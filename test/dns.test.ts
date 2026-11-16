import { describe, it, expect, vi, afterEach } from 'vitest';
import { SELF } from 'cloudflare:test';
import { normalizeRecord, runDnsCompare, rcodeLabel, DNS_RESOLVERS } from '../src/tools/dns';

afterEach(() => {
  vi.unstubAllGlobals();
});

/** 按解析器主机名路由的 mock：返回各自的答案集合 */
function mockByResolver(map: Record<string, { status?: number; answers?: Array<{ type: number; data: string }> }>): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    for (const [host, r] of Object.entries(map)) {
      if (url.includes(host)) {
        return new Response(JSON.stringify({ Status: r.status ?? 0, Answer: r.answers ?? [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/dns-json' },
        });
      }
    }
    return new Response('nope', { status: 500 });
  }) as unknown as typeof fetch;
}

describe('dns：记录归一化', () => {
  it('去尾部点、TXT 去引号', () => {
    expect(normalizeRecord('CNAME', 'd1.cloudfront.net.')).toBe('d1.cloudfront.net');
    expect(normalizeRecord('TXT', '"v=spf1 -all"')).toBe('v=spf1 -all');
    expect(normalizeRecord('A', '1.2.3.4')).toBe('1.2.3.4');
  });

  it('RCODE 中文说明', () => {
    expect(rcodeLabel(0)).toBe('NOERROR');
    expect(rcodeLabel(3)).toMatch(/NXDOMAIN/);
    expect(rcodeLabel(null)).toBe('未知错误');
  });
});

describe('dns：多解析器对比', () => {
  it('全部一致时 consistent=true', async () => {
    vi.stubGlobal('fetch', mockByResolver({
      'cloudflare-dns.com': { answers: [{ type: 1, data: '1.2.3.4' }] },
      'dns.google': { answers: [{ type: 1, data: '1.2.3.4' }] },
      'dns.adguard-dns.com': { answers: [{ type: 1, data: '1.2.3.4' }] },
      'dns.alidns.com': { answers: [{ type: 1, data: '1.2.3.4' }] },
      'doh.pub': { answers: [{ type: 1, data: '1.2.3.4' }] },
    }));
    const r = await runDnsCompare(fetch, 'example.com', 'A');
    expect(r.consistent).toBe(true);
    expect(r.consensus).toEqual(['1.2.3.4']);
    expect(r.divergentResolvers).toEqual([]);
    expect(r.resolvers).toHaveLength(DNS_RESOLVERS.length);
  });

  it('国内外结果不同 → 标记分歧解析器与提示', async () => {
    vi.stubGlobal('fetch', mockByResolver({
      'cloudflare-dns.com': { answers: [{ type: 1, data: '93.184.216.34' }] },
      'dns.google': { answers: [{ type: 1, data: '93.184.216.34' }] },
      'dns.adguard-dns.com': { answers: [{ type: 1, data: '93.184.216.34' }] },
      'dns.alidns.com': { answers: [{ type: 1, data: '10.10.10.10' }] },
      'doh.pub': { answers: [{ type: 1, data: '10.10.10.10' }] },
    }));
    const r = await runDnsCompare(fetch, 'example.com', 'A');
    expect(r.consistent).toBe(false);
    expect(r.consensus).toEqual(['93.184.216.34']);
    expect(r.divergentResolvers.sort()).toEqual(['alidns', 'dnspod']);
    expect(r.note).toMatch(/不一致/);
  });

  it('NXDOMAIN 视为失败并给出原因', async () => {
    vi.stubGlobal('fetch', mockByResolver({ 'dns.google': { status: 3 } }));
    const r = await runDnsCompare(fetch, 'nope.example', 'A');
    const g = r.resolvers.find((x) => x.id === 'google')!;
    expect(g.ok).toBe(false);
    expect(g.status).toBe(3);
    expect(g.error).toMatch(/NXDOMAIN/);
    expect(r.note).toMatch(/均未返回/);
  });

  it('查询异常时单源失败不影响整体', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.includes('dns.google')) throw new Error('boom');
      return new Response(JSON.stringify({ Status: 0, Answer: [{ type: 28, data: '2606:4700::1111' }] }), { status: 200 });
    }) as unknown as typeof fetch);
    const r = await runDnsCompare(fetch, 'example.com', 'AAAA');
    expect(r.resolvers.find((x) => x.id === 'google')?.error).toMatch(/boom/);
    expect(r.consensus).toEqual(['2606:4700::1111']);
  });
});

describe('/api/dns 路由', () => {
  it('无效域名 400', async () => {
    const res = await SELF.fetch('https://example.com/api/dns?domain=not-a-domain');
    expect(res.status).toBe(400);
  });

  it('无效 type 400', async () => {
    const res = await SELF.fetch('https://example.com/api/dns?domain=example.com&type=PTR');
    expect(res.status).toBe(400);
  });

  it('有效请求返回对比报告', async () => {
    vi.stubGlobal('fetch', mockByResolver({ 'cloudflare-dns.com': { answers: [{ type: 1, data: '1.2.3.4' }] } }));
    const res = await SELF.fetch('https://example.com/api/dns?domain=example.com&type=A');
    expect(res.status).toBe(200);
    const j = (await res.json()) as { domain: string; type: string; resolvers: unknown[]; consistent: boolean };
    expect(j.domain).toBe('example.com');
    expect(j.type).toBe('A');
    expect(j.resolvers).toHaveLength(DNS_RESOLVERS.length);
    expect(typeof j.consistent).toBe('boolean');
  });
});
