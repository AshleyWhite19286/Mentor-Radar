"""Retain all explicitly titled official works, including unindexed publications.

Keep the actual year precision, original author string, and bibliography line.
This fallback does not invent DOIs, abstracts, author expansions, or dates.
"""
import hashlib
import importlib
import json
import re

coverage = importlib.import_module('audit-paper-coverage')
completion = importlib.import_module('complete-publications')
ROOT, DAY = coverage.ROOT, coverage.DAY


def main():
    mentors = {m['id']: m for m in json.loads((ROOT / 'data/seed.json').read_text())['mentors'] if m['id'] not in coverage.CURATED}
    profiles = {p['id']: p for p in json.loads((ROOT / 'data/source-profiles.json').read_text())}
    people = json.loads((ROOT / 'data/publication-evidence.json').read_text())['people']
    results = {}
    for ident, mentor in mentors.items():
        official = (profiles.get(ident, {}).get('sections') or {}).get('代表性论文及专著', '')
        sources = [(mentor['source']['url'], official, True)]
        sources += [(p['url'], p['text'], False) for p in people[ident]['pages']]
        papers = []
        for url, text, direct in sources:
            section_year = None
            for line in text.splitlines():
                if re.fullmatch(r'20\d{2}', line.strip()):
                    section_year = line.strip()
                    continue
                if re.search(r'专利|patent|keynote|tutorial speaker|invited talk|受邀报告', line, re.I):
                    continue
                quote = re.search(r'[“"]([^”"]{15,800})[”"]', line)
                if not quote or not direct and not completion.name_in_line(mentor['name'], line):
                    continue
                years = re.findall(r'\b(202[3-6])\b', line)
                year = years[-1] if years else section_year
                if year not in ('2023', '2024', '2025', '2026'):
                    continue
                title = quote.group(1).strip(' ,.;，。')
                if len(re.findall('[A-Za-z]', title)) < 12:
                    continue
                key = hashlib.sha256((ident + ':' + completion.normal(title)).encode()).hexdigest()[:20]
                if any(completion.normal(p['title']) == completion.normal(title) for p in papers):
                    continue
                author_text = re.sub(r'^\s*(?:\[?\d+\]?[.、，,:：]?|[l•*])\s*', '', line[:quote.start()]).strip(' ,.;，。')
                venue = line[quote.end():].strip(' ,.;，。')
                preprint = bool(re.search(r'arxiv|preprint', venue, re.I))
                papers.append({'id': 'paper-official-bib-' + key, 'title': title, 'date': year, 'precision': 'year', 'venue': venue or '官网书目未单列发表位置', 'authors': [author_text] if author_text else [], 'url': url, 'status': 'preprint' if preprint else 'accepted' if re.search('accepted|已接收', venue, re.I) else 'published', 'versions': [{'kind': '官方公开书目（原始年份精度）', 'date': year, 'url': url}], 'source': {'id': 'official-bib-' + key, 'title': mentor['name'] + ' · 公开论文书目', 'url': url, 'kind': 'official', 'retrievedAt': DAY, 'excerpt': line}, 'identity': '学院代表作书目直接列出，或学院链接的教师/团队论文页列出该教师署名；未以同名索引搜索结果推断归属。', 'dateNote': '书目仅提供年份或年度栏目；保留其原始精度。作者按原始署名串显示，不扩写缩写、补齐省略作者或推断具体发表日。'})
        results[ident] = {'id': ident, 'name': mentor['name'], 'papers': papers}
    coverage.save_json(ROOT / 'data/official-bibliography-publications.json', {'checkedAt': DAY, 'people': results})
    print(json.dumps({'peopleWithExplicitWorks': sum(bool(p['papers']) for p in results.values()), 'papers': sum(len(p['papers']) for p in results.values())}))


if __name__ == '__main__':
    main()
