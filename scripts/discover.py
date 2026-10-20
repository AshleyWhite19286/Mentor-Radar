"""Inspect public academic identities; output is candidates, not verified seed data."""
import concurrent.futures,json,pathlib,urllib.request,urllib.parse
ROOT=pathlib.Path(__file__).resolve().parent.parent
NAMES={'wang-xinbing':'Xinbing Wang','dai-wenrui':'Wenrui Dai','min-xiongkuo':'Xiongkuo Min','tao-meixia':'Meixia Tao','zhang-wenjia':'Wenjia Zhang','wu-qingqing':'Qingqing Wu','sun-yanan':'Yanan Sun','liu-jingquan':'Jingquan Liu','chen-changxin':'Changxin Chen','xu-yin':'Yin Xu','fang-xiangzhong':'Xiangzhong Fang'}
def get(u):
 with urllib.request.urlopen(urllib.request.Request(u,headers={'User-Agent':'MentorRadar/0.1'}),timeout=30) as r:return json.load(r)
def work(w):
 inv=w.get('abstract_inverted_index') or {}; words={i:s for s,ids in inv.items() for i in ids}
 return {'id':w['id'],'title':w['title'],'date':w['publication_date'],'doi':w.get('doi'),'type':w.get('type'),'venue':(w.get('primary_location',{}).get('source') or {}).get('display_name',''), 'url':w.get('doi') or w['id'],'abstract':' '.join(words[i] for i in sorted(words)), 'authors':[(a['author']['display_name'],[i['display_name'] for i in a['institutions']]) for a in w['authorships']], 'topics':[t['display_name'] for t in w.get('topics',[])], 'locations':[{'url':x.get('landing_page_url'),'pdf':x.get('pdf_url')} for x in w.get('locations',[])]}
def run(row):
 ident,n=row
 try:
  candidates=get('https://api.openalex.org/authors?search='+urllib.parse.quote(n)+'&per-page=50')['results']
  authors=[a for a in candidates if any('Shanghai Jiao Tong' in i['display_name'] for i in (a.get('last_known_institutions') or [])) and a['display_name'].lower()==n.lower()]
  result=[]
  for a in authors[:5]:
   works=get('https://api.openalex.org/works?filter=authorships.author.id:'+a['id'].split('/')[-1]+',from_publication_date:2023-10-20,to_publication_date:2026-10-20&sort=publication_date:desc&per-page=30')['results']
   result.append({'authorId':a['id'],'count':a['works_count'],'works':[work(w) for w in works]})
  return ident,result
 except Exception as e:return ident,{'error':str(e)}
if __name__=='__main__':
 with concurrent.futures.ThreadPoolExecutor(max_workers=3) as ex: data=dict(ex.map(run,NAMES.items()))
 (ROOT/'data/source-works.json').write_text(json.dumps(data,ensure_ascii=False,indent=2))
 for ident,authors in data.items():
  print(ident)
  if isinstance(authors,dict): print(authors);continue
  for a in authors:
   print(a['authorId'],a['count'])
   for w in a['works'][:6]:print(w['date'],w['title'],w['doi'])
