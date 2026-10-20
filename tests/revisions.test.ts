import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.RADAR_DB_PATH=':memory:';
import { catalog,get,mutateRevision,save } from '../lib/db';
import type { Revision } from '../lib/types';
test('简介建议先待确认，接受后改变，可恢复且历史保留',()=>{
 const i=catalog().institutes[0],old=i.observation;
 const r:Revision={id:'test-revision',instituteId:i.id,before:old,after:old+' 新证据观察。',reason:'新增论文',citations:['source'],fingerprint:'f1',status:'pending',createdAt:'2026-10-20'};
 save('revision',r.id,r);assert.equal(catalog().institutes[0].observation,old);
 mutateRevision(r.id,'accept');assert.equal(catalog().institutes[0].observation,r.after);
 mutateRevision(r.id,'restore');assert.equal(catalog().institutes[0].observation,old);assert.equal(get<Revision>('revision',r.id)?.status,'restored');
});
test('拒绝建议保留简介，重复接受与过时建议均拒绝',()=>{
 const i=catalog().institutes[1];const r:Revision={id:'rejected',instituteId:i.id,before:i.observation,after:'新介绍',reason:'新证据',citations:['source'],fingerprint:'f2',status:'pending',createdAt:'2026-10-20'};
 save('revision',r.id,r);mutateRevision(r.id,'reject');assert.equal(catalog().institutes[1].observation,i.observation);assert.throws(()=>mutateRevision(r.id,'accept'));
 save('revision','stale',{...r,id:'stale',status:'pending',before:'不是当前版本'});assert.throws(()=>mutateRevision('stale','accept'));assert.equal(catalog().institutes[1].observation,i.observation);
});
