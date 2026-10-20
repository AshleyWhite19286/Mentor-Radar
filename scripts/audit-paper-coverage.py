"""Collect every non-curated teacher's official publication evidence, resumably.

Never treats an empty catalog as an eligibility condition. Network responses are
cached separately; the review manifest records successful and failed requests.
Only links published in the teacher's official page (or linked personal site)
are followed. This collector does not attach same-name search results.
"""
import argparse
import concurrent.futures
import hashlib
import fcntl
import html
from html.parser import HTMLParser
import json
import pathlib
import re
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
CACHE = ROOT / 'data' / '.publication-cache'
DAY = '2026-10-20'
CURATED = set(json.loads((ROOT / 'data/selected-papers.json').read_text()))


def fetch(url, json_response=False):
    CACHE.mkdir(exist_ok=True)
    path = CACHE / (hashlib.sha256(url.encode()).hexdigest() + '.txt')
    if path.exists():
        content = path.read_text()
    else:
        host = urllib.parse.urlparse(url).hostname or ''
        # Public Crossref currently advertises concurrency=1, interval=1s.
        # A file lock shares the limit across the bibliography/identity jobs.
        api_lock = None
        if host in ('api.crossref.org', 'api.semanticscholar.org', 'scholar.google.com'):
            api_lock = (CACHE / (host + '.lock')).open('a+')
            fcntl.flock(api_lock, fcntl.LOCK_EX)
            if path.exists():
                content = path.read_text()
                fcntl.flock(api_lock, fcntl.LOCK_UN)
                api_lock.close()
                return json.loads(content) if json_response else content
        try:
            for attempt in range(3):
                try:
                    request = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (MentorRadar public academic bibliography verification)'})
                    with urllib.request.urlopen(request, timeout=22) as response:
                        content = response.read().decode('utf-8', errors='replace')
                    path.write_text(content)
                    break
                except (urllib.error.URLError, TimeoutError) as error:
                    if host in ('api.semanticscholar.org', 'scholar.google.com') and isinstance(error, urllib.error.HTTPError) and error.code == 429:
                        raise
                    if attempt == 2 or isinstance(error, urllib.error.HTTPError) and error.code in (400, 401, 403, 404):
                        raise
                    time.sleep(3 * (attempt + 1))
        finally:
            if api_lock:
                time.sleep(1.05)
                fcntl.flock(api_lock, fcntl.LOCK_UN)
                api_lock.close()
    return json.loads(content) if json_response else content


class Page(HTMLParser):
    def __init__(self, raw, base):
        super().__init__(convert_charrefs=True)
        self.links = []
        self.lines = []
        self.link = None
        self.skip = 0
        self.feed(raw)
        self.text = ''.join(self.lines)
        self.base = base
        for link in self.links:
            link['url'] = urllib.parse.urljoin(base, link['url'].strip())

    def handle_starttag(self, tag, attrs):
        attr = dict(attrs)
        if tag in ('script', 'style'):
            self.skip += 1
        if self.skip:
            return
        if tag in ('p', 'div', 'li', 'tr', 'br', 'h1', 'h2', 'h3', 'h4'):
            self.lines.append('\n')
        if tag == 'a' and attr.get('href'):
            self.link = {'url': attr['href'], 'label': ''}
            self.links.append(self.link)

    def handle_endtag(self, tag):
        if tag in ('script', 'style'):
            self.skip = max(0, self.skip - 1)
        if tag == 'a':
            self.link = None
        if tag in ('p', 'div', 'li', 'tr', 'h1', 'h2', 'h3', 'h4'):
            self.lines.append('\n')

    def handle_data(self, data):
        if not self.skip:
            self.lines.append(data)
            if self.link is not None:
                self.link['label'] += data


def clean_lines(text):
    return '\n'.join(re.sub(r'\s+', ' ', line).strip() for line in text.splitlines() if line.strip())


def save_json(path, value):
    temp = path.with_suffix('.tmp')
    temp.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')
    temp.replace(path)


def publication_link(link):
    return bool(re.search(r'scholar\.google|orcid\.org|dblp\.|semanticscholar\.org/author|researchgate.net/profile|publications?|papers?\b|论文|成果|scholar', link['url'] + ' ' + link['label'], re.I))


