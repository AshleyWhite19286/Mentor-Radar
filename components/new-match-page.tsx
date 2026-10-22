'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, ArrowUpRight, BookOpen, Check, Clock, Compass, ExternalLink, LoaderCircle, RotateCcw, Shuffle, SlidersHorizontal, Sparkles, X } from 'lucide-react';
import type { Catalog, Mentor, ModelSettings, Source } from '@/lib/types';
import { emptyProfile, formatReading, hasProfile, profileLabels, readingDelta, readVisits, sampleMentors, sessionKey, visitsKey, type EntryPlan, type MatchCandidate, type MatchProfile, type NewMatchResult, type Visits } from '@/lib/new-match';
import styles from './new-match-page.module.css';

function safeHref(url: string) { try { return ['https:', 'http:'].includes(new URL(url).protocol) ? url : '#'; } catch { return '#'; } }
function Photo({ mentor }: { mentor: Mentor }) {
  const [failed, setFailed] = useState(false);
  return <div className={styles.photo}>{mentor.photo && !failed ? <img src={mentor.photo} alt="" onError={() => setFailed(true)} /> : <span>{mentor.name.slice(-2)}</span>}</div>;
}
function Evidence({ sources }: { sources: Source[] }) {
  return <div className={styles.evidence}>{[...new Map(sources.map(s => [s.id, s])).values()].map(s => <a href={safeHref(s.url)} key={s.id} target="_blank" rel="noreferrer"><ExternalLink size={12} />{s.title}</a>)}</div>;
}

function useFootprints() {
  const [visits, setVisits] = useState<Visits>({});
  const [storageError, setStorageError] = useState('');
  const values = useRef<Visits>({});
  const selected = useRef<string | null>(null);
  const tickAt = useRef(0);
  const activityAt = useRef(0);
  const visible = useRef(true);
  const dirty = useRef(false);
  const save = useCallback(() => {
    if (!dirty.current) return;
    try { localStorage.setItem(visitsKey, JSON.stringify(values.current)); dirty.current = false; }
    catch { setStorageError('浏览器无法保存记录，本次足迹仍会显示，刷新后可能丢失。'); }
  }, []);
  const tick = useCallback(() => {
    const now = Date.now();
    if (selected.current) {
      const delta = readingDelta(tickAt.current, now, activityAt.current, visible.current);
      if (delta > 0) {
        const id = selected.current, old = values.current[id] || { clicks: 0, milliseconds: 0 };
        values.current = { ...values.current, [id]: { ...old, milliseconds: old.milliseconds + delta } };
        dirty.current = true;
        setVisits(values.current);
      }
    }
    tickAt.current = now;
  }, []);
  useEffect(() => {
    try { values.current = readVisits(JSON.parse(localStorage.getItem(visitsKey) || '{}')); setVisits(values.current); }
    catch { setStorageError('无法读取之前的浏览记录，本次将重新记录。'); }
    visible.current = document.visibilityState === 'visible';
    tickAt.current = activityAt.current = Date.now();
    const activity = () => {
      const now = Date.now();
      // Settle the idle boundary before resuming, without rerendering on every mouse move.
      if (now - activityAt.current >= 60_000) tick();
      activityAt.current = now;
    };
    const visibility = () => {
      tick(); visible.current = document.visibilityState === 'visible'; tickAt.current = Date.now();
      if (visible.current) activityAt.current = Date.now();
      save();
    };
    const pagehide = () => { tick(); save(); };
    const interval = window.setInterval(tick, 1000), persistence = window.setInterval(save, 5000);
    const events = ['pointerdown', 'pointermove', 'keydown', 'scroll', 'wheel', 'touchstart'] as const;
    events.forEach(event => window.addEventListener(event, activity, { passive: true, capture: true }));
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('pagehide', pagehide);
    return () => {
      tick(); save(); clearInterval(interval); clearInterval(persistence);
      events.forEach(event => window.removeEventListener(event, activity, true));
      document.removeEventListener('visibilitychange', visibility); window.removeEventListener('pagehide', pagehide);
    };
  }, [save, tick]);
  const select = useCallback((id: string | null) => {
    if (selected.current === id) return;
    tick(); selected.current = id; tickAt.current = activityAt.current = Date.now();
    if (id) {
      const old = values.current[id] || { clicks: 0, milliseconds: 0 };
      values.current = { ...values.current, [id]: { ...old, clicks: old.clicks + 1 } };
      dirty.current = true; setVisits(values.current);
    }
    save();
  }, [save, tick]);
  const clear = useCallback(() => {
    values.current = {}; dirty.current = true; tickAt.current = activityAt.current = Date.now(); setVisits({}); save();
  }, [save]);
  return { visits, select, clear, storageError };
}

