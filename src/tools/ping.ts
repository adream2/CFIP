/**
 * 全球 Ping（/api/ping）：Globalping 匿名测量（免 Key，250 次/小时按 IP 限流）。
 * 流程：POST 创建测量 → 轮询 Location 直至 finished（最多约 10s）。
 * 限流风险由上层缓存（5min）+ 熔断兜底。
 */

export type PingType = 'ping' | 'http' | 'dns';

export interface PingProbeResult {
  country: string | null;
  city: string | null;
  asn: number | null;
  /** ping：平均 RTT */
  rttMs: number | null;
  minMs: number | null;
  maxMs: number | null;
  /** http：状态码与总耗时 */
  statusCode: number | null;
  totalMs: number | null;
  /** dns：解析记录 */
  records: string[];
  error: string | null;
}

export interface PingReport {
  id: string | null;
  type: PingType;
  target: string;
  /** finished=完成；in-progress=仍在进行（可带 id 续询）；failed=创建失败 */
  status: 'finished' | 'in-progress' | 'failed';
  results: PingProbeResult[];
  error: string | null;
}

const GP_ENDPOINT = 'https://api.globalping.io/v1/measurements';
const MAX_LIMIT = 10;
const POLL_ATTEMPTS = 12;
const POLL_INTERVAL_MS = 800;

export const PING_TYPES: PingType[] = ['ping', 'http', 'dns'];

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function normalizeResult(raw: unknown): PingProbeResult {
  const r = (raw ?? {}) as Record<string, unknown>;
  const probe = (r.probe ?? {}) as Record<string, unknown>;
  const result = (r.result ?? {}) as Record<string, unknown>;
  const stats = (result.stats ?? {}) as Record<string, unknown>;
  const timings = (result.timings ?? {}) as Record<string, unknown>;
  const answers = Array.isArray(result.answers) ? (result.answers as Array<Record<string, unknown>>) : [];
  return {
    country: str(probe.country),
    city: str(probe.city),
    asn: num(probe.asn),
    rttMs: num(stats.avg),
    minMs: num(stats.min),
    maxMs: num(stats.max),
    statusCode: num(result.statusCode),
    totalMs: num(timings.total),
    records: answers.map((a) => str(a.answer ?? a.data)).filter((x): x is string => x !== null),
    error: str(r.error) ?? str(result.error),
  };
}

async function pollMeasurement(fetchFn: typeof fetch, location: string, signal?: AbortSignal): Promise<{ status: string; results: unknown[] }> {
  let last: { status: string; results: unknown[] } = { status: 'in-progress', results: [] };
  for (let i = 0; i < POLL_ATTEMPTS; i++) {
    const res = await fetchFn(location, { signal, headers: { Accept: 'application/json', 'User-Agent': 'cfip-ping/1.0' } });
    if (!res.ok) return { status: 'in-progress', results: [] };
    const j = (await res.json()) as { status?: string; results?: unknown[] };
    last = { status: j.status ?? 'in-progress', results: j.results ?? [] };
    if (last.status === 'finished' || last.status === 'failed') return last;
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  return last;
}

export async function runPing(
  fetchFn: typeof fetch,
  type: PingType,
  target: string,
  limit = 3,
  signal?: AbortSignal,
): Promise<PingReport> {
  if (!PING_TYPES.includes(type)) {
    return { id: null, type, target, status: 'failed', results: [], error: `暂支持的测量类型: ${PING_TYPES.join('/')}` };
  }
  const clamped = Math.min(Math.max(1, Math.floor(limit) || 3), MAX_LIMIT);
  try {
    const create = await fetchFn(GP_ENDPOINT, {
      method: 'POST',
      signal,
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'cfip-ping/1.0' },
      body: JSON.stringify({
        type,
        target,
        limit: clamped,
        // 全球分散采样：每大洲取 1（匿名额度内）
        locations: [{ magic: 'world' }],
      }),
    });
    if (create.status === 429) {
      return { id: null, type, target, status: 'failed', results: [], error: 'Globalping 匿名额度已用完（250 次/小时/IP），稍后再试' };
    }
    if (!create.ok) {
      return { id: null, type, target, status: 'failed', results: [], error: `Globalping HTTP ${create.status}` };
    }
    const location = create.headers.get('Location');
    const body = (await create.json().catch(() => null)) as { id?: string } | null;
    if (!location) {
      return { id: body?.id ?? null, type, target, status: 'failed', results: [], error: 'Globalping 未返回测量地址' };
    }
    const polled = await pollMeasurement(fetchFn, location, signal);
    return {
      id: body?.id ?? null,
      type,
      target,
      status: polled.status === 'finished' ? 'finished' : 'in-progress',
      results: polled.results.map(normalizeResult),
      error: null,
    };
  } catch (e) {
    return { id: null, type, target, status: 'failed', results: [], error: e instanceof Error ? e.message : String(e) };
  }
}
