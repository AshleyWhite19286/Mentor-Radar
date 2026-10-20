import { NextResponse } from 'next/server';
import { z } from 'zod';
import { catalog,get,mutateRevision,save } from '@/lib/db';
import { launch,taskResult } from '@/lib/tasks';
import { settingsSchema,modelRequest } from '@/lib/model';
import { modelFetch } from '@/lib/network';
import { localRequest } from '@/lib/local-request';
import { answer,explain,fetchPapers,importMentor,inspect,match,proposeRevision,type Draft } from '@/lib/agent';
import { paperByDoi } from '@/lib/academic';
import type { Paper,Task } from '@/lib/types';

export const runtime='nodejs';export const dynamic='force-dynamic';
const response=(v:unknown,status=200)=>NextResponse.json(v,{status,headers:{'Cache-Control':'no-store'}});
export async function GET(req:Request,{params}:{params:Promise<{path:string[]}>}) {
  try{localRequest(req);const p=(await params).path;if(p[0]==='catalog')return response(catalog());if(p[0]==='tasks'){const task=get<Task>('task',p[1]);return task?response(task):response({error:'任务不存在'},404);}return response({error:'接口不存在'},404);}catch{return response({error:'无法读取数据'},400);}
}
export async function POST(req:Request,{params}:{params:Promise<{path:string[]}>}) {
  try {
    localRequest(req);const route=(await params).path.join('/');if(Number(req.headers.get('content-length'))>150000)throw new Error('请求内容过大');
    const raw=await req.text();if(raw.length>150000)throw new Error('请求内容过大');const body=JSON.parse(raw);
    if(route==='revisions/action'){const b=z.object({id:z.string(),action:z.enum(['accept','reject','restore'])}).parse(body);const revision=mutateRevision(b.id,b.action);if(b.action==='accept')save('observation-fingerprint',revision.instituteId,revision.fingerprint);else if(b.action==='restore')save('observation-fingerprint',revision.instituteId,'');return response(revision);}
    if(route==='doi'){const b=z.object({doi:z.string().max(220),abstract:z.string().max(24000).optional()}).parse(body);const paper=await paperByDoi(b.doi);const token=crypto.randomUUID();if(b.abstract?.trim()){paper.abstract=b.abstract.trim();paper.source={...paper.source,id:'user-abstract-'+token,title:paper.title+' · 用户补充摘要',kind:'user',excerpt:'用户手动补充，未与出版全文核对'};}save('paper-draft',token,paper);return response({token,paper});}
    const settings=settingsSchema.parse(body.settings);
    if(route==='models'){
      const base=settings.baseUrl.replace(/\/+$/,'');if(!base.startsWith('https://'))throw new Error('模型接口必须使用HTTPS');
      const j=await (await modelFetch(`${base}/models`,{headers:{Authorization:`Bearer ${settings.apiKey}`}})).json();return response({models:(j.data||[]).map((m:{id:string})=>m.id)});
    }
    if(route==='connection'){await modelRequest(settings,[{role:'user',content:'请仅回复：连接成功'}]);return response({ok:true});}
    if(route==='match'){const student=z.object({grade:z.string(),interests:z.string().min(1).max(1000),courses:z.string().max(1500),programming:z.string().max(500),hours:z.string().max(100),goal:z.string().max(500)}).parse(body.student);return response(launch('个人匹配',step=>match(student,settings,step)));}
    if(route==='chat'){const b=z.object({question:z.string().min(1).max(2500),mentorId:z.string().optional(),paperId:z.string().optional()}).parse(body);return response(launch('证据问答',step=>answer(b.question,b.mentorId,b.paperId,settings,step)));}
    if(route==='explain'){const b=z.object({mentorId:z.string(),paperId:z.string()}).parse(body);return response(launch('论文解读',step=>explain(b.mentorId,b.paperId,settings,step)));}
    if(route==='revisions/propose'){const b=z.object({instituteId:z.string()}).parse(body);return response(launch('简介修改建议',step=>proposeRevision(b.instituteId,settings,step)));}
    if(route==='import/inspect'){const b=z.object({url:z.union([z.string().url(),z.literal('')]),text:z.string().max(24000),englishName:z.string().max(150)}).parse(body);if(!b.url&&!b.text)throw new Error('请填写网址或粘贴个人资料');return response(launch('识别教师',step=>inspect(b.url,b.text,b.englishName,settings,step)));}
    if(route==='import/papers'){const b=z.object({draftId:z.string(),authorId:z.string()}).parse(body);const draft=taskResult<Draft>(b.draftId);const author=draft.candidates.find(a=>a.id===b.authorId);if(!author)throw new Error('请从已检索的作者候选中确认身份');return response(launch('论文检索',step=>fetchPapers(author,step)));}
    if(route==='import/save'){
      const b=z.object({draftId:z.string(),papersTaskId:z.string().optional(),selectedPaperIds:z.array(z.string()).max(10),manualTokens:z.array(z.string()).max(10),instituteId:z.string(),confirmed:z.literal(true),profile:z.object({name:z.string().min(1).max(100),englishName:z.string().max(150),title:z.string().max(100),institute:z.string().max(200),directions:z.string().max(3000),tags:z.array(z.string()).max(8),advisorStatus:z.string().max(300)})}).parse(body);
      const draft=taskResult<Draft>(b.draftId);const papers=b.papersTaskId?taskResult<{papers:Paper[]}>(b.papersTaskId).papers:[];const manual=b.manualTokens.map(t=>get<Paper>('paper-draft',t)).filter((p):p is Paper=>!!p);
      const selected=[...papers,...manual].filter(p=>b.selectedPaperIds.includes(p.id));return response(launch('保存教师与解读',step=>importMentor(draft,b.profile,selected,b.instituteId,settings,step)));
    }
    return response({error:'接口不存在'},404);
  }catch(e){return response({error:e instanceof z.ZodError?e.issues.map(i=>i.message).join('；'):e instanceof Error?e.message:'请求失败'},400);}
}
