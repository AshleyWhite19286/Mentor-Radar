/** Merge source-verified publications and produce a per-person coverage audit. */
import { createHash } from 'node:crypto';
import { existsSync,readFileSync,writeFileSync } from 'node:fs';
import { deduplicate,selectRecent } from '../lib/papers';
import type { Catalog,Mentor,Paper } from '../lib/types';

const snapshot=new Date('2026-10-20T23:59:59Z');
const read=<T>(path:string,fallback:T):T=>existsSync(path)?JSON.parse(readFileSync(path,'utf8')) as T:fallback;
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const normal=(value:string)=>value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
const curated=new Set(Object.keys(read<Record<string,unknown>>('data/selected-papers.json',{})));
const catalog=read<Catalog>('data/seed.json',{institutes:[],mentors:[],revisions:[]});
type Evidence={id:string;name:string;officialUrl:string;links:{url:string;label:string;via?:string}[];confirmedAcademicLinks?:{label:string;url:string;sourceUrl:string;verification:string}[];requests:{url:string;status:string;reason?:string;kind?:string}[]};
type ScholarRow={title:string;year:string;authors:string;venue:string;detailUrl:string};
type Scholar={user:string;status:string;displayName?:string;officialLink:{url:string;via?:string};pages:string[];rows:ScholarRow[];paginationLimit?:boolean;reason?:string};
type Resolved={mentorId:string;status:string;paper?:Paper;line:string;url:string;reason?:string};
type AuthorResult={id:string;name:string;status:string;papers:Paper[];authors:{authorId:string;retrievedWorks:number}[];errors:{reason:string}[]};
const evidence=read<{people:Record<string,Evidence>}>('data/publication-evidence.json',{people:{}}).people;
const completed=read<{scholar:Record<string,Scholar[]>;bibliography:Record<string,Resolved>}>('data/publication-completion.json',{scholar:{},bibliography:{}});
const anchored=read<{people:Record<string,AuthorResult>}>('data/anchored-author-publications.json',{people:{}}).people;
const verified=read<{bibliography:Record<string,Resolved>;authors:Record<string,AuthorResult>;rejected:{mentorId:string;reason:string}[]}>('data/verified-publication-candidates.json',{bibliography:{},authors:{},rejected:[]});
const explicit=read<{people:Record<string,{papers:Paper[]}>}>('data/official-bibliography-publications.json',{people:{}}).people;
const lab=read<{people:Record<string,{papers:Paper[];authorUrl:string}>}>('data/lab-publication-records.json',{people:{}}).people;
const coauthored=read<{people:Record<string,{papers:Paper[]}>}>('data/coauthored-publication-records.json',{people:{}}).people;
const crossrefAuthors=read<{people:Record<string,{papers:Paper[];status:string;reason?:string}>}>('data/crossref-author-publications.json',{people:{}}).people;
const crossrefAffiliations=read<{people:Record<string,{papers:Paper[];status:string;reason?:string}>}>('data/crossref-affiliation-publications.json',{people:{}}).people;
const details=read<{papers:Record<string,{mentorId:string;status:string;paper?:Paper;reason?:string}>}>('data/scholar-publication-details.json',{papers:{}}).papers;
type Baseline={curated:Record<string,string>;people:Record<string,{papers:number;recent:number;ids:string[]}>;originalPapers?:Record<string,Paper[]>;originalAuthorIds?:Record<string,string>};
const baselinePath='data/publication-coverage-baseline.json';
const initial=existsSync(baselinePath)?undefined:catalog;
const baseline=read<Baseline>(baselinePath,{curated:Object.fromEntries((initial?.mentors||[]).filter(m=>curated.has(m.id)).map(m=>[m.id,hash(m)])),people:Object.fromEntries((initial?.mentors||[]).map(m=>[m.id,{papers:m.papers.length,recent:selectRecent(m.papers,snapshot).papers.length,ids:m.papers.map(p=>p.id)}])),originalPapers:Object.fromEntries((initial?.mentors||[]).filter(m=>!curated.has(m.id)).map(m=>[m.id,m.papers])),originalAuthorIds:Object.fromEntries((initial?.mentors||[]).filter(m=>!curated.has(m.id)&&m.authorId).map(m=>[m.id,m.authorId!]))});
if(!existsSync(baselinePath))writeFileSync(baselinePath,JSON.stringify(baseline,null,2)+'\n');
if(!baseline.originalPapers)throw new Error('论文复查基线缺少原始论文，请恢复完整基线后再合并。');

