/**
 * DoH 适配器：Cloudflare DNS-over-HTTPS JSON API。
 * 两项能力，全部无 Key：
 *   1. PTR 反向解析（rDNS）
 *   2. DNSBL 黑名单检测（对 5 个公共列表发起 A 记录查询，命中时追加 TXT 原因）
 */

import type { Adapter, AdapterResult } from './types';
import type { DeepPartial, DnsblResult, IpInfo } from '../types';
import { reverseArpa } from '../ip';

const DOH_ENDPOINT = 'https://cloudflare-dns.com/dns-query';

/** 公共 DNSBL 列表（免费、无需注册） */
export const DNSBL_LISTS = [
  'zen.spamhaus.org',
  'b.barracudacentral.org',
  'bl.spamcop.net',
  'dnsbl.sorbs.net',
  'dnsbl.dronebl.org',
];

interface DohAnswer {
  name: string;
  type: number;
  TTL: number;
  data: string;
}

interface DohResponse {
  Status: number;
  Answer?: DohAnswer[];
}

async function dohQuery(fetchFn: typeof fetch, name: string, type: 'PTR' | 'A' | 'TXT', signal?: AbortSignal): Promise<DohResponse> {
  const url = `${DOH_ENDPOINT}?ct=application/dns-json&name=${encodeURIComponent(name)}&type=${type}`;
  const res = await fetchFn(url, { signal, headers: { Accept: 'application/dns-json' } });
  if (!res.ok) throw new Error(`DoH HTTP ${res.status}`);
  return (await res.json()) as DohResponse;
}

function stripDot(s: string): string {
  return s.endsWith('.') ? s.slice(0, -1) : s;
}

export const dohAdapter: Adapter = {
  id: 'doh',
  timeoutMs: 6000,
  cacheTtlSec: 60 * 60, // 黑名单变化快，缓存从短
  async run(ctx, signal): Promise<AdapterResult> {
    const arpa = reverseArpa(ctx.ip);
    if (!arpa) return { data: {}, warnings: ['无法构造反向解析名'] };

    // —— PTR 反解 ——
    let rdns: string[] = [];
    let rdnsError: string | null = null;
    try {
      const ptr = await dohQuery(ctx.fetchFn, arpa, 'PTR', signal);
      if (ptr.Status === 0) {
        rdns = (ptr.Answer ?? []).filter((a) => a.type === 12).map((a) => stripDot(a.data));
      }
    } catch (e) {
      rdnsError = e instanceof Error ? e.message : String(e);
    }

    // —— DNSBL 检测（并发） ——
    const dnsblResults: DnsblResult[] = await Promise.all(
      DNSBL_LISTS.map(async (list): Promise<DnsblResult> => {
        try {
          const r = await dohQuery(ctx.fetchFn, `${arpa}.${list}`, 'A', signal);
          const aRecords = (r.Answer ?? []).filter((a) => a.type === 1);
          if (r.Status === 0 && aRecords.length > 0) {
            const returnCode = aRecords[0].data;
            // 命中时追加 TXT 查询获取原因
            let reason: string | null = null;
            try {
              const txt = await dohQuery(ctx.fetchFn, `${arpa}.${list}`, 'TXT', signal);
              reason = (txt.Answer ?? [])
                .filter((a) => a.type === 16)
                .map((a) => stripDot(a.data).replace(/^"|"$/g, ''))
                .join(' ')
                .slice(0, 300) || null;
            } catch { /* TXT 失败不影响判定 */ }
            return { list, listed: true, returnCode, ttl: aRecords[0].TTL ?? null, reason } as DnsblResult & { reason?: string | null };
          }
          return { list, listed: false, returnCode: null, ttl: null };
        } catch {
          return { list, listed: false, returnCode: null, ttl: null };
        }
      }),
    );

    const listedCount = dnsblResults.filter((r) => r.listed).length;
    const data: DeepPartial<IpInfo> = {
      node: { rdns, rdnsError },
      reputation: { dnsbl: dnsblResults, dnsblListedCount: listedCount },
    };
    return { data };
  },
};
