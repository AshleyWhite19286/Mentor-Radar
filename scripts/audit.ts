import { readFileSync,existsSync } from 'node:fs';
import { selectRecent } from '../lib/papers';
import type { Catalog } from '../lib/types';
const d=JSON.parse(readFileSync('data/seed.json','utf8')) as Catalog;
const output=d.mentors.map(m=>{const r=selectRecent(m.papers,new Date('2026-10-20T23:59:59Z'));if(m.photo&&!existsSync('public'+m.photo))throw new Error('Missing photo '+m.name);return {机构:d.institutes.find(i=>i.id===m.instituteId)?.name,姓名:m.name,职称:m.title,近期:r.papers.length,有摘要:r.papers.filter(p=>p.abstract).length,有解读:r.papers.filter(p=>p.analysis).length,窗口:r.window};});
console.table(output);console.log(`目录当前收录 ${d.mentors.length} 人；后续可运行 npm run data:directory:all 同步官网目录。`);
