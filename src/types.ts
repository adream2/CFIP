/**
 * CFIP 统一数据模型
 * 所有数据源适配器输出归一化到 IpInfo；字段按 location/network/node/reputation/connection/meta 分区。
 */

export type SourceId =
  | 'cf'
  | 'ip2region'
  | 'ipwhois'
  | 'ipapi'
  | 'rdap'
  | 'doh'
  | 'bgptools'
  | 'ipinfo'
  | 'abuseipdb'
  | 'static';

export type IpClass =
  | 'public'
  | 'private'
  | 'loopback'
  | 'link-local'
  | 'cgnat'
  | 'bogon'
  | 'reserved'
  | 'documentation'
  | 'multicast';

/** 带来源与置信度的判定值 */
export interface Judgement<T> {
  value: T;
  confidence: 'high' | 'medium' | 'low';
  source: SourceId;
}

export interface RangeInfo {
  start: string | null;
  end: string | null;
  cidr: string | null;
  count: number | null;
}

export interface DnsblResult {
  list: string;
  listed: boolean;
  returnCode: string | null;
  ttl: number | null;
  /** 命中时列表返回的 TXT 说明 */
  reason?: string | null;
}

export interface ProxyInfo {
  isProxy: boolean | null;
  isVpn: boolean | null;
  isTor: boolean | null;
  isAnonymous: boolean | null;
  sources: SourceId[];
}

export interface SourceStatus {
  id: SourceId;
  ok: boolean;
  ms: number;
  cached: boolean;
  error: string | null;
}

export interface IpInfo {
  ip: string;
  version: 4 | 6;
  class: IpClass;
  isPublic: boolean;

  location: {
    continent: string | null;
    continentCode: string | null;
    country: string | null;
    countryCode: string | null;
    countryNative: string | null;
    capital: string | null;
    region: string | null;
    regionCode: string | null;
    city: string | null;
    district: string | null;
    postalCode: string | null;
    latitude: number | null;
    longitude: number | null;
    timezone: string | null;
    utcOffsetSeconds: number | null;
    callingCode: string | null;
    isChinaMainland: boolean;
  };

  network: {
    asn: number | null;
    asnLabel: string | null;
    isp: string | null;
    org: string | null;
    asName: string | null;
    asDomain: string | null;
    asCountry: string | null;
    range: RangeInfo;
    rir: string | null;
    allocationDate: string | null;
    abuseEmail: string | null;
    usageType: string | null;
    rdapServer: string | null;
  };

  node: {
    hosting: Judgement<boolean> | null;
    anycast: Judgement<boolean> | null;
    provider: string | null;
    providerType: 'cloud' | 'cdn' | 'hosting' | 'isp' | 'education' | 'government' | 'unknown' | null;
    isMobile: Judgement<boolean> | null;
    isBroadband: Judgement<boolean> | null;
    rdns: string[];
    rdnsError: string | null;
  };

  reputation: {
    dnsbl: DnsblResult[];
    dnsblListedCount: number;
    proxy: ProxyInfo;
    abuseScore: number | null;
    abuseReports: number | null;
  };

  /** 仅当查询目标 = 访客自身 IP 时填充 */
  connection: {
    httpProtocol: string | null;
    tlsVersion: string | null;
    tlsCipher: string | null;
    clientTcpRttMs: number | null;
    colo: string | null;
    asOrganization: string | null;
    userAgent: string | null;
  } | null;

  meta: {
    sources: SourceStatus[];
    warnings: string[];
    generatedAt: string;
    cacheTtlSec: number;
  };
}

/** 空骨架：merge 的基线 */
export function emptyIpInfo(ip: string, version: 4 | 6, cls: IpClass, cacheTtlSec: number): IpInfo {
  return {
    ip,
    version,
    class: cls,
    isPublic: cls === 'public',
    location: {
      continent: null, continentCode: null,
      country: null, countryCode: null, countryNative: null, capital: null,
      region: null, regionCode: null,
      city: null, district: null, postalCode: null,
      latitude: null, longitude: null,
      timezone: null, utcOffsetSeconds: null, callingCode: null,
      isChinaMainland: false,
    },
    network: {
      asn: null, asnLabel: null,
      isp: null, org: null, asName: null, asDomain: null, asCountry: null,
      range: { start: null, end: null, cidr: null, count: null },
      rir: null, allocationDate: null, abuseEmail: null,
      usageType: null, rdapServer: null,
    },
    node: {
      hosting: null, anycast: null,
      provider: null, providerType: null,
      isMobile: null, isBroadband: null,
      rdns: [], rdnsError: null,
    },
    reputation: {
      dnsbl: [], dnsblListedCount: 0,
      proxy: { isProxy: null, isVpn: null, isTor: null, isAnonymous: null, sources: [] },
      abuseScore: null, abuseReports: null,
    },
    connection: null,
    meta: {
      sources: [], warnings: [],
      generatedAt: new Date().toISOString(),
      cacheTtlSec,
    },
  };
}

/** 适配器可返回的深局部结构（数组视为叶子，保持原类型） */
export type DeepPartial<T> = T extends (infer U)[]
  ? U[]
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;
