"""Resolve official bibliography titles and stable author profiles without a five-paper cap.

Run audit-paper-coverage.py first. This writes a reviewable result snapshot;
merge-publication-completion.ts merges it without modifying the first 12 records.
"""
import argparse
import concurrent.futures
import hashlib
import html
import importlib
import json
import pathlib
import re
import urllib.parse
from pypinyin import lazy_pinyin

evidence = importlib.import_module('audit-paper-coverage')
ROOT, DAY, CURATED = evidence.ROOT, evidence.DAY, evidence.CURATED
OUT = ROOT / 'data/publication-completion.json'


def normal(value):
    return ''.join(c for c in html.unescape(value).lower() if c.isalnum())


def plain(value):
    return re.sub(r'\s+', ' ', html.unescape(re.sub('<[^>]+>', '', value))).strip()


def title_matches(title, line):
    return len(normal(title)) >= 15 and normal(title) in normal(line)


def crossref_author_matches(item, mentor):
    parts = lazy_pinyin(mentor['name'])
    family, given = (''.join(parts[:2]), ''.join(parts[2:])) if mentor['name'].startswith('诸葛') else (parts[0], ''.join(parts[1:]))
    families = {family, 'xie'} if mentor['name'].startswith('解') else {family}
    expected = {normal(given + f) for f in families} | {normal(f + given) for f in families}
    if mentor.get('englishName'):
        expected.add(normal(mentor['englishName']))
    for author in item.get('author', []):
        actual_given, actual_family = normal(author.get('given', '')), normal(author.get('family', ''))
        if actual_given + actual_family in expected or actual_family + actual_given in expected:
            return True
        # Retain real initials supplied by publishers, never expand them.
        if actual_family in families and len(actual_given) <= 3 and actual_given and actual_given[0] == given[0] and not re.search(r'[a-z]{2}', author.get('given', '').lower()):
            return True
    return False


def candidate_lines(person):
    profile = next((p for p in PROFILES if p['id'] == person['id']), {})
    official = (profile.get('sections') or {}).get('代表性论文及专著', '')
    sources = [(person['officialUrl'], official)]
    # Personal sites can contain group/coauthor lists, so require the teacher's
    # full name or surname+initial in each bibliographic line before querying.
    for page in person.get('pages', []):
        if re.search(r'publications?|papers|论文|成果', page['url'], re.I):
            sources.append((page['url'], page['text']))
    seen = set()
    for url, text in sources:
        for line in text.splitlines():
            if not re.search(r'\b202[3-6]\b', line) or len(line) > 2000:
                continue
            if len(re.findall('[A-Za-z]', line)) < 18:
                continue
            if url != person['officialUrl'] and not name_in_line(person['name'], line):
                continue
            key = normal(line)
            if key not in seen:
                seen.add(key)
                yield {'url': url, 'line': line}


def name_in_line(name, line):
    parts = lazy_pinyin(name)
    family, given = parts[0], ''.join(parts[1:])
    text = normal(line)
    return (normal(given + family) in text or normal(family + given) in text
            or bool(re.search(r'\b' + re.escape(given[:1]) + r'\.?\s*' + re.escape(family) + r'\b', line, re.I)))


