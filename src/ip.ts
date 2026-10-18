/**
 * IP 解析 / 校验 / 分类 / 反写 —— 纯函数，无运行时依赖。
 */

import type { IpClass } from './types';

// ---------- IPv4 ----------

export function parseIpv4(input: string): string | null {
  const parts = input.split('.');
  if (parts.length !== 4) return null;
  const nums: number[] = [];
  for (const p of parts) {
    if (p.length === 0 || p.length > 3) return null;
    if (!/^\d+$/.test(p)) return null;
    if (p.length > 1 && p[0] === '0') return null; // 拒绝前导零（避免八进制歧义）
    const n = Number(p);
    if (!Number.isFinite(n) || n > 255) return null;
    nums.push(n);
  }
  return nums.join('.');
}

export function ipv4ToUint32(ip: string): number {
  const [a, b, c, d] = ip.split('.').map(Number);
  return (((a << 24) | (b << 16) | (c << 8) | d) >>> 0);
}

// ---------- IPv6 ----------

function parseHexGroup(g: string): number | null {
  if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
  return parseInt(g, 16);
}

/** 解析 IPv6（含内嵌 IPv4）为 8 个 16bit 组；失败返回 null */
export function parseIpv6Groups(input: string): number[] | null {
  let str = input;
  const pct = str.indexOf('%');
  if (pct !== -1) str = str.slice(0, pct); // 去掉 zone id
  if (str.length === 0 || str.length > 45) return null;

  // 处理尾部内嵌 IPv4（如 ::ffff:192.168.1.1）
  const lastColon = str.lastIndexOf(':');
  const firstDot = str.indexOf('.');
  if (firstDot !== -1 && firstDot > lastColon) {
    const v4 = parseIpv4(str.slice(lastColon + 1));
    if (!v4) return null;
    const [a, b, c, d] = v4.split('.').map(Number);
    str = str.slice(0, lastColon + 1) + ((a << 8) | b).toString(16) + ':' + ((c << 8) | d).toString(16);
  }

  const dc = str.indexOf('::');
  if (dc !== -1 && dc !== str.lastIndexOf('::')) return null; // 多个 ::

  let headGroups: string[], tailGroups: string[];
  if (dc === -1) {
    headGroups = str.split(':');
    tailGroups = [];
    if (headGroups.length !== 8) return null;
  } else {
    const h = str.slice(0, dc);
    const t = str.slice(dc + 2);
    headGroups = h === '' ? [] : h.split(':');
    tailGroups = t === '' ? [] : t.split(':');
    if (headGroups.length + tailGroups.length > 7) return null;
  }

  const groups: number[] = [];
  for (const g of headGroups) {
    const n = parseHexGroup(g);
    if (n === null) return null;
    groups.push(n);
  }
  const missing = 8 - headGroups.length - tailGroups.length;
  if (dc !== -1 && missing < 1) return null;
  for (let i = 0; i < missing; i++) groups.push(0);
  for (const g of tailGroups) {
    const n = parseHexGroup(g);
    if (n === null) return null;
    groups.push(n);
  }
  if (groups.length !== 8) return null;
  return groups;
}

/** RFC 5952 规范化：压缩最长全零段、小写、去组内前导零；v4-mapped 用点分十进制 */
export function compressIpv6(groups: number[]): string {
  if (groups.length !== 8) throw new Error('invalid ipv6 groups');
  const isV4Mapped = groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff;
  if (isV4Mapped) {
    const a = (groups[6] >> 8) & 0xff, b = groups[6] & 0xff;
    const c = (groups[7] >> 8) & 0xff, d = groups[7] & 0xff;
    return `::ffff:${a}.${b}.${c}.${d}`;
  }
  const hex = groups.map((g) => g.toString(16));
  let bestStart = -1, bestLen = 0, curStart = -1, curLen = 0;
  for (let i = 0; i < 8; i++) {
    if (groups[i] === 0) {
      if (curStart === -1) { curStart = i; curLen = 1; } else curLen++;
      if (curLen > bestLen) { bestLen = curLen; bestStart = curStart; }
    } else {
      curStart = -1; curLen = 0;
    }
  }
  if (bestLen < 2) return hex.join(':');
  const head = hex.slice(0, bestStart).join(':');
  const tail = hex.slice(bestStart + bestLen).join(':');
  return `${head}::${tail}`;
}

export function parseIpv6(input: string): string | null {
  const groups = parseIpv6Groups(input);
  if (!groups) return null;
  return compressIpv6(groups);
}

// ---------- 统一入口 ----------

/** 校验并规范化 IP；失败返回 null */
export function parseIp(input: string): string | null {
  if (typeof input !== 'string') return null;
  const s = input.trim();
  if (s.length === 0) return null;
  if (s.includes(':')) return parseIpv6(s);
  if (s.includes('.')) return parseIpv4(s);
  return null;
}

export function ipVersion(ip: string): 4 | 6 {
  return ip.includes(':') ? 6 : 4;
}

