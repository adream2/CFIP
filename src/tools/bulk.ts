/**
 * 批量 IP 查询（/api/bulk）：一次最多 20 个 IP 的轻量地理 / ASN 查询。
 * 走 ipwho.is 单条接口 + 并发上限 5，避免打爆上游（共享出口配额有限）。
 * 完整字段请对单条使用 /api，这里只解决「一批 IP 大概在哪」。
 */

import { parseIp, classifyIp } from '../ip';

export const BULK_LIMIT = 20;
const CONCURRENCY = 5;
const TIMEOUT_MS = 6000;

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

/** 并发受限执行，保持输出顺序与输入一致 */
export async function runBulk(
  fetchFn: typeof fetch,
  ips: string[],
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
  return { rows, invalid: [], generatedAt: new Date().toISOString() };
}