def crossref_paper(item, mentor, ref):
    title = plain((item.get('title') or [''])[0])
    if not title_matches(title, ref['line']) or not crossref_author_matches(item, mentor):
        return None
    dates = (item.get('published-online') or item.get('published') or item.get('issued') or {}).get('date-parts', [[]])[0]
    if not dates or dates[0] < 2023 or dates[0] > 2026:
        return None
    date = '-'.join(str(v) if i == 0 else str(v).zfill(2) for i, v in enumerate(dates[:3]))
    if len(date) > 4 and date > DAY:
        return None
    doi = item['DOI']
    url = 'https://doi.org/' + doi
    key = hashlib.sha256(doi.lower().encode()).hexdigest()[:20]
    return {'id': 'paper-crossref-' + key, 'title': title, 'date': date,
            'precision': ['year', 'month', 'day'][min(len(dates), 3) - 1],
            'venue': plain((item.get('container-title') or ['发表位置待核实'])[0]),
            'doi': doi, 'authors': [plain(' '.join(filter(None, [a.get('given'), a.get('family')]))) for a in item.get('author', [])],
            'abstract': plain(item.get('abstract', '')) or None, 'url': url,
            'status': 'preprint' if item.get('type') == 'posted-content' else 'published',
            'versions': [{'kind': 'Crossref 发表元信息', 'date': date, 'url': url}],
            'source': {'id': 'crossref-' + key, 'title': title, 'url': url, 'kind': 'paper', 'retrievedAt': DAY,
                       'excerpt': '教师公开书目来源：' + ref['url'] + '\n' + ref['line']},
            'identity': '学院个人页或其链接的教师主页列出该论文；Crossref 完整题名与书目逐字归一化匹配。',
            **({'dateNote': '公开来源仅提供年份或月份，不推断具体发表日。'} if len(dates) < 3 else {})}


def resolve_line(job):
    mentor, ref = job
    try:
        doi = re.search(r'10\.\d{4,9}/[^\s<>"，；]+', ref['line'], re.I)
        urls = []
        if doi:
            urls.append('https://api.crossref.org/works/' + urllib.parse.quote(doi.group().rstrip('.,;)'), safe=''))
        quoted = re.search(r'[“"]([^”"]{15,800})[”"]', ref['line'])
        query = quoted.group(1).strip(' ,.;') if quoted else ref['line']
        urls.append('https://api.crossref.org/works?' + urllib.parse.urlencode({'query.bibliographic': query, 'rows': 3}))
        for url in urls:
            try:
                response = evidence.fetch(url, True)['message']
            except Exception:
                if len(urls) == 1 or url == urls[-1]:
                    raise
                continue
            for item in response.get('items', []) if 'items' in response else [response]:
                paper = crossref_paper(item, mentor, ref)
                if paper:
                    return {'mentorId': mentor['id'], **ref, 'status': 'matched', 'paper': paper}
        return {'mentorId': mentor['id'], **ref, 'status': 'unresolved'}
    except Exception as error:
        return {'mentorId': mentor['id'], **ref, 'status': 'error', 'reason': str(error)[:180]}


def scholar_rows(raw):
    rows = []
    for row in re.findall(r'<tr\b[^>]*class="gsc_a_tr"[^>]*>(.*?)</tr>', raw, re.S):
        title = re.search(r'<a\b[^>]*class="gsc_a_at"[^>]*>(.*?)</a>', row, re.S)
        link = re.search(r'<a\b[^>]*href="([^"]+)"[^>]*class="gsc_a_at"', row)
        if not link:
            link = re.search(r'<a\b[^>]*class="gsc_a_at"[^>]*href="([^"]+)"', row)
        year = re.search(r'<span[^>]*class="[^"]*gsc_a_h[^"]*"[^>]*>(\d{4})</span>', row)
        gray = re.findall(r'<div class="gs_gray">(.*?)</div>', row, re.S)
        if title and year:
            rows.append({'title': plain(title.group(1)), 'year': year.group(1), 'authors': plain(gray[0]) if gray else '', 'venue': plain(gray[1]) if len(gray) > 1 else '', 'detailUrl': urllib.parse.urljoin('https://scholar.google.com', html.unescape(link.group(1))) if link else ''})
    return rows


