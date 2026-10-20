"""Retrieve complete recent bibliographies using author IDs anchored in official works.

A name search alone is never sufficient: one exact official title and the
teacher's full romanized name must occur together in the same indexed paper.
All author-paper pages are traversed, including work before joining SJTU.
"""
import argparse
import concurrent.futures
import importlib
import json
import re
import threading
import time
import urllib.parse
from pypinyin import lazy_pinyin

coverage = importlib.import_module('audit-paper-coverage')
completion = importlib.import_module('complete-publications')
ROOT, DAY = coverage.ROOT, coverage.DAY
OUT = ROOT / 'data/anchored-author-publications.json'
lock = threading.Lock()
last_request = 0.0


def semantic(path, params):
    global last_request
    with lock:
        delay = max(0, last_request + 1.05 - time.monotonic())
        if delay:
            time.sleep(delay)
        last_request = time.monotonic()
    return coverage.fetch('https://api.semanticscholar.org/graph/v1/' + path + '?' + urllib.parse.urlencode(params), True)


def author_names(mentor):
    parts = lazy_pinyin(mentor['name'])
    if mentor['name'].startswith('诸葛'):
        family, given = ''.join(parts[:2]), ''.join(parts[2:])
    else:
        family, given = parts[0], ''.join(parts[1:])
    families = {family}
    if mentor['name'].startswith('解'):
        families.add('xie')
    names = {completion.normal(f + given) for f in families} | {completion.normal(given + f) for f in families}
    if mentor.get('englishName'):
        names.add(completion.normal(mentor['englishName']))
    return names


def crossref_anchor(mentor, line):
    url = 'https://api.crossref.org/works?' + urllib.parse.urlencode({'query.bibliographic': line, 'rows': 3})
    items = coverage.fetch(url, True)['message'].get('items', [])
    for item in items:
        title = completion.plain((item.get('title') or [''])[0])
        if completion.title_matches(title, line):
            return title, item.get('DOI')
    return None


def unquoted_title(line):
    # Common bibliography: Name, Name, Full paper title, Venue, year.
    # A query candidate is only a hint: the returned complete title must still
    # occur in the original official line before an author ID is accepted.
    for chunk in re.split(r',|[.;](?=\s*[A-Z])|:', line):
        value = chunk.strip(' .;，；')
        words = re.findall(r'[A-Za-z][A-Za-z-]*', value)
        if len(words) >= 5 and len(value) >= 24 and not re.search(r'IEEE|Proceedings|Transactions|Conference|University|Journal|\bvol\b|\bpp\b', value, re.I):
            return value
    return None


def paper(item, mentor, anchor):
    if not item.get('year') or item['year'] < 2023 or item['year'] > 2026:
        return None
    date = item.get('publicationDate') or str(item['year'])
    if len(date) > 4 and (date > DAY or date < '2023-10-20'):
        return None
    ids = item.get('externalIds') or {}
    doi, arxiv = ids.get('DOI'), ids.get('ArXiv')
    published = item.get('publicationVenue') or {}
    venue = item.get('venue') or published.get('name') or ''
    preprint = not venue or 'arxiv' in venue.lower()
    # S2 sometimes supplies an arXiv DOI for a work with a formal venue.
    url = 'https://doi.org/' + doi if doi else item.get('url') or 'https://www.semanticscholar.org/paper/' + item['paperId']
    title = item['title']
    return {'id': 'paper-s2-' + item['paperId'], 'title': title, 'date': date, 'precision': 'day' if item.get('publicationDate') else 'year', 'venue': venue or ('arXiv' if arxiv else '发表位置待核实'), 'doi': doi, 'arxivId': arxiv, 'authors': [a['name'] for a in item.get('authors', [])], 'abstract': item.get('abstract') or None, 'url': url, 'status': 'preprint' if preprint else 'published', 'versions': [{'kind': 'Semantic Scholar 论文元信息', 'date': date, 'url': url}], 'source': {'id': 'source-s2-' + item['paperId'], 'title': title, 'url': item.get('url') or url, 'kind': 'paper', 'retrievedAt': DAY, 'excerpt': '作者身份核验所用官网代表作：' + anchor.get('title', '') + '\n' + mentor['source']['url']}, 'identity': '学院个人页代表作的完整题名和作者全名与 Semantic Scholar 同一论文记录匹配；按其稳定作者 ID 检索后续论文，包含入职前作品。', **({'dateNote': '索引仅提供年份；不推断具体发表日。'} if not item.get('publicationDate') else {})}


