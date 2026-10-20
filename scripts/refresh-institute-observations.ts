/** Rebuild institute observations from official profile directions and verified works. */
import { createHash } from 'node:crypto';
import { readFileSync,writeFileSync } from 'node:fs';
import type { Catalog } from '../lib/types';

const path='data/seed.json';
const catalog=JSON.parse(readFileSync(path,'utf8')) as Catalog;
const clean=(value:string)=>value.replace(/^\d+[.、]*/,'').replace(/研究领域[:：]?/,'').trim();
for(const institute of catalog.institutes){
  const mentors=catalog.mentors.filter(mentor=>mentor.instituteId===institute.id);
  const directions=[...new Set(mentors.flatMap(mentor=>mentor.officialDirections.split(/[\n，、；;]+/).map(clean).filter(value=>value.length>=2&&value.length<=22&&value!=='官方个人页暂未单列研究方向。')))].slice(0,6);
  const papers=mentors.flatMap(mentor=>mentor.papers);
  const verified=mentors.filter(mentor=>mentor.papers.length).length;
  const directionText=directions.length?`官网个人页显示的研究方向包括${directions.join('、')}。`:'部分官网个人页未单列研究方向。';
  institute.observation=`截至2026-10-20，官网目录收录${mentors.length}位人员；当前已核验${verified}位人员的${papers.length}篇近期论文。${directionText}该观察基于已公开资料，不代表完整研究布局或招生信息。`;
  institute.updatedAt='2026-10-20';
  const evidence=mentors.map(mentor=>({id:mentor.id,directions:mentor.officialDirections,papers:mentor.papers.map(paper=>({id:paper.id,title:paper.title,abstract:paper.abstract}))}));
  institute.evidenceFingerprint=createHash('sha256').update(JSON.stringify(evidence)).digest('hex');
}
writeFileSync(path,JSON.stringify(catalog,null,2)+'\n');
console.log(`已更新${catalog.institutes.length}个分类的简介；当前共有${catalog.mentors.flatMap(mentor=>mentor.papers).length}篇已核验论文。`);
