"""Add recent papers explicitly listed on official teacher profiles via exact Crossref titles."""
import argparse, datetime, html, json, pathlib, re, time, urllib.error, urllib.parse, urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
SEED = ROOT / 'data' / 'seed.json'
PROFILES = ROOT / 'data' / 'source-profiles.json'
STATE = ROOT / 'data' / 'official-works-progress.json'
CUTOFF = '2023-10-20'
DAY = '2026-10-20'

def normalize(value): return re.sub(r'[^a-z0-9]', '', value.lower())

def request(url):
    req=urllib.request.Request(url,headers={'User-Agent':'MentorRadar/0.2 (official profile title verification; mailto=icisee@sjtu.edu.cn)'})
    for attempt in range(5):
        try:
            with urllib.request.urlopen(req,timeout=30) as response: return json.load(response)
        except urllib.error.HTTPError as error:
            if error.code not in (429,500,502,503,504) or attempt==4: raise
            time.sleep(5*(attempt+1))

def candidate_titles(profile):
    works=(profile.get('sections') or {}).get('代表性论文及专著','')
    titles=[]
    for line in works.splitlines():
        quoted=[match[0] or match[1] for match in re.findall(r'“([^”]{12,400})”|"([^"]{12,400})"',line)]
        titles += quoted
        if not quoted:
            match=re.search(r':\s*([^:.]{12,400}?)\.\s*(?:IEEE|ACM|Nature|Science|[A-Z][A-Za-z ]{3,})',line)
            if match: titles.append(match.group(1))
    # Many official pages list unquoted bibliography lines. The complete line is
    # passed to Crossref's bibliographic search and the returned title must later
    # be a normalized substring of the line before it can be accepted.
    for line in works.splitlines():
        ascii_letters=len(re.findall(r'[A-Za-z]',line))
        if ascii_letters>=18 and len(line)<=1200: titles.append(line.strip())
    return list(dict.fromkeys(title.strip() for title in titles if len(title.strip())>12))[:40]

def paper(message,profile,title):
    parts=(message.get('published-online') or message.get('published') or message.get('issued') or {}).get('date-parts',[[]])[0]
    if not parts: return None
    date='-'.join(str(value) if index==0 else str(value).zfill(2) for index,value in enumerate(parts))
    if date<CUTOFF: return None
    doi=message.get('DOI')
    actual=(message.get('title') or [''])[0]
    # Exact title matches are preferred. Bibliographic lines also contain author,
    # venue, and pages, so accepting a returned title requires it to occur in the
    # official line verbatim after normalization.
    if normalize(actual)!=normalize(title) and normalize(actual) not in normalize(title): return None
    abstract=html.unescape(re.sub('<[^>]+>','',message.get('abstract',''))) or None
    url='https://doi.org/'+doi
    return {
      'id':'paper-doi-'+doi.replace('/','-'), 'title':actual, 'date':date,
      'precision':['year','month','day'][min(len(parts),3)-1], 'venue':(message.get('container-title') or ['发表位置待核实'])[0],
      'doi':doi, 'authors':[' '.join(filter(None,[author.get('given',''),author.get('family','')])) for author in message.get('author',[])],
      'abstract':abstract, 'url':url, 'status':'preprint' if message.get('type')=='posted-content' else 'published',
      'versions':[{'kind':'Crossref正式发表元信息','date':date,'url':url}],
      'source':{'id':'crossref-'+doi,'title':actual,'url':url,'kind':'paper','retrievedAt':DAY},
      'identity':f'学院官方个人页将该论文列为{profile["name"]}的代表作；Crossref题名精确匹配。',
    }

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--limit',type=int,default=0);parser.add_argument('--retry-unresolved',action='store_true');args=parser.parse_args()
    seed=json.loads(SEED.read_text()); profiles={item['id']:item for item in json.loads(PROFILES.read_text())}
    state=json.loads(STATE.read_text()) if STATE.exists() else {'people':{}}
    pending=[mentor for mentor in seed['mentors'] if not mentor.get('papers') and mentor['id'] in profiles and (mentor['id'] not in state['people'] or args.retry_unresolved and state['people'][mentor['id']].get('status')=='unresolved')]
    if args.limit: pending=pending[:args.limit]
    print(json.dumps({'event':'started','pending':len(pending)},ensure_ascii=False),flush=True)
    for current,mentor in enumerate(pending,1):
        profile=profiles[mentor['id']]; matched=[]; reason='官网个人页没有可解析的2023年以来代表作题名'
        try:
            for title in candidate_titles(profile):
                if len(matched)>=5: break
                parameter='query.title' if len(title)<450 else 'query.bibliographic'
                query='https://api.crossref.org/works?'+parameter+'='+urllib.parse.quote(title)+'&rows=1'
                item=(request(query).get('message',{}).get('items') or [{}])[0]
                entry=paper(item,profile,title)
                if entry and entry['id'] not in {work['id'] for work in matched}: matched.append(entry)
                time.sleep(1)
            if matched:
                mentor['papers']=matched
                mentor['coverageNote']=f'学院官方个人页列出代表作；以Crossref题名精确匹配补充{len(matched)}篇近36个月论文。'
                state['people'][mentor['id']]={'status':'enriched','papers':len(matched),'abstracts':sum(bool(work['abstract']) for work in matched)}
            else: state['people'][mentor['id']]={'status':'unresolved','reason':reason}
        except Exception as error:
            state['people'][mentor['id']]={'status':'error','reason':type(error).__name__}
        state['updatedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat()
        SEED.write_text(json.dumps(seed,ensure_ascii=False,indent=2)+'\n');STATE.write_text(json.dumps(state,ensure_ascii=False,indent=2)+'\n')
        print(json.dumps({'event':'progress','current':current,'total':len(pending),'id':mentor['id'],'name':mentor['name'],**state['people'][mentor['id']]},ensure_ascii=False),flush=True)
    print(json.dumps({'event':'complete'},ensure_ascii=False),flush=True)
if __name__=='__main__': main()
