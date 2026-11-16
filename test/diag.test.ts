import { describe, it, expect } from 'vitest';
import {
  SITE_GROUPS,
  median,
  minOf,
  mbps,
  parseUa,
  fnv1a,
  isPrivateIp,
  classifyCandidate,
  summarizeConnectivity,
  fingerprintDigest,
} from '../public/assets/diag.js';

describe('diag：站点预设', () => {
  it('5 组共 30 个站点，全部 https', () => {
    expect(SITE_GROUPS).toHaveLength(5);
    const sites = SITE_GROUPS.flatMap((g) => g.sites);
    expect(sites).toHaveLength(30);
    expect(sites.every((s) => s.url.startsWith('https://'))).toBe(true);
    expect(SITE_GROUPS.map((g) => g.id)).toEqual(['ai', 'streaming', 'social', 'dev', 'cn']);
  });
});

describe('diag：统计', () => {
  it('median 奇偶与过滤', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
    expect(median([1, null, undefined, NaN, 5])).toBe(3);
  });

  it('minOf 与 mbps', () => {
    expect(minOf([9, 3, 5])).toBe(3);
    expect(minOf([])).toBeNull();
    expect(mbps(1_000_000, 1000)).toBe(8);
    expect(mbps(1_000_000, 0)).toBeNull();
  });
});

describe('diag：UA 解析', () => {
  it('识别主流浏览器与系统', () => {
    expect(parseUa('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36'))
      .toMatchObject({ browser: 'Chrome', os: 'Windows 10/11', version: '131' });
    expect(parseUa('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Version/17.2 Safari/605.1.15'))
      .toMatchObject({ browser: 'Safari', os: 'macOS', version: '17' });
    expect(parseUa('Mozilla/5.0 (iPhone; CPU iPhone OS 17_2) Mobile/15E148')).toMatchObject({ os: 'iOS / iPadOS', mobile: true });
    expect(parseUa('Mozilla/5.0 (X11; Linux x86_64) Firefox/122.0')).toMatchObject({ browser: 'Firefox', os: 'Linux' });
    expect(parseUa('Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Edg/131.0.0.0')).toMatchObject({ browser: 'Edge' });
  });
});

describe('diag：哈希', () => {
  it('FNV-1a 稳定且为 8 位十六进制', () => {
    expect(fnv1a('abc')).toBe(fnv1a('abc'));
    expect(fnv1a('abc')).not.toBe(fnv1a('abd'));
    expect(fnv1a('')).toMatch(/^[0-9a-f]{8}$/);
  });

  it('指纹摘要与键顺序无关', () => {
    expect(fingerprintDigest({ a: 1, b: 2 })).toBe(fingerprintDigest({ b: 2, a: 1 }));
    expect(fingerprintDigest({ a: 1 })).not.toBe(fingerprintDigest({ a: 2 }));
  });
});

describe('diag：地址判定', () => {
  it('内网 / 环回 / ULA', () => {
    expect(isPrivateIp('192.168.1.1')).toBe(true);
    expect(isPrivateIp('10.1.2.3')).toBe(true);
    expect(isPrivateIp('172.20.0.1')).toBe(true);
    expect(isPrivateIp('100.64.0.1')).toBe(true);
    expect(isPrivateIp('8.8.8.8')).toBe(false);
    expect(isPrivateIp('fd00::1')).toBe(true);
    expect(isPrivateIp('fe80::1')).toBe(true);
    expect(isPrivateIp('2606:4700::1111')).toBe(false);
  });

  it('ICE candidate 分类', () => {
    expect(classifyCandidate('candidate:1 1 udp 2113937151 192.168.1.5 54321 typ host generation 0'))
      .toMatchObject({ type: 'host', address: '192.168.1.5', private: true, mdns: false });
    expect(classifyCandidate('candidate:2 1 udp 1677729535 203.0.113.5 54321 typ srflx raddr 0.0.0.0 rport 0'))
      .toMatchObject({ type: 'srflx', address: '203.0.113.5', private: false, protocol: 'udp' });
    expect(classifyCandidate('candidate:3 1 udp 1677729535 a1b2c3d4-0000.local 54321 typ host'))
      .toMatchObject({ mdns: true, private: false });
    expect(classifyCandidate('not-a-candidate')).toBeNull();
    expect(classifyCandidate('candidate:')).toBeNull();
  });
});

describe('diag：连通性汇总', () => {
  it('分组统计与最快最慢', () => {
    const sum = summarizeConnectivity([
      { name: 'A', group: 'ai', groupLabel: 'AI', ok: true, ms: 120 },
      { name: 'B', group: 'ai', groupLabel: 'AI', ok: false, ms: null },
      { name: 'C', group: 'cn', groupLabel: '国内', ok: true, ms: 400 },
    ]);
    expect(sum).toMatchObject({ total: 3, reachable: 2, unreachable: 1, fastest: 'A', slowest: 'C', offline: false });
    expect(sum.byGroup).toEqual([
      { group: 'ai', label: 'AI', reachable: 1, total: 2 },
      { group: 'cn', label: '国内', reachable: 1, total: 1 },
    ]);
  });

  it('全部不可达判定 offline', () => {
    const sum = summarizeConnectivity([{ name: 'A', group: 'ai', ok: false, ms: null }]);
    expect(sum.offline).toBe(true);
    expect(sum.fastest).toBeNull();
  });
});
