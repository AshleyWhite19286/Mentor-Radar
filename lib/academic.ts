import * as cheerio from 'cheerio';
import { publicFetch,jsonFetch } from './network';
import { selectRecent,deduplicate } from './papers';
import type { Paper } from './types';

export type AuthorCandidate={id:string;name:string;affiliations:string[];works:number;url:string;provider:'openalex'|'semantic'};
export async function authorCandidates(name:string):Promise<AuthorCandidate[]> {
  try {
    const j=await jsonFetch(`https://api.openalex.org/authors?search=${encodeURIComponent(name)}&per-page=8`);
    return (j.results||[]).map((a:Record<string,unknown>)=>({id:String(a.id).split('/').pop(),name:a.display_name,affiliations:((a.last_known_institutions||[]) as {display_name:string}[]).map(i=>i.display_name),works:a.works_count,url:a.id,provider:'openalex'}));
  } catch {
    const j=await jsonFetch(`https://api.semanticscholar.org/graph/v1/author/search?query=${encodeURIComponent(name)}&fields=name,affiliations,paperCount&limit=8`);
    return (j.data||[]).map((a:{authorId:string;name:string;affiliations:string[];paperCount:number})=>({id:a.authorId,name:a.name,affiliations:a.affiliations||[],works:a.paperCount,url:`https://www.semanticscholar.org/author/${a.authorId}`,provider:'semantic'}));
  }
}
function uninvert(inv:Record<string,number[]>|null) { const words:string[]=[];for(const [word,indices] of Object.entries(inv||{})) for(const i of indices) words[i]=word;return words.join(' '); }
function record(w:Record<string,any>,identity:string): Paper { // External metadata is normalized here before entering the app.
  const doi=w.doi?.replace(/^https?:\/\/(dx\.)?doi.org\//,''); const url=w.doi||w.primary_location?.landing_page_url||w.id;
  const arxivLocation=w.locations?.find((l:Record<string,any>)=>/arxiv\.org\/abs\//.test(l.landing_page_url||''));
  const arxivId=arxivLocation?.landing_page_url?.split('/abs/')[1]||(doi?.startsWith('10.48550/arxiv.')?doi.slice('10.48550/arxiv.'.length):undefined);
  const preprint=w.type==='preprint'||doi?.startsWith('10.48550/arxiv.')||(!w.primary_location?.source&&!!arxivId);
  return {id:'paper-'+String(w.id).split('/').pop(),title:w.title||w.display_name,date:w.publication_date,precision:'day',doi,arxivId,venue:w.primary_location?.source?.display_name||'发表位置待核实',authors:(w.authorships||[]).map((a:Record<string,any>)=>a.author.display_name),abstract:uninvert(w.abstract_inverted_index)||undefined,url,status:preprint?'preprint':'published',versions:[{kind:preprint?'预印本':'正式发表',date:w.publication_date,url}],source:{id:'source-'+String(w.id).split('/').pop(),title:w.title,url:w.id,kind:'paper',retrievedAt:new Date().toISOString()},identity};
}
export async function authorPapers(author:AuthorCandidate,onStep:(s:string)=>void) {
  const now=new Date(); const cutoff=new Date(now);cutoff.setUTCFullYear(cutoff.getUTCFullYear()-3);
  let papers:Paper[]=[];
  onStep('检索作者近36个月的论文元信息，按24个月优先规则筛选');
  if(author.provider==='openalex') {
    if(!/^A\d+$/.test(author.id))throw new Error('作者标识不正确');
    const j=await jsonFetch(`https://api.openalex.org/works?filter=authorships.author.id:${author.id},from_publication_date:${cutoff.toISOString().slice(0,10)},to_publication_date:${now.toISOString().slice(0,10)}&sort=publication_date:desc&per-page=100`);
    papers=(j.results||[]).map((w:Record<string,any>)=>record(w,`用户确认作者 ${author.name}（${author.id}）；论文归属来自学术索引，保存前请核对`));
  } else {
    if(!/^\d+$/.test(author.id))throw new Error('作者标识不正确');
    const headers:Record<string,string>={};if(process.env.SEMANTIC_SCHOLAR_API_KEY)headers['x-api-key']=process.env.SEMANTIC_SCHOLAR_API_KEY;
    const j=await (await publicFetch(`https://api.semanticscholar.org/graph/v1/author/${author.id}/papers?fields=title,year,publicationDate,venue,authors,abstract,externalIds,url,publicationTypes&limit=100`,{headers})).json();
    papers=(j.data||[]).map((p:Record<string,any>)=>({id:'paper-'+p.paperId,title:p.title,date:p.publicationDate||String(p.year),precision:p.publicationDate?'day':'year',venue:p.venue||'发表位置待核实',doi:p.externalIds?.DOI,arxivId:p.externalIds?.ArXiv,authors:p.authors.map((a:Record<string,any>)=>a.name),abstract:p.abstract,url:p.url,status:p.venue?'published':'preprint',versions:[{kind:p.venue?'正式发表':'预印本',date:p.publicationDate||String(p.year),url:p.url}],identity:'用户确认作者；学术索引归属，保存前请核对',source:{id:'source-'+p.paperId,title:p.title,url:p.url,kind:'paper',retrievedAt:now.toISOString()}}));
  }
  const recent=selectRecent(papers,now);
  onStep(`去重后采用${recent.window}个月窗口；找到${recent.available}篇，展示最新${recent.papers.length}篇`);
  // Search arXiv by a known title, never import arbitrary name-only matches.
  for(const p of recent.papers.filter(p=>!p.abstract).slice(0,3)) {
    try {
      const r=await publicFetch(`https://export.arxiv.org/api/query?search_query=ti:${encodeURIComponent('"'+p.title.replace(/"/g,'')+'"')}&max_results=2`);
      const $=cheerio.load(await r.text(),{xml:true}); const entry=$('entry').toArray().find(e=>$(e).find('title').text().replace(/\s/g,'').toLowerCase()===p.title.replace(/\s/g,'').toLowerCase());
      if(entry){p.abstract=$(entry).find('summary').text().trim();const u=$(entry).find('id').text();p.arxivId=u.split('/abs/')[1];p.versions.push({kind:'预印本',date:$(entry).find('published').text().slice(0,10),url:u});}
    } catch { /* One unavailable source must not erase existing metadata. */ }
  }
  return {...recent,papers:deduplicate(recent.papers)};
}
export async function readPage(url:string) {
  const response=await publicFetch(url);const type=response.headers.get('content-type')||'';
  if(!type.includes('html')&&!type.includes('text/'))throw new Error('请提供个人介绍网页；PDF请改为粘贴摘要');
  const $=cheerio.load(await response.text()); $('script,style,nav,footer,header,noscript').remove();
  const main=$('main,article,.teacher-info,.ny-content').first();
  return (main.length?main:$('body')).text().replace(/[\t ]+/g,' ').replace(/\n\s*\n/g,'\n').trim().slice(0,24000);
}
export async function paperByDoi(doi:string):Promise<Paper> {
  const normalized=doi.replace(/^https?:\/\/doi.org\//,'');
  if(!/^10\.\d{4,9}\/.{1,180}$/.test(normalized))throw new Error('DOI格式不正确');
  const j=await jsonFetch(`https://api.crossref.org/works/${encodeURIComponent(normalized)}`);const w=j.message;
  const parts=(w['published-online']||w.published||w['published-print'])?.['date-parts']?.[0]; if(!parts)throw new Error('未找到发表时间');
  const date=parts.map((n:number,i:number)=>i?String(n).padStart(2,'0'):String(n)).join('-');
  const abstract=w.abstract?cheerio.load(w.abstract).text():undefined;
  return {id:'doi-'+Buffer.from(normalized).toString('base64url'),title:w.title?.[0]||normalized,date,precision:parts.length>=3?'day':parts.length===2?'month':'year',venue:w['container-title']?.[0]||'发表位置待核实',doi:normalized,authors:(w.author||[]).map((a:{given:string;family:string})=>[a.given,a.family].filter(Boolean).join(' ')),abstract,url:`https://doi.org/${normalized}`,status:w.type==='posted-content'?'preprint':'published',versions:[{kind:'元数据记录',date,url:`https://doi.org/${normalized}`}],identity:'DOI解析结果，需用户确认作者归属',source:{id:'crossref-'+normalized,title:w.title?.[0]||normalized,url:`https://doi.org/${normalized}`,kind:'paper',retrievedAt:new Date().toISOString()}};
}
