/** Merge verified official directory profiles into the browsable seed catalog. */
import { readFileSync, writeFileSync } from 'node:fs';
import type { Catalog, Mentor, Source } from '../lib/types';

type Profile = { id:string; name:string; url:string; title:string; group:string; profile?:string; sections?:Record<string,string>; photo?:string; retrievedAt:string };
const groupToInstitute:Record<string,string>={
  '数据智能研究所':'data','信息智能研究所':'intelligence','图像通信与网络工程研究所':'image','无线通信技术研究所':'wireless',
  '光子学与通信研究所':'photonics','电磁与智能系统研究所':'electromagnetics','芯片设计与EDA研究所':'eda','微纳器件与集成系统研究所':'microsystems',
  '纳电子材料与器件研究所':'nanoelectronics','未来媒体网络协同创新中心':'media','电子信息与集成电路实验教学中心':'teaching','先进电子材料与器件平台':'aemd',
};
const limitArg=process.argv.find(a=>a.startsWith('--per-group='));
const limit=limitArg?Number(limitArg.split('=')[1]):0;
if(!Number.isInteger(limit)||limit<0)throw new Error('--per-group must be a non-negative integer');
const data=JSON.parse(readFileSync('data/seed.json','utf8')) as Catalog;
const profiles=JSON.parse(readFileSync('data/source-profiles.json','utf8')) as Profile[];

function profileValue(profile:Profile,label:string){return profile.profile?.match(new RegExp(`${label}：[ ]*([^\\n]+)`))?.[1];}
function mentorFrom(profile:Profile,instituteId:string):Mentor {
  const institute=data.institutes.find(i=>i.id===instituteId)!;
  const source:Source={id:'profile-'+profile.id,title:`${profile.name} · 学院官方个人页`,url:profile.url,retrievedAt:profile.retrievedAt,kind:'official',excerpt:[profile.profile,profile.sections?.['研究方向']&&`研究方向：${profile.sections['研究方向']}`].filter(Boolean).join('\n')};
  const platform=institute.kind==='平台';
  const directions=profile.sections?.['研究方向']||'官方个人页暂未单列研究方向。';
  return {
    id:profile.id,name:profile.name,englishName:'',title:profile.title||profileValue(profile,'')||'职称待核实',instituteId,photo:profile.photo||'',
    email:profileValue(profile,'电子邮件'),homepage:profileValue(profile,'个人主页'),officialDirections:directions,
    tagline:`${institute.shortName} · 官方个人资料已收录`,tags:institute.tags,prerequisites:institute.prerequisites,
    advisorStatus:platform?'导师资格待核实；当前按平台人员展示':'导师资格待核实；请联系官方确认',role:platform?'机构人员':'导师',source,
    selectionReason:'学院教师目录及官方个人页已核对；近期论文仍待作者身份与作品逐项核验。',papers:[],feedback:[],
    identity:'姓名、职称和机构归属已与学院个人页核对',searchedAt:profile.retrievedAt,coverageNote:'已收录官方个人页。近期论文正在按作者身份逐项核验；未显示论文不代表没有科研活动。',
  };
}

for(const [group,instituteId] of Object.entries(groupToInstitute)){
  const existing=data.mentors.filter(m=>m.instituteId===instituteId);
  const candidates=profiles.filter(p=>p.group===group&&!data.mentors.some(m=>m.id===p.id));
  const wanted=limit?Math.max(0,limit-existing.length):candidates.length;
  data.mentors.push(...candidates.slice(0,wanted).map(p=>mentorFrom(p,instituteId)));
}
writeFileSync('data/seed.json',JSON.stringify(data,null,2)+'\n');
const counts=data.institutes.map(i=>`${i.shortName}:${data.mentors.filter(m=>m.instituteId===i.id).length}`);
console.log(`目录已合并 ${data.mentors.length} 人（${counts.join('，')}）`);
