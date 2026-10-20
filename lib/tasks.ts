import { randomUUID } from 'node:crypto';
import { get,rows,save } from './db';
import type { Task } from './types';

export function launch(kind:string,work:(step:(label:string)=>void)=>Promise<unknown>) {
  for(const t of rows<Task>('task').filter(t=>t.status==='running'&&Date.now()-Date.parse(t.createdAt)>15*60_000))save('task',t.id,{...t,status:'error',error:'任务已超时，请重新发起。'});
  if(rows<Task>('task').filter(t=>t.status==='running').length>=3)throw new Error('已有3个任务运行中，请稍后再试');
  const task:Task={id:randomUUID(),kind,status:'running',steps:[],createdAt:new Date().toISOString(),owner:process.pid};save('task',task.id,task);
  const step=(label:string)=>{task.steps.push({label,at:new Date().toISOString()});save('task',task.id,task);};
  step('任务已开始');
  void work(step).then(result=>{task.status='complete';task.result=result;step('任务完成');}).catch(error=>{task.status='error';task.error=error instanceof Error?error.message:'任务失败，请重试';save('task',task.id,task);});
  return {taskId:task.id};
}
export function taskResult<T>(id:string):T {const t=get<Task>('task',id);if(!t||t.status!=='complete')throw new Error('准备任务尚未完成或已失效');return t.result as T;}