def collect_scholar(person):
    results = []
    seen = set()
    for link in person['links']:
        if not re.search(r'scholar\.google\.', link['url']):
            continue
        user = urllib.parse.parse_qs(urllib.parse.urlparse(link['url']).query).get('user', [''])[0]
        if not user or user in seen:
            continue
        seen.add(user)
        result = {'user': user, 'officialLink': link, 'rows': [], 'pages': []}
        try:
            for start in range(0, 1000, 100):
                url = 'https://scholar.google.com/citations?' + urllib.parse.urlencode({'user': user, 'hl': 'en', 'pagesize': 100, 'sortby': 'pubdate', 'cstart': start})
                raw = evidence.fetch(url)
                name = re.search(r'<div[^>]*id="gsc_prf_in"[^>]*>(.*?)</div>', raw, re.S)
                result['displayName'] = plain(name.group(1)) if name else ''
                # Links on a lab site can point to collaborators: exclude them.
                names = normal(result['displayName'])
                parts = lazy_pinyin(person['name'])
                expected = {normal(''.join(parts[1:]) + parts[0]), normal(''.join(parts))}
                direct = not link.get('via')
                if not direct and not any(n in names for n in expected):
                    result['status'] = 'other_person'
                    break
                rows = scholar_rows(raw)
                result['pages'].append(url)
                if not rows:
                    if not result['rows']:
                        raise ValueError('Scholar 未返回公开论文列表')
                    break
                result['rows'].extend(row for row in rows if row['year'] >= '2023')
                if len(rows) < 100 or rows[-1]['year'] < '2023':
                    break
            else:
                result['paginationLimit'] = True
            result.setdefault('status', 'ok')
        except Exception as error:
            result['status'] = 'error'
            result['reason'] = str(error)[:180]
        results.append(result)
    return person['id'], results


