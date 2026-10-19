import { describe, it, expect, vi, afterEach } from 'vitest';
import { SELF } from 'cloudflare:test';
import { parseTrace, runProbes, PROBE_TARGETS } from '../src/tools/probe';
import { isValidDomain, detectCdn, resolveDns, runDomainReport } from '../src/tools/domain';
import { runStatusReport, indicatorLabel } from '../src/tools/status';
import { runPing } from '../src/tools/ping';

/** 按 URL 路由的 mock fetch（支持 text 响应与 Location 头） */
function mockFetch(routes: Record<string, { body?: unknown; text?: string; status?: number; location?: string }>): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    for (const [pattern, r] of Object.entries(routes)) {
      if (url.includes(pattern)) {
        const headers: Record<string, string> = { 'Content-Type': 'text/plain; charset=utf-8' };
        if (r.location) headers['Location'] = r.location;
        return new Response(r.text ?? (r.body !== undefined ? JSON.stringify(r.body) : ''), {
          status: r.status ?? 200,
          headers,
        });
      }
    }
    return new Response('not found', { status: 404 });
  }) as unknown as typeof fetch;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('probe：trace 解析', () => {
  it('解析 key=value 行', () => {
    const t = parseTrace('fl=447f225\nh=www.cloudflare.com\nip=1.2.3.4\nts=1792371213.000\ncolo=SIN\nloc=SG\nhttp=h3\ntls=TLSv1.3\nwarp=off\ngateway=off');
    expect(t).toMatchObject({ fl: '447f225', ip: '1.2.3.4', colo: 'SIN', loc: 'SG', http: 'h3', tls: 'TLSv1.3' });
  });
  it('容错空行与无等号行', () => {
    expect(parseTrace('\n\nfoo\nbar=\n')).toEqual({ bar: '' });
  });
});

describe('probe：并发探测', () => {
  it('trace 站点解析出口身份，非 trace 站点仅可达性', async () => {
    vi.stubGlobal('fetch', mockFetch({
      'cloudflare.com/cdn-cgi/trace': { text: 'fl=x\nip=8.8.8.8\ncolo=HKG\nloc=HK\nhttp=h3\ntls=TLSv1.3\nwarp=off' },
      'chatgpt.com': { status: 403 },
      'claude.ai/cdn-cgi/trace': { text: 'fl=y\nip=9.9.9.9\ncolo=FRA\nloc=DE' },
      'grok.com': { text: 'ip=1.1.1.1\ncolo=LAX' },
      'google.com/generate_204': { status: 204 },
      'github.com': { status: 200 },
    }));
    const { probes } = await runProbes(fetch);
    const cf = probes.find((p) => p.service === 'cloudflare')!;
    expect(cf.reachable).toBe(true);
    expect(cf.exitIp).toBe('8.8.8.8');
    expect(cf.colo).toBe('HKG');
    const openai = probes.find((p) => p.service === 'openai')!;
    expect(openai.reachable).toBe(false);
    expect(openai.error).toMatch(/403/);
    const google = probes.find((p) => p.service === 'google')!;
    expect(google.reachable).toBe(true);
    expect(google.exitIp).toBeNull();
  });

  it('内置目标列表包含 AI 三大家', () => {
    const services = PROBE_TARGETS.map((t) => t.service);
    expect(services).toContain('openai');
    expect(services).toContain('anthropic');
    expect(services).toContain('grok');
  });
});

describe('domain：校验与 CDN 判定', () => {
  it('域名校验', () => {
    expect(isValidDomain('example.com')).toBe(true);
    expect(isValidDomain('a.b.co.uk')).toBe(true);
    expect(isValidDomain('no-dot')).toBe(false);
    expect(isValidDomain('-bad.com')).toBe(false);
    expect(isValidDomain('a..com')).toBe(false);
  });

  it('CNAME 关键词判定 CDN', () => {
    expect(detectCdn(['d1234.cloudfront.net']).provider).toBe('Amazon CloudFront');
    expect(detectCdn(['x.akamaiedge.net']).provider).toBe('Akamai');
    expect(detectCdn(['a.cdn.dnsv1.com']).provider).toBe('腾讯云 CDN');
    expect(detectCdn(['origin.example.com']).isCdn).toBe(false);
  });
});

