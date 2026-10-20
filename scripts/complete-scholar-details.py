"""Read date/author/abstract fields from officially linked Scholar records."""
import concurrent.futures
import hashlib
import html
import importlib
import json
import re
import urllib.parse

coverage = importlib.import_module('audit-paper-coverage')
completion = importlib.import_module('complete-publications')
ROOT, DAY = coverage.ROOT, coverage.DAY
OUT = ROOT / 'data/scholar-publication-details.json'


def detail(job):
    mentor_id, scholar, row = job
    result = {'mentorId': mentor_id, 'title': row['title'], 'url': row['detailUrl'], 'status': 'error'}
    try:
        raw = coverage.fetch(row['detailUrl'])
        title_match = re.search(r'id="gsc_oci_title"[^>]*>(.*?)</div>', raw, re.S)
        if not title_match:
            raise ValueError('Scholar 未返回论文详情')
        title = completion.plain(title_match.group(1))
        if completion.normal(title) != completion.normal(row['title']):
            raise ValueError('Scholar 列表和详情题名不一致')
        fields = {completion.plain(key): completion.plain(value) for key, value in re.findall(r'<div class="gsc_oci_field">(.*?)</div>\s*<div class="gsc_oci_value"[^>]*>(.*?)</div>', raw, re.S)}
        raw_date = fields.get('Publication date', row['year'])
        date_match = re.fullmatch(r'(\d{4})(?:/(\d{1,2}))?(?:/(\d{1,2}))?', raw_date)
        if not date_match:
            raise ValueError('无法解析公开发表日期：' + raw_date)
        parts = [v for v in date_match.groups() if v]
        date = '-'.join(v if i == 0 else v.zfill(2) for i, v in enumerate(parts))
        url_match = re.search(r'<a[^>]*class="gsc_oci_title_link"[^>]*href="([^"]+)"', title_match.group(1))
        if not url_match:
            url_match = re.search(r'<a[^>]*href="([^"]+)"[^>]*class="gsc_oci_title_link"', title_match.group(1))
        url = html.unescape(url_match.group(1)) if url_match else row['detailUrl']
        arxiv_match = re.search(r'arxiv\.org/(?:abs|pdf)/(\d{4}\.\d{4,5})', url)
        doi_match = re.search(r'doi\.org/(10\.\d{4,9}/[^\s"<>?]+)', url)
        arxiv = arxiv_match.group(1) if arxiv_match else None
        doi = urllib.parse.unquote(doi_match.group(1)) if doi_match else None
        venue = fields.get('Journal') or fields.get('Conference') or fields.get('Book') or row['venue']
        preprint = bool(arxiv) or 'arxiv' in venue.lower()
        key = hashlib.sha256(row['detailUrl'].encode()).hexdigest()[:20]
        authors = [v.strip() for v in fields.get('Authors', row['authors']).split(',') if v.strip()]
        result['paper'] = {'id': 'paper-scholar-' + key, 'title': title, 'date': date, 'precision': ['year', 'month', 'day'][len(parts) - 1], 'venue': venue or '发表位置待核实', 'doi': doi, 'arxivId': arxiv, 'authors': authors, 'abstract': fields.get('Description') or None, 'url': url, 'status': 'preprint' if preprint else 'published', 'versions': [{'kind': 'Google Scholar 公开论文详情', 'date': date, 'url': row['detailUrl']}], 'source': {'id': 'source-scholar-' + key, 'title': title, 'url': row['detailUrl'], 'kind': 'paper', 'retrievedAt': DAY}, 'identity': '学院官方个人页直接链接或经本人姓名核对的教师主页链接到 Google Scholar 用户 ' + scholar['user'] + '；论文出现在该作者的公开列表中。', **({'dateNote': 'Scholar 仅提供年份或月份，保留原始日期精度。'} if len(parts) < 3 else {})}
        result['status'] = 'ok'
    except Exception as error:
        result['reason'] = str(error)[:180]
    return result


def main():
    state = json.loads(OUT.read_text()) if OUT.exists() else {'checkedAt': DAY, 'papers': {}}
    source = json.loads((ROOT / 'data/publication-completion.json').read_text())['scholar']
    jobs = [(ident, scholar, row) for ident, profiles in source.items() for scholar in profiles if scholar['status'] == 'ok' for row in scholar['rows'][:20] if row['detailUrl'] and row['detailUrl'] not in state['papers']]
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
        for index, result in enumerate(executor.map(detail, jobs), 1):
            state['papers'][result['url']] = result
            coverage.save_json(OUT, state)
            print(json.dumps({'done': index, 'total': len(jobs), 'mentorId': result['mentorId'], 'status': result['status'], 'title': result['title']}, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    main()
