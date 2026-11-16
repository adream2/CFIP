/** CFIP 纯前端 IP 计算器：零外部依赖、零网络请求，可在 Node 下单测（见 test/calc.test.ts）。
 *  覆盖：IPv4 CIDR / 掩码 / 通配符 / 可用主机 / 整数·十六进制·二进制换算 / 范围聚合；
 *        IPv6 压缩·展开 / 前缀网络 / 地址总数 / 地址类型。 */

/**
 * 计算结果（字段按 IPv4 / IPv6 / 范围三种模式各自填充）
 * @typedef {Object} CalcResult
 * @property {boolean} ok
 * @property {string} [error]
 * @property {number} [version]
 * @property {string} [mode]
 * @property {string} [input]
 * @property {string} [ip]
 * @property {number} [prefix]
 * @property {string} [cidr]
 * @property {string} [netmask]
 * @property {string} [wildcard]
 * @property {string} [network]
 * @property {string} [broadcast]
 * @property {string} [firstHost]
 * @property {string} [lastHost]
 * @property {number|string} [totalAddresses]
 * @property {number} [usableHosts]
 * @property {string} [rangeText]
 * @property {number} [ipInt]
 * @property {string} [ipHex]
 * @property {string} [ipBinary]
 * @property {string} [kind]
 * @property {boolean} [isPrivate]
 * @property {string} [start]
 * @property {string} [end]
 * @property {string[]} [cidrs]
 * @property {string} [summary]
 * @property {string} [expanded]
 * @property {string} [last]
 */

const V4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

