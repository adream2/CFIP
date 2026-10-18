/**
 * 适配器注册与并行执行。
 * - buildAdapters: 按环境决定启用哪些源（ENABLE_IPAPI 开关、secret 驱动）
 * - runAdapters: Promise.all 并发 + 每源超时 + 熔断跳过，单源失败不影响其他源
 */

import { breaker } from './breaker';
import { cfAdapter } from './cf';
import { ip2regionAdapter } from './ip2region';
import { ipapiAdapter } from './ipapi';
import { ipwhoisAdapter } from './ipwhois';
import { rdapAdapter } from './rdap';
import { dohAdapter } from './doh';
import { bgptoolsAdapter } from './bgptools';
import { ipinfoAdapter } from './ipinfo';
import { abuseipdbAdapter } from './abuseipdb';
import { loadConfig } from '../config';
import type { Adapter, AdapterCtx, AdapterOutcome } from './types';
import type { Env } from '../env';

export function buildAdapters(env: Env): Adapter[] {
  const cfg = loadConfig(env);
  const all: Adapter[] = [cfAdapter, ipwhoisAdapter, ip2regionAdapter];
  if (cfg.enableIpApi) all.push(ipapiAdapter);
  all.push(rdapAdapter, dohAdapter, bgptoolsAdapter, ipinfoAdapter, abuseipdbAdapter);
  return all.filter((a) => !a.requiresSecret || !!env[a.requiresSecret]);
}

function errMsg(e: unknown, timeoutMs: number): string {
  if (e instanceof Error) {
    if (e.name === 'AbortError' || e.name === 'TimeoutError') return `timeout ${timeoutMs}ms`;
    return e.message;
  }
  return String(e);
}

export async function runAdapters(adapters: Adapter[], ctx: AdapterCtx): Promise<AdapterOutcome[]> {
  const now = Date.now();
  return Promise.all(
    adapters.map(async (a): Promise<AdapterOutcome> => {
      if (breaker.shouldSkip(a.id, now)) {
        return { id: a.id, ok: false, ms: 0, cached: false, data: null, error: '熔断中（连续失败，临时跳过）' };
      }
      const ac = new AbortController();
      const t0 = Date.now();
      const timer = a.timeoutMs > 0 ? setTimeout(() => ac.abort(), a.timeoutMs) : null;
      try {
        const res = await a.run(ctx, ac.signal);
        breaker.onSuccess(a.id);
        return { id: a.id, ok: true, ms: Date.now() - t0, cached: false, data: res.data, error: null, warnings: res.warnings };
      } catch (e) {
        breaker.onFailure(a.id);
        return { id: a.id, ok: false, ms: Date.now() - t0, cached: false, data: null, error: errMsg(e, a.timeoutMs) };
      } finally {
        if (timer) clearTimeout(timer);
      }
    }),
  );
}
