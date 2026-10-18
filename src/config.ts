/** 环境变量默认值集中管理 */

import type { Env } from './env';

export interface AppConfig {
  cacheTtlSec: number;
  dnsblTtlSec: number;
  enableIpApi: boolean;
  upstreamTimeoutMs: number;
}

const DEFAULTS: AppConfig = {
  cacheTtlSec: 6 * 60 * 60, // 6h
  dnsblTtlSec: 60 * 60, // 1h
  enableIpApi: true,
  upstreamTimeoutMs: 6000,
};

function int(v: string | undefined, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export function loadConfig(env: Env): AppConfig {
  return {
    cacheTtlSec: int(env.CACHE_TTL_SEC, DEFAULTS.cacheTtlSec),
    dnsblTtlSec: int(env.DNSBL_TTL_SEC, DEFAULTS.dnsblTtlSec),
    enableIpApi: env.ENABLE_IPAPI !== 'false',
    upstreamTimeoutMs: int(env.UPSTREAM_TIMEOUT_MS, DEFAULTS.upstreamTimeoutMs),
  };
}
