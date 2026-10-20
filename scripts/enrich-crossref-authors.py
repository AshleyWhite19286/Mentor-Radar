"""Fill remaining recent gaps using full author names plus independent evidence.

Accept only a complete-name author whose own affiliation states SJTU and the
relevant electronics department, or at least two full-name collaborators
explicitly present in the official teacher bibliography. Name alone is rejected.
"""
import concurrent.futures
import argparse
import importlib
import json
import re
import urllib.parse

coverage = importlib.import_module('audit-paper-coverage')
completion = importlib.import_module('complete-publications')
anchored = importlib.import_module('enrich-anchored-authors')
ROOT, DAY = coverage.ROOT, coverage.DAY
OUT = ROOT / 'data/crossref-author-publications.json'


def affiliation_text(author):
    parts = []
    for institution in author.get('affiliation', []):
        parts.append(institution.get('name', ''))
        departments = institution.get('department') or []
        parts.extend(departments if isinstance(departments, list) else [departments])
    return ' '.join(str(value) for value in parts if value)


def enrich(mentor, profile, person, with_affiliation=False):
    result = {'id': mentor['id'], 'name': mentor['name'], 'status': 'error', 'papers': [], 'queries': []}
    names = anchored.author_names(mentor)
    official = completion.normal('\n'.join((profile.get('sections') or {}).values()) + '\n' + '\n'.join(page['text'] for page in person.get('pages', [])))
    parts = anchored.lazy_pinyin(mentor['name'])
    english = mentor.get('englishName') or (''.join(parts[1:]) + ' ' + parts[0]).title()
    if mentor['name'].startswith('解'):
        english = ''.join(parts[1:]).title() + ' Xie'
    if mentor['name'].startswith('诸葛'):
        english = ''.join(parts[2:]).title() + ' Zhuge'
    try:
        for offset in (0, 100):
            parameters = {'query.author': english, 'filter': 'from-pub-date:2023-10-20,until-pub-date:' + DAY, 'rows': 100, 'offset': offset}
            if with_affiliation:
                parameters['query.affiliation'] = 'Shanghai Jiao Tong University'
            url = 'https://api.crossref.org/works?' + urllib.parse.urlencode(parameters)
            message = coverage.fetch(url, True)['message']
            result['queries'].append({'url': url, 'returned': len(message.get('items', [])), 'totalResults': message.get('total-results')})
            accepted = 0
            for item in message.get('items', []):
                authors = item.get('author', [])
                own = [a for a in authors if completion.normal(' '.join(filter(None, [a.get('given'), a.get('family')]))) in names]
                if len(own) != 1:
                    continue
                affiliation = affiliation_text(own[0])
                sjtu = 'shanghaijiaotong' in completion.normal(affiliation) or '上海交通大学' in affiliation
                department = bool(re.search(r'electron|information|micro|nano|integrated circuit|电子|信息|微纳|集成电路', affiliation, re.I))
                stable = [a for a in authors if a is not own[0] and len(completion.normal(' '.join(filter(None, [a.get('given'), a.get('family')])))) >= 8 and completion.normal(' '.join(filter(None, [a.get('given'), a.get('family')]))) in official]
                if not (sjtu and department or len(stable) >= 2):
                    continue
                title = completion.plain((item.get('title') or [''])[0])
                ref = {'line': title, 'url': mentor['source']['url']}
                paper = completion.crossref_paper(item, mentor, ref)
                if not paper:
                    continue
                full_name = ' '.join(filter(None, [own[0].get('given'), own[0].get('family')]))
                paper['identity'] = f'出版元信息的完整署名“{full_name}”与学院教师姓名匹配；' + ('该作者本人单位标注上海交通大学电子/信息/微纳相关院系。' if sjtu and department else '同时有至少两位完整姓名的合作者在该教师官网书目中出现。')
                paper['source']['excerpt'] = '官网身份资料：' + mentor['source']['url'] + '\n作者单位：' + affiliation + '\n稳定合作者：' + ', '.join(' '.join(filter(None, [a.get('given'), a.get('family')])) for a in stable)
                if not any(p.get('doi', '').lower() == paper['doi'].lower() for p in result['papers']):
                    result['papers'].append(paper)
                    accepted += 1
            # A second page is useful only when the first is substantially
            # about this identity; never trawl thousands of ambiguous names.
            if offset or accepted < 30 or message.get('total-results', 0) <= 100:
                break
        result['status'] = 'ok'
    except Exception as error:
        result['reason'] = str(error)[:180]
    return result


def main():
    global OUT
    parser = argparse.ArgumentParser()
    parser.add_argument('--with-affiliation', action='store_true')
    parser.add_argument('--only-empty', action='store_true')
    parser.add_argument('--recheck', action='store_true', help='Reparse previously collected author responses, including structured departments.')
    args = parser.parse_args()
    if args.with_affiliation:
        OUT = ROOT / 'data/crossref-affiliation-publications.json'
    state = json.loads(OUT.read_text()) if OUT.exists() else {'checkedAt': DAY, 'people': {}}
    audit = {p['id']: p for p in json.loads((ROOT / 'data/publication-coverage-audit.json').read_text())['people']}
    profiles = {p['id']: p for p in json.loads((ROOT / 'data/source-profiles.json').read_text())}
    people = json.loads((ROOT / 'data/publication-evidence.json').read_text())['people']
    mentors = [m for m in json.loads((ROOT / 'data/seed.json').read_text())['mentors'] if m['id'] not in coverage.CURATED and re.search('教授|研究员', m['title']) and ((args.recheck and m['id'] in state['people']) or (not args.recheck and m['id'] not in state['people'] and audit[m['id']]['after']['recent'] < (1 if args.only_empty else 5)))]
    # Four scheduling workers can consume cached records concurrently. The
    # shared fetch lock still permits exactly one Crossref request at a time.
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
        futures = [executor.submit(enrich, mentor, profiles.get(mentor['id'], {}), people[mentor['id']], args.with_affiliation) for mentor in mentors]
        for index, future in enumerate(concurrent.futures.as_completed(futures), 1):
            result = future.result()
            state['people'][result['id']] = result
            coverage.save_json(OUT, state)
            print(json.dumps({'done': index, 'total': len(mentors), 'name': result['name'], 'status': result['status'], 'papers': len(result['papers'])}, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    main()
