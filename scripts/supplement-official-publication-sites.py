"""Check university profile sites for faculty whose school page lacks a bibliography."""
import concurrent.futures
import importlib
import json
import re
import urllib.parse

coverage = importlib.import_module('audit-paper-coverage')
ROOT = coverage.ROOT
EXTRA = {
    'xierong': ['https://icne.sjtu.edu.cn/info/1030/1049.htm', 'https://medialab.sjtu.edu.cn/author/rong-xie/'],
    'liyongfu': ['https://bicasl-en.sjtu.edu.cn/info/1019/1058.htm'],
    'wangguoxing': ['https://bicasl.sjtu.edu.cn/info/1017/1080.htm'],
    '2765': ['https://carfic.sjtu.edu.cn/%E5%9B%A2%E9%98%9F%E6%88%90%E5%91%98'],
    'jinjing': ['https://faculty.sjtu.edu.cn/jinjing1'],
    'maozhigang': ['https://faculty.sjtu.edu.cn/maozhigang'],
}


def collect(mentor, person):
    urls = EXTRA.get(mentor['id'], []) + ['https://faculty.sjtu.edu.cn/' + mentor['id']]
    visited = {p['url'] for p in person['pages']}
    for url in urls:
        if url in visited:
            continue
        try:
            raw = coverage.fetch(url)
            page = coverage.Page(raw, url)
            text = coverage.clean_lines(page.text)
            email_match = mentor.get('email') and mentor['email'].lower() in text.lower()
            title = re.search(r'<title[^>]*>(.*?)</title>', raw, re.S | re.I)
            name_match = title and mentor['name'] in title.group(1)
            # Extra author pages were manually checked on the university site.
            curated_extra = url in EXTRA.get(mentor['id'], [])
            if not (email_match or name_match or curated_extra):
                continue
            person['requests'].append({'url': url, 'kind': 'additional_official', 'status': 'ok'})
            person['pages'].append({'url': url, 'text': text, 'links': page.links})
            visited.add(url)
            person['links'].append({'url': url, 'label': '学校补充个人资料'})
            links = [link for link in page.links if coverage.publication_link(link)]
            for link in links:
                if 'scholar.google.' in link['url']:
                    if link['url'] not in {p['url'] for p in person['links']}:
                        person['links'].append({**link, 'via': url})
            for link in [link for link in links if urllib.parse.urlparse(link['url']).hostname == urllib.parse.urlparse(url).hostname and re.search('论文|publications?|papers|lwzx', link['label']+' '+link['url'], re.I)][:3]:
                if link['url'] in visited:
                    continue
                publication = coverage.Page(coverage.fetch(link['url']), link['url'])
                person['requests'].append({'url': link['url'], 'kind': 'additional_publications', 'status': 'ok'})
                person['pages'].append({'url': link['url'], 'text': coverage.clean_lines(publication.text), 'links': publication.links})
                visited.add(link['url'])
        except Exception as error:
            person['requests'].append({'url': url, 'kind': 'additional_official', 'status': 'error', 'reason': str(error)[:180]})
    return person


def main():
    path = ROOT / 'data/publication-evidence.json'
    state = json.loads(path.read_text())
    profiles = {p['id']: p for p in json.loads((ROOT / 'data/source-profiles.json').read_text())}
    mentors = [m for m in json.loads((ROOT / 'data/seed.json').read_text())['mentors'] if m['id'] not in coverage.CURATED and (m['id'] in EXTRA or not profiles.get(m['id'], {}).get('sections', {}).get('代表性论文及专著') and not m['papers'] and re.search('教授|研究员', m['title']))]
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
        futures = [executor.submit(collect, mentor, state['people'][mentor['id']]) for mentor in mentors]
        for future in concurrent.futures.as_completed(futures):
            person = future.result()
            state['people'][person['id']] = person
            coverage.save_json(path, state)
            print(person['name'], len(person['pages']), flush=True)


if __name__ == '__main__':
    main()
