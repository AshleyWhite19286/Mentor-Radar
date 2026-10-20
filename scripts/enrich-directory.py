"""Incrementally add verified recent OpenAlex works to official directory records.

This deliberately skips ambiguous authors: a Chinese-name exact match and SJTU
affiliation evidence are both required before any paper is attached.
"""
import argparse, datetime, json, pathlib, re, time, urllib.error, urllib.parse, urllib.request
from pypinyin import lazy_pinyin

ROOT = pathlib.Path(__file__).resolve().parent.parent
SEED = ROOT / 'data' / 'seed.json'
PROFILES = ROOT / 'data' / 'source-profiles.json'
STATE = ROOT / 'data' / 'directory-enrichment-progress.json'
DAY = '2026-10-20'
CUTOFF = '2023-10-20'

def request(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'MentorRadar/0.2 (verified academic directory enrichment)'})
    for attempt in range(6):
        try:
            with urllib.request.urlopen(req, timeout=30) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            if error.code not in (429, 500, 502, 503, 504) or attempt == 5:
                raise
            time.sleep((attempt + 1) * 5)

def abstract(index):
    words = {}
    for word, positions in (index or {}).items():
        for position in positions:
            words[position] = word
    return ' '.join(words[position] for position in sorted(words))

def is_sjtu(values):
    return any('Shanghai Jiao Tong' in value.get('display_name', '') for value in values or [])

def romanize(name):
    parts = lazy_pinyin(name)
    return ' '.join(parts[1:] + parts[:1]).title()

def normalized(value):
    return re.sub(r'[^a-z0-9]', '', value.lower())

def has_sjtu_authorship(work, author_id):
    for authorship in work.get('authorships', []):
        if str(authorship.get('author', {}).get('id') or '').endswith('/' + author_id):
            return is_sjtu(authorship.get('institutions'))
    return False

def paper(work, author_id, name):
    doi = (work.get('doi') or '').replace('https://doi.org/', '')
    primary = work.get('primary_location') or {}
    source = primary.get('source') or {}
    url = work.get('doi') or primary.get('landing_page_url') or work['id']
    is_preprint = work.get('type') == 'preprint' or doi.startswith('10.48550/arxiv.')
    return {
        'id': 'paper-' + work['id'].rsplit('/', 1)[-1],
        'title': work.get('title') or '标题待核实',
        'date': work.get('publication_date') or str(work.get('publication_year')),
        'precision': 'day' if work.get('publication_date') else 'year',
        'venue': source.get('display_name') or '发表位置待核实',
        'doi': doi or None,
        'authors': [item.get('author', {}).get('display_name', '') for item in work.get('authorships', [])],
        'abstract': abstract(work.get('abstract_inverted_index')) or None,
        'url': url,
        'status': 'preprint' if is_preprint else 'published',
        'versions': [{'kind': '预印本' if is_preprint else '正式发表元信息', 'date': work.get('publication_date') or str(work.get('publication_year')), 'url': url}],
        'source': {'id': 'source-paper-' + work['id'].rsplit('/', 1)[-1], 'title': work.get('title') or '论文元信息', 'url': work['id'], 'kind': 'paper', 'retrievedAt': DAY},
        'identity': f'OpenAlex 中文姓名精确匹配“{name}”；该作者在本条记录标注上海交通大学单位；待人工复核。',
    }

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--retry', action='store_true', help='Retry people previously marked unresolved.')
    parser.add_argument('--only-errors', action='store_true', help='Retry only records with a transient request error.')
    parser.add_argument('--limit', type=int, default=0, help='Process at most this many pending people.')
    args = parser.parse_args()
    seed = json.loads(SEED.read_text())
    profiles = {profile['id']: profile for profile in json.loads(PROFILES.read_text())}
    state = json.loads(STATE.read_text()) if STATE.exists() else {'updatedAt': DAY, 'people': {}}
    pending = [mentor for mentor in seed['mentors'] if not mentor.get('papers') and (args.retry or args.only_errors or mentor['id'] not in state['people'])]
    if args.only_errors:
        pending = [mentor for mentor in pending if state['people'].get(mentor['id'], {}).get('status') == 'error']
    if args.limit:
        pending = pending[:args.limit]
    total = len(pending)
    print(json.dumps({'event': 'started', 'pending': total, 'completed': len(state['people'])}, ensure_ascii=False), flush=True)
    for number, mentor in enumerate(pending, 1):
        name = mentor['name']
        result = {'status': 'unresolved', 'reason': '未找到满足单位条件的中文姓名精确作者档案'}
        try:
            english_name = romanize(name)
            search = request('https://api.openalex.org/authors?search=' + urllib.parse.quote(english_name) + '&per-page=20')
            candidates = [candidate for candidate in search.get('results', []) if normalized(candidate.get('display_name', '')) == normalized(english_name)]
            sjtu_candidates = [candidate for candidate in candidates if is_sjtu(candidate.get('last_known_institutions'))]
            if len(sjtu_candidates) == 1:
                candidates = sjtu_candidates
            if len(candidates) == 1:
                candidate = candidates[0]
                author_id = candidate['id'].rsplit('/', 1)[-1]
                works_url = ('https://api.openalex.org/works?filter=authorships.author.id:' + author_id +
                    ',from_publication_date:' + CUTOFF + ',to_publication_date:' + DAY + '&sort=publication_date:desc&per-page=100')
                works = request(works_url).get('results', [])
                verified = [work for work in works if has_sjtu_authorship(work, author_id)]
                papers = [paper(work, author_id, name) for work in verified[:5]]
                if papers:
                    mentor['authorId'] = candidate['id']
                    mentor['papers'] = papers
                    mentor['coverageNote'] = f'OpenAlex检索近36个月，作者中文姓名与上海交通大学单位交叉核验；当前收录{len(papers)}篇，后续需人工复核。'
                    result = {'status': 'enriched', 'authorId': candidate['id'], 'papers': len(papers), 'abstracts': sum(bool(item.get('abstract')) for item in papers)}
                else:
                    result = {'status': 'unresolved', 'reason': '作者档案匹配，但近36个月没有带上海交通大学单位标注的作品'}
            elif not candidates:
                result = {'status': 'unresolved', 'reason': f'没有拼音姓名精确匹配的作者档案（检索名：{english_name}）'}
            else:
                result = {'status': 'ambiguous', 'reason': f'存在{len(candidates)}个同名上海交通大学作者档案'}
        except Exception as error:
            result = {'status': 'error', 'reason': type(error).__name__}
        state['people'][mentor['id']] = result
        state['updatedAt'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
        SEED.write_text(json.dumps(seed, ensure_ascii=False, indent=2) + '\n')
        STATE.write_text(json.dumps(state, ensure_ascii=False, indent=2) + '\n')
        print(json.dumps({'event': 'progress', 'current': number, 'total': total, 'id': mentor['id'], 'name': name, **result}, ensure_ascii=False), flush=True)
        time.sleep(0.15)
    summary = {}
    for item in state['people'].values():
        summary[item['status']] = summary.get(item['status'], 0) + 1
    print(json.dumps({'event': 'complete', 'summary': summary}, ensure_ascii=False), flush=True)

if __name__ == '__main__':
    main()
