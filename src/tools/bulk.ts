/**
 * 批量 IP 查询（/api/bulk）：一次最多 20 个 IP 的轻量地理 / ASN 查询。
 * 走 ipwho.is 单条接口 + 并发上限 5，避免打爆上游（共享出口配额有限）。
 * 完整字段请对单条使用 /api，这里只解决「一批 IP 大概在哪」。
 */

import { parseIp, classifyIp } from '../ip';
import { parseAsnField } from '../adapters/ipapi';

export const BULK_LIMIT = 20;
const CONCURRENCY = 5;
const TIMEOUT_MS = 6000;

/** ip-api.com 批量接口：最多 100 个 IP / 次，免费档 15 次/分钟（HTTP only） */
const IPAPI_BATCH_URL =
  'http://ip-api.com/batch?fields=status,message,query,country,countryCode,regionName,city,timezone,as,org,isp';


export interface BulkRow {
  ip: string;
  ok: boolean;
  country: string | null;
  countryCode: string | null;
  region: string | null;
  city: string | null;
  asn: number | null;
  org: string | null;
  timezone: string | null;
  error: string | null;
}

export interface BulkReport {
  rows: BulkRow[];
  invalid: string[];
  generatedAt: string;
}

/** 限长读取请求体：超限返回 null（防止 chunked 请求绕过 content-length 校验） */
export async function readBodyLimited(request: Request, maxBytes: number): Promise<string | null> {
  const body = request.body;
  if (!body) return '';
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder().decode(merged);
}

/** 从任意分隔文本/查询参数中提取 IP：逗号、空白、换行都算分隔符，最多 BULK_LIMIT 个 */
export function parseIpList(raw: string): { ips: string[]; invalid: string[] } {
  const tokens = String(raw ?? '')
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const ips: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  for (const t of tokens) {
    const ip = parseIp(t);
    if (!ip) {
      if (invalid.length < BULK_LIMIT) invalid.push(t);
      continue;
    }
    if (seen.has(ip)) continue;
    seen.add(ip);
    if (ips.length < BULK_LIMIT) ips.push(ip);
  }
  return { ips, invalid };
}

interface IpApiBatchItem {
  status?: string;
  message?: string;
  query?: string;
  country?: string;
  countryCode?: string;
  regionName?: string;
  city?: string;
  timezone?: string;
  as?: string;
  org?: string;
  isp?: string;
}

interface IpwhoisRow {
  success?: boolean;
  message?: string;
  country?: string;
  country_code?: string;
  region?: string;
  city?: string;
  timezone?: { id?: string };
  connection?: { asn?: number; org?: string; isp?: string };
}

async function lookupOne(fetchFn: typeof fetch, ip: string, signal?: AbortSignal): Promise<BulkRow> {
  const base: BulkRow = {
    ip,
    ok: false,
    country: null,
    countryCode: null,
    region: null,
    city: null,
    asn: null,
    org: null,
    timezone: null,
    error: null,
  };
  if (classifyIp(ip) !== 'public') {
    return { ...base, error: '非公网地址，已跳过' };
  }
  try {
    const res = await fetchFn(`https://ipwho.is/${encodeURIComponent(ip)}`, {
      headers: { Accept: 'application/json', 'User-Agent': 'cfip-bulk/1.0' },
      signal: signal ?? AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return { ...base, error: `ipwho.is HTTP ${res.status}` };
    const j = (await res.json()) as IpwhoisRow;
    if (j.success === false) return { ...base, error: j.message ?? 'ipwho.is 查询失败' };
    return {
      ip,
      ok: true,
      country: j.country ?? null,
      countryCode: j.country_code ?? null,
      region: j.region ?? null,
      city: j.city ?? null,
      asn: typeof j.connection?.asn === 'number' ? j.connection.asn : null,
      org: j.connection?.org ?? j.connection?.isp ?? null,
      timezone: j.timezone?.id ?? null,
      error: null,
    };
  } catch (e) {
    const msg = e instanceof Error ? (e.name === 'TimeoutError' ? `超时 ${TIMEOUT_MS}ms` : e.message) : String(e);
    return { ...base, error: msg };
  }
}

/** 首轮失败（多为 ipwho.is 共享出口 429）的公网 IP，走 ip-api 批量接口补一次 */
async function fillViaIpApi(fetchFn: typeof fetch, rows: BulkRow[], signal?: AbortSignal): Promise<void> {
  const targets = rows.filter((r) => !r.ok && r.error !== '非公网地址，已跳过');
  if (!targets.length) return;

  const res = await fetchFn(IPAPI_BATCH_URL, {
    method: 'POST',
    signal: signal ?? AbortSignal.timeout(TIMEOUT_MS),
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(targets.map((r) => r.ip)),
  });
  if (!res.ok) throw new Error(`ip-api batch HTTP ${res.status}`);
  const list = (await res.json()) as IpApiBatchItem[];
  if (!Array.isArray(list)) return;

  const byIp = new Map(list.map((item) => [item.query ?? '', item]));
  for (const row of targets) {
    const item = byIp.get(row.ip);
    if (!item || item.status !== 'success') continue;
    row.ok = true;
    row.country = item.country ?? null;
    row.countryCode = item.countryCode ?? null;
    row.region = item.regionName ?? null;
    row.city = item.city ?? null;
    row.asn = parseAsnField(item.as);
    row.org = item.org ?? item.isp ?? null;
    row.timezone = item.timezone ?? null;
    row.error = null;
  }
}

export interface BulkOptions {
  /** ip-api 免费档禁商用，可由 ENABLE_IPAPI 关闭 */
  enableIpApi?: boolean;
}

/** 并发受限执行，保持输出顺序与输入一致 */
export async function runBulk(
  fetchFn: typeof fetch,
  ips: string[],
  opts: BulkOptions = {},
  signal?: AbortSignal,
): Promise<BulkReport> {
  const rows: BulkRow[] = new Array(ips.length);
  let next = 0;
  const worker = async () => {
    while (next < ips.length) {
      const i = next++;
      rows[i] = await lookupOne(fetchFn, ips[i], signal);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, ips.length) }, worker));

  if (opts.enableIpApi !== false) {
    try {
      await fillViaIpApi(fetchFn, rows, signal);
    } catch {
      // 兜底失败时保留首轮结果，不让整体请求失败
    }
  }

  return { rows, invalid: [], generatedAt: new Date().toISOString() };
}