function MentorDrawer({ mentor, institute, recommendation, visit, onClose, profile, settings, openSettings }: {
  mentor: Mentor; institute?: string; recommendation?: MatchCandidate; visit?: Visits[string]; onClose: () => void;
  profile: MatchProfile; settings: ModelSettings; openSettings: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [plan, setPlan] = useState<EntryPlan | null>(null), [planBusy, setPlanBusy] = useState(false), [planError, setPlanError] = useState('');
  const planController = useRef<AbortController | null>(null);
  useEffect(() => {
    const d = dialog.current; d?.showModal();
    const previous = document.body.style.overflow; document.body.style.overflow = 'hidden';
    return () => { planController.current?.abort(); d?.close(); document.body.style.overflow = previous; };
  }, []);
  async function generatePlan() {
    if (!settings.apiKey) { onClose(); openSettings(); return; }
    const controller = new AbortController(); planController.current = controller;
    setPlanBusy(true); setPlanError('');
    try {
      const response = await fetch('/api/new-match/plan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mentorId: mentor.id, profile, settings }), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(105_000)]) });
      const value = await response.json(); if (!response.ok) throw new Error(value.error || '生成计划失败');
      if (!controller.signal.aborted) setPlan(value);
    } catch (error) { if (!controller.signal.aborted) setPlanError(error instanceof Error ? error.message : '生成计划失败，可重试。'); }
    finally { if (!controller.signal.aborted) setPlanBusy(false); }
  }
  const sources = [mentor.source, ...mentor.papers.map(p => p.source)];
  const papers = [...mentor.papers].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);
  return <dialog ref={dialog} className={styles.drawer} aria-labelledby="new-match-mentor-name" onCancel={onClose} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div className={styles.drawerHeader}><span className="eyebrow">MEET THE RESEARCHER</span><button className="icon-button" aria-label="关闭教师详情" onClick={onClose} autoFocus><X size={20} /></button></div>
    <div className={styles.drawerBody}>
      <div className={styles.drawerIdentity}><Photo mentor={mentor} /><div><h2 id="new-match-mentor-name">{mentor.name}</h2><p>{mentor.title} · {institute}</p></div></div>
      <div className="tags">{mentor.tags.map(tag => <span key={tag}>{tag}</span>)}</div>
      <p className={styles.drawerFootprint}><Clock size={14} />我的浏览足迹：查看 {visit?.clicks || 0} 次 · 阅读 {formatReading(visit?.milliseconds)}</p>
      {recommendation && <section className={styles.reasonBox}><h3><Sparkles size={17} />为什么值得了解</h3><p>{recommendation.reason}</p><span className={styles.readiness}>{recommendation.readiness}</span>{recommendation.gaps.length > 0 && <p>可以先补：{recommendation.gaps.join('、')}</p>}<Evidence sources={sources.filter(s => recommendation.citations.includes(s.id))} /></section>}
      <section><h3>老师的研究方向</h3><p>{mentor.officialDirections}</p><Evidence sources={[mentor.source]} /></section>
      <section className={styles.reasonBox}><h3><Compass size={17} />我的第一步</h3>{plan ? <><p>{plan.reason}</p>{plan.gaps.length > 0 && <p>可以先补：{plan.gaps.join('、')}</p>}<ol className={styles.planWeeks}>{plan.weeks.map((week, index) => <li key={index}><span>第 {index + 1} 周</span><p>{week}</p></li>)}</ol><div className={styles.firstTask}><b>试着完成这个小任务</b><p>{plan.firstTask}</p></div>{plan.firstPaperId && <p>入门论文：{mentor.papers.find(p => p.id === plan.firstPaperId)?.titleZh || mentor.papers.find(p => p.id === plan.firstPaperId)?.title}</p>}<Evidence sources={sources.filter(s => plan.citations.includes(s.id))} /><p className={styles.planNote}>以上为 AI 学习建议，可根据实际基础和时间调整。</p></> : <><p>想进一步了解？根据你当前的输入，为这位老师的研究生成四周入门建议。</p><button className="button secondary small" disabled={planBusy} onClick={generatePlan}>{planBusy ? <LoaderCircle className="spin" size={14} /> : <Sparkles size={14} />}{planBusy ? '正在生成入门计划…' : settings.apiKey ? '生成我的入门计划' : '连接模型，生成入门计划'}</button></>}{planError && <p className={styles.planError} role="alert">{planError}</p>}</section>
      {mentor.prerequisites.length > 0 && <section><h3>入门基础参考</h3><div className="tags">{mentor.prerequisites.map(item => <span key={item}>{item}</span>)}</div></section>}
      <section><h3><BookOpen size={18} />从一篇论文开始</h3>{papers.length ? papers.map(paper => <article className={styles.drawerPaper} key={paper.id}>
        <span>{paper.date} · {paper.venue}</span><h4><a href={safeHref(paper.url)} target="_blank" rel="noreferrer">{paper.titleZh || paper.title} <ArrowUpRight size={14} /></a></h4>
        <p>{paper.analysis?.summary || (paper.abstract ? `${paper.abstract.slice(0, 320)}${paper.abstract.length > 320 ? '…' : ''}` : '尚未取得摘要，可先核对原文。')}</p>
        {paper.analysis && <details><summary>展开入门建议</summary><p>建议基础：{paper.analysis.prerequisites.join('、') || '资料未列出'}</p><p>{paper.analysis.reading}</p><p>{paper.analysis.task}</p><p>解读边界：{paper.analysis.limitations}</p></details>}
        <Evidence sources={[paper.source]} />
      </article>) : <p>暂未收录可核验的论文，可以先查看官方资料。</p>}</section>
      <section className={styles.boundary}><h3>了解更多之前</h3><p>{mentor.coverageNote}</p><p>{mentor.advisorStatus}</p><p>研究相关性不代表招生名额或接收意愿。阅读仅在详情打开、页面处于前台且最近 60 秒有操作时累计。</p></section>
      <a className="button secondary" href={safeHref(mentor.source.url)} target="_blank" rel="noreferrer">查看官方资料 <ExternalLink size={15} /></a>
    </div>
  </dialog>;
}

export default function NewMatchPage({ data, settings, openSettings }: { data: Catalog; settings: ModelSettings; openSettings: () => void }) {
  const mentors = useMemo(() => data.mentors.filter(m => m.role === '导师'), [data.mentors]);
  const [profile, setProfile] = useState<MatchProfile>({ ...emptyProfile });
  const [randomIds, setRandomIds] = useState<string[]>([]), [ready, setReady] = useState(false);
  const [result, setResult] = useState<NewMatchResult | null>(null);
  const [status, setStatus] = useState<'idle' | 'waiting' | 'loading' | 'complete' | 'error'>('idle');
  const [error, setError] = useState(''), [sessionError, setSessionError] = useState('');
  const [composing, setComposing] = useState(false), [retry, setRetry] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [change, setChange] = useState(''), [newIds, setNewIds] = useState<string[]>([]), [changedIds, setChangedIds] = useState<string[]>([]);
  const [clearPrompt, setClearPrompt] = useState(false);
  const previousResults = useRef<MatchCandidate[]>([]);
  const cache = useRef(new Map<string, NewMatchResult>());
  const { visits, select, clear, storageError } = useFootprints();
  const profileJson = JSON.stringify(profile), nonempty = hasProfile(profile);

  useEffect(() => {
    let ids: string[] = [];
    try {
      const saved = JSON.parse(sessionStorage.getItem(sessionKey) || '{}');
      const allowed = new Set(mentors.map(m => m.id));
      if (Array.isArray(saved.randomIds)) ids = [...new Set<string>(saved.randomIds.filter((id: unknown): id is string => typeof id === 'string' && allowed.has(id)))].slice(0, 16);
      if (saved.profile && typeof saved.profile === 'object') {
        const restored = { ...emptyProfile };
        for (const key of Object.keys(restored) as (keyof MatchProfile)[]) if (typeof saved.profile[key] === 'string') restored[key] = saved.profile[key].slice(0, 1500);
        setProfile(restored);
      }
    } catch { setSessionError('当前浏览器无法恢复上次输入，可继续探索。'); }
    if (ids.length < Math.min(16, mentors.length)) ids = sampleMentors(mentors);
    setRandomIds(ids); setReady(true);
  }, [mentors]);
  useEffect(() => {
    if (!ready) return;
    try { sessionStorage.setItem(sessionKey, JSON.stringify({ profile: JSON.parse(profileJson), randomIds })); }
    catch { setSessionError('当前浏览器无法保存本次输入，离开页面前可先保留需要的内容。'); }
  }, [ready, profileJson, randomIds]);

  useEffect(() => {
    if (!ready || selectedId) return;
    if (!nonempty) {
      setResult(null); setStatus('idle'); setError(''); setChange(''); setNewIds([]); setChangedIds([]); previousResults.current = []; return;
    }
    if (!settings.apiKey) { setStatus('idle'); setError(''); return; }
    if (composing) { setStatus('waiting'); return; }
    let disposed = false;
    const controller = new AbortController();
    const cacheKey = JSON.stringify([profileJson, settings.baseUrl, settings.model, settings.apiKey]);
    const apply = (next: NewMatchResult) => {
      if (disposed) return;
      const previous = previousResults.current;
      const fresh = next.recommendations.filter(r => !previous.some(p => p.mentorId === r.mentorId)).map(r => r.mentorId);
      setNewIds(previous.length ? fresh : []);
      setChangedIds(previous.length ? next.recommendations.filter(r => previous.some(p => p.mentorId === r.mentorId && p.reason !== r.reason)).map(r => r.mentorId) : []);
      setChange(previous.length ? `已根据当前输入更新，${fresh.length} 位老师进入推荐列表。` : `已从全部 ${mentors.length} 位教师中检索，按当前需求推荐。`);
      previousResults.current = next.recommendations; setResult(next); setStatus('complete'); setError('');
    };
    const cached = cache.current.get(cacheKey);
    if (cached) { apply(cached); return () => { disposed = true; }; }
    setStatus('waiting'); setError('');
    const timer = window.setTimeout(async () => {
      setStatus('loading');
      try {
        const response = await fetch('/api/new-match', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ profile: JSON.parse(profileJson), settings }),
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(105_000)]),
        });
        const next = await response.json();
        if (!response.ok) throw new Error(next.error || '匹配暂不可用');
        if (disposed) return;
        if (cache.current.size >= 20) cache.current.delete(cache.current.keys().next().value!);
        cache.current.set(cacheKey, next); apply(next);
      } catch (e) {
        if (disposed || controller.signal.aborted) return;
        setStatus('error'); setError(e instanceof Error && e.name === 'TimeoutError' ? '本轮匹配超时，可以重试。' : e instanceof Error ? e.message : '匹配暂不可用，请重试。');
      }
    }, 1000);
    return () => { disposed = true; clearTimeout(timer); controller.abort(); };
  }, [ready, profileJson, nonempty, composing, settings.apiKey, settings.baseUrl, settings.model, selectedId, retry, mentors.length]);

  const update = (key: keyof MatchProfile, value: string) => { setProfile(current => ({ ...current, [key]: value })); setRetry(0); };
  const close = () => { select(null); setSelectedId(null); };
  const open = (id: string) => { select(id); setSelectedId(id); };
  const displayed = result ? result.recommendations : randomIds.map(mentorId => ({ mentorId }));
  const selected = mentors.find(m => m.id === selectedId);
  const selectedRecommendation = result?.recommendations.find(r => r.mentorId === selectedId);
  const activeKeys = (Object.keys(profileLabels) as (keyof MatchProfile)[]).filter(key => profile[key].trim());
  const isUpdating = status === 'loading' || status === 'waiting';

  return <div className={styles.page}>
    <div className={styles.intro}><div><span className="eyebrow">NEW MATCH · YOUR RESEARCH, IN FOCUS</span><h1>让好奇心，慢慢聚焦。</h1><p>从随便看看，到找到与你的问题有关的人。每次多说一点，方向就更清晰一点。</p></div><div className={styles.introMark}><Compass size={26} /><span>一次，认识最多 <b>16</b> 位老师</span></div></div>
    <div className={styles.layout}>
      <aside className={styles.inputPanel}>
        <div className={styles.panelHeading}><SlidersHorizontal size={17} /><h2>从你开始</h2><span>随时可改</span></div>
        <label htmlFor="nm-interests" className={styles.interestLabel}>你想研究什么？<textarea id="nm-interests" rows={5} maxLength={1000} value={profile.interests} onChange={e => update('interests', e.target.value)} onCompositionStart={() => setComposing(true)} onCompositionEnd={() => setComposing(false)} placeholder={'一个兴趣、一个问题，都可以。\n例如：我喜欢摄影，想知道 AI 如何判断照片好不好看。'} /></label>
        <p className={styles.inputHint}><Sparkles size={13} />停止输入约 1 秒后，自动更新结果。</p>
        <details className={styles.moreFields} open={activeKeys.some(key => key !== 'interests')}><summary>补充一点我的背景 <span>选填</span></summary>
          <div className={styles.fields}>
            <label htmlFor="nm-grade">目前年级<select id="nm-grade" value={profile.grade} onChange={e => update('grade', e.target.value)}><option value="">暂不填写</option>{['大一', '大二', '大三', '大四', '研究生', '其他'].map(s => <option key={s}>{s}</option>)}</select></label>
            <label htmlFor="nm-courses">已经学过的课程<input id="nm-courses" maxLength={1500} value={profile.courses} onChange={e => update('courses', e.target.value)} onCompositionStart={() => setComposing(true)} onCompositionEnd={() => setComposing(false)} placeholder="例如：线性代数、大学物理" /></label>
            <label htmlFor="nm-programming">编程经验<input id="nm-programming" maxLength={500} value={profile.programming} onChange={e => update('programming', e.target.value)} onCompositionStart={() => setComposing(true)} onCompositionEnd={() => setComposing(false)} placeholder="例如：会写简单的 Python 脚本" /></label>
            <label htmlFor="nm-hours">每周可以投入<select id="nm-hours" value={profile.hours} onChange={e => update('hours', e.target.value)}><option value="">暂不填写</option>{['每周1–2小时', '每周3–5小时', '每周6–10小时', '每周10小时以上'].map(s => <option key={s}>{s}</option>)}</select></label>
            <label htmlFor="nm-goal">探索目标<select id="nm-goal" value={profile.goal} onChange={e => update('goal', e.target.value)}><option value="">暂不填写</option>{['探索兴趣，尝试第一次科研', '参加本科科研项目', '为深造打基础'].map(s => <option key={s}>{s}</option>)}</select></label>
            <label htmlFor="nm-constraints">其他偏好或排除条件<textarea id="nm-constraints" rows={2} maxLength={1000} value={profile.constraints} onChange={e => update('constraints', e.target.value)} onCompositionStart={() => setComposing(true)} onCompositionEnd={() => setComposing(false)} placeholder="例如：更想做软件，暂不考虑纯硬件方向" /></label>
          </div>
        </details>
        {activeKeys.length > 0 && <div className={styles.profileSummary}><h3>你已告诉我们</h3><div className={styles.chips}>{activeKeys.map(key => <span key={key}><button onClick={() => document.getElementById(`nm-${key}`)?.focus()} title="点击修改">{profileLabels[key]}：{profile[key]}</button><button aria-label={`移除${profileLabels[key]}`} onClick={() => update(key, '')}><X size={12} /></button></span>)}</div><button className={styles.reset} onClick={() => { setProfile({ ...emptyProfile }); setRetry(0); }}><RotateCcw size={13} />清空条件，重新探索</button></div>}
        <div className={styles.connection}>{settings.apiKey ? <p><Check size={14} />模型已连接 · {settings.model}</p> : <><p>随便看看不需要连接模型。<br />连接后，把你的输入变成个性化推荐。</p><button className="button secondary small" onClick={openSettings}><Sparkles size={14} />连接我的模型 <ArrowRight size={14} /></button></>}</div>
        <div className={styles.footprintNote}><Clock size={15} /><div><h3>我的浏览足迹</h3><p>只记录你的查看次数和有效阅读时长，保存在当前浏览器，不影响推荐排序。</p>{clearPrompt ? <div className={styles.clearActions}><span>清除全部足迹？</span><button onClick={() => { clear(); setClearPrompt(false); }}>确认清除</button><button onClick={() => setClearPrompt(false)}>取消</button></div> : <button onClick={() => setClearPrompt(true)}>清除浏览记录</button>}</div></div>
      </aside>
      <section className={styles.results} aria-label="动态导师匹配结果" aria-busy={isUpdating}>
        <div className={styles.resultsHeader}><div><span className={styles.sectionNumber}>01 / EXPLORE</span><h2>{result ? '与你有关的研究者' : '先认识几位研究者'}</h2></div><div className={styles.resultTools}><span>{displayed.length} / 16 位</span>{!nonempty && <button onClick={() => { setRandomIds(sampleMentors(mentors)); setNewIds([]); }} disabled={!ready}><Shuffle size={14} />换一批</button>}</div></div>
        <div className={styles.status} role="status" aria-live="polite">
          {selectedId ? <><BookOpen size={15} /><span>正在了解一位老师，推荐列表保持不动。</span></> : isUpdating ? <><LoaderCircle size={15} className="spin" /><span>{status === 'waiting' ? '等待你完成输入…' : `正在从全部 ${mentors.length} 位教师中检索并生成匹配理由…`}{result && ' 上一轮结果暂时保留。'}</span></> : nonempty && !settings.apiKey ? <><Compass size={15} /><span>已保留你的输入，连接模型后开始个性化匹配。{result ? '当前保留上一轮结果。' : '当前为随机探索。'}</span></> : status === 'error' ? <><Compass size={15} /><span>本轮更新未完成，已保留之前的结果。</span></> : result ? <><Check size={15} /><span>{change}</span></> : <><Compass size={15} /><span>随机探索 · 输入你的兴趣，让这 16 个位置逐步聚焦。</span></>}
        </div>
        {result && <div className={styles.understanding}><span>当前理解</span><p>{result.summary}</p>{isUpdating && <small>上一轮</small>}</div>}
        {error && <div className={styles.error} role="alert"><span>{error}</span><button onClick={() => { cache.current.clear(); setRetry(value => value + 1); }}>重试 <RotateCcw size={13} /></button></div>}
        {(storageError || sessionError) && <p className={styles.storageError} role="status">{storageError || sessionError}</p>}
        <div className={styles.grid} data-testid="new-match-grid">
          {displayed.map((item, index) => {
            const mentor = mentors.find(m => m.id === item.mentorId); if (!mentor) return null;
            const recommendation = 'reason' in item ? item as MatchCandidate : undefined;
            const visit = visits[mentor.id];
            return <button className={styles.card} key={mentor.id} onClick={() => open(mentor.id)} aria-label={`查看${mentor.name}的教师详情`} data-mentor-id={mentor.id}>
              <div className={styles.cardEyebrow}><span>{recommendation ? `TOP ${String(index + 1).padStart(2, '0')}` : '随机探索'}</span>{newIds.includes(mentor.id) ? <b>新出现</b> : changedIds.includes(mentor.id) ? <b>理由已更新</b> : <ArrowUpRight size={14} />}</div>
              <div className={styles.identity}><Photo mentor={mentor} /><div><h3>{mentor.name}</h3><p>{mentor.title}</p></div></div>
              <p className={styles.institute}>{data.institutes.find(i => i.id === mentor.instituteId)?.shortName || '所属机构待核实'}</p>
              <div className={styles.cardTags}>{mentor.tags.slice(0, 3).map(tag => <span key={tag}>{tag}</span>)}</div>
              <p className={styles.cardReason}>{recommendation?.reason || mentor.officialDirections || mentor.tagline}</p>
              <div className={styles.cardReadiness}>{recommendation ? <><span>{recommendation.readiness}</span>{recommendation.gaps.length > 0 && <p>可先补：{recommendation.gaps.join('、')}</p>}</> : <span>从研究方向开始了解</span>}</div>
              <div className={styles.cardStats}><span>你已查看 <b>{visit?.clicks || 0}</b> 次</span><span><Clock size={11} />{formatReading(visit?.milliseconds)}</span></div>
            </button>;
          })}
        </div>
        {!ready && <div className={styles.empty}><LoaderCircle className="spin" size={26} /><p>正在准备你的探索窗口…</p></div>}
        {ready && !displayed.length && <div className={styles.empty}><Compass size={32} /><h3>先把范围放宽一点。</h3><p>{mentors.length ? '当前资料中没有找到符合条件的老师，试试删除一个条件或换一种描述。' : '暂未收录可匹配的教师。'}</p><button className="button secondary" onClick={() => setProfile({ ...emptyProfile })}>回到随机探索</button></div>}
        <p className={styles.resultsNote}>{result?.limitations || '随机展示帮助你开始探索；个性化匹配会从全部教师中重新选择。'}<br />推荐依据来自已收录的研究资料，不代表招生名额或接收意愿。</p>
      </section>
    </div>
    {selected && <MentorDrawer key={selected.id} mentor={selected} institute={data.institutes.find(i => i.id === selected.instituteId)?.name} recommendation={selectedRecommendation} visit={visits[selected.id]} onClose={close} profile={profile} settings={settings} openSettings={openSettings} />}
  </div>;
}