def enrich(mentor, profiles):
    result = {'id': mentor['id'], 'name': mentor['name'], 'checkedAt': DAY, 'status': 'unresolved', 'anchors': [], 'authors': [], 'papers': [], 'errors': []}
    profile = profiles.get(mentor['id'], {})
    lines = [line for line in (profile.get('sections') or {}).get('代表性论文及专著', '').splitlines() if len(re.findall('[A-Za-z]', line)) >= 25 and len(line) < 1800 and not re.search(r'专利|patents|ZL\d|CN\d', line, re.I)]
    pages = json.loads((ROOT / 'data/publication-evidence.json').read_text())['people'].get(mentor['id'], {}).get('pages', [])
    for page in pages:
        for line in page['text'].splitlines():
            if len(line) < 1800 and completion.name_in_line(mentor['name'], line) and len(re.findall('[A-Za-z]', line)) >= 60:
                lines.append(line)
    names = author_names(mentor)
    author_ids = set()
    existing = mentor.get('authorId', '')
    if 'semanticscholar.org/author/' in existing:
        author_ids.add(existing.rstrip('/').split('/')[-1])
        result['anchors'].append({'title': '此前已与官网 Scholar 链接交叉核验的作者档案', 'authorId': existing})
    # Prefer an existing DOI that is also explicitly present in the official
    # bibliography. Otherwise resolve old official titles, not just 2023+ rows.
    for line in lines[:4]:
        if author_ids:
            break
        try:
            quoted = re.search(r'[“"]([^”"]{15,800})[”"]', line)
            title_hint = quoted.group(1).strip(' ,.;') if quoted else unquoted_title(line)
            anchor = (title_hint, None) if title_hint else crossref_anchor(mentor, line)
            if anchor is None:
                continue
            title, doi = anchor
            if doi:
                data = semantic('paper/DOI:' + urllib.parse.quote(doi, safe=''), {'fields': 'title,authors,externalIds'})
                items = [data]
            else:
                data = semantic('paper/search/match', {'query': title, 'fields': 'title,authors,year,externalIds'})
                items = data.get('data', [])
            for item in items:
                if not completion.title_matches(item.get('title', ''), line):
                    continue
                matches = [a for a in item.get('authors', []) if completion.normal(a['name']) in names and a.get('authorId')]
                if len(matches) == 1:
                    author_ids.add(matches[0]['authorId'])
                    result['anchors'].append({'title': item['title'], 'officialLine': line, 'url': mentor['source']['url'], 'author': matches[0], 'paperId': item['paperId']})
        except Exception as error:
            result['errors'].append({'stage': 'anchor', 'line': line, 'reason': str(error)[:180]})
            if sum('429' in error['reason'] for error in result['errors']) >= 2:
                break
    for author_id in sorted(author_ids):
        try:
            offset = 0
            count = 0
            while True:
                data = semantic('author/' + author_id + '/papers', {'fields': 'title,year,publicationDate,venue,publicationVenue,authors,abstract,externalIds,url,publicationTypes', 'limit': 1000, 'offset': offset})
                items = data.get('data', [])
                count += len(items)
                for item in items:
                    entry = paper(item, mentor, result['anchors'][0])
                    if entry:
                        result['papers'].append(entry)
                if data.get('next') is None:
                    break
                offset = data['next']
            result['authors'].append({'authorId': author_id, 'retrievedWorks': count})
        except Exception as error:
            result['errors'].append({'stage': 'author_papers', 'authorId': author_id, 'reason': str(error)[:180]})
    if result['authors']:
        result['status'] = 'ok'
    elif result['errors']:
        result['status'] = 'error'
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--workers', type=int, default=3)
    parser.add_argument('--only', default='')
    parser.add_argument('--retry-errors', action='store_true')
    args = parser.parse_args()
    state = json.loads(OUT.read_text()) if OUT.exists() else {'checkedAt': DAY, 'people': {}}
    profiles = {p['id']: p for p in json.loads((ROOT / 'data/source-profiles.json').read_text())}
    mentors = [m for m in json.loads((ROOT / 'data/seed.json').read_text())['mentors'] if m['id'] not in coverage.CURATED and (m['id'] not in state['people'] or args.retry_errors and state['people'][m['id']]['status'] != 'ok') and (not args.only or m['id'] in args.only.split(','))]
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as executor:
        futures = [executor.submit(enrich, mentor, profiles) for mentor in mentors]
        for index, future in enumerate(concurrent.futures.as_completed(futures), 1):
            result = future.result()
            state['people'][result['id']] = result
            coverage.save_json(OUT, state)
            print(json.dumps({'checked': index, 'total': len(mentors), 'name': result['name'], 'status': result['status'], 'authors': len(result['authors']), 'papers': len(result['papers']), 'errors': len(result['errors'])}, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    main()
