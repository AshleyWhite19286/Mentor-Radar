"""Refresh the official SJTU teacher directory, profiles, and portraits. Never calls an LLM."""
import argparse, concurrent.futures, html, json, pathlib, re, urllib.parse, urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
BASE = 'https://icisee.sjtu.edu.cn'
DIRECTORY = f'{BASE}/active/ajax_teacher_list.html'
GROUPS = ['数据智能研究所','信息智能研究所','图像通信与网络工程研究所','无线通信技术研究所','光子学与通信研究所','电磁与智能系统研究所','芯片设计与EDA研究所','微纳器件与集成系统研究所','纳电子材料与器件研究所','未来媒体网络协同创新中心','电子信息与集成电路实验教学中心','先进电子材料与器件平台']
LEGACY_IDS = {'wangxinbing':'wang-xinbing','2851':'dai-wenrui','561':'min-xiongkuo','541':'tao-meixia','zhangwenjia':'zhang-wenjia','538':'wu-qingqing','718':'sun-yanan','782':'liu-jingquan','chenzhangxin':'chen-changxin','523':'xu-yin','fangxiangzhong':'fang-xiangzhong','747':'wang-ying'}

def get(url):
 req = urllib.request.Request(url, headers={'User-Agent':'MentorRadar/0.1 (academic navigation prototype)'})
 with urllib.request.urlopen(req, timeout=25) as r: return r.read()

def stable_id(name, slug):
 return LEGACY_IDS.get(slug, re.sub(r'[^a-z0-9]+', '-', slug.lower()).strip('-') or ('teacher-'+str(abs(hash(name)))))

def directory(group):
 data=urllib.parse.urlencode({'page':1,'cat_code':'jiaoshiml','yjszxfl':group,'name':'','zm':'All'}).encode()
 req=urllib.request.Request(DIRECTORY,data=data,headers={'User-Agent':'MentorRadar/0.1 (academic navigation prototype)'})
 with urllib.request.urlopen(req,timeout=25) as r: content=json.load(r)['content']
 rows=[]
 for href,name,title,role in re.findall(r'href="([^"]+)"[^>]*>.*?<div class="name">\s*([^<]+)<span>([^<]*)</span><p[^>]*>(.*?)</p>',content,re.S):
  slug=urllib.parse.urlparse(html.unescape(href)).path.rsplit('/',1)[-1].removesuffix('.html')
  rows.append({'id':stable_id(html.unescape(name).strip(),slug),'name':html.unescape(name).strip(),'slug':slug,'url':html.unescape(href),'title':html.unescape(title).strip(),'directoryRole':html.unescape(re.sub('<[^>]+>','',role)).strip(),'group':group})
 return rows

def text(s):
 s = re.sub(r'<(?:br|/p|/div|/li|/tr|/h[1-6])\b[^>]*>', '\n', s, flags=re.I)
 return '\n'.join(x.strip() for x in html.unescape(re.sub('<[^>]+>', '', s)).splitlines() if x.strip())

def collect(row):
 ident,name,slug = row['id'],row['name'],row['slug']; url=row['url']
 try:
  raw=get(url).decode('utf-8'); body=raw.split('教师简介</div>')[-1].split('<!-- 底部')[0]
  # The source groups profile sections under .tit headings.
  chunks=re.split(r'<div class="tit">(.*?)</div>',body)
  sections={chunks[i]:text(chunks[i+1]).split('Copyright')[0].strip() for i in range(1,len(chunks)-1,2)}
  profile=text(chunks[0]); photo=re.search(r'class="imgk"[^>]*>\s*<img src="([^"]+)"',body)
  photo_url=BASE+photo.group(1) if photo and photo.group(1).startswith('/') else (photo.group(1) if photo else '')
  photo_path=''
  if photo_url:
   try:
    content=get(photo_url); dest=ROOT/'public'/'portraits'/f'{ident}.jpg'; dest.parent.mkdir(parents=True,exist_ok=True); dest.write_bytes(content); photo_path=f'/portraits/{ident}.jpg'
   except Exception as e: print(name,'portrait:',type(e).__name__)
  return {**row,'profile':profile,'sections':sections,'photo':photo_path,'photoSource':photo_url,'retrievedAt':'2026-10-20'}
 except Exception as e: return {**row,'error':str(e)}

if __name__=='__main__':
 parser=argparse.ArgumentParser()
 parser.add_argument('--per-group',type=int,default=0,help='Limit each official directory category; zero means all people.')
 args=parser.parse_args()
 (ROOT/'data').mkdir(exist_ok=True)
 candidates=[]
 for group in GROUPS:
  listed=directory(group)
  candidates.extend(listed[:args.per_group] if args.per_group else listed)
  print(group,len(listed),'listed; collecting',min(len(listed),args.per_group) if args.per_group else len(listed))
 with concurrent.futures.ThreadPoolExecutor(max_workers=4) as ex: rows=list(ex.map(collect,candidates))
 (ROOT/'data'/'source-profiles.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2))
 for row in rows: print(row['group'],row['name'],row.get('profile','')[:130].replace('\n',' | '), {k:len(v) for k,v in row.get('sections',{}).items()},row.get('error',''))
