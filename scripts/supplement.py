"""Fill missing abstracts from public paper records; exact-title matches only."""
import concurrent.futures,html,json,pathlib,re,urllib.parse,urllib.request,xml.etree.ElementTree as ET
ROOT=pathlib.Path(__file__).resolve().parent.parent
def get(url):
 with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'MentorRadar/0.1'}),timeout=18) as r:return r.read().decode()
def norm(s):return re.sub(r'[^a-z0-9]','',s.lower())
def find(row):
 ident,index,w=row;doi=(w.get('doi')or'').replace('https://doi.org/','')
 try:
  j=json.loads(get('https://api.semanticscholar.org/graph/v1/paper/DOI:'+urllib.parse.quote(doi,safe='')+'?fields=title,abstract,url'))
  if j.get('abstract') and norm(j['title'])==norm(w['title']):return ident,index,j['abstract'],j['url']
 except Exception:pass
 try:
  query='ti:"'+w['title'].replace('"','')+'"'
  root=ET.fromstring(get('https://export.arxiv.org/api/query?search_query='+urllib.parse.quote(query)+'&max_results=3'));ns={'a':'http://www.w3.org/2005/Atom'}
  for entry in root.findall('a:entry',ns):
   title=entry.findtext('a:title','',ns)
   if norm(title)==norm(w['title']):return ident,index,entry.findtext('a:summary','',ns).strip(),entry.findtext('a:id','',ns)
 except Exception:pass
 if doi.startswith('10.1038/'):
  url='https://www.nature.com/articles/'+doi.split('/')[1]
  try:
   raw=get(url);m=re.search(r'<meta[^>]+name="(?:dc.description|description)"[^>]+content="([^"]+)"',raw)
   if m and len(html.unescape(m.group(1)))>300:return ident,index,html.unescape(m.group(1)),url
  except Exception:pass
 return ident,index,'',''
if __name__=='__main__':
 p=ROOT/'data/selected-papers.json';j=json.loads(p.read_text());jobs=[(ident,i,w) for ident,d in j.items() for i,w in enumerate(d['papers']) if not w.get('abstract')]
 with concurrent.futures.ThreadPoolExecutor(max_workers=2) as ex:
  for ident,index,abstract,url in ex.map(find,jobs):
   if abstract:j[ident]['papers'][index]['abstract']=abstract;j[ident]['papers'][index]['abstractSource']=url
   print(ident,index,'found '+str(len(abstract)) if abstract else 'no public abstract found')
 p.write_text(json.dumps(j,ensure_ascii=False,indent=2))