describe('domain：DNS + RDAP 组合', () => {
  it('拉取 A/AAAA/CNAME 并识别 CDN，附带 RDAP', async () => {
    vi.stubGlobal('fetch', mockFetch({
      // 注意：'&type=A' 是 '&type=AAAA' 的子串，AAAA 必须排在前面
      '&type=AAAA': { body: { Status: 0, Answer: [{ name: 'x', type: 28, TTL: 60, data: '::1' }] } },
      '&type=A': { body: { Status: 0, Answer: [{ name: 'x', type: 1, TTL: 60, data: '1.2.3.4' }, { name: 'x', type: 1, TTL: 60, data: '1.2.3.4' }] } },
      '&type=CNAME': { body: { Status: 0, Answer: [{ name: 'x', type: 5, TTL: 60, data: 'd1.cloudfront.net.' }] } },
      'rdap.org/domain': {
        body: {
          events: [
            { eventAction: 'registration', eventDate: '1997-09-15T04:00:00Z' },
            { eventAction: 'expiration', eventDate: '2028-09-13T04:00:00Z' },
          ],
          nameservers: [{ ldhName: 'NS1.EXAMPLE.COM.' }],
          status: ['client transfer prohibited'],
          entities: [
            { roles: ['registrar'], vcardArray: ['vcard', [['email', {}, 'text', 'registrar@example.com']]] },
            { roles: ['abuse'], vcardArray: ['vcard', [['email', {}, 'text', 'abuse@example.com']]] },
          ],
        },
      },
    }));
    const r = await runDomainReport(fetch, 'example.com');
    expect(r.dns.a).toEqual(['1.2.3.4']); // 去重
    expect(r.dns.aaaa).toEqual(['::1']);
    expect(r.dns.cname).toEqual(['d1.cloudfront.net']); // 去尾点
    expect(r.cdn.isCdn).toBe(true);
    expect(r.cdn.provider).toBe('Amazon CloudFront');
    expect(r.rdap?.abuseEmail).toBe('abuse@example.com');
    expect(r.rdap?.expires).toMatch(/^2028/);
    expect(r.rdap?.nameservers).toEqual(['NS1.EXAMPLE.COM']);
  });

  it('DoH 整体失败时返回空记录集', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 500 })) as unknown as typeof fetch);
    const dns = await resolveDns(fetch, 'example.com');
    expect(dns).toEqual({ a: [], aaaa: [], cname: [] });
  });
});

describe('status：聚合', () => {
  it('归一化 indicator 与描述', async () => {
    vi.stubGlobal('fetch', mockFetch({
      'cloudflarestatus': { body: { page: { updated_at: '2026-10-19T00:00:00Z' }, status: { indicator: 'none', description: 'All Systems Operational' } } },
      'githubstatus': { body: { page: { updated_at: '2026-10-19T00:00:00Z' }, status: { indicator: 'minor', description: 'Elevated Errors' } } },
      'status.openai': { body: { page: {}, status: { indicator: 'none', description: 'ok' } } },
      'status.anthropic': { status: 503 },
    }));
    const { services } = await runStatusReport(fetch);
    expect(services).toHaveLength(4);
    expect(services.find((s) => s.service === 'cloudflare')?.indicator).toBe('none');
    expect(services.find((s) => s.service === 'github')?.indicator).toBe('minor');
    expect(services.find((s) => s.service === 'anthropic')?.error).toMatch(/503/);
  });

  it('indicator 中文标签', () => {
    expect(indicatorLabel('none')).toBe('正常');
    expect(indicatorLabel('major')).toBe('严重故障');
    expect(indicatorLabel(null)).toBe('未知');
  });
});

describe('ping：Globalping', () => {
  it('创建测量并轮询归一化结果', async () => {
    let created = false;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.includes('/v1/measurements') && init?.method === 'POST') {
        created = true;
        expect(JSON.parse(String(init.body))).toMatchObject({ type: 'ping', target: '1.1.1.1', limit: 3 });
        return new Response(JSON.stringify({ id: 'm-123' }), { status: 202, headers: { Location: 'https://api.globalping.io/v1/measurements/m-123', 'Content-Type': 'application/json' } });
      }
      if (!created) return new Response('not found', { status: 404 });
      return new Response(JSON.stringify({
        id: 'm-123',
        status: 'finished',
        results: [
          { probe: { country: 'US', city: 'New York', asn: 15169 }, result: { stats: { min: 1.1, avg: 2.2, max: 3.3 } } },
          { probe: { country: 'DE', city: 'Frankfurt', asn: 13335 }, result: { stats: { min: 4, avg: 5, max: 6 } } },
        ],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as unknown as typeof fetch);
    const r = await runPing(fetch, 'ping', '1.1.1.1', 3);
    expect(r.status).toBe('finished');
    expect(r.id).toBe('m-123');
    expect(r.results).toHaveLength(2);
    expect(r.results[0]).toMatchObject({ country: 'US', city: 'New York', rttMs: 2.2, minMs: 1.1 });
    expect(r.results[1].asn).toBe(13335);
  });

  it('429 时返回友好错误', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 429 })) as unknown as typeof fetch);
    const r = await runPing(fetch, 'ping', '1.1.1.1');
    expect(r.status).toBe('failed');
    expect(r.error).toMatch(/额度/);
  });

  it('不支持的类型直接失败', async () => {
    const r = await runPing(fetch, 'traceroute' as never, '1.1.1.1');
    expect(r.status).toBe('failed');
    expect(r.error).toMatch(/暂支持/);
  });
});

