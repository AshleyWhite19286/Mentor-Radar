"""Complete coauthors' records from exact official bibliographies.

Require a unique full romanized name, the same official institute, and a paper
explicitly listed by that institute's verified colleague. No initials, fuzzy
name matches, or ambiguous directory names are accepted.
"""
import copy
import importlib
import json

coverage = importlib.import_module('audit-paper-coverage')
completion = importlib.import_module('complete-publications')
anchored = importlib.import_module('enrich-anchored-authors')
verifier = importlib.import_module('verify-publication-candidates')
ROOT = coverage.ROOT


def main():
    mentors = {m['id']: m for m in json.loads((ROOT / 'data/seed.json').read_text())['mentors']}
    names = {}
    for mentor in mentors.values():
        for name in anchored.author_names(mentor):
            names.setdefault(name, set()).add(mentor['id'])
    completed = json.loads((ROOT / 'data/publication-completion.json').read_text())
    sources = [(ref['mentorId'], ref['paper'], ref['url']) for ref in completed['bibliography'].values() if ref.get('paper') and mentors[ref['mentorId']]['source']['url'] == ref['url'] and verifier.matches(ref['paper'], mentors[ref['mentorId']])]
    # These are university-authored records with explicit, linked author lists.
    lab_path = ROOT / 'data/lab-publication-records.json'
    if lab_path.exists():
        for ident, record in json.loads(lab_path.read_text())['people'].items():
            sources.extend((ident, paper, record['authorUrl']) for paper in record['papers'])
    results = {}
    for owner_id, paper, bibliography_url in sources:
        owner = mentors[owner_id]
        for author in paper.get('authors', []):
            matches = names.get(completion.normal(author), set())
            if len(matches) != 1:
                continue
            ident = next(iter(matches))
            mentor = mentors[ident]
            if ident == owner_id or ident in coverage.CURATED or mentor['instituteId'] != owner['instituteId']:
                continue
            entry = results.setdefault(ident, {'id': ident, 'name': mentor['name'], 'papers': [], 'evidence': []})
            if any(completion.normal(p['title']) == completion.normal(paper['title']) for p in entry['papers']):
                continue
            copied = copy.deepcopy(paper)
            copied['identity'] = f'学院已核对{mentor["name"]}与{owner["name"]}同属一个研究所；同所教师{owner["name"]}的官网书目明确列出本论文，出版元信息中的完整署名“{author}”与目录内唯一拼音姓名匹配。'
            copied['source']['excerpt'] = copied['source'].get('excerpt', '') + '\n共同作者归属交叉核验：' + mentor['source']['url'] + '\n代表作书目：' + bibliography_url
            entry['papers'].append(copied)
            entry['evidence'].append({'paperId': paper['id'], 'matchedFullName': author, 'colleagueId': owner_id, 'bibliographyUrl': bibliography_url, 'officialInstituteId': mentor['instituteId']})
    coverage.save_json(ROOT / 'data/coauthored-publication-records.json', {'checkedAt': coverage.DAY, 'people': results})
    print(json.dumps({'people': len(results), 'papers': sum(len(p['papers']) for p in results.values())}))


if __name__ == '__main__':
    main()
