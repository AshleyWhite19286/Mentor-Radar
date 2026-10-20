import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { Catalog, Institute, Mentor, Revision, Task } from './types';

let db: DatabaseSync;
export function database() {
  if (!db) {
    mkdirSync(path.join(process.cwd(),'data'),{recursive:true});
    db = new DatabaseSync(process.env.RADAR_DB_PATH || path.join(process.cwd(),'data/local.sqlite'));
    db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS records (kind TEXT NOT NULL, id TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(kind,id));');
    // Credentials and in-flight closures never enter this table.
    for (const task of rows<Task>('task').filter(t=>t.status==='running')) {
      let alive=false;try{if(task.owner){process.kill(task.owner,0);alive=true;}}catch{/* Owning process exited. */}
      if(!alive||Date.now()-Date.parse(task.createdAt)>15*60_000) save('task',task.id,{...task,status:'error',error:'任务所属服务已退出或任务超时，请重新发起。'});
    }
  }
  return db;
}
export function rows<T>(kind: string): T[] { return database().prepare('SELECT value FROM records WHERE kind=?').all(kind).map(r=>JSON.parse(r.value as string)); }
export function save(kind: string,id: string,value: unknown) { database().prepare('INSERT OR REPLACE INTO records(kind,id,value) VALUES(?,?,?)').run(kind,id,JSON.stringify(value)); }
export function get<T>(kind: string,id: string): T | undefined { const r=database().prepare('SELECT value FROM records WHERE kind=? AND id=?').get(kind,id); return r ? JSON.parse(r.value as string) : undefined; }
export function hash(value: unknown) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
export function catalog(): Catalog {
  const seed=JSON.parse(readFileSync(path.join(process.cwd(),'data/seed.json'),'utf8')) as Catalog;
  const merge=<T extends {id:string}>(a:T[],b:T[])=>[...new Map([...a,...b].map(v=>[v.id,v])).values()];
  return { institutes:merge(seed.institutes,rows<Institute>('institute')),mentors:merge(seed.mentors,rows<Mentor>('mentor')),revisions:rows<Revision>('revision') };
}
export function mutateRevision(id: string,action: 'accept'|'reject'|'restore') {
  const db=database(); db.exec('BEGIN IMMEDIATE');
  try {
    const r=get<Revision>('revision',id); if(!r) throw new Error('修改建议不存在');
    const institute=catalog().institutes.find(i=>i.id===r.instituteId); if(!institute) throw new Error('机构不存在');
    if(action==='reject') { if(r.status!=='pending') throw new Error('建议状态已改变，请刷新'); r.status='rejected'; }
    else if(action==='accept') {
      if(r.status!=='pending'||institute.observation!==r.before) throw new Error('简介已有更新，请重新生成建议');
      institute.observation=r.after; institute.updatedAt=new Date().toISOString(); save('institute',institute.id,institute); r.status='accepted';
    } else {
      if(r.status!=='accepted'||institute.observation!==r.after) throw new Error('仅能恢复当前正在使用的版本');
      institute.observation=r.before; institute.updatedAt=new Date().toISOString(); save('institute',institute.id,institute); r.status='restored';
    }
    save('revision',id,r); db.exec('COMMIT'); return r;
  } catch(e) { db.exec('ROLLBACK'); throw e; }
}