export function ipv4ToInt(ip) {
  const m = V4_RE.exec(String(ip ?? '').trim());
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  if (parts.some((n) => n > 255)) return null;
  return (((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0);
}

export function intToIpv4(n) {
  const v = Number(n) >>> 0;
  return [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255].join('.');
}

export function prefixToMaskInt(prefix) {
  return prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
}

/** 点分掩码 → 前缀长度；非连续掩码返回 null */
export function maskToPrefix(mask) {
  const n = ipv4ToInt(mask);
  if (n === null) return null;
  let seenZero = false;
  let bits = 0;
  for (let i = 31; i >= 0; i--) {
    const bit = (n >>> i) & 1;
    if (bit === 1) {
      if (seenZero) return null;
      bits++;
    } else seenZero = true;
  }
  return bits;
}

function v4Kind(n) {
  const inRange = (base, prefix) => {
    const mask = prefixToMaskInt(prefix);
    return ((n & mask) >>> 0) === ((ipv4ToInt(base) & mask) >>> 0);
  };
  if (inRange('10.0.0.0', 8) || inRange('172.16.0.0', 12) || inRange('192.168.0.0', 16)) return '私有地址（RFC 1918）';
  if (inRange('100.64.0.0', 10)) return '运营商级 NAT（CGNAT）';
  if (inRange('127.0.0.0', 8)) return '环回';
  if (inRange('169.254.0.0', 16)) return '链路本地';
  if (inRange('224.0.0.0', 4)) return '组播';
  if (inRange('240.0.0.0', 4)) return '保留';
  if (inRange('0.0.0.0', 8)) return '保留（本网络）';
  return '公网地址';
}

const splitCidr = (input) => String(input ?? '').trim().replace(/\s+/g, ' ');

/** 范围 → 最小 CIDR 集合（IPv4） */
export function rangeToCidrs(start, end) {
  let s = start >>> 0;
  const e = end >>> 0;
  if (s > e) return [];
  const out = [];
  while (s <= e) {
    let tz = 32;
    for (let i = 0; i < 32; i++) {
      if (((s >>> i) & 1) === 1) { tz = i; break; }
    }
    let size = Math.min(tz, 31);
    while (size > 0 && 2 ** size > (e - s + 1)) size--;
    out.push(`${intToIpv4(s)}/${32 - size}`);
    const next = s + 2 ** size;
    if (next > 0xffffffff) break;
    s = next >>> 0;
  }
  return out;
}

/** @returns {CalcResult} */
function ipv4RangeSummary(input) {
  const m = /^(.+?)\s*-\s*(.+)$/.exec(input);
  if (!m) return null;
  const a = ipv4ToInt(m[1]);
  const b = ipv4ToInt(m[2]);
  if (a === null || b === null || a > b) return null;
  const cidrs = rangeToCidrs(a, b);
  return {
    ok: true,
    version: 4,
    mode: 'range',
    start: intToIpv4(a),
    end: intToIpv4(b),
    totalAddresses: b - a + 1,
    cidrs,
    summary: cidrs.join(', '),
  };
}

/** @returns {CalcResult} */
export function calcIpv4(raw) {
  const input = splitCidr(raw);
  const range = ipv4RangeSummary(input);
  if (range) return range;

  let addrPart = input;
  let prefix = 32;
  const slash = input.lastIndexOf('/');
  if (slash !== -1) {
    addrPart = input.slice(0, slash).trim();
    const tail = input.slice(slash + 1).trim();
    if (tail.includes('.')) {
      const p = maskToPrefix(tail);
      if (p === null) return { ok: false, error: '掩码不是连续的（例如 255.255.255.0）' };
      prefix = p;
    } else if (/^\d{1,2}$/.test(tail) && Number(tail) <= 32) {
      prefix = Number(tail);
    } else {
      return { ok: false, error: '前缀长度需为 0–32' };
    }
  } else if (input.includes(' ')) {
    const [addr, mask] = input.split(' ');
    addrPart = addr;
    const p = maskToPrefix(mask);
    if (p === null) return { ok: false, error: '掩码不是连续的（例如 255.255.255.0）' };
    prefix = p;
  }

  const ipInt = ipv4ToInt(addrPart);
  if (ipInt === null) return { ok: false, error: 'IPv4 地址格式不正确' };

  const mask = prefixToMaskInt(prefix);
  const network = (ipInt & mask) >>> 0;
  const broadcast = (network | (~mask >>> 0)) >>> 0;
  const total = 2 ** (32 - prefix);
  const usable = prefix >= 31 ? (prefix === 32 ? 1 : 2) : total - 2;

  return {
    ok: true,
    version: 4,
    mode: 'cidr',
    input,
    ip: intToIpv4(ipInt),
    prefix,
    cidr: `${intToIpv4(network)}/${prefix}`,
    netmask: intToIpv4(mask),
    wildcard: intToIpv4(~mask >>> 0),
    network: intToIpv4(network),
    broadcast: intToIpv4(broadcast),
    firstHost: prefix >= 31 ? intToIpv4(network) : intToIpv4(network + 1),
    lastHost: prefix >= 31 ? intToIpv4(broadcast) : intToIpv4(broadcast - 1),
    totalAddresses: total,
    usableHosts: usable,
    rangeText: `${intToIpv4(network)} – ${intToIpv4(broadcast)}`,
    ipInt,
    ipHex: '0x' + ipInt.toString(16).toUpperCase().padStart(8, '0'),
    ipBinary: ipInt.toString(2).padStart(32, '0').replace(/(.{8})(?=.)/g, '$1.'),
    kind: v4Kind(ipInt),
    isPrivate: /私有|环回|链路本地|CGNAT/.test(v4Kind(ipInt)),
  };
}

/* —— IPv6 —— */

export function parseIpv6Groups(input) {
  let s = String(input ?? '').trim().replace(/^\[|\]$/g, '');
  const pct = s.indexOf('%');
  if (pct !== -1) s = s.slice(0, pct);
  if (!s.includes(':')) return null;

  const lastColon = s.lastIndexOf(':');
  if (s.indexOf('.') > lastColon) {
    const v4 = ipv4ToInt(s.slice(lastColon + 1));
    if (v4 === null) return null;
    s = `${s.slice(0, lastColon + 1)}${((v4 >>> 16) & 0xffff).toString(16)}:${(v4 & 0xffff).toString(16)}`;
  }

  const dc = s.indexOf('::');
  if (dc !== -1 && dc !== s.lastIndexOf('::')) return null;
  let head;
  let tail = [];
  if (dc === -1) {
    head = s.split(':');
    if (head.length !== 8) return null;
  } else {
    const h = s.slice(0, dc);
    const t = s.slice(dc + 2);
    head = h === '' ? [] : h.split(':');
    tail = t === '' ? [] : t.split(':');
    if (head.length + tail.length > 7) return null;
  }
  const groups = [];
  for (const g of head) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
    groups.push(parseInt(g, 16));
  }
  const missing = 8 - head.length - tail.length;
  if (dc !== -1 && missing < 1) return null;
  for (let i = 0; i < missing; i++) groups.push(0);
  for (const g of tail) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
    groups.push(parseInt(g, 16));
  }
  return groups.length === 8 ? groups : null;
}