function score(paper:Paper){return (paper.status==='published'?1000:0)+({day:120,month:80,year:20}[paper.precision])+(paper.source.url.includes('doi.org')?15:0)+(paper.source.url.includes('semanticscholar')?10:0)+(paper.authors.length>1?3:0)+(paper.abstract?2:0)-(paper.venue.includes('待结构化')?500:0);}
function same(a:Paper,b:Paper){return Boolean(a.doi&&b.doi&&normal(a.doi)===normal(b.doi)||a.arxivId&&b.arxivId&&a.arxivId.replace(/v\d+$/,'')===b.arxivId.replace(/v\d+$/,'')||normal(a.title)===normal(b.title));}
function mergePapers(existing:Paper[],incoming:Paper[]){
  const candidates=[...existing,...incoming].map(p=>structuredClone(p)).filter(p=>p.title.trim()&&/^202\d/.test(p.date)&&Number(p.date.slice(0,4))<=2026&&(p.precision==='year'||p.date<='2026-10-20'));
  for(const paper of candidates){
    const arxiv=paper.arxivId||paper.url.match(/arxiv\.org\/(?:abs|pdf)\/(\d{4}\.\d{4,5})/)?.[1]||paper.doi?.match(/10\.48550\/arxiv\.(\d{4}\.\d{4,5})/i)?.[1];
    if(arxiv)paper.arxivId=arxiv;
    if(/arxiv/i.test(paper.venue)||paper.doi?.toLowerCase().startsWith('10.48550/arxiv.'))paper.status='preprint';
  }
  // Earlier fallback imports stored whole bibliography lines as titles. Replace
  // them when the same official line now resolves to an actual full title.
  const cleaned=candidates.filter(p=>!p.venue.includes('待结构化')||!candidates.some(q=>q!==p&&!q.venue.includes('待结构化')&&normal(q.title).length>=15&&normal(p.title).includes(normal(q.title))));
  let unique:Paper[]=deduplicate(cleaned).map(merged=>{
    const group=cleaned.filter(p=>same(p,merged));
    const best=group.sort((a,b)=>score(b)-score(a)||a.date.localeCompare(b.date))[0]||merged;
    const prior=existing.find(p=>same(p,merged));
    const analysis=group.find(p=>p.analysis&&p.abstract);
    const result={...merged,...best,id:prior?.id||best.id,doi:best.doi||merged.doi,arxivId:best.arxivId||merged.arxivId,versions:merged.versions,abstract:best.abstract||merged.abstract,analysis:analysis?.analysis,source:analysis?.source||best.source};
    if(!result.abstract)delete result.analysis;
    return result;
  });
  // A metadata merge can connect previously separate title/DOI groups. Close
  // those transitive matches before displaying or counting the bibliography.
  for(;;){const next=deduplicate(unique);if(next.length===unique.length)break;unique=next;}
  return unique.sort((a,b)=>b.date.localeCompare(a.date));
}