def homepage_links(page):
    links = [link for link in page.links if publication_link(link)]
    for line in page.text.splitlines():
        if '个人主页' in line or '团队主页' in line:
            for match in re.finditer(r'(?:https?://|www\.|[a-zA-Z0-9.-]+\.(?:edu\.cn|github\.io)/?)[^\s<>；;，（）()|]*', line):
                url = match.group().rstrip('。.,')
                links.append({'url': url if url.startswith('http') else 'https://' + url, 'label': '个人主页'})
        # Bibliography sections sometimes contain an unlinked publication URL.
        for match in re.finditer(r'https?://[^\s<>；;，（）()|]+', line):
            url = match.group().rstrip('。.,')
            link = {'url': url, 'label': '官网论文链接'}
            if publication_link(link) and not re.search(r'\.pdf(?:$|\?)', url, re.I):
                links.append(link)
    # Some pages use linked text instead of a literal URL beside the label.
    for link in page.links:
        if re.search(r'个人主页|团队主页|homepage', link['label'], re.I):
            links.append(link)
    return list({link['url']: link for link in links if link['url'].startswith(('http://', 'https://'))}.values())


def collect(mentor):
    result = {'id': mentor['id'], 'name': mentor['name'], 'officialUrl': mentor['source']['url'], 'checkedAt': DAY, 'requests': [], 'links': [], 'pages': []}
    def read(url, kind):
        try:
            raw = fetch(url)
            page = Page(raw, url)
            result['requests'].append({'url': url, 'kind': kind, 'status': 'ok'})
            return page
        except Exception as error:
            result['requests'].append({'url': url, 'kind': kind, 'status': 'error', 'reason': str(error)[:180]})
    page = read(result['officialUrl'], 'official')
    if page is None:
        return result
    # Restrict extraction to teacher content, excluding global navigation/footer.
    raw = fetch(result['officialUrl'])
    raw = raw.split('教师简介</div>')[-1].split('<!-- 底部')[0]
    raw = raw.split('<footer')[0].split('Copyright')[0]
    page = Page(raw, result['officialUrl'])
    result['officialText'] = clean_lines(page.text)
    result['links'] = homepage_links(page)
    if mentor.get('homepage'):
        for match in re.finditer(r'(?:https?://|www\.)[^\s；;，（）()|]+', mentor['homepage']):
            url = match.group().rstrip('。.,')
            url = url if url.startswith('http') else 'https://' + url
            if url not in {link['url'] for link in result['links']}:
                result['links'].append({'url': url, 'label': '官网个人主页'})
    # Scholar is fetched by a separate, rate-conscious stage.
    sites = [link for link in result['links'] if not re.search(r'scholar\.google|doi.org|arxiv.org|researchgate|orcid.org|dblp\.|semanticscholar|\.pdf(?:$|\?)', link['url'], re.I)]
    sites = sites[:3]
    for link in sites:
        site = read(link['url'], 'homepage')
        if site is None:
            continue
        result['pages'].append({'url': link['url'], 'text': clean_lines(site.text), 'links': site.links})
        discovered = [item for item in site.links if publication_link(item)]
        for item in discovered:
            if 'scholar.google' in item['url'] and item['url'] not in {a['url'] for a in result['links']}:
                result['links'].append({**item, 'via': link['url']})
        # One level of explicit bibliography pages, never crawl the whole site.
        for item in [item for item in discovered if urllib.parse.urlparse(item['url']).netloc == urllib.parse.urlparse(link['url']).netloc and item['url'] != link['url'] and re.search(r'publications?|papers|论文|成果', item['label'] + ' ' + item['url'], re.I)][:2]:
            if item['url'] in {p['url'] for p in result['pages']}:
                continue
            publication = read(item['url'], 'publications')
            if publication:
                result['pages'].append({'url': item['url'], 'text': clean_lines(publication.text), 'links': publication.links})
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--workers', type=int, default=6)
    parser.add_argument('--only', default='')
    args = parser.parse_args()
    path = ROOT / 'data' / 'publication-evidence.json'
    state = json.loads(path.read_text()) if path.exists() else {'checkedAt': DAY, 'people': {}}
    mentors = [m for m in json.loads((ROOT / 'data/seed.json').read_text())['mentors'] if m['id'] not in CURATED and (not args.only or m['id'] in args.only.split(','))]
    pending = [m for m in mentors if m['id'] not in state['people']]
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as executor:
        jobs = {executor.submit(collect, mentor): mentor for mentor in pending}
        for future in concurrent.futures.as_completed(jobs):
            result = future.result()
            state['people'][result['id']] = result
            save_json(path, state)
            print(json.dumps({'checked': len(state['people']), 'total': len(mentors), 'name': result['name'], 'links': len(result['links']), 'pages': len(result['pages']), 'errors': sum(r['status'] == 'error' for r in result['requests'])}, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    main()