describe('工具端点路由（handler 集成）', () => {
  function installToolsMock() {
    vi.stubGlobal('fetch', mockFetch({
      'cloudflare.com/cdn-cgi/trace': { text: 'ip=8.8.8.8\ncolo=SIN' },
      'claude.ai/cdn-cgi/trace': { text: 'ip=9.9.9.9\ncolo=FRA' },
      'chatgpt.com': { text: 'ip=1.1.1.1\ncolo=LAX' },
      'grok.com': { text: 'ip=2.2.2.2' },
      'google.com/generate_204': { status: 204 },
      'github.com': { status: 200 },
      '&type=AAAA': { body: { Status: 0, Answer: [] } },
      '&type=A': { body: { Status: 0, Answer: [{ name: 'x', type: 1, TTL: 60, data: '1.2.3.4' }] } },
      '&type=CNAME': { body: { Status: 0, Answer: [] } },
      'rdap.org/domain': { body: { events: [], nameservers: [], status: [], entities: [] } },
      'cloudflarestatus': { body: { page: {}, status: { indicator: 'none', description: 'ok' } } },
      'githubstatus': { body: { page: {}, status: { indicator: 'none', description: 'ok' } } },
      'status.openai': { body: { page: {}, status: { indicator: 'none', description: 'ok' } } },
      'status.anthropic': { body: { page: {}, status: { indicator: 'none', description: 'ok' } } },
    }));
  }

  it('/api/probe 返回探测报告', async () => {
    installToolsMock();
    const res = await SELF.fetch('https://example.com/api/probe');
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Cache')).toBe('MISS');
    const j = (await res.json()) as { probes: Array<{ service: string; exitIp: string | null }> };
    expect(j.probes).toHaveLength(6);
    expect(j.probes.find((p) => p.service === 'cloudflare')?.exitIp).toBe('8.8.8.8');
  });

  it('/api/domain 无效域名 400', async () => {
    installToolsMock();
    const res = await SELF.fetch('https://example.com/api/domain?domain=not-a-domain');
    expect(res.status).toBe(400);
  });

  it('/api/domain 有效域名返回 DNS+RDAP', async () => {
    installToolsMock();
    const res = await SELF.fetch('https://example.com/api/domain?domain=example.com');
    const j = (await res.json()) as { dns: { a: string[] }; cdn: { isCdn: boolean } };
    expect(j.dns.a).toEqual(['1.2.3.4']);
    expect(j.cdn.isCdn).toBe(false);
  });

  it('/api/ping 缺少 target 400', async () => {
    installToolsMock();
    const res = await SELF.fetch('https://example.com/api/ping');
    expect(res.status).toBe(400);
  });

  it('/api/status 返回四家状态', async () => {
    installToolsMock();
    const res = await SELF.fetch('https://example.com/api/status');
    const j = (await res.json()) as { services: Array<{ service: string }> };
    expect(j.services.map((s) => s.service)).toEqual(['cloudflare', 'github', 'openai', 'anthropic']);
  });

  it('/api/ping 完整流程（mock Globalping）', async () => {
    let created = false;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.includes('/v1/measurements') && init?.method === 'POST') {
        created = true;
        return new Response(JSON.stringify({ id: 'x1' }), { status: 202, headers: { Location: 'https://api.globalping.io/v1/measurements/x1', 'Content-Type': 'application/json' } });
      }
      if (created && url.includes('/v1/measurements/x1')) {
        return new Response(JSON.stringify({ id: 'x1', status: 'finished', results: [{ probe: { country: 'JP', city: 'Tokyo', asn: 2497 }, result: { stats: { avg: 12.5 } } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response('not found', { status: 404 });
    }) as unknown as typeof fetch);
    const res = await SELF.fetch('https://example.com/api/ping?target=1.1.1.1&type=ping&limit=2');
    const j = (await res.json()) as { status: string; results: Array<{ country: string; rttMs: number }> };
    expect(j.status).toBe('finished');
    expect(j.results[0]).toMatchObject({ country: 'JP', rttMs: 12.5 });
  });
});