const rows=[];
for(const mentor of catalog.mentors){
  if(curated.has(mentor.id)){
    if(baseline.curated[mentor.id]!==hash(mentor))throw new Error(`首批资料发生变化：${mentor.name}`);
    continue;
  }
  const person=evidence[mentor.id];
  if(!person)throw new Error(`尚未检查官网：${mentor.name}`);
  const bibliography=Object.values(verified.bibliography).filter(r=>r.mentorId===mentor.id);
  const scholar=(completed.scholar[mentor.id]||[]).filter(s=>s.status==='ok');
  const author=verified.authors[mentor.id];
  const incoming=[...bibliography.flatMap(r=>r.paper?[r.paper]:[]),...(author?.papers||[]),...(explicit[mentor.id]?.papers||[]),...(lab[mentor.id]?.papers||[]),...(coauthored[mentor.id]?.papers||[]),...(crossrefAuthors[mentor.id]?.papers||[]),...(crossrefAffiliations[mentor.id]?.papers||[]),...Object.values(details).filter(r=>r.mentorId===mentor.id).flatMap(r=>r.paper?[r.paper]:[])];
  // A public author list is still valid evidence when a publisher API has no
  // record. Retain its actual precision and show the unresolved fields plainly.
  for(const profile of scholar){
    for(const row of profile.rows){
      if(incoming.some(p=>normal(p.title)===normal(row.title)))continue;
      const key=hash({user:profile.user,title:row.title}).slice(0,20);
      const arxiv=row.venue.match(/arXiv:(\d{4}\.\d{4,5})/i)?.[1];
      incoming.push({id:'paper-scholar-list-'+key,title:row.title,date:row.year,precision:'year',venue:row.venue||'发表位置待核实',arxivId:arxiv,authors:row.authors.split(',').map(v=>v.trim()).filter(Boolean),url:row.detailUrl||profile.pages[0],status:arxiv||/arxiv|preprint/i.test(row.venue)?'preprint':'published',versions:[{kind:'Google Scholar 作者公开论文列表',date:row.year,url:profile.pages[0]}],source:{id:'scholar-list-'+key,title:row.title,url:row.detailUrl||profile.pages[0],kind:'paper',retrievedAt:'2026-10-20'},identity:`学院官网或经本人姓名核对的教师主页链接到 Scholar 用户 ${profile.user}；条目来自该作者公开列表。`,dateNote:'当前仅取得作者列表的年份和书目信息；具体日期及完整作者待详情或出版方元信息核实，省略作者不自行补写。'});
    }
  }
  // Rebuild from the task baseline so candidates rejected on a later review
  // cannot survive just because an earlier incremental merge accepted them.
  mentor.papers=mergePapers(baseline.originalPapers?.[mentor.id]||[],incoming);
  const academicProfiles=scholar.map(profile=>({label:'Google Scholar',url:'https://scholar.google.com/citations?user='+profile.user}));
  for(const profile of person.confirmedAcademicLinks||[])if(!academicProfiles.some(p=>p.url===profile.url))academicProfiles.push({label:profile.label,url:profile.url});
  if(lab[mentor.id])academicProfiles.push({label:'研究所论文页',url:lab[mentor.id].authorUrl});
  if(academicProfiles.length)mentor.academicProfiles=academicProfiles;
  if(!mentor.homepage&&academicProfiles.length)mentor.homepage=academicProfiles[0].url;
  // Preserve a valid single personal URL; split malformed legacy multi-URL text.
  if(mentor.homepage){
    const match=mentor.homepage.match(/(?:https?:\/\/|www\.|[a-zA-Z0-9.-]+\.(?:edu\.cn|github\.io)\/)[^\s；;，（）()|]*/);
    if(match)mentor.homepage=match[0].startsWith('http')?match[0]:'https://'+match[0];
    else delete mentor.homepage;
    if(mentor.homepage&&/scholar\.google\./.test(mentor.homepage)){
      const user=new URL(mentor.homepage).searchParams.get('user');
      if(user)mentor.homepage='https://scholar.google.com/citations?user='+user;
    }
  }
  if(!mentor.homepage){
    const link=person.links.find(link=>/个人主页/.test(link.label));
    if(link)mentor.homepage=link.url;
  }
  if(!mentor.englishName&&scholar[0]?.displayName)mentor.englishName=scholar[0].displayName.replace(/[（(][^）)]*[）)]/g,'').trim();
  if(baseline.originalAuthorIds?.[mentor.id])mentor.authorId=baseline.originalAuthorIds[mentor.id];
  else if(author?.authors.length===1&&author.papers.length&&!verified.rejected.some(r=>r.mentorId===mentor.id))mentor.authorId='https://www.semanticscholar.org/author/'+author.authors[0].authorId;
  else delete mentor.authorId;
  const recent=selectRecent(mentor.papers,snapshot);
  const failed=[...person.requests.filter(r=>r.status==='error'&&(!('kind' in r)||r.kind!=='profile_discovery')),...bibliography.filter(r=>r.status==='error'),...(author?.errors||[]),...Object.entries(details).filter(([,r])=>r.mentorId===mentor.id&&r.status==='error').map(([url,r])=>({url,reason:r.reason})),...(crossrefAuthors[mentor.id]?.status==='error'?[{reason:crossrefAuthors[mentor.id].reason}]:[]),...(crossrefAffiliations[mentor.id]?.status==='error'?[{reason:crossrefAffiliations[mentor.id].reason}]:[])];
  const unresolved=bibliography.filter(r=>r.status==='unresolved').length;
  const sourceCount=person.requests.filter(r=>r.status==='ok').length+scholar.reduce((n,s)=>n+s.pages.length,0);
  mentor.searchedAt='2026-10-20';
  const methods=[scholar.length?'官网链接的 Scholar 论文列表':'',author?.papers.length?'官网代表作与合作者逐篇核验':'',bibliography.some(r=>r.paper)?'官网书目与 Crossref 题名、作者核对':'',crossrefAuthors[mentor.id]?.papers.length||crossrefAffiliations[mentor.id]?.papers.length?'出版元信息的本人单位或稳定合作者核验':'',lab[mentor.id]?'研究所官方论文目录':''].filter(Boolean);
  mentor.coverageNote=mentor.papers.length?`已复查学院个人页及可访问的论文主页。${methods.length?methods.join('、')+'；':''}合并去重后收录${mentor.papers.length}篇论文，近期${recent.papers.length}篇默认展示，其余可展开查看。${recent.boundary.length?`其中${recent.boundary.length}篇日期精度不足，未计入近期数量。`:''}${failed.length?'部分外部来源访问或索引核对未成功，详见逐人复查记录。':''}`:'已复查学院个人页及其公开论文入口；目前没有取得可核验且日期可确认的近36个月论文证据。'+(failed.length?'部分外部来源访问或索引核对未成功，保留待补状态。':'官网书目缺失、较旧或缺少可核验题名，保留待补状态。')+'这不代表老师没有科研活动。';
  mentor.selectionReason='学院目录、官方个人页及公开论文入口已复查；论文以官网明确书目、本人学术主页或代表作核验的作者档案为依据。';
  rows.push({id:mentor.id,name:mentor.name,instituteId:mentor.instituteId,officialUrl:person.officialUrl,academicProfiles,before:baseline.people[mentor.id],after:{papers:mentor.papers.length,recent:recent.papers.length,abstracts:mentor.papers.filter(p=>p.abstract).length,dateBoundary:recent.boundary.length},checkedPages:sourceCount,authorLookup:author?.status||anchored[mentor.id]?.status||'pending',candidateAuthorIds:author?.authors.map(a=>a.authorId)||[],publisherAuthorLookup:crossrefAuthors[mentor.id]?.status||'not_applicable',affiliationLookup:crossrefAffiliations[mentor.id]?.status||'not_applicable',matchedBibliography:bibliography.filter(r=>r.status==='matched').length,unresolvedBibliography:unresolved,rejectedCandidates:verified.rejected.filter(r=>r.mentorId===mentor.id).length,requestErrors:failed.map(r=>({url:'url' in r?r.url:undefined,reason:r.reason})),status:recent.papers.length>=5?'recent_sample_filled':recent.papers.length?'fewer_recent_verified':'no_recent_verified'});
}
const audit={checkedAt:'2026-10-20',scope:'排除首批12位，逐人复查其余261位官网及其论文入口；无记录与请求失败分别记录。',curatedPreserved:true,summary:{checked:rows.length,withPapers:rows.filter(r=>r.after.papers>0).length,withFiveRecent:rows.filter(r=>r.after.recent>=5).length,papersBefore:rows.reduce((n,r)=>n+(r.before?.papers||0),0),papersAfter:rows.reduce((n,r)=>n+r.after.papers,0),increased:rows.filter(r=>r.after.papers>(r.before?.papers||0)).length,noRecentVerified:rows.filter(r=>r.after.recent===0).length},people:rows};
writeFileSync('data/seed.json',JSON.stringify(catalog,null,2)+'\n');
writeFileSync('data/publication-coverage-audit.json',JSON.stringify(audit,null,2)+'\n');
console.log(JSON.stringify(audit.summary,null,2));
const report=['# 非首批教师论文复查记录','','复查日期：2026-10-20。首批12位资料保持原样；本表覆盖其余261位。','',`已检查${rows.length}位；${audit.summary.increased}位收录增加，论文条目从${audit.summary.papersBefore}篇增至${audit.summary.papersAfter}篇。`,'',`其中${audit.summary.withFiveRecent}位已达到5篇近期样本；${audit.summary.noRecentVerified}位仍未取得可确认的近期证据（包括教学与平台人员），原因逐人列明。`,'','默认近期列表仍采用24个月内最新5篇、不足时扩至36个月的规则；“查看全部已收录论文”保留已核验的其他条目。只有年份的2026年条目保留原始精度，不伪造日期。','', '书目核验采用官网明确题名、本人 Scholar 列表、研究所官方目录，以及出版元信息中的本人单位与完整署名。作者 ID 只用于发现候选；索引作品还须逐篇满足官方题名或至少两名已确认合作者的证据要求，包含可核验的入职前作品。同题评论和混合作者档案另行排除。未获取摘要时不编写摘要或解读。接口错误、日期边界和未核验题名见 [机器可读逐人记录](../data/publication-coverage-audit.json)。','', '“未取得近期证据”不代表没有论文；旧官网书目、不可访问的主页、索引分裂或失败请求均可能留下缺口，不宣称全量发表记录已穷尽。','', '|姓名|机构|原收录→本次收录|近期展示|复查来源|待确认|','|---|---|---:|---:|---|---|',...rows.map(r=>`|${r.name}|${catalog.institutes.find(i=>i.id===r.instituteId)?.shortName}|${r.before?.papers||0}→${r.after.papers}|${r.after.recent}|[官网](${r.officialUrl})${r.academicProfiles.map(p=>` · [${p.label}](${p.url})`).join('')}|${[r.after.dateBoundary?`${r.after.dateBoundary}篇日期待确认`:'',r.requestErrors.length?'外部来源/索引请求有失败':'',r.after.recent===0?'未取得可确认的近期证据':''].filter(Boolean).join('；')||'—'}|`)];
writeFileSync('docs/非首批教师论文复查.md',report.join('\n')+'\n');
