import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { catalog,get,hash,save } from './db';
import { analysisSchema,structured } from './model';
import { authorCandidates,authorPapers,readPage,type AuthorCandidate } from './academic';
import { selectRecent } from './papers';
import type { Institute,Mentor,ModelSettings,Paper,Revision,Source,Student } from './types';

type Step=(s:string)=>void;
export function sourcesFor(mentors:Mentor[]) { return mentors.flatMap(m=>[m.source,...m.papers.map(p=>p.source),...m.feedback.map(f=>f.source)]); }
function context(mentors:Mentor[]) { return mentors.map(m=>({id:m.id,name:m.name,officialDirections:m.officialDirections,role:m.role,advisorStatus:m.advisorStatus,evidence:{sourceId:m.source.id,text:m.source.excerpt||m.officialDirections},prerequisites:m.prerequisites,papers:m.papers.map(p=>({id:p.id,title:p.title,date:p.date,sourceId:p.source.id,abstract:p.abstract?.slice(0,2700),analysis:p.analysis?.summary})),feedback:m.feedback})); }
export async function analyzePaper(p:Paper,settings:ModelSettings) {
  if(!p.abstract)throw new Error('尚无可用摘要，请先补充摘要；不会仅凭标题生成论文解读');
  const key=hash({v:1,p:p.title,abstract:p.abstract,base:settings.baseUrl,model:settings.model});const cached=get<Paper['analysis']>('analysis-cache',key);if(cached)return cached;
  const result=await structured(settings,`基于摘要解读论文，不声称读过全文。返回JSON字段：summary（中文摘要，120字左右）,problem,method,significance,limitations（摘要未给出的实验条件须说明）,keywords（3–5个中文关键词，可附括号解释）,difficulty（可直接探索/需补基础/需较强基础）,prerequisites（课程和技能数组）,reading（理解论文所需基础）,reproduction（局部复现所需基础及设备）,research（开展研究仍需什么）,task（不依赖专用设备、一个具体的入门学习任务，明确是AI建议）,citations。证据ID ${p.source.id}，标题${p.title}，摘要：${p.abstract.slice(0,24000)}`,analysisSchema,[p.source]);
  const analysis={...result,basis:'abstract' as const,model:settings.model};save('analysis-cache',key,analysis);return analysis;
}
export async function explain(mentorId:string,paperId:string,settings:ModelSettings,step:Step) {
  const m=catalog().mentors.find(m=>m.id===mentorId);if(!m)throw new Error('教师不存在');const p=m.papers.find(p=>p.id===paperId);if(!p)throw new Error('论文不存在');
  step('读取已核验的论文摘要');const analysis=await analyzePaper(p,settings);step('检查结构与引用');
  const current=catalog().mentors.find(x=>x.id===mentorId)!;const paper=current.papers.find(x=>x.id===paperId);if(!paper)throw new Error('论文数据已变化，请刷新');paper.analysis=analysis;save('mentor',current.id,current);return {analysis};
}
const recommendation=z.object({mentorId:z.string(),reason:z.string(),gaps:z.array(z.string()),firstPaperId:z.string().nullable(),firstTask:z.string(),weeks:z.array(z.string()).length(4),citations:z.array(z.string()).min(1)});
export async function match(student:Student,settings:ModelSettings,step:Step) {
  const mentors=catalog().mentors.filter(m=>m.role==='导师');step('检索教学科研导师及近期论文证据');
  const sources=sourcesFor(mentors);step('结合兴趣、课程、编程经验和可投入时间分析');
  const result=await structured(settings,`根据学生画像推荐最多3位教师，不打分，不推断有名额或接收意愿。仅从下面的教学科研导师中选取。每位给出reason（带主题和证据的理由）,gaps（结合学生实际基础的差距）,firstPaperId（该导师已列论文ID，资料不足可null）,firstTask（具体、适配每周时间）,weeks（恰好4条，每条给出学习内容和可检查的产出）,citations。返回{recommendations:[{mentorId,reason,gaps,firstPaperId,firstTask,weeks,citations}],limitations:string}。学生：${JSON.stringify(student)}。证据：${JSON.stringify(context(mentors))}`,z.object({recommendations:z.array(recommendation).min(1).max(3),limitations:z.string()}),sources);
  const seen=new Set<string>();for(const r of result.recommendations){const m=mentors.find(m=>m.id===r.mentorId);if(!m||seen.has(m.id))throw new Error('推荐对象未通过核验，请重试');seen.add(m.id);if(r.firstPaperId&&!m.papers.some(p=>p.id===r.firstPaperId))throw new Error('推荐论文与教师不一致，请重试');const ids=new Set(sourcesFor([m]).map(s=>s.id));if(r.citations.some(id=>!ids.has(id)))throw new Error('推荐依据与教师不一致，请重试');}
  step('核验教师、论文归属和引用');return {...result,sources};
}
export async function answer(question:string,mentorId:string|undefined,paperId:string|undefined,settings:ModelSettings,step:Step) {
  let mentors=catalog().mentors;step('理解问题并选择相关本地证据');
  if(mentorId){mentors=mentors.filter(m=>m.id===mentorId);if(!mentors.length)throw new Error('教师不存在');}
  else {
    const plan=await structured(settings,`从目录选择最多3个与问题相关的导师ID。返回{mentorIds:string[]}。问题：${question}。目录：${JSON.stringify(mentors.map(m=>({id:m.id,name:m.name,tags:m.tags,directions:m.officialDirections})))}`,z.object({mentorIds:z.array(z.string()).max(3)}));
    mentors=mentors.filter(m=>plan.mentorIds.includes(m.id));if(!mentors.length)throw new Error('当前目录未找到相关证据，请尝试指定教师或调整问题');
  }
  if(paperId){mentors=mentors.map(m=>({...m,papers:m.papers.filter(p=>p.id===paperId)}));if(!mentors.some(m=>m.papers.length))throw new Error('论文不存在');}
  step(`读取${mentors.length}位教师的资料与相关论文`);const sources=sourcesFor(mentors);
  const result=await structured(settings,`回答问题，专业词汇给出解释。仅有标题的论文不能据此编造方法和结论。区分事实、有限证据推断与学习建议，必要时明确资料不足。返回{answer:string,citations:string[],gaps:string[]}。问题：${question}。证据：${JSON.stringify(context(mentors))}`,z.object({answer:z.string().min(1),citations:z.array(z.string()).min(1),gaps:z.array(z.string())}),sources);
  step('检查回答引用均来自已读取证据');return {...result,sources};
}
export type Draft={profile:{name:string;englishName:string;title:string;institute:string;directions:string;tags:string[];advisorStatus:string};source:Source;candidates:AuthorCandidate[]};
export async function inspect(url:string,text:string,englishName:string,settings:ModelSettings,step:Step):Promise<Draft> {
  step(url?'读取公开个人页':'读取用户粘贴资料');const body=text||(await readPage(url));if(body.length<30)throw new Error('资料过少，请粘贴完整个人介绍');
  const source:Source={id:'profile-'+randomUUID(),title:text?'用户粘贴的教师资料':'用户补充的个人页',url:url||'https://icisee.sjtu.edu.cn/jiaoshiml.html',kind:!text&&url&&new URL(url).hostname.endsWith('.sjtu.edu.cn')?'official':'user',retrievedAt:new Date().toISOString(),excerpt:(text?'用户手动粘贴，尚未核对原网页。\n':'')+body.slice(0,12000)};
  step('提取姓名、真实职称与机构，缺失字段标为待核实');
  const profile=await structured(settings,`从个人资料中提取教师信息，不得把导航栏机构当作所属机构。返回{name,englishName,title,institute,directions,tags:string[],advisorStatus}，所有字段为字符串（tags除外）。缺失字段填写待核实，英文姓名可基于给定英文姓名${englishName}，不得凭猜测确认作者身份。是否具备硕博导师资格只能按明确资料填写。资料：${body}`,z.object({name:z.string().min(1),englishName:z.string(),title:z.string(),institute:z.string(),directions:z.string(),tags:z.array(z.string()).max(8),advisorStatus:z.string()}));
  if(englishName)profile.englishName=englishName;
  step('检索同名学术作者候选，等待用户确认');let candidates:AuthorCandidate[]=[];
  try {candidates=await authorCandidates(profile.englishName||profile.name);}catch{step('学术索引暂不可用，可以继续手动补充DOI和摘要');}
  return {profile,source,candidates};
}
export async function fetchPapers(author:AuthorCandidate,step:Step) {return authorPapers(author,step);}
export async function importMentor(draft:Draft,profile:Draft['profile'],papers:Paper[],instituteId:string,settings:ModelSettings,step:Step) {
  const all=catalog();let institution=all.institutes.find(i=>i.id===instituteId);
  if(!institution){institution=all.institutes.find(i=>i.name===profile.institute);}
  let newInstitution:Institute|undefined;
  if(!institution){const id='local-'+randomUUID();newInstitution={id,name:profile.institute||'所属机构待核实',shortName:profile.institute||'待核实',english:'PERSONAL COLLECTION',kind:'研究所',official:'当前机构资料来自用户补充的个人页面，完整官方介绍待补充。',plain:'可先浏览已添加的人员与论文，机构整体定位尚待核实。',observation:'尚无近期研究观察。',prerequisites:[],tags:profile.tags,sources:[draft.source],updatedAt:new Date().toISOString(),isLocal:true};institution=newInstitution;}
  const recent=selectRecent(papers);const selected=recent.papers;step(`使用${recent.window}个月窗口，保存${selected.length}篇经用户确认的论文`);
  let analyzed=0;for(const p of selected){if(p.abstract){try{p.analysis=await analyzePaper(p,settings);analyzed++;step(`已解读${analyzed}篇论文`);}catch{step('一篇论文解读暂不可用，保留元信息与摘要');}}}
  const id='mentor-'+randomUUID();const mentor:Mentor={id,name:profile.name,englishName:profile.englishName,title:profile.title,instituteId:institution.id,photo:'',officialDirections:profile.directions,tagline:profile.directions.slice(0,70),tags:profile.tags,prerequisites:[],advisorStatus:profile.advisorStatus||'待核实',role:/实验师|工程师|实验员/.test(profile.title)?'机构人员':'导师',source:{...draft.source,title:profile.name+'个人资料'},selectionReason:'用户自主添加；已由用户确认身份及论文归属',papers:selected,feedback:[],isLocal:true,identity:'用户核对个人资料并确认论文；未经维护者复核',searchedAt:new Date().toISOString(),coverageNote:`本次选择${selected.length}篇；${recent.window}个月窗口。个人添加不表示完整覆盖。`};
  if(newInstitution)save('institute',newInstitution.id,newInstitution);save('mentor',mentor.id,mentor);step('个人资料已保存至本机');
  try{const revision=await proposeRevision(institution.id,settings,step);return {mentorId:id,instituteId:institution.id,revision};}catch{return {mentorId:id,instituteId:institution.id,revisionNote:'已保存教师；简介修改建议暂未生成，可在机构页重试。'};}
}
export function evidenceFingerprint(mentors:Mentor[]) {return hash(mentors.map(m=>({id:m.id,directions:m.officialDirections,papers:m.papers.map(p=>({id:p.id,title:p.title,abstract:p.abstract}))})));}
export async function proposeRevision(instituteId:string,settings:ModelSettings,step:Step) {
  const all=catalog(),i=all.institutes.find(i=>i.id===instituteId);if(!i)throw new Error('机构不存在');const mentors=all.mentors.filter(m=>m.instituteId===i.id);const fingerprint=evidenceFingerprint(mentors);
  const pending=all.revisions.find(r=>r.instituteId===i.id&&r.fingerprint===fingerprint&&r.status==='pending');if(pending)return pending;
  if((get<string>('observation-fingerprint',i.id)??i.evidenceFingerprint)===fingerprint)return {unchanged:true};
  step('对比机构现有介绍与新增证据');const sources=sourcesFor(mentors);
  const result=await structured(settings,`你要提出机构“近期研究观察”的修改建议，不能修改官方定位。当前只收录${mentors.length}位教师，必须说明样本不代表整个机构，不能把新样本误说成整个机构转向。若没有实质新主题或变化，返回changed:false。不改变仅因文风不同的句子。返回{changed:boolean,observation:string,reason:string,citations:string[]}。原观察：${i.observation}。证据：${JSON.stringify(context(mentors))}`,z.object({changed:z.boolean(),observation:z.string(),reason:z.string(),citations:z.array(z.string()).min(1)}),sources);
  if(!result.changed||result.observation.trim()===i.observation.trim()){save('observation-fingerprint',i.id,fingerprint);return {unchanged:true};}
  const r:Revision={id:randomUUID(),instituteId:i.id,before:i.observation,after:result.observation,reason:result.reason,citations:result.citations,fingerprint,status:'pending',createdAt:new Date().toISOString()};save('revision',r.id,r);step('修改建议已生成，等待用户确认；当前简介保持原样');return r;
}
