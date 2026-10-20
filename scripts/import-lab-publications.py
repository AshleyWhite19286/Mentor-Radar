"""Import explicit author-linked records from the university Media Lab index."""
import hashlib
import importlib
import json
import re
import urllib.parse

coverage = importlib.import_module('audit-paper-coverage')
completion = importlib.import_module('complete-publications')
anchored = importlib.import_module('enrich-anchored-authors')
ROOT, DAY = coverage.ROOT, coverage.DAY
URL = 'https://medialab.sjtu.edu.cn/publication'


def main():
    mentors = [m for m in json.loads((ROOT / 'data/seed.json').read_text())['mentors'] if m['id'] not in coverage.CURATED]
    names = {}
    for mentor in mentors:
        for name in anchored.author_names(mentor):
            names.setdefault(name, []).append(mentor)
    raw = coverage.fetch(URL)
    people = {}
    for block in re.findall(r'<div class="pub-list-item view-citation"[^>]*>(.*?)</div>', raw, re.S):
        page = coverage.Page(block, URL)
        year = re.search(r'\((202[3-6])\)\.', page.text)
        link = next((link for link in page.links if re.search(r'/publication/[^/#?]+/', link['url'])), None)
        if not year or not link:
            continue
        title = link['label'].strip()
        authors = [a for a in page.links if '/author/' in a['url']]
        venue = re.search(r'<em>(.*?)</em>', block, re.S)
        venue = completion.plain(venue.group(1)) if venue else '发表位置待核实'
        doi_link = next((a['url'] for a in page.links if 'doi.org/' in a['url']), None)
        doi = urllib.parse.unquote(doi_link.split('doi.org/')[1]) if doi_link else None
        arxiv = re.search(r'(?:arxiv\.|arxiv/)(\d{4}\.\d{4,5})', doi or '', re.I)
        preprint = venue.lower() == 'corr' or bool(arxiv)
        key = hashlib.sha256(link['url'].encode()).hexdigest()[:20]
        paper = {'id': 'paper-lab-' + key, 'title': title, 'date': year.group(1), 'precision': 'year', 'venue': venue, 'doi': doi, 'arxivId': arxiv.group(1) if arxiv else None, 'authors': [a['label'].strip() for a in authors], 'url': doi_link or link['url'], 'status': 'preprint' if preprint else 'published', 'versions': [{'kind': '上海交大 Media Lab 官方论文书目', 'date': year.group(1), 'url': link['url']}], 'source': {'id': 'source-lab-' + key, 'title': title, 'url': link['url'], 'kind': 'official', 'retrievedAt': DAY}, 'identity': '上海交大 Media Lab 官方论文目录明确列出完整作者，并链接到对应作者页；与学院教师姓名及研究所归属核对。', 'dateNote': '团队书目仅给出发表年份；网站发布/修改时间不作为论文发表日期，也不把默认一月一日当作真实日期。'}
        for author in authors:
            match = names.get(completion.normal(re.sub(r'\s+\d{4}$', '', author['label'].strip())), [])
            if len(match) != 1 or match[0]['instituteId'] not in ('image', 'media', 'intelligence', 'data'):
                continue
            mentor = match[0]
            entry = people.setdefault(mentor['id'], {'id': mentor['id'], 'name': mentor['name'], 'authorUrl': author['url'], 'papers': []})
            entry['papers'].append(paper)
    coverage.save_json(ROOT / 'data/lab-publication-records.json', {'checkedAt': DAY, 'indexUrl': URL, 'people': people})
    print(json.dumps({'people': len(people), 'papers': sum(len(p['papers']) for p in people.values())}))


if __name__ == '__main__':
    main()
