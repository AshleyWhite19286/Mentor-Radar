import { NextResponse } from 'next/server';
import { z } from 'zod';
import { catalog } from '@/lib/db';
import { localRequest } from '@/lib/local-request';
import { settingsSchema } from '@/lib/model';
import { matchProfileSchema, newMatch } from '@/lib/new-match-agent';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  try {
    localRequest(request);
    if (Number(request.headers.get('content-length')) > 20_000) throw new Error('请求内容过大');
    const raw = await request.text();
    if (raw.length > 20_000) throw new Error('请求内容过大');
    const body = z.object({ profile: matchProfileSchema, settings: settingsSchema }).parse(JSON.parse(raw));
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(100_000)]);
    const result = await newMatch(body.profile, catalog(), body.settings, signal);
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof z.ZodError ? '输入内容不完整或超出长度限制' : error instanceof Error && error.name === 'TimeoutError' ? '匹配超时，请重试' : error instanceof Error && error.name === 'AbortError' ? '本轮匹配已取消' : error instanceof Error ? error.message : '匹配暂不可用' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }
}
