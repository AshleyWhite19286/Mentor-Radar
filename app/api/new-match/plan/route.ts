import { NextResponse } from 'next/server';
import { z } from 'zod';
import { catalog } from '@/lib/db';
import { localRequest } from '@/lib/local-request';
import { settingsSchema } from '@/lib/model';
import { matchProfileSchema, newMatchPlan } from '@/lib/new-match-agent';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  try {
    localRequest(request);
    const raw = await request.text();
    if (raw.length > 20_000) throw new Error('请求内容过大');
    const body = z.object({ mentorId: z.string().max(200), profile: matchProfileSchema, settings: settingsSchema }).parse(JSON.parse(raw));
    const result = await newMatchPlan(body.mentorId, body.profile, catalog(), body.settings, AbortSignal.any([request.signal, AbortSignal.timeout(100_000)]));
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof z.ZodError ? '输入内容不完整或超出长度限制' : error instanceof Error ? error.message : '暂时无法生成计划' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }
}
