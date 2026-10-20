import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { deduplicate,selectRecent } from '../lib/papers';
import type { Catalog } from '../lib/types';

const catalog=JSON.parse(readFileSync('data/seed.json','utf8')) as Catalog;
const baseline=JSON.parse(readFileSync('data/publication-coverage-baseline.json','utf8')) as {curated:Record<string,string>};
const audit=JSON.parse(readFileSync('data/publication-coverage-audit.json','utf8')) as {people:{id:string;after:{papers:number;recent:number}}[]};
const now=new Date('2026-10-20T23:59:59Z');

test('复查覆盖全部261位非首批人员，首批12位对象保持原样',()=>{
  assert.equal(Object.keys(baseline.curated).length,12);
  assert.equal(audit.people.length,261);
  assert.equal(new Set(audit.people.map(p=>p.id)).size,261);
  for(const mentor of catalog.mentors){
    const original=baseline.curated[mentor.id];
    if(original){assert.equal(createHash('sha256').update(JSON.stringify(mentor)).digest('hex'),original,mentor.name);continue;}
    const row=audit.people.find(p=>p.id===mentor.id);
    assert.ok(row,mentor.name);
    assert.equal(row.after.papers,mentor.papers.length,mentor.name);
    assert.equal(row.after.recent,selectRecent(mentor.papers,now).papers.length,mentor.name);
    assert.equal(deduplicate(mentor.papers).length,mentor.papers.length,mentor.name+' 论文重复');
  }
});

test('已有一篇论文的陈一彤也被补全，并保留跨单位的Nature和Science作品',()=>{
  const mentor=catalog.mentors.find(m=>m.id==='chenyitong')!;
  assert.ok(mentor.academicProfiles?.some(p=>p.url.includes('BIg-cOMAAAAJ')));
  const nature=mentor.papers.find(p=>p.title==='All-analog photoelectronic chip for high-speed vision tasks');
  const science=mentor.papers.find(p=>p.title==='All-optical synthesis chip for large-scale intelligent semantic vision generation');
  assert.ok(nature);
  assert.ok(science);
  assert.match(nature.venue,/Nature/);
  assert.match(science.venue,/Science/);
  assert.equal(nature.date,'2023-10-25');
  assert.equal(nature.precision,'day');
  assert.equal(selectRecent(mentor.papers,now).papers.length,5);
  assert.ok(!mentor.papers.some(p=>p.title==='A Mouse-Tracking Paradigm for Value-Driven Attentional Capture'),'排除同名心理学作者的误归属');
  assert.ok(!mentor.papers.some(p=>p.doi==='10.1097/ms9.0000000000004558'),'排除同题评论文章的误匹配');
});
