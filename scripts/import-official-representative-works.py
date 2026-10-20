"""Import recent works explicitly listed by an official teacher profile.

This is intentionally a metadata-only fallback. It does not infer abstracts,
DOIs, author order, or claims beyond the bibliography supplied by the school.
"""
import argparse, json, pathlib, re

ROOT=pathlib.Path(__file__).resolve().parent.parent
SEED=ROOT/'data'/'seed.json'
PROFILES=ROOT/'data'/'source-profiles.json'
STATE=ROOT/'data'/'official-profile-works-progress.json'

def title_from(line):
    quoted=re.search(r'[“"](.+?)[”"]',line)
    if quoted:return quoted.group(1).strip()
    # Common official bibliography form: authors: Title. Venue, year.
    colon=line.find(':')
    if colon>=0:
        value=line[colon+1:].strip()
        value=re.sub(r'\s+(?:IEEE|ACM|Nature|Science|Optics|Applied|Journal|Proceedings|International Conference|Conference).*$', '',value,flags=re.I)
        value=re.sub(r'\s+20\d{2}.*$','',value).strip(' .;，；')
        if len(value)>=12:return value
    return line.strip()

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--limit',type=int,default=0);args=parser.parse_args()
    seed=json.loads(SEED.read_text());profiles={p['id']:p for p in json.loads(PROFILES.read_text())}
    state=json.loads(STATE.read_text()) if STATE.exists() else {'people':{}}
    pending=[m for m in seed['mentors'] if not m.get('papers') and m['id'] in profiles and m['id'] not in state['people']]
    if args.limit:pending=pending[:args.limit]
    print(json.dumps({'event':'started','pending':len(pending)},ensure_ascii=False),flush=True)
    for current,mentor in enumerate(pending,1):
        profile=profiles[mentor['id']];works=(profile.get('sections') or {}).get('代表性论文及专著','')
        papers=[]
        for line in works.splitlines():
            match=re.search(r'\b(202[3-6])\b',line)
            if not match:continue
            title=title_from(line)
            if len(title)<12:continue
            key=re.sub(r'[^a-z0-9]','',title.lower())
            if not key or any(re.sub(r'[^a-z0-9]','',p['title'].lower())==key for p in papers):continue
            year=match.group(1)
            papers.append({'id':f'official-{mentor["id"]}-{len(papers)+1}','title':title,'date':year,'precision':'year','venue':'官方个人页代表作（发表位置待结构化）','authors':[mentor['name']],'url':profile['url'],'status':'published','versions':[{'kind':'学院官方个人页代表作','date':year,'url':profile['url']}],'source':{'id':f'official-work-{mentor["id"]}-{len(papers)+1}','title':f'{mentor["name"]} · 学院官方个人页代表作','url':profile['url'],'kind':'official','retrievedAt':profile.get('retrievedAt','2026-10-20')},'identity':'学院官方个人页明确列出的代表作；未从书目行推断摘要、DOI或作者顺序。'})
            if len(papers)==5:break
        if papers:
            mentor['papers']=papers
            mentor['coverageNote']=f'学院官方个人页列出{len(papers)}篇2023年以来代表作；条目日期为年份精度，DOI、摘要和完整作者信息待补。'
            result={'status':'enriched','papers':len(papers)}
        else:result={'status':'unresolved','reason':'官方个人页未列出可识别的2023年以来代表作'}
        state['people'][mentor['id']]=result
        SEED.write_text(json.dumps(seed,ensure_ascii=False,indent=2)+'\n');STATE.write_text(json.dumps(state,ensure_ascii=False,indent=2)+'\n')
        print(json.dumps({'event':'progress','current':current,'total':len(pending),'id':mentor['id'],'name':mentor['name'],**result},ensure_ascii=False),flush=True)
    print(json.dumps({'event':'complete'},ensure_ascii=False),flush=True)
if __name__=='__main__':main()
