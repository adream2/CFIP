/**
 * ASN 查询（/api/asn）：RIPEstat 免 Key 数据集。
 *   as-overview        → AS 名称、是否已宣告
 *   asn-neighbours     → 上下游邻居（按 peer 规模排序）
 *   announced-prefixes → 宣告前缀数量与样本
 * 叠加静态 ASN 映射（provider-map）给出云厂商 / CDN 标签。
 */

import { asnProvider, asnAnycast } from '../adapters/provider-map';

export interface AsnNeighbour {
  asn: number;
  /** 邻居权重（RIPEstat power）：越大越主要 */
  power: number;
}

export interface AsnReport {
  asn: number;
  asnLabel: string;
  holder: string | null;
  announced: boolean | null;
  provider: { name: string; type: string } | null;
  anycast: boolean | null;
  neighbours: {
    upstream: AsnNeighbour[];
    downstream: AsnNeighbour[];
    uncertainCount: number;
  };
  prefixes: {
    count: number;
    sample: string[];
  };
  warnings: string[];
  generatedAt: string;
}

const RIPE = 'https://stat.ripe.net/data';
const TIMEOUT_MS = 6000;

/** 解析 "AS13335" / "13335" / " as13335 "；非法返回 null */
export function parseAsn(raw: string | null | undefined): number | null {
  const m = /^\s*(?:as)?(\d{1,10})\s*$/i.exec(String(raw ?? ''));
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isSafeInteger(n) || n < 1 || n > 4294967295) return null;
  return n;
}

interface RipeEnvelope<T> {
  data?: T;
}

async function ripeGet<T>(fetchFn: typeof fetch, path: string, signal?: AbortSignal): Promise<T | null> {
  const res = await fetchFn(`${RIPE}/${path}`, {
    headers: { Accept: 'application/json', 'User-Agent': 'cfip-asn/1.0' },
    signal: signal ?? AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`RIPEstat HTTP ${res.status}`);
  const j = (await res.json()) as RipeEnvelope<T>;
  return j.data ?? null;
}

interface OverviewData {
  resource?: string;
  holder?: string;
  announced?: boolean;
}

interface NeighboursData {
  neighbours?: Array<{ asn?: number; type?: string; power?: number }>;
}

interface PrefixesData {
  prefixes?: Array<{ prefix?: string }>;
}

export async function runAsnReport(
  fetchFn: typeof fetch,
  asn: number,
  signal?: AbortSignal,
): Promise<AsnReport> {
  const warnings: string[] = [];
  const [overview, neighbours, prefixes] = await Promise.all([
    ripeGet<OverviewData>(fetchFn, `as-overview/data.json?resource=AS${asn}`, signal).catch((e) => {
      warnings.push(`AS 概览获取失败：${e instanceof Error ? e.message : String(e)}`);
      return null;
    }),
    ripeGet<NeighboursData>(fetchFn, `asn-neighbours/data.json?resource=AS${asn}`, signal).catch((e) => {
      warnings.push(`邻居信息获取失败：${e instanceof Error ? e.message : String(e)}`);
      return null;
    }),
    ripeGet<PrefixesData>(fetchFn, `announced-prefixes/data.json?resource=AS${asn}`, signal).catch((e) => {
      warnings.push(`前缀列表获取失败：${e instanceof Error ? e.message : String(e)}`);
      return null;
    }),
  ]);

  const up: AsnNeighbour[] = [];
  const down: AsnNeighbour[] = [];
  let uncertainCount = 0;
  for (const n of neighbours?.neighbours ?? []) {
    if (typeof n.asn !== 'number') continue;
    const item = { asn: n.asn, power: typeof n.power === 'number' ? n.power : 0 };
    if (n.type === 'left') up.push(item);
    else if (n.type === 'right') down.push(item);
    else uncertainCount++;
  }
  const byPower = (a: AsnNeighbour, b: AsnNeighbour) => b.power - a.power;

  const allPrefixes = (prefixes?.prefixes ?? []).map((p) => p.prefix).filter((p): p is string => typeof p === 'string');
  const provider = asnProvider(asn);

  return {
    asn,
    asnLabel: `AS${asn}`,
    holder: overview?.holder ?? null,
    announced: typeof overview?.announced === 'boolean' ? overview.announced : null,
    provider: provider ? { name: provider.provider, type: provider.providerType } : null,
    anycast: asnAnycast(asn)?.value ?? null,
    neighbours: {
      upstream: up.sort(byPower).slice(0, 10),
      downstream: down.sort(byPower).slice(0, 10),
      uncertainCount,
    },
    prefixes: {
      count: allPrefixes.length,
      sample: allPrefixes.slice(0, 20),
    },
    warnings,
    generatedAt: new Date().toISOString(),
  };
}
