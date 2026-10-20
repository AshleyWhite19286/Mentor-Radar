"""Materialize reviewed academic candidates and Crossref publication dates."""
import concurrent.futures,html,json,pathlib,re,urllib.request,urllib.parse
ROOT=pathlib.Path(__file__).resolve().parent.parent
PICKS={'wang-xinbing':(0,[1,2,3,4,5]),'dai-wenrui':(0,[0,2,3,4,5]),'min-xiongkuo':(0,[0,2,3,4,8]),'tao-meixia':(0,[1,2,3,4,5]),'zhang-wenjia':(0,[0,3,5,7,11]),'wu-qingqing':(0,[2,6,7,8,9]),'sun-yanan':(0,[0,1,3,4,7]),'liu-jingquan':(0,[1,2,3,5,6]),'chen-changxin':(0,[0,1,2,3,4]),'xu-yin':(1,[1,2,3,5,6]),'fang-xiangzhong':(0,[2,3,4,6,8])}
def get(url):
 with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'MentorRadar/0.1'}),timeout=20) as r:return json.load(r)
def enrich(row):
 ident,w=row;w=dict(w);doi=(w.get('doi') or '').replace('https://doi.org/','');w['precision']='day';w['metadataSource']=w['id']
 try:
  if doi.startswith('10.48550/arxiv.'):
   w['type']='preprint'
  elif doi:
   c=get('https://api.crossref.org/works/'+urllib.parse.quote(doi,safe=''))['message']
   # Earliest online publication is distinct from issue/print assignment.
   d=(c.get('published-online') or {}).get('date-parts',[[]])[0]
   if not d:w['metadataNote']='公开索引日期；首次在线日期未由出版社元数据确认'
   if d:
    w['date']='-'.join(str(n) if i==0 else str(n).zfill(2) for i,n in enumerate(d));w['precision']=['year','month','day'][min(len(d),3)-1]
   if not w.get('abstract') and c.get('abstract'):w['abstract']=html.unescape(re.sub('<[^>]*>','',c['abstract']))
   w['metadataSource']='https://api.crossref.org/works/'+doi
 except Exception as e:w['metadataNote']='Crossref补充暂不可用，日期来自OpenAlex，首次在线日期待复核'
 return ident,w
if __name__=='__main__':
 source=json.loads((ROOT/'data/source-works.json').read_text());jobs=[];result={}
 for ident,(author,indices) in PICKS.items():
  result[ident]={'authorId':source[ident][author]['authorId'],'papers':[]}
  jobs.extend((ident,source[ident][author]['works'][i]) for i in indices)
 # This paper is explicitly listed on the official profile; no name-only author search.
 c=get('https://api.crossref.org/works?query.title='+urllib.parse.quote('An Edge Detection Algorithm for SEM Images of Multilayer Thin Films')+'&rows=1')['message']['items'][0]
 assert 'edge detection algorithm' in c['title'][0].lower()
 result['wang-ying']={'papers':[]}
 jobs.append(('wang-ying',{'id':'https://doi.org/'+c['DOI'],'title':c['title'][0],'date':'2024-03','doi':'https://doi.org/'+c['DOI'],'type':'article','venue':c['container-title'][0],'url':c['URL'],'abstract':html.unescape(re.sub('<[^>]*>','',c.get('abstract',''))),'authors':[(a.get('given','')+' '+a.get('family',''),[]) for a in c.get('author',[])],'topics':[],'locations':[]}))
 with concurrent.futures.ThreadPoolExecutor(max_workers=4) as ex:
  for ident,w in ex.map(enrich,jobs):result[ident]['papers'].append(w)
 (ROOT/'data/selected-papers.json').write_text(json.dumps(result,ensure_ascii=False,indent=2))
 for ident,d in result.items():
  print(ident)
  for w in d['papers']:print(w['date'],w['title'][:110],len(w.get('abstract','')))