/** IP → 字节数组（xdb 查询等场景使用） */
export function ipToBytes(ip: string): Uint8Array {
  if (ip.includes(':')) {
    const groups = parseIpv6Groups(ip);
    if (!groups) throw new Error(`invalid ipv6: ${ip}`);
    const b = new Uint8Array(16);
    for (let i = 0; i < 8; i++) {
      b[i * 2] = (groups[i] >> 8) & 0xff;
      b[i * 2 + 1] = groups[i] & 0xff;
    }
    return b;
  }
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    throw new Error(`invalid ipv4: ${ip}`);
  }
  return new Uint8Array(parts);
}

// ---------- 分类 ----------

const V4_RANGES: Array<[string, IpClass]> = [
  ['0.0.0.0/8', 'bogon'],
  ['10.0.0.0/8', 'private'],
  ['100.64.0.0/10', 'cgnat'],
  ['127.0.0.0/8', 'loopback'],
  ['169.254.0.0/16', 'link-local'],
  ['172.16.0.0/12', 'private'],
  ['192.0.0.0/24', 'reserved'],
  ['192.0.2.0/24', 'documentation'],
  ['192.88.99.0/24', 'reserved'],
  ['192.168.0.0/16', 'private'],
  ['198.18.0.0/15', 'reserved'],
  ['198.51.100.0/24', 'documentation'],
  ['203.0.113.0/24', 'documentation'],
  ['224.0.0.0/4', 'multicast'],
  ['240.0.0.0/4', 'bogon'],
];

function v4InCidr(ip: number, cidr: string): boolean {
  const [baseStr, bitsStr] = cidr.split('/');
  const bits = Number(bitsStr);
  const base = ipv4ToUint32(baseStr);
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ip & mask) === (base & mask);
}

function v6ToBig(bytes: Uint8Array): bigint {
  let v = 0n;
  for (const b of bytes) v = (v << 8n) | BigInt(b);
  return v;
}

function v6BytesToPrefixBytes(cidr: string): { base: bigint; bits: number } {
  const [baseStr, bitsStr] = cidr.split('/');
  const bytes = ipToBytes(parseIpv6(baseStr) ?? baseStr);
  return { base: v6ToBig(bytes), bits: Number(bitsStr) };
}

const V6_RANGES: Array<[string, IpClass]> = [
  ['::/128', 'bogon'],
  ['::1/128', 'loopback'],
  ['::ffff:0:0/96', 'public'], // v4-mapped：转交内嵌 v4 判定
  ['64:ff9b::/96', 'public'], // NAT64：转交内嵌 v4 判定
  ['64:ff9b:1::/48', 'reserved'],
  ['100::/64', 'reserved'],
  ['2001:db8::/32', 'documentation'],
  ['2001::/32', 'reserved'],
  ['2002::/16', 'reserved'],
  ['fc00::/7', 'private'],
  ['fe80::/10', 'link-local'],
  ['ff00::/8', 'multicast'],
];

function v6InCidr(v: bigint, cidr: string): boolean {
  const { base, bits } = v6BytesToPrefixBytes(cidr);
  if (bits === 0) return true;
  const shift = 128n - BigInt(bits);
  const mask = ((1n << BigInt(bits)) - 1n) << shift;
  return (v & mask) === (base & mask);
}

/** 从 v4-mapped / NAT64 地址提取内嵌 IPv4 字符串 */
function embeddedV4(ip: string): string | null {
  const groups = parseIpv6Groups(ip);
  if (!groups) return null;
  const isV4Mapped = groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff;
  const isNat64 = groups[0] === 0x0064 && groups[1] === 0xff9b && groups[2] === 0 && groups[3] === 0;
  if (!isV4Mapped && !isNat64) return null;
  return `${(groups[6] >> 8) & 0xff}.${groups[6] & 0xff}.${(groups[7] >> 8) & 0xff}.${groups[7] & 0xff}`;
}

export function classifyIp(ip: string): IpClass {
  if (ip.includes(':')) {
    const bytes = ipToBytes(ip);
    const v = v6ToBig(bytes);
    if (v6InCidr(v, '::ffff:0:0/96') || v6InCidr(v, '64:ff9b::/96')) {
      const inner = embeddedV4(ip);
      if (inner) return classifyIp(inner);
    }
    for (const [cidr, cls] of V6_RANGES) {
      if (cls === 'public') continue;
      if (v6InCidr(v, cidr)) return cls;
    }
    return 'public';
  }
  const n = ipv4ToUint32(ip);
  for (const [cidr, cls] of V4_RANGES) {
    if (v4InCidr(n, cidr)) return cls;
  }
  return 'public';
}

// ---------- 反查 / 辅助 ----------

/** in-addr.arpa / ip6.arpa 全 nibble 反写 */
export function reverseArpa(ip: string): string | null {
  if (ip.includes(':')) {
    const bytes = ipToBytes(ip);
    const nibbles: string[] = [];
    for (let i = 15; i >= 0; i--) {
      nibbles.push((bytes[i] & 0x0f).toString(16));
      nibbles.push((bytes[i] >> 4).toString(16));
    }
    return nibbles.join('.') + '.ip6.arpa';
  }
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  return parts.reverse().join('.') + '.in-addr.arpa';
}

export function isChinaMainland(countryCode: string | null): boolean {
  return countryCode?.toUpperCase() === 'CN';
}
