/**
 * Cache API 封装：按 IP 缓存查询结果。
 * 仅显式 ?ip= 的查询读写缓存；自身查询不缓存（connection 数据会串味）。
 */

import type { IpInfo } from './types';
import type { Env } from './env';

const CACHE_BASE = 'https://cache.cfip.internal/v1/';

/** workers-types v5 未导出 caches.default 类型，此处转型 */
function defaultCache(): Cache {
  return (caches as unknown as { default: Cache }).default;
}

function cacheKey(ip: string): Request {
  return new Request(CACHE_BASE + ip);
}

export async function readCache(env: Env, ip: string): Promise<IpInfo | null> {
  try {
    const res = await defaultCache().match(cacheKey(ip));
    if (!res) return null;
    const info = (await res.json()) as IpInfo;
    // 基本完整性校验，防止脏数据
    if (!info || typeof info.ip !== 'string' || !info.meta) return null;
    return info;
  } catch {
    return null;
  }
}

export async function writeCache(env: Env, ip: string, info: IpInfo, ttlSec: number): Promise<void> {
  try {
    const res = new Response(JSON.stringify(info), {
      headers: {
        'Cache-Control': `public, max-age=${ttlSec}, s-maxage=${ttlSec}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
    });
    await defaultCache().put(cacheKey(ip), res);
  } catch {
    // 缓存写入失败不阻塞响应
  }
}

/** 缓存条目的年龄（毫秒） */
export function cacheAgeMs(info: IpInfo, now: number = Date.now()): number {
  const t = Date.parse(info.meta.generatedAt);
  return Number.isFinite(t) ? Math.max(0, now - t) : Infinity;
}
