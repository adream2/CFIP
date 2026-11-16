/**
 * RDAP 适配器：rdap.org 自动引导到正确的 RIR（ARIN/APNIC/RIPE/AFRINIC/LACNIC）。
 * 提供网段范围、RIR、注册时间、滥用投诉邮箱、用途类型、注册国家等注册局信息。
 *
 * rdap.org 不可达时（大陆网络、上游故障）自动降级到 RIPEstat whois 数据集：
 * 同样来自 RIR 的原始 whois，字段更粗但足以支撑「原生 / 广播 IP」判定。
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

interface RipeWhoisRecord {
  key?: string;
  value?: string;
}

const RDAP_PRIMARY_TIMEOUT_MS = 3000;

/** 主通道失败后的短期记忆：10 分钟内直接走兜底，避免每次查询都白等 3 秒 */
const PRIMARY_COOLDOWN_MS = 10 * 60 * 1000;
let primaryDownUntil = 0;

/** 组合外部 abort 与本地超时：任一触发即中断（保持兜底通道仍有时间预算） */
function withTimeout(signal: AbortSignal | undefined, ms: number): AbortSignal {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new Error(`primary timeout ${ms}ms`)), ms);
  const forward = () => ctrl.abort(new Error('aborted'));
  if (signal) {
    if (signal.aborted) forward();
    else signal.addEventListener('abort', forward, { once: true });
  }
  // 清理挂在 controller 上的定时器：abort 之后无需再等
  ctrl.signal.addEventListener('abort', () => clearTimeout(timer), { once: true });
  return ctrl.signal;
}

interface RipeWhoisData {
  records?: RipeWhoisRecord[][];
  authorities?: string[];
}

/** 从 "8.8.8.0 - 8.8.8.255" 中提取起止地址 */
export function parseNetRange(raw: string | undefined): { start: string | null; end: string | null } {
  if (!raw) return { start: null, end: null };
  const m = /^\s*([0-9a-fA-F:.]+)\s*-\s*([0-9a-fA-F:.]+)\s*$/.exec(raw);
  if (!m) return { start: null, end: null };
  return { start: m[1], end: m[2] };
}

/** RIPEstat whois 兜底：字段比 RDAP 粗，但覆盖 country / CIDR / 滥用邮箱 */
async function viaRipeWhois(fetchFn: typeof fetch, ip: string, signal?: AbortSignal): Promise<DeepPartial<IpInfo>> {
  const res = await fetchFn(`https://stat.ripe.net/data/whois/data.json?resource=${encodeURIComponent(ip)}`, {
    signal: signal ?? AbortSignal.timeout(6000),
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`RIPEstat whois HTTP ${res.status}`);
  const j = (await res.json()) as { data?: RipeWhoisData };
  const records = (j.data?.records ?? []).flat();

  const first = (keys: string[]): string | null => {
    for (const key of keys) {
      const hit = records.find((r) => r.key?.toLowerCase() === key.toLowerCase() && r.value && r.value.trim());
      if (hit?.value) return hit.value.trim();
    }
    return null;
  };

  const { start, end } = parseNetRange(first(['NetRange']) ?? undefined);
  const cidr = first(['CIDR']);
  const rir = (j.data?.authorities?.[0] ?? first(['source']) ?? '').toUpperCase() || null;

  return {
    network: {
      range: {
        start,
        end,
        cidr,
        count: start && end && ipVersion(ip) === 4 ? v4ToNum(end) - v4ToNum(start) + 1 : null,
      },
      rir,
      allocationDate: first(['RegDate']),
      abuseEmail: first(['OrgAbuseEmail', 'abuse-mailbox']),
      usageType: first(['NetType']),
      asName: first(['NetName']),
      registryCountry: (first(['Country']) ?? '').toUpperCase() || null,
    },
  };
}

export const rdapAdapter: Adapter = {
  id: 'rdap',
  // 主通道（rdap.org）3s 内没有响应就切 RIEstat whois 兜底，故总预算放宽到 9s
  timeoutMs: 9000,
  cacheTtlSec: 24 * 60 * 60,
  async run(ctx, signal): Promise<AdapterResult> {
    const url = `https://rdap.org/ip/${encodeURIComponent(ctx.ip)}`;
    const skipPrimary = Date.now() < primaryDownUntil;
    try {
      if (skipPrimary) throw new Error('主通道近期不可用，直接兜底');
      const res = await ctx.fetchFn(url, {
        signal: withTimeout(signal, RDAP_PRIMARY_TIMEOUT_MS),
        headers: { Accept: 'application/rdap+json' },
      });
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
          registryCountry: j.country ? j.country.toUpperCase() : null,
        },
      };
      primaryDownUntil = 0;
      return { data };
    } catch (e) {
      // 主通道失败：RIPEstat whois 兜底（同为 RIR 原始数据）
      primaryDownUntil = Date.now() + PRIMARY_COOLDOWN_MS;
      const reason = e instanceof Error ? e.message : String(e);
      try {
        const data = await viaRipeWhois(ctx.fetchFn, ctx.ip, signal);
        return { data, warnings: [`rdap.org 不可用（${reason}），已改用 RIPEstat whois 兜底`] };
      } catch (e2) {
        const reason2 = e2 instanceof Error ? e2.message : String(e2);
        throw new Error(`rdap.org 失败（${reason}），RIPEstat whois 兜底也失败（${reason2}）`);
      }
    }
  },
};

function v4ToNum(ip: string): number {
  const p = ip.split('.').map(Number);
  return (((p[0] << 24) | (p[1] << 16) | (p[2] << 8) | p[3]) >>> 0);
}
