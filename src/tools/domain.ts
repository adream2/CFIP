/**
 * 域名工具箱（/api/domain）：一次返回 DNS 解析（DoH）、CDN 判定、RDAP 注册信息。
 * 全部无 Key：DoH 走 cloudflare-dns.com，RDAP 走 rdap.org 引导。
 */

export interface DomainDns {
  a: string[];
  aaaa: string[];
  cname: string[];
}

export interface DomainCdn {
  isCdn: boolean;
  provider: string | null;
  evidence: string | null;
}

export interface DomainRdap {
  registrar: string | null;
  created: string | null;
  expires: string | null;
  updated: string | null;
  nameservers: string[];
  status: string[];
  abuseEmail: string | null;
  error?: string;
}

export interface DomainReport {
  domain: string;
  dns: DomainDns;
  cdn: DomainCdn;
  rdap: DomainRdap | null;
  generatedAt: string;
}

const DOH_ENDPOINT = 'https://cloudflare-dns.com/dns-query';

interface DohAnswer {
  name: string;
  type: number;
  TTL: number;
  data: string;
}

/** CNAME 关键词 → CDN/云厂商 判定表 */
const CDN_PATTERNS: Array<[RegExp, string]> = [
  [/cloudfront\.net/i, 'Amazon CloudFront'],
  [/akamaiedge\.net|akamai\.net|edgekey\.net|edgesuite\.net/i, 'Akamai'],
  [/fastly\.net|fastlylb\.net/i, 'Fastly'],
  [/azureedge\.net|trafficmanager\.net|azure\.com/i, 'Microsoft Azure'],
  [/cdngcba\.net|cdngcbr\.net|gcdn\.co/i, 'Google Cloud CDN'],
  [/cdn\.dnsv1\.com|dnspao\.com|tcdn|cdntip\.com/i, '腾讯云 CDN'],
  [/alikunlun\.net|aliyuncs\.com|cdngslb\.com/i, '阿里云 CDN'],
  [/wcdngd\.net|bsgslb\.cn|hichina\.com/i, '网宿/万网 CDN'],
  [/cdn20\.com|chinanetcenter\.com/i, '网宿 ChinaNetCenter'],
  [/cloudflare\.com|cdn-cdn/i, 'Cloudflare'],
  [/incapdns\.net/i, 'Imperva Incapsula'],
  [/sucuri\.net/i, 'Sucuri'],
];

/** 宽松域名校验：至少一个点，标签合法 */
export function isValidDomain(domain: string): boolean {
  if (domain.length > 253 || domain.length < 4) return false;
  const labels = domain.split('.');
  if (labels.length < 2) return false;
  return labels.every((l) => /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/i.test(l));
}

async function dohQuery(fetchFn: typeof fetch, name: string, type: 'A' | 'AAAA' | 'CNAME', signal?: AbortSignal): Promise<DohAnswer[]> {
  const url = `${DOH_ENDPOINT}?ct=application/dns-json&name=${encodeURIComponent(name)}&type=${type}`;
  const res = await fetchFn(url, { signal, headers: { Accept: 'application/dns-json' } });
  if (!res.ok) return [];
  const j = (await res.json()) as { Status?: number; Answer?: DohAnswer[] };
  if (j.Status !== 0 || !j.Answer) return [];
  const want = type === 'A' ? 1 : type === 'AAAA' ? 28 : 5;
  return j.Answer.filter((a) => a.type === want);
}

export async function resolveDns(fetchFn: typeof fetch, domain: string, signal?: AbortSignal): Promise<DomainDns> {
  const [a, aaaa, cname] = await Promise.all([
    dohQuery(fetchFn, domain, 'A', signal),
    dohQuery(fetchFn, domain, 'AAAA', signal),
    dohQuery(fetchFn, domain, 'CNAME', signal),
  ]);
  return {
    a: [...new Set(a.map((x) => x.data))],
    aaaa: [...new Set(aaaa.map((x) => x.data))],
    cname: [...new Set(cname.map((x) => x.data.replace(/\.$/, '')))],
  };
}

export function detectCdn(cname: string[]): DomainCdn {
  for (const c of cname) {
    for (const [pattern, provider] of CDN_PATTERNS) {
      if (pattern.test(c)) {
        return { isCdn: true, provider, evidence: c };
      }
    }
  }
  return { isCdn: false, provider: null, evidence: null };
}

interface RdapVcardEntry extends Array<unknown> {
  0: string;
  3?: string;
}

async function fetchRdap(fetchFn: typeof fetch, domain: string, signal?: AbortSignal): Promise<DomainRdap | null> {
  try {
    const res = await fetchFn(`https://rdap.org/domain/${encodeURIComponent(domain)}`, {
      signal,
      headers: { Accept: 'application/rdap+json' },
    });
    if (!res.ok) return { registrar: null, created: null, expires: null, updated: null, nameservers: [], status: [], abuseEmail: null, error: `RDAP HTTP ${res.status}` };
    const j = (await res.json()) as {
      events?: Array<{ eventAction?: string; eventDate?: string }>;
      nameservers?: Array<{ ldhName?: string }>;
      status?: string[];
      entities?: Array<{ roles?: string[]; vcardArray?: [string, RdapVcardEntry[]] }>;
    };
    const ev = (action: string) => j.events?.find((e) => e.eventAction === action)?.eventDate ?? null;
    let registrar: string | null = null;
    let abuseEmail: string | null = null;
    for (const ent of j.entities ?? []) {
      const vcard = ent.vcardArray;
      if (!Array.isArray(vcard) || vcard.length < 2) continue;
      for (const entry of vcard[1]) {
        if (!Array.isArray(entry) || entry[0] !== 'email' || typeof entry[3] !== 'string') continue;
        const roles = ent.roles?.map((r) => r.toLowerCase()) ?? [];
        if (roles.includes('registrar') && !registrar) registrar = entry[3];
        if (roles.includes('abuse') && !abuseEmail) abuseEmail = entry[3];
      }
      // 部分 RIR 把 registrar 名放在 fn 字段
      if (!registrar) {
        const fn = vcard[1].find((e) => Array.isArray(e) && e[0] === 'fn' && typeof e[3] === 'string');
        if (fn && (ent.roles?.map((r) => r.toLowerCase()) ?? []).includes('registrar')) {
          registrar = typeof fn[3] === 'string' ? fn[3] : null;
        }
      }
    }
    return {
      registrar,
      created: ev('registration'),
      expires: ev('expiration'),
      updated: ev('last changed'),
      nameservers: (j.nameservers ?? []).map((n) => (n.ldhName ?? '').replace(/\.$/, '')).filter(Boolean),
      status: j.status ?? [],
      abuseEmail,
    };
  } catch (e) {
    return { registrar: null, created: null, expires: null, updated: null, nameservers: [], status: [], abuseEmail: null, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function runDomainReport(fetchFn: typeof fetch, domain: string, signal?: AbortSignal): Promise<DomainReport> {
  const dns = await resolveDns(fetchFn, domain, signal);
  const cdn = detectCdn(dns.cname);
  const rdap = await fetchRdap(fetchFn, domain, signal);
  return { domain, dns, cdn, rdap, generatedAt: new Date().toISOString() };
}
