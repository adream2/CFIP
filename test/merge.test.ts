import { describe, it, expect } from 'vitest';
import { mergeResults } from '../src/merge';
import { emptyIpInfo } from '../src/types';
import type { DeepPartial, IpInfo, SourceId } from '../src/types';

function part(id: SourceId, data: DeepPartial<IpInfo>) {
  return { id, data };
}

const base = emptyIpInfo('8.8.8.8', 4, 'public', 21600);

describe('mergeResults', () => {
  it('按字段优先级取第一个非空值', () => {
    const { merged, provenance } = mergeResults(
      [
        part('ipapi', { location: { country: 'United States', city: 'Mountain View' }, network: { isp: 'Google LLC' } }),
        part('ipwhois', { location: { country: 'United States (ipwhois)', city: 'Mountain View (ipwhois)' } }),
      ],
      base,
    );
    // city 优先级 ip2region > ipwhois > ipapi → ipwhois 的 city 胜出
    expect(merged.location.city).toBe('Mountain View (ipwhois)');
    // country 同样 ipwhois 优先
    expect(merged.location.country).toBe('United States (ipwhois)');
    // isp 优先级 ipapi > ipwhois
    expect(merged.network.isp).toBe('Google LLC');
    expect(provenance['location.city']).toBe('ipwhois');
    expect(provenance['network.isp']).toBe('ipapi');
  });

  it('ip2region 国内数据优先于在线源', () => {
    const { merged } = mergeResults(
      [
        part('ipwhois', { location: { country: 'China', region: 'Guangdong', city: 'Shenzhen' } }),
        part('ip2region', { location: { country: '中国', region: '广东省', city: '深圳市' } }),
      ],
      base,
    );
    expect(merged.location.country).toBe('中国');
    expect(merged.location.region).toBe('广东省');
    expect(merged.location.city).toBe('深圳市');
  });

  it('null 与空数组被跳过，落入下一优先级', () => {
    const { merged } = mergeResults(
      [
        part('ipwhois', { location: { country: null, city: null } }),
        part('ipapi', { location: { country: 'United States', city: null }, node: { rdns: [] } }),
        part('doh', { node: { rdns: ['dns.google'] } }),
      ],
      base,
    );
    expect(merged.location.country).toBe('United States');
    expect(merged.location.city).toBeNull();
    expect(merged.node.rdns).toEqual(['dns.google']);
  });

  it('判定对象作为原子叶子整体胜出', () => {
    const { merged } = mergeResults(
      [
        part('ipwhois', { node: { hosting: { value: true, confidence: 'medium', source: 'ipwhois' } } }),
        part('ipapi', { node: { hosting: { value: false, confidence: 'medium', source: 'ipapi' } } }),
      ],
      base,
    );
    expect(merged.node.hosting).toEqual({ value: true, confidence: 'medium', source: 'ipwhois' });
  });

  it('proxy flag 跨源逐字段合并，sources 取并集', () => {
    const { merged } = mergeResults(
      [
        part('ipwhois', {
          reputation: { proxy: { isProxy: true, isVpn: null, isTor: null, isAnonymous: null, sources: ['ipwhois'] } },
        }),
        part('ipapi', {
          reputation: { proxy: { isProxy: null, isVpn: null, isTor: false, isAnonymous: null, sources: ['ipapi'] } },
        }),
      ],
      base,
    );
    expect(merged.reputation.proxy.isProxy).toBe(true);
    expect(merged.reputation.proxy.isTor).toBe(false);
    expect(merged.reputation.proxy.sources.sort()).toEqual(['ipapi', 'ipwhois']);
  });

  it('数组字段不跨源合并（dnsbl 仅 doh）', () => {
    const { merged } = mergeResults(
      [
        part('doh', {
          reputation: { dnsbl: [{ list: 'zen.spamhaus.org', listed: false, returnCode: null, ttl: null }], dnsblListedCount: 0 },
        }),
        part('abuseipdb', { reputation: { abuseScore: 12, abuseReports: 3 } }),
      ],
      base,
    );
    expect(merged.reputation.dnsbl).toHaveLength(1);
    expect(merged.reputation.dnsblListedCount).toBe(0);
    expect(merged.reputation.abuseScore).toBe(12);
  });

  it('meta.* 不被适配器覆盖', () => {
    const { merged } = mergeResults(
      [part('ipwhois', { meta: { warnings: ['x'] } } as DeepPartial<IpInfo>)],
      base,
    );
    expect(merged.meta.warnings).toEqual([]);
  });

  it('connection 仅在自身查询由 cf 提供', () => {
    const { merged } = mergeResults(
      [
        part('cf', {
          connection: {
            httpProtocol: 'HTTP/3', tlsVersion: 'TLSv1.3', tlsCipher: 'x', clientTcpRttMs: 12,
            colo: 'HKG', asOrganization: 'Google Cloud', userAgent: 'curl',
          },
        }),
      ],
      base,
    );
    expect(merged.connection?.colo).toBe('HKG');
    expect(merged.connection?.clientTcpRttMs).toBe(12);
  });
});
