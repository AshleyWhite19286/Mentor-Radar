"""Reject title-only commentary matches and papers in merged same-name profiles.

Author IDs are discovery aids. Every imported S2 paper additionally needs an
explicit official/Scholar title, or two independently confirmed collaborators.
This verifier is offline and keeps rejected candidates out of the catalog.
"""
import copy
import importlib
import json

coverage = importlib.import_module('audit-paper-coverage')
completion = importlib.import_module('complete-publications')
anchored = importlib.import_module('enrich-anchored-authors')
ROOT = coverage.ROOT


def read(name, fallback):
    path = ROOT / 'data' / name
    return json.loads(path.read_text()) if path.exists() else fallback


def matches(paper, mentor):
    authors = []
    for author in paper.get('authors', []):
        parts = author.split()
        if parts:
            authors.append({'given': ' '.join(parts[:-1]), 'family': parts[-1]})
    return completion.crossref_author_matches({'author': authors}, mentor)


def main():
    mentors = {m['id']: m for m in read('seed.json', {})['mentors']}
    completion_data = read('publication-completion.json', {'bibliography': {}, 'scholar': {}})
    evidence = read('publication-evidence.json', {'people': {}})['people']
    profiles = {p['id']: p for p in read('source-profiles.json', [])}
    explicit = read('official-bibliography-publications.json', {'people': {}})['people']
    lab = read('lab-publication-records.json', {'people': {}})['people']
    crossref_authors = read('crossref-author-publications.json', {'people': {}})['people']
    crossref_affiliations = read('crossref-affiliation-publications.json', {'people': {}})['people']
    baseline = read('publication-coverage-baseline.json', {})
    trusted = {ident: list(baseline.get('originalPapers', {}).get(ident, [])) for ident in mentors}
    bibliography = {}
    rejected = []
    for key, entry in completion_data['bibliography'].items():
        result = copy.deepcopy(entry)
        if result.get('paper') and not matches(result['paper'], mentors[result['mentorId']]):
            rejected.append({'mentorId': result['mentorId'], 'title': result['paper']['title'], 'url': result['paper']['url'], 'reason': '完整题名相同，但出版元信息作者不包含该教师；可能是同题评论或题名误匹配。'})
            result.pop('paper')
            result['status'] = 'rejected_metadata'
        elif result.get('paper'):
            trusted[result['mentorId']].append(result['paper'])
        bibliography[key] = result
    for source in (explicit, lab, crossref_authors, crossref_affiliations):
        for ident, entry in source.items():
            trusted[ident].extend(entry.get('papers', []))
    accepted_authors = {}
    for ident, result in read('anchored-author-publications.json', {'people': {}})['people'].items():
        mentor = mentors[ident]
        own_names = anchored.author_names(mentor)
        official_text = completion.normal('\n'.join((profiles.get(ident, {}).get('sections') or {}).values()) + '\n' + '\n'.join(p['text'] for p in evidence.get(ident, {}).get('pages', [])))
        verified_titles = {completion.normal(p['title']) for p in trusted[ident]}
        for scholar in completion_data['scholar'].get(ident, []):
            if scholar['status'] == 'ok':
                verified_titles.update(completion.normal(p['title']) for p in scholar['rows'])
        stable_names = {completion.normal(name) for p in trusted[ident] for name in p.get('authors', []) if 7 <= len(completion.normal(name)) <= 40 and 2 <= len(name.split()) <= 5 and completion.normal(name) not in own_names}
        verified = copy.deepcopy(result)
        verified['papers'] = []
        verified['rejectedPapers'] = []
        for paper in result.get('papers', []):
            names = {completion.normal(name) for name in paper.get('authors', [])}
            full_self = bool(names & own_names)
            direct = completion.normal(paper['title']) in verified_titles
            collaborators = {name for name in paper.get('authors', []) if 7 <= len(completion.normal(name)) <= 40 and completion.normal(name) not in own_names and (completion.normal(name) in stable_names or len(name.split()) >= 2 and completion.normal(name) in official_text)}
            if full_self and (direct or len(collaborators) >= 2):
                accepted = copy.deepcopy(paper)
                accepted['identity'] += ' 本条另以官网/本人学术主页的完整题名核验。' if direct else ' 本条另与至少两位官网已确认的完整姓名合作者交叉核验：' + ', '.join(sorted(collaborators)) + '。'
                verified['papers'].append(accepted)
            else:
                reason = {'mentorId': ident, 'title': paper['title'], 'url': paper['url'], 'reason': '作者索引可能合并同名身份；本条缺少本人完整署名、明确的官方题名或两名已核验合作者证据。'}
                verified['rejectedPapers'].append(reason)
                rejected.append(reason)
        accepted_authors[ident] = verified
    coverage.save_json(ROOT / 'data/verified-publication-candidates.json', {'checkedAt': coverage.DAY, 'bibliography': bibliography, 'authors': accepted_authors, 'rejected': rejected})
    print(json.dumps({'verifiedBibliography': sum(bool(p.get('paper')) for p in bibliography.values()), 'verifiedIndexedPapers': sum(len(p['papers']) for p in accepted_authors.values()), 'rejectedCandidates': len(rejected)}))


if __name__ == '__main__':
    main()
