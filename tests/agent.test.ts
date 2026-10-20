import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
process.env.RADAR_DB_PATH=':memory:';
import { catalog,mutateRevision,rows } from '../lib/db';
import { answer,importMentor,match,proposeRevision,type Draft } from '../lib/agent';
import type { Paper,Task } from '../lib/types';
import { launch } from '../lib/tasks';
const settings={baseUrl:'https://8.8.8.8/api/v1',apiKey:'NEVER_PERSIST_THIS_KEY',model:'fixture-model'};
const source={id:'manual-test-source',title:'测试摘要',url:'https://example.com/paper',kind:'user' as const,retrievedAt:'2026-10-20'};
const sample:Paper={id:'integration-'+randomUUID(),title:'Test paper for the import workflow',date:'2026-10-01',precision:'day',venue:'Test',authors:['Test Author'],abstract:'A test-only abstract about reconstructing missing measurements.',url:source.url,status:'preprint',versions:[],source,identity:'测试资料'};
const steps:string[]=[];
test('无新证据不调用模型生成简介修改',async()=>{const original=globalThis.fetch;globalThis.fetch=async()=>{throw new Error('不应调用模型');};try{assert.deepEqual(await proposeRevision('data',settings,s=>steps.push(s)),{unchanged:true});}finally{globalThis.fetch=original;}});
test('添加教师→解读→简介待确认→采用→恢复，凭证不入库',async()=>{
 const original=globalThis.fetch;const before=catalog().institutes.find(i=>i.id==='data')!.observation;
 globalThis.fetch=async(_url,init)=>{const prompt=JSON.parse(init!.body as string).messages.at(-1).content as string;const result=prompt.includes('近期研究观察')?{changed:true,observation:before+' 新增用户样本涉及缺失测量重建，仍不代表整个机构。',reason:'新增一位教师及其论文',citations:[source.id]}:{summary:'测试中文摘要',problem:'缺失测量',method:'测试重建方法',significance:'测试意义',limitations:'仅基于摘要',keywords:['重建'],difficulty:'需补基础',prerequisites:['Python'],reading:'理解输入输出',reproduction:'简化实验',research:'需要对照',task:'AI建议：补全序列',citations:[source.id]};return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(result)}}]}));};
 try{
  const profile={name:'流程测试教师',englishName:'Test Author',title:'副教授',institute:'数据智能研究所',directions:'缺失数据重建',tags:['重建'],advisorStatus:'待核实'};
  const draft:Draft={profile,source:{...source,id:'test-profile'},candidates:[]};
  const result=await importMentor(draft,profile,[sample],'data',settings,s=>steps.push(s));
  const saved=catalog().mentors.find(m=>m.id===result.mentorId)!;assert.equal(saved.title,'副教授');assert.equal(saved.papers.length,1);assert.equal(saved.papers[0].analysis?.basis,'abstract');
  const revision=catalog().revisions.find(r=>r.instituteId==='data')!;assert.equal(revision.status,'pending');assert.equal(catalog().institutes.find(i=>i.id==='data')!.observation,before);
  mutateRevision(revision.id,'accept');assert.equal(catalog().institutes.find(i=>i.id==='data')!.observation,revision.after);mutateRevision(revision.id,'restore');assert.equal(catalog().institutes.find(i=>i.id==='data')!.observation,before);
  const persisted=JSON.stringify(['mentor','institute','revision','task','analysis-cache'].flatMap(k=>rows(k)));assert.ok(!persisted.includes(settings.apiKey));
 }finally{globalThis.fetch=original;}
});
test('个人匹配检查教师与论文归属，学生基础传给模型',async()=>{
 const original=globalThis.fetch;const m=catalog().mentors[0];let received='';
 globalThis.fetch=async(_u,init)=>{received=JSON.parse(init!.body as string).messages[1].content;return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({recommendations:[{mentorId:m.id,reason:'基础匹配',gaps:['概率论'],firstPaperId:m.papers[0].id,firstTask:'补全序列',weeks:['了解数据','做基线','比较误差','整理结果'],citations:[m.source.id]}],limitations:'名额待确认'})}}]}));};
 try{const result=await match({grade:'大一',interests:'数据重建',courses:'线性代数',programming:'初学Python',hours:'每周3小时',goal:'探索'},settings,()=>{});assert.equal(result.recommendations.length,1);assert.ok(received.includes('每周3小时'));assert.ok(received.includes('线性代数'));}finally{globalThis.fetch=original;}
});
test('问答先选择证据再回答，返回真实引用',async()=>{
 const original=globalThis.fetch,m=catalog().mentors[0];let calls=0;
 globalThis.fetch=async()=>{calls++;return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(calls===1?{mentorIds:[m.id]}:{answer:'当前资料支持了解数据重建。',citations:[m.source.id],gaps:['是否接收本科生需要直接确认']})}}]}));};
 try{const result=await answer('想学数据重建，从哪里开始？',undefined,undefined,settings,()=>{});assert.equal(calls,2);assert.ok(result.sources.some(s=>s.id===result.citations[0]));}finally{globalThis.fetch=original;}
});
test('任务失败保存可恢复状态，不留下悬挂running',async()=>{
 const {taskId}=launch('失败演练',async step=>{step('读取来源');throw new Error('来源暂不可用');});
 await new Promise(resolve=>setTimeout(resolve,10));const task=rows<Task>('task').find(t=>t.id===taskId)!;assert.equal(task.status,'error');assert.equal(task.error,'来源暂不可用');
});

test('论文继续追问只引用本次资料，误填论文ID后可依据反馈修正',async t=>{
 const m=catalog().mentors[0],p=m.papers[0];let calls=0;
 t.mock.method(globalThis,'fetch',async(_url:URL,init:RequestInit)=>{
  calls++;const {messages}=JSON.parse(init.body as string);const prompt=messages[1].content;
  assert.ok(prompt.includes(JSON.stringify({sourceId:m.source.id,text:m.source.excerpt||m.officialDirections})));
  assert.ok(prompt.includes(`"sourceId":"${p.source.id}"`));
  if(calls===2){assert.ok(messages.at(-1).content.includes(p.id));assert.ok(messages.at(-1).content.includes(p.source.id));}
  return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({answer:'可以先阅读这篇论文的公开摘要。',citations:[calls===1?p.id:p.source.id],gaps:['全文细节仍待核实']})}}]}));
 });
 const result=await answer('这篇论文从哪里开始读？',m.id,p.id,settings,()=>{});
 assert.equal(calls,2);assert.deepEqual(result.citations,[p.source.id]);
 assert.deepEqual(new Set(result.sources.map(s=>s.id)),new Set([m.source.id,p.source.id]));
});
