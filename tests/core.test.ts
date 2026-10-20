import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deduplicate,monthsAgo,selectRecent } from '../lib/papers';
import { checkCitations,parseJson,structured } from '../lib/model';
import { isPrivate,publicFetch } from '../lib/network';
import { z } from 'zod';
import type { Catalog,Paper } from '../lib/types';
const now=new Date('2026-10-20T23:59:59Z');
function paper(id:string,date:string,extra:Partial<Paper>={}):Paper{return {id,title:id,date,precision:'day',venue:'Test',authors:['Test Author'],url:'https://example.com/'+id,status:'published',versions:[{kind:'published',date,url:'https://example.com/'+id}],source:{id:'source-'+id,title:id,url:'https://example.com/'+id,kind:'paper',retrievedAt:'2026-10-20'},identity:'test',...extra};}
test('24个月内有5篇时不扩窗，按日期选最新5篇',()=>{const p=[1,2,3,4,5,6].map(i=>paper('p'+i,`2026-0${i}-01`));p.push(paper('old','2024-01-01'));const r=selectRecent(p,now);assert.equal(r.window,24);assert.equal(r.papers.length,5);assert.equal(r.papers[0].id,'p6');});
test('先去重后计算5篇，不足时扩展36个月',()=>{const p=[paper('a','2026-01-01',{doi:'10.1234/test'}),paper('b','2026-01-01',{doi:'10.1234/test'}),paper('c','2025-01-01'),paper('d','2024-03-01')];const r=selectRecent(p,now);assert.equal(r.window,36);assert.equal(r.papers.length,3);});
test('超过36个月与未来记录不计入近期，旧作单列',()=>{const r=selectRecent([paper('old','2023-01-01'),paper('future','2027-01-01')],now);assert.equal(r.papers.length,0);assert.equal(r.historical.length,1);});
test('年份跨越窗口边界时待核实，完整处于窗口内才纳入',()=>{const r=selectRecent([paper('border','2023',{precision:'year'}),paper('inside','2025',{precision:'year'}),paper('thisYear','2026',{precision:'year'})],now);assert.deepEqual(r.papers.map(p=>p.id),['inside']);assert.equal(r.boundary.length,2);});
test('正式版与预印本合并计数，保留版本且使用正式版时间',()=>{const p=deduplicate([paper('a','2025-02-01',{title:'Same Paper',arxivId:'2502.00001',status:'preprint'}),paper('b','2026-02-01',{title:'Same Paper',doi:'10.1234/pub'})]);assert.equal(p.length,1);assert.equal(p[0].date,'2026-02-01');assert.equal(p[0].status,'published');assert.equal(p[0].versions.length,2);});
test('月底滚动窗口正确处理闰年',()=>{assert.equal(monthsAgo(new Date('2024-03-31T00:00:00Z'),1).toISOString().slice(0,10),'2024-02-29');});
test('窗口起始日按日历日期包含，不受检索时分秒影响',()=>{const p=[paper('edge','2024-10-20'),...['a','b','c','d'].map(id=>paper(id,'2025-01-01'))];const r=selectRecent(p,now);assert.equal(r.window,24);assert.ok(r.papers.some(p=>p.id==='edge'));});
test('引用仅允许已读证据，不能虚构来源',()=>{assert.throws(()=>checkCitations(['fake'],[paper('p','2026-01-01').source]));checkCitations(['source-p'],[paper('p','2026-01-01').source]);assert.throws(()=>checkCitations([],[]));});
test('解析模型JSON并去除代码块和思考标签',()=>{assert.deepEqual(parseJson('<think>ignored</think>\n```json\n{"answer":"ok"}\n```'),{answer:'ok'});assert.throws(()=>parseJson('not json'));});
test('不访问内网、回环、IPv4映射地址',()=>{for(const ip of ['127.0.0.1','10.1.2.3','172.16.0.1','169.254.169.254','192.168.2.1','::1','fd01::2','::ffff:127.0.0.1','::ffff:7f00:1'])assert.equal(isPrivate(ip),true,ip);assert.equal(isPrivate('8.8.8.8'),false);});
test('模型结构输出修复一次后通过；未知引用仍拒绝',async()=>{
 const original=globalThis.fetch;let calls=0;
 globalThis.fetch=async()=>{calls++;return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({answer:'中文解释',citations:calls===1?['fake']:['source-p']})}}]}),{headers:{'Content-Type':'application/json'}});};
 try{const result=await structured({baseUrl:'https://8.8.8.8/api/v1',apiKey:'test-not-a-secret',model:'test'},'test',z.object({answer:z.string(),citations:z.array(z.string())}),[paper('p','2026-01-01').source]);assert.equal(calls,2);assert.equal(result.answer,'中文解释');}finally{globalThis.fetch=original;}
});
test('401与429错误不泄露接口响应或Key',async()=>{const original=globalThis.fetch;try{for(const [code,expected] of [[401,'凭证无效'],[429,'限流']] as const){globalThis.fetch=async()=>new Response('secret-token',{status:code});await assert.rejects(()=>publicFetch('https://8.8.8.8'),e=>e instanceof Error&&e.message.includes(expected)&&!e.message.includes('secret-token'));}}finally{globalThis.fetch=original;}});
test('目录资料覆盖官网当前的全量人员，且保留论文与职称边界',()=>{const data=JSON.parse(readFileSync('data/seed.json','utf8')) as Catalog;assert.equal(data.institutes.length,12);assert.equal(data.mentors.length,273);for(const i of data.institutes){assert.ok(data.mentors.filter(m=>m.instituteId===i.id).length>=3);assert.ok(i.sources.length);assert.ok(i.official);assert.ok(i.observation);}const platform=data.mentors.find(m=>m.id==='wang-ying')!;assert.equal(platform.title,'正高级实验师');assert.equal(platform.role,'机构人员');for(const m of data.mentors){assert.ok(m.source.url.startsWith('https://icisee.sjtu.edu.cn/'));for(const p of m.papers){if(!p.abstract)assert.equal(p.analysis,undefined);if(p.analysis)checkCitations(p.analysis.citations,[p.source]);}}});
