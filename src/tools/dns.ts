/**
 * 多解析器 DNS 对比（/api/dns）：并发向 6 个公共 DoH 解析器查询同一域名，
 * 对比各解析器的返回值，用于发现 DNS 污染 / 劫持 / 分区域解析。
 *
 * 注意：CDN 的 GeoDNS 就近调度本身就会让不同地区解析器返回不同 IP，
 * 因此结果不一致只作为「需要进一步判断」的信号，不下篡改结论。
 * 全部无 Key，走 JSON API（application/dns-json）。
 */

export type DnsType = 'A' | 'AAAA' | 'CNAME' | 'MX' | 'TXT' | 'NS' | 'CAA';

export const DNS_TYPES: DnsType[] = ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'CAA'];

/** DNS 记录类型 → 数值（RFC 1035 / 3596 / 6844） */
const TYPE_CODES: Record<DnsType, number> = {
  A: 1,
  NS: 2,
  CNAME: 5,
  MX: 15,
  TXT: 16,
  AAAA: 28,
  CAA: 257,
};

interface ResolverDef {
  id: string;
  name: string;
  /** 分组标签：便于一眼看出「国内 / 海外」解析差异 */
  region: '海外' | '中国';
  endpoint: (name: string, type: DnsType) => string;
}

/** RFC 8484 JSON 接口；四家海外 + 两家国内，覆盖最常见的区域性差异对比 */
export const DNS_RESOLVERS: ResolverDef[] = [
  {
    id: 'cloudflare',
    name: 'Cloudflare',
    region: '海外',
    endpoint: (n, t) => `https://cloudflare-dns.com/dns-query?ct=application/dns-json&name=${encodeURIComponent(n)}&type=${t}`,
  },
  {
    id: 'google',
    name: 'Google',
    region: '海外',
    endpoint: (n, t) => `https://dns.google/resolve?name=${encodeURIComponent(n)}&type=${t}`,
  },
  {
    id: 'quad9',
    name: 'Quad9',
    region: '海外',
    endpoint: (n, t) => `https://dns.quad9.net:5053/dns-query?ct=application/dns-json&name=${encodeURIComponent(n)}&type=${t}`,
  },
  {
    id: 'adguard',
    name: 'AdGuard',
    region: '海外',
    endpoint: (n, t) => `https://dns.adguard-dns.com/resolve?name=${encodeURIComponent(n)}&type=${t}`,
  },
  {
    id: 'alidns',
    name: 'AliDNS',
    region: '中国',
    endpoint: (n, t) => `https://dns.alidns.com/resolve?name=${encodeURIComponent(n)}&type=${t}`,
  },
  {
    id: 'dnspod',
    name: 'DNSPod',
    region: '中国',
    endpoint: (n, t) => `https://doh.pub/dns-query?ct=application/dns-json&name=${encodeURIComponent(n)}&type=${t}`,
  },
];

export interface DnsResolverResult {
  id: string;
  name: string;
  region: string;
  ok: boolean;
  ms: number;
  /** DNS RCODE：0=NOERROR，3=NXDOMAIN，2=SERVFAIL */
  status: number | null;
  answers: string[];
  error: string | null;
  /** 与多数派不一致 */
  divergent: boolean;
}

export interface DnsCompareReport {
  domain: string;
  type: DnsType;
  resolvers: DnsResolverResult[];
  /** 所有成功解析器结果是否完全一致 */
  consistent: boolean;
  consensus: string[];
  divergentResolvers: string[];
  note: string | null;
  generatedAt: string;
}

interface DohAnswer {
  name?: string;
  type?: number;
  TTL?: number;
  data?: string;
}

interface DohResponse {
  Status?: number;
  Answer?: DohAnswer[];
}

