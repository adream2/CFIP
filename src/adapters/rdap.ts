/**
 * RDAP 适配器：rdap.org 自动引导到正确的 RIR（ARIN/APNIC/RIPE/AFRINIC/LACNIC）。
 * 提供网段范围、RIR、注册时间、滥用投诉邮箱、用途类型等注册局信息。
 */

import type { Adapter, AdapterResult } from './types';
import type { DeepPartial, IpInfo } from '../types';
import { ipVersion } from '../ip';

interface RdapEntity {
  roles?: string[];
  vcardArray?: [string, Array<[string, unknown, string, string?]>];
  handle?: string;
}

interface RdapResponse {
  name?: string;
  type?: string;
  country?: string;
  startAddress?: string;
  endAddress?: string;
  handle?: string;
  ipVersion?: string;
  port43?: string; // whois 服务器，如 whois.apnic.net
  entities?: RdapEntity[];
  events?: Array<{ eventAction?: string; eventDate?: string }>;
  remarks?: Array<{ title?: string; description?: string[] }>;
}

/** 由 RDAP 服务器主机名推断 RIR */
function rirFromUrl(url: string): string | null {
  const m = /rdap\.([a-z]+)\.net/i.exec(url);
  if (!m) return null;
  const key = m[1].toUpperCase();
  return ['ARIN', 'APNIC', 'RIPE', 'LACNIC', 'AFRINIC'].includes(key) ? key : null;
}

/** 由 port43（whois 服务器）推断 RIR（重定向不可见时的兜底） */
function rirFromPort43(port43: string | undefined): string | null {
  if (!port43) return null;
  const m = /whois\.([a-z]+)\.net/i.exec(port43);
  if (!m) return null;
  const key = m[1].toUpperCase();
  return ['ARIN', 'APNIC', 'RIPE', 'LACNIC', 'AFRINIC'].includes(key) ? key : null;
}

/** IPv4: [start, end] → CIDR（仅当是单一对齐块时） */
export function v4RangeToCidr(start: string, end: string): string | null {
  const s = start.split('.').map(Number);
  const e = end.split('.').map(Number);
  if (s.length !== 4 || e.length !== 4 || s.some(Number.isNaN) || e.some(Number.isNaN)) return null;
  const sN = (((s[0] << 24) | (s[1] << 16) | (s[2] << 8) | s[3]) >>> 0);
  const eN = (((e[0] << 24) | (e[1] << 16) | (e[2] << 8) | e[3]) >>> 0);
  if (eN < sN) return null;
  const size = eN - sN + 1;
  const log2 = Math.log2(size);
  if (!Number.isInteger(log2)) return null; // 必须是 2 的幂
  if (sN % size !== 0) return null; // 起始地址必须对齐
  if (eN !== sN + size - 1) return null; // 防御：区间必须恰好覆盖整个块
  const prefix = 32 - log2;
  return `${s.join('.')}/${prefix}`;
}

/** 从 entities 的 vcardArray 提取 abuse 邮箱 */
function extractAbuseEmail(entities: RdapEntity[] | undefined): string | null {
  if (!entities) return null;
  const ordered = [
    ...entities.filter((e) => e.roles?.some((r) => r.toLowerCase() === 'abuse')),
    ...entities.filter((e) => e.roles?.some((r) => r.toLowerCase() === 'registrant')),
    ...entities,
  ];
  for (const ent of ordered) {
    const vcard = ent.vcardArray;
    if (!Array.isArray(vcard) || vcard.length < 2) continue;
    for (const entry of vcard[1]) {
      if (Array.isArray(entry) && entry[0] === 'email' && typeof entry[3] === 'string') {
        return entry[3];
      }
    }
  }
  return null;
}

export const rdapAdapter: Adapter = {
  id: 'rdap',
  timeoutMs: 5000,
  cacheTtlSec: 24 * 60 * 60,
  async run(ctx, signal): Promise<AdapterResult> {
    const url = `https://rdap.org/ip/${encodeURIComponent(ctx.ip)}`;
    const res = await ctx.fetchFn(url, { signal, headers: { Accept: 'application/rdap+json' } });
    if (!res.ok) throw new Error(`rdap HTTP ${res.status}`);
    const j = (await res.json()) as RdapResponse;

    const start = j.startAddress ?? null;
    const end = j.endAddress ?? null;
    const cidr = start && end && ipVersion(ctx.ip) === 4 ? v4RangeToCidr(start, end) : null;
    const count =
      start && end && ipVersion(ctx.ip) === 4
        ? (v4ToNum(end) - v4ToNum(start) + 1)
        : null;
    const registration = j.events?.find((e) => e.eventAction === 'registration' || e.eventAction === 'allocation');

    const data: DeepPartial<IpInfo> = {
      network: {
        range: { start, end, cidr, count },
        rir: rirFromUrl(res.url || url) ?? rirFromPort43(j.port43),
        allocationDate: registration?.eventDate ?? null,
        abuseEmail: extractAbuseEmail(j.entities),
        usageType: j.type ?? null,
        rdapServer: res.url || url,
        asName: j.name ?? null,
      },
    };
    return { data };
  },
};

function v4ToNum(ip: string): number {
  const p = ip.split('.').map(Number);
  return (((p[0] << 24) | (p[1] << 16) | (p[2] << 8) | p[3]) >>> 0);
}