def openalex_person(mentor):
    result = {'mentorId': mentor['id'], 'authors': [], 'papers': [], 'status': 'unresolved'}
    author_id = mentor.get('authorId', '')
    try:
        candidates = []
        if 'openalex.org/A' in author_id:
            candidates.append({'id': author_id, 'basis': 'existing_verified_author'})
        else:
            parts = lazy_pinyin(mentor['name'])
            english = (''.join(parts[1:]) + ' ' + parts[0]).title()
            url = 'https://api.openalex.org/authors?' + urllib.parse.urlencode({'search': english, 'per-page': 25})
            data = evidence.fetch(url, True)
            exact = [a for a in data.get('results', []) if normal(a.get('display_name', '')) in {normal(english), normal(''.join(parts))}]
            affiliated = [a for a in exact if any('Shanghai Jiao Tong' in i.get('display_name', '') for i in a.get('last_known_institutions', []))]
            if len(affiliated) == 1:
                candidates.append({'id': affiliated[0]['id'], 'basis': 'unique_exact_name_and_sjtu'})
            elif exact:
                result['reason'] = '同名作者无法唯一核验'
        for candidate in candidates:
            cursor = '*'
            works = []
            while cursor:
                url = 'https://api.openalex.org/works?' + urllib.parse.urlencode({'filter': 'author.id:' + candidate['id'].split('/')[-1] + ',from_publication_date:2023-10-20,to_publication_date:' + DAY, 'per-page': 100, 'sort': 'publication_date:desc', 'cursor': cursor})
                data = evidence.fetch(url, True)
                works.extend(data.get('results', []))
                if len(works) >= data.get('meta', {}).get('count', 0) or not data.get('results'):
                    break
                cursor = data.get('meta', {}).get('next_cursor')
            result['authors'].append({**candidate, 'works': len(works)})
            for work in works:
                # New matches must have teacher-specific SJTU authorship. Stable
                # existing identities also retain pre-SJTU works after checking
                # their author name, avoiding the new-faculty affiliation gap.
                own = [a for a in work.get('authorships', []) if a.get('author', {}).get('id') == candidate['id']]
                sjtu = any('Shanghai Jiao Tong' in i.get('display_name', '') for a in own for i in a.get('institutions', []))
                if candidate['basis'] != 'existing_verified_author' and not sjtu:
                    continue
                title = work.get('title') or ''
                if not title:
                    continue
                words = {pos: word for word, positions in (work.get('abstract_inverted_index') or {}).items() for pos in positions}
                abstract = ' '.join(words[pos] for pos in sorted(words)) or None
                doi = (work.get('doi') or '').removeprefix('https://doi.org/') or None
                primary = work.get('primary_location') or {}
                url = work.get('doi') or primary.get('landing_page_url') or work['id']
                date = work.get('publication_date') or str(work.get('publication_year'))
                key = work['id'].split('/')[-1]
                preprint = work.get('type') == 'preprint' or (doi or '').lower().startswith('10.48550/arxiv')
                result['papers'].append({'id': 'paper-' + key, 'title': title, 'date': date, 'precision': 'day' if work.get('publication_date') else 'year', 'venue': (primary.get('source') or {}).get('display_name') or '发表位置待核实', 'doi': doi, 'authors': [a.get('author', {}).get('display_name', '') for a in work.get('authorships', [])], 'abstract': abstract, 'url': url, 'status': 'preprint' if preprint else 'published', 'versions': [{'kind': '预印本' if preprint else '正式发表元信息', 'date': date, 'url': url}], 'source': {'id': 'source-paper-' + key, 'title': title, 'url': work['id'], 'kind': 'paper', 'retrievedAt': DAY}, 'identity': '经姓名与交大单位核对的 OpenAlex 作者档案；本次按稳定作者 ID 完整分页检索，包含入职前作品。' if candidate['basis'] == 'existing_verified_author' else 'OpenAlex 拼音姓名精确匹配且交大作者档案唯一；本篇该作者的单位标注为上海交通大学。'})
        result['status'] = 'ok' if candidates else 'unresolved'
    except Exception as error:
        result['status'] = 'error'
        result['reason'] = str(error)[:180]
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--stage', choices=['scholar', 'bibliography', 'authors'], required=True)
    parser.add_argument('--workers', type=int, default=4)
    parser.add_argument('--max-per-person', type=int, default=0)
    parser.add_argument('--retry-errors', action='store_true')
    parser.add_argument('--only-incomplete', action='store_true')
    args = parser.parse_args()
    global PROFILES
    PROFILES = json.loads((ROOT / 'data/source-profiles.json').read_text())
    people = json.loads((ROOT / 'data/publication-evidence.json').read_text())['people']
    mentors = {m['id']: m for m in json.loads((ROOT / 'data/seed.json').read_text())['mentors'] if m['id'] not in CURATED}
    state = json.loads(OUT.read_text()) if OUT.exists() else {'checkedAt': DAY, 'scholar': {}, 'bibliography': {}, 'authors': {}}
    if args.stage == 'scholar':
        jobs = [p for p in people.values() if p['id'] not in state['scholar'] and any('scholar.google.' in l['url'] for l in p['links'])]
        function = collect_scholar
    elif args.stage == 'authors':
        jobs = [m for m in mentors.values() if m['id'] not in state['authors']]
        function = openalex_person
    else:
        jobs = []
        audit_path = ROOT / 'data/publication-coverage-audit.json'
        filled = {p['id'] for p in json.loads(audit_path.read_text())['people'] if p['after']['recent'] >= 5} if args.only_incomplete and audit_path.exists() else set()
        for ident, person in people.items():
            if ident in filled:
                continue
            refs = list(candidate_lines(person))
            for scholar in state['scholar'].get(ident, []):
                if scholar['status'] == 'ok':
                    refs.extend({'url': scholar['pages'][0], 'line': row['authors'] + '. "' + row['title'] + '". ' + row['venue'] + ', ' + row['year']} for row in scholar['rows'])
            if args.max_per_person:
                refs = refs[:args.max_per_person]
            for ref in refs:
                key = ident + ':' + hashlib.sha256(normal(ref['line']).encode()).hexdigest()[:20]
                if key not in state['bibliography'] or args.retry_errors and state['bibliography'][key]['status'] == 'error':
                    jobs.append((mentors[ident], {**ref, 'key': key}))
        function = resolve_line
    print(json.dumps({'stage': args.stage, 'pending': len(jobs)}), flush=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as executor:
        futures = [executor.submit(function, job) for job in jobs]
        for index, future in enumerate(concurrent.futures.as_completed(futures), 1):
            result = future.result()
            if args.stage == 'scholar':
                key, value = result
            elif args.stage == 'bibliography':
                key, value = result['key'], result
            else:
                key, value = result['mentorId'], result
            state[args.stage][key] = value
            evidence.save_json(OUT, state)
            print(json.dumps({'stage': args.stage, 'done': index, 'total': len(jobs), 'id': key, 'status': value.get('status') if isinstance(value, dict) else [v['status'] for v in value]}, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    main()
