"""Fill missing abstracts for already verified directory papers using DOI records."""
import argparse, html, json, pathlib, re, time, urllib.parse, urllib.request

ROOT=pathlib.Path(__file__).resolve().parent.parent
SEED=ROOT/'data'/'seed.json'
STATE=ROOT/'data'/'directory-abstract-progress.json'

def request(url):
    req=urllib.request.Request(url,headers={'User-Agent':'MentorRadar/0.2 (abstract enrichment; mailto=icisee@sjtu.edu.cn)'})
    with urllib.request.urlopen(req,timeout=25) as response:return json.load(response)

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--limit',type=int,default=0);args=parser.parse_args()
    seed=json.loads(SEED.read_text());state=json.loads(STATE.read_text()) if STATE.exists() else {'papers':{}}
    jobs=[(mentor,paper) for mentor in seed['mentors'] for paper in mentor.get('papers',[]) if not paper.get('abstract') and paper['id'] not in state['papers']]
    if args.limit:jobs=jobs[:args.limit]
    print(json.dumps({'event':'started','pending':len(jobs)},ensure_ascii=False),flush=True)
    for current,(mentor,paper) in enumerate(jobs,1):
        result={'status':'unresolved'};doi=paper.get('doi')
        try:
            if doi:
                record=request('https://api.semanticscholar.org/graph/v1/paper/DOI:'+urllib.parse.quote(doi,safe='')+'?fields=title,abstract,url')
                title=record.get('title','')
                if record.get('abstract') and re.sub(r'[^a-z0-9]','',title.lower())==re.sub(r'[^a-z0-9]','',paper['title'].lower()):
                    paper['abstract']=record['abstract'];paper['source']['url']=record.get('url') or paper['source']['url'];result={'status':'enriched','length':len(record['abstract'])}
            if result['status']=='unresolved':result={'status':'unresolved','reason':'DOI记录未提供题名精确匹配的公开摘要'}
        except Exception as error:result={'status':'error','reason':type(error).__name__}
        state['papers'][paper['id']]=result;SEED.write_text(json.dumps(seed,ensure_ascii=False,indent=2)+'\n');STATE.write_text(json.dumps(state,ensure_ascii=False,indent=2)+'\n')
        print(json.dumps({'event':'progress','current':current,'total':len(jobs),'mentor':mentor['name'],'paper':paper['id'],**result},ensure_ascii=False),flush=True);time.sleep(.4)
    print(json.dumps({'event':'complete'},ensure_ascii=False),flush=True)
if __name__=='__main__':main()
