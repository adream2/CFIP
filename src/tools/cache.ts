/**
 * 工具端点（/api/probe、/api/domain、/api/ping、/api/status）的泛型 JSON 缓存。
 * 与 src/cache.ts（IpInfo 专用）分开：这里不校验 schema，只做 TTL 缓存。
 */

const CACHE_BASE = 'https://cache.cfip.internal/tools/';

function defaultCache(): Cache {
  return (caches as unknown as { default: Cache }).default;
}

function cacheKey(key: string): Request {
  return new Request(CACHE_BASE + encodeURIComponent(key));
}

/** 带 TTL 的缓存包装：命中返回缓存（hit=true），否则执行 produce 并写缓存 */
export async function withCache<T>(
  key: string,
  ttlSec: number,
  produce: () => Promise<T>,
): Promise<{ data: T; hit: boolean }> {
  const req = cacheKey(key);
  try {
    const res = await defaultCache().match(req);
    if (res) {
      const data = (await res.json()) as T;
      return { data, hit: true };
    }
  } catch {
    // 缓存读取失败不阻塞
  }
  const data = await produce();
  try {
    const res = new Response(JSON.stringify(data), {
      headers: {
        'Cache-Control': `public, max-age=${ttlSec}, s-maxage=${ttlSec}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
    });
    await defaultCache().put(req, res);
  } catch {
    // 缓存写入失败不阻塞
  }
  return { data, hit: false };
}
