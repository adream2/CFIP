/** CFIP 诊断纯逻辑：站点预设、UA 解析、延迟统计、WebRTC candidate 分类、指纹摘要。
 *  无 DOM 依赖（Canvas / WebGL 采集在 labs.js），可在 Node 下单测（test/diag.test.ts）。 */

/** 连通性检测站点：5 组 30 个，均为根路径（no-cors 只关心能否连上） */
export const SITE_GROUPS = [
  {
    id: 'ai',
    label: 'AI',
    sites: [
      { name: 'ChatGPT', url: 'https://chatgpt.com/' },
      { name: 'Claude', url: 'https://claude.ai/' },
      { name: 'Gemini', url: 'https://gemini.google.com/' },
      { name: 'Grok', url: 'https://grok.com/' },
      { name: 'Perplexity', url: 'https://www.perplexity.ai/' },
      { name: 'Copilot', url: 'https://copilot.microsoft.com/' },
    ],
  },
  {
    id: 'streaming',
    label: '流媒体',
    sites: [
      { name: 'Netflix', url: 'https://www.netflix.com/' },
      { name: 'YouTube', url: 'https://www.youtube.com/' },
      { name: 'Disney+', url: 'https://www.disneyplus.com/' },
      { name: 'Spotify', url: 'https://open.spotify.com/' },
      { name: 'Twitch', url: 'https://www.twitch.tv/' },
      { name: 'Bilibili', url: 'https://www.bilibili.com/' },
    ],
  },
  {
    id: 'social',
    label: '社交',
    sites: [
      { name: 'X', url: 'https://x.com/' },
      { name: 'Facebook', url: 'https://www.facebook.com/' },
      { name: 'Instagram', url: 'https://www.instagram.com/' },
      { name: 'Reddit', url: 'https://www.reddit.com/' },
      { name: 'Discord', url: 'https://discord.com/' },
      { name: 'Telegram', url: 'https://telegram.org/' },
    ],
  },
  {
    id: 'dev',
    label: '开发',
    sites: [
      { name: 'GitHub', url: 'https://github.com/' },
      { name: 'GitLab', url: 'https://gitlab.com/' },
      { name: 'npm', url: 'https://www.npmjs.com/' },
      { name: 'Docker Hub', url: 'https://hub.docker.com/' },
      { name: 'Stack Overflow', url: 'https://stackoverflow.com/' },
      { name: 'Cloudflare', url: 'https://www.cloudflare.com/' },
    ],
  },
  {
    id: 'cn',
    label: '国内',
    sites: [
      { name: '百度', url: 'https://www.baidu.com/' },
      { name: '腾讯', url: 'https://www.qq.com/' },
      { name: '淘宝', url: 'https://www.taobao.com/' },
      { name: '微博', url: 'https://weibo.com/' },
      { name: '知乎', url: 'https://www.zhihu.com/' },
      { name: '京东', url: 'https://www.jd.com/' },
    ],
  },
];

export function median(nums) {
  const arr = (nums ?? []).filter((n) => typeof n === 'number' && Number.isFinite(n));
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function minOf(nums) {
  const arr = (nums ?? []).filter((n) => typeof n === 'number' && Number.isFinite(n));
  return arr.length ? Math.min(...arr) : null;
}

/** 字节 / 毫秒 → Mbps（保留两位） */
export function mbps(bytes, ms) {
  if (!bytes || !ms || ms <= 0) return null;
  return Math.round((bytes * 8) / ms / 1000 * 100) / 100;
}

/** 粗粒度 UA 解析（只做展示，不追求完备） */
export function parseUa(ua) {
  const s = String(ua ?? '');
  const browser =
    /Edg\//.test(s) ? 'Edge' :
    /OPR\/|Opera/.test(s) ? 'Opera' :
    /MicroMessenger/i.test(s) ? '微信内置浏览器' :
    /QQBrowser/.test(s) ? 'QQ 浏览器' :
    /Firefox\//.test(s) ? 'Firefox' :
    /Chrome\//.test(s) ? 'Chrome' :
    /Safari\//.test(s) ? 'Safari' : '未知';
  const os =
    /Windows NT 10/.test(s) ? 'Windows 10/11' :
    /Windows/.test(s) ? 'Windows' :
    /iPhone|iPad|iPod/.test(s) ? 'iOS / iPadOS' :
    /Android/.test(s) ? 'Android' :
    /Mac OS X/.test(s) ? 'macOS' :
    /Linux/.test(s) ? 'Linux' : '未知';
  const version =
    /(?:Edg|OPR|Firefox|Chrome)\/(\d+)/.exec(s)?.[1] ??
    /Version\/(\d+).*Safari/.exec(s)?.[1] ??
    null;
  return { browser, os, version, mobile: /Mobile|Android|iPhone/.test(s) };
}

/** FNV-1a 32 位哈希（十六进制字符串） */
export function fnv1a(str) {
  let h = 0x811c9dc5;
  const s = String(str ?? '');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export function isPrivateIp(ip) {
  const s = String(ip ?? '').trim().toLowerCase();
  if (!s) return false;
  if (s.includes(':')) {
    return s === '::1' || /^(fc|fd)/.test(s) || /^fe[89ab]/.test(s) || s === '::';
  }
  const parts = s.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b] = parts;
  return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
    (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
}

/**
 * 解析 WebRTC ICE candidate 字符串。
 * 形如：candidate:842163049 1 udp 1677729535 203.0.113.5 54321 typ srflx raddr 0.0.0.0 rport 0
 */
export function classifyCandidate(candidate) {
  if (typeof candidate !== 'string' || !candidate.startsWith('candidate:')) return null;
  const parts = candidate.split(/\s+/);
  const address = parts[4];
  if (!address) return null;
  const typIdx = parts.indexOf('typ');
  const type = typIdx >= 0 ? parts[typIdx + 1] : 'host';
  const mdns = address.endsWith('.local');
  return {
    type,
    address,
    mdns,
    private: !mdns && isPrivateIp(address),
    protocol: parts[2] ?? null,
  };
}

/** 连通性结果汇总 */
export function summarizeConnectivity(results) {
  const rows = results ?? [];
  const reachable = rows.filter((r) => r.ok);
  const byGroup = new Map();
  for (const r of rows) {
    const g = byGroup.get(r.group) ?? { group: r.group, label: r.groupLabel ?? r.group, reachable: 0, total: 0 };
    g.total++;
    if (r.ok) g.reachable++;
    byGroup.set(r.group, g);
  }
  const fastest = reachable.reduce((best, r) => (best == null || r.ms < best.ms ? r : best), null);
  const slowest = reachable.reduce((best, r) => (best == null || r.ms > best.ms ? r : best), null);
  return {
    total: rows.length,
    reachable: reachable.length,
    unreachable: rows.length - reachable.length,
    byGroup: [...byGroup.values()],
    fastest: fastest?.name ?? null,
    slowest: slowest?.name ?? null,
    offline: rows.length > 0 && reachable.length === 0,
  };
}

/** 指纹摘要：按键排序后拼接，保证同一浏览器多次计算结果一致 */
export function fingerprintDigest(parts) {
  const obj = parts ?? {};
  const stable = Object.keys(obj).sort().map((k) => `${k}=${obj[k]}`).join('|');
  return fnv1a(stable);
}
