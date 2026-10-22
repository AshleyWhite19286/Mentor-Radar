import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export function isPrivate(ip: string): boolean {
  const s=ip.toLowerCase();
  if(s.includes(':')) {
    if(s.startsWith('::ffff:')) { const tail=s.slice(7); if(isIP(tail)===4) return isPrivate(tail); const parts=tail.split(':'); if(parts.length===2) {const n=parseInt(parts[0],16)*65536+parseInt(parts[1],16); return isPrivate(`${n>>>24}.${n>>>16&255}.${n>>>8&255}.${n&255}`);} return true; }
    return s==='::'||s==='::1'||/^(fc|fd|fe[89ab]|ff)/.test(s)||s.startsWith('2001:db8:');
  }
  const [a,b]=s.split('.').map(Number);
  return a===0||a===10||a===127||a>=224||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&(b===168||b===0))||(a===100&&b>=64&&b<=127)||(a===198&&(b===18||b===19));
}
export async function validatePublicUrl(input: string) {
  const u=new URL(input);
  if(!['http:','https:'].includes(u.protocol)||u.username||u.password||(u.port&&!['80','443'].includes(u.port))) throw new Error('仅支持公开的HTTP/HTTPS网址');
  const hostname=u.hostname.replace(/^\[|\]$/g,'');
  const addresses=isIP(hostname)?[{address:hostname}]:await lookup(hostname,{all:true});
  if(!addresses.length||addresses.some(x=>isPrivate(x.address))) throw new Error('不支持访问本机或内网地址');
  return u;
}
export async function publicFetch(input: string,init: RequestInit={},maxBytes=3_000_000,redirects=0): Promise<Response> {
  const u=await validatePublicUrl(input);
  return fetchValidated(u,init,maxBytes,redirects);
}
export async function modelFetch(input: string,init: RequestInit={},maxBytes=3_000_000): Promise<Response> {
  const u=new URL(input);
  if(u.protocol!=='https:')throw new Error('模型接口必须使用HTTPS');
  // The approved campus service may resolve to a campus or proxy-mapped IP.
  // Trust only its exact HTTPS origin and the two model API endpoints. TLS
  // still verifies the hostname, and model requests never follow redirects.
  const campus=u.origin==='https://models.sjtu.edu.cn'&&!u.username&&!u.password&&!u.search&&!u.hash&&['/api/v1/models','/api/v1/chat/completions'].includes(u.pathname);
  return fetchValidated(campus?u:await validatePublicUrl(input),init,maxBytes,0,false);
}
async function fetchValidated(u: URL,init: RequestInit,maxBytes: number,redirects: number,allowRedirects=true): Promise<Response> {
  const timeout=AbortSignal.timeout(45_000);
  const response=await fetch(u,{...init,redirect:'manual',signal:init.signal?AbortSignal.any([init.signal,timeout]):timeout,headers:{'User-Agent':'MentorRadar/0.1',...init.headers}});
  if(response.status>=300&&response.status<400) {
    if(!allowRedirects||new Headers(init.headers).has('authorization')) throw new Error('模型接口发生重定向，已停止发送凭证');
    const next=response.headers.get('location'); if(!next||redirects>=3) throw new Error('来源重定向过多');
    return publicFetch(new URL(next,u).href,init,maxBytes,redirects+1);
  }
  if(!response.ok) { const error=new Error(response.status===401||response.status===403?'凭证无效或无访问权限':response.status===429?'接口限流，请稍后重试':`来源暂不可用（HTTP ${response.status}）`); throw error; }
  if(Number(response.headers.get('content-length'))>maxBytes) throw new Error('来源文件过大，请使用网页或摘要');
  const reader=response.body?.getReader(); const chunks:Uint8Array[]=[]; let length=0;
  if(reader) while(true) { const {done,value}=await reader.read(); if(done)break;length+=value.length;if(length>maxBytes){await reader.cancel();throw new Error('来源内容超过读取上限');}chunks.push(value); }
  return new Response(Buffer.concat(chunks),{status:response.status,headers:response.headers});
}
export async function jsonFetch(url:string) { return (await publicFetch(url)).json(); }