export function compressIpv6(groups) {
  const hex = groups.map((g) => g.toString(16));
  let bestStart = -1;
  let bestLen = 0;
  let curStart = -1;
  let curLen = 0;
  for (let i = 0; i < 8; i++) {
    if (groups[i] === 0) {
      if (curStart === -1) { curStart = i; curLen = 1; } else curLen++;
      if (curLen > bestLen) { bestLen = curLen; bestStart = curStart; }
    } else {
      curStart = -1;
      curLen = 0;
    }
  }
  if (bestLen < 2) return hex.join(':');
  const head = hex.slice(0, bestStart).join(':');
  const tail = hex.slice(bestStart + bestLen).join(':');
  return `${head}::${tail}`;
}

function v6Kind(groups) {
  if (groups.every((g, i) => (i === 7 ? g === 1 : g === 0))) return '环回（::1）';
  if ((groups[0] & 0xffc0) === 0xfe80) return '链路本地（fe80::/10）';
  if ((groups[0] & 0xfe00) === 0xfc00) return '唯一本地地址 ULA（fc00::/7）';
  if ((groups[0] & 0xff00) === 0xff00) return '组播（ff00::/8）';
  if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) return 'IPv4 映射地址';
  if (groups[0] === 0x64 && groups[1] === 0xff9b) return 'NAT64';
  if (groups[0] === 0x2001 && groups[1] === 0xdb8) return '文档示例（2001:db8::/32）';
  if ((groups[0] & 0xe000) === 0x2000) return '全球单播';
  return '其他 / 保留';
}

/** @returns {CalcResult} */
export function calcIpv6(raw) {
  const input = splitCidr(raw);
  let addrPart = input;
  let prefix = 128;
  const slash = input.lastIndexOf('/');
  if (slash !== -1) {
    addrPart = input.slice(0, slash).trim();
    const tail = input.slice(slash + 1).trim();
    if (!/^\d{1,3}$/.test(tail) || Number(tail) > 128) return { ok: false, error: '前缀长度需为 0–128' };
    prefix = Number(tail);
  }
  const groups = parseIpv6Groups(addrPart);
  if (!groups) return { ok: false, error: 'IPv6 地址格式不正确' };

  const value = groups.reduce((acc, g) => (acc << 16n) | BigInt(g), 0n);
  const bits = BigInt(prefix);
  const mask = bits === 0n ? 0n : ((1n << 128n) - 1n) ^ ((1n << (128n - bits)) - 1n);
  const netValue = value & mask;
  const lastValue = netValue | ((1n << (128n - bits)) - 1n);
  const toGroups = (v) => {
    const out = [];
    for (let i = 7; i >= 0; i--) out.push(Number((v >> BigInt(i * 16)) & 0xffffn));
    return out;
  };

  return {
    ok: true,
    version: 6,
    mode: 'cidr',
    input,
    ip: compressIpv6(groups),
    prefix,
    cidr: `${compressIpv6(toGroups(netValue))}/${prefix}`,
    expanded: groups.map((g) => g.toString(16).padStart(4, '0')).join(':'),
    network: compressIpv6(toGroups(netValue)),
    last: compressIpv6(toGroups(lastValue)),
    totalAddresses: (1n << (128n - bits)).toString(),
    kind: v6Kind(groups),
    isPrivate: /链路本地|ULA|环回|IPv4 映射/.test(v6Kind(groups)),
  };
}

/** 统一入口：按是否含冒号分派 */
/** @returns {CalcResult} */
export function calcIp(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return { ok: false, error: '请输入 IP 地址或网段' };
  return s.includes(':') ? calcIpv6(s) : calcIpv4(s);
}