/** 记录值归一化：去尾部点、TXT 去引号，便于跨解析器比较 */
export function normalizeRecord(type: DnsType, data: string): string {
  let s = data.trim();
  if (type === 'TXT') {
    s = s.replace(/^"|"$/g, '').replace(/\\"/g, '"');
  }
  if (type !== 'TXT' && s.endsWith('.')) s = s.slice(0, -1);
  return s;
}

const QUERY_TIMEOUT_MS = 4500;

async function queryResolver(
  fetchFn: typeof fetch,
  def: ResolverDef,
  domain: string,
  type: DnsType,
): Promise<DnsResolverResult> {
  const t0 = Date.now();
  const base = { id: def.id, name: def.name, region: def.region };
  try {
    const res = await fetchFn(def.endpoint(domain, type), {
      headers: { Accept: 'application/dns-json' },
      signal: AbortSignal.timeout(QUERY_TIMEOUT_MS),
    });
    if (!res.ok) {
      return { ...base, ok: false, ms: Date.now() - t0, status: null, answers: [], error: `HTTP ${res.status}`, divergent: false };
    }
    const j = (await res.json()) as DohResponse;
    const want = TYPE_CODES[type];
    const code = typeof j.Status === 'number' ? j.Status : null;
    const answers = [...new Set(
      (j.Answer ?? [])
        .filter((a) => a.type === want && typeof a.data === 'string')
        .map((a) => normalizeRecord(type, a.data as string)),
    )].sort();
    return {
      ...base,
      ok: code === 0,
      ms: Date.now() - t0,
      status: code,
      answers,
      error: code === 0 ? null : rcodeLabel(code),
      divergent: false,
    };
  } catch (e) {
    const msg = e instanceof Error ? (e.name === 'TimeoutError' ? `超时 ${QUERY_TIMEOUT_MS}ms` : e.message) : String(e);
    return { ...base, ok: false, ms: Date.now() - t0, status: null, answers: [], error: msg, divergent: false };
  }
}

export function rcodeLabel(code: number | null): string {
  if (code === null) return '未知错误';
  if (code === 0) return 'NOERROR';
  if (code === 2) return 'SERVFAIL';
  if (code === 3) return 'NXDOMAIN（域名或记录不存在）';
  if (code === 5) return 'REFUSED（解析器拒绝）';
  return `RCODE ${code}`;
}

/** 多数派统计：按答案集合分组，取成员最多的组作为共识 */
function pickConsensus(results: DnsResolverResult[]): { key: string; answers: string[] } | null {
  const groups = new Map<string, { answers: string[]; count: number }>();
  for (const r of results) {
    if (!r.ok) continue;
    const key = r.answers.join('|');
    const g = groups.get(key);
    if (g) g.count++;
    else groups.set(key, { answers: r.answers, count: 1 });
  }
  let best: { key: string; answers: string[]; count: number } | null = null;
  for (const [key, g] of groups) {
    if (!best || g.count > best.count) best = { key, ...g };
  }
  return best ? { key: best.key, answers: best.answers } : null;
}

export async function runDnsCompare(
  fetchFn: typeof fetch,
  domain: string,
  type: DnsType = 'A',
): Promise<DnsCompareReport> {
  const resolvers = await Promise.all(DNS_RESOLVERS.map((def) => queryResolver(fetchFn, def, domain, type)));
  const consensus = pickConsensus(resolvers);

  if (consensus) {
    for (const r of resolvers) {
      r.divergent = r.ok && r.answers.join('|') !== consensus.key;
    }
  }
  const divergentResolvers = resolvers.filter((r) => r.divergent).map((r) => r.id);
  const okCount = resolvers.filter((r) => r.ok).length;
  const consistent = consensus !== null && divergentResolvers.length === 0;

  let note: string | null = null;
  if (okCount === 0) {
    note = '所有解析器均未返回有效结果，请检查域名或稍后重试';
  } else if (!consistent) {
    note = '各解析器结果不一致：可能是分区域 CDN 调度、解析器缓存不同步，也可能是 DNS 污染 / 劫持，请结合国内与海外解析器分别判断';
  }

  return {
    domain,
    type,
    resolvers,
    consistent,
    consensus: consensus?.answers ?? [],
    divergentResolvers,
    note,
    generatedAt: new Date().toISOString(),
  };
}
