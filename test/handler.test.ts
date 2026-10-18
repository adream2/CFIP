import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SELF } from 'cloudflare:test';

/** 全外部源 mock 路由 */
function installMockFetch() {
  const router: Record<string, unknown> = {
    'ipwho.is': {
      success: true,
      continent: 'North America', continent_code: 'NA',
      country: 'United States', country_code: 'US',
      region: 'California', region_code: 'CA', city: 'Mountain View',
      latitude: 37.386, longitude: -122.0838, postal: '94039',
      calling_code: 1, capital: 'Washington D.C.',
      native: { country: 'United States' },
      connection: { asn: 15169, org: 'Google LLC', isp: 'Google LLC', domain: 'google.com' },
      timezone: { id: 'America/Los_Angeles', offset: -25200 },
      security: { proxy: false, vpn: false, tor: false, hosting: true },
    },
    'ip-api.com': {
      status: 'success',
      country: 'United States', countryCode: 'US',
      regionName: 'California', region: 'CA', city: 'Mountain View',
      lat: 37.386, lon: -122.0838, timezone: 'America/Los_Angeles', offset: -25200,
      isp: 'Google LLC', org: 'Google LLC', as: 'AS15169 Google LLC', asname: 'GOOGLE',
      reverse: 'dns.google', mobile: false, proxy: false, hosting: true,
    },
    'rdap.org': {
      name: 'GOOGLE', type: 'DIRECT ASSIGNMENT', country: 'US',
      port43: 'whois.arin.net',
      startAddress: '8.8.8.0', endAddress: '8.8.8.255',
      events: [{ eventAction: 'registration', eventDate: '2015-01-01T00:00:00Z' }],
      entities: [{ roles: ['abuse'], vcardArray: ['vcard', [['email', {}, 'text', 'arin-contact@google.com']]] }],
    },
    'type=PTR': { Status: 0, Answer: [{ name: 'x', type: 12, TTL: 3600, data: 'dns.google.' }] },
    'zen.spamhaus.org': { Status: 3 },
    'barracuda': { Status: 3 },
    'spamcop': { Status: 3 },
    'sorbs': { Status: 3 },
    'dronebl': { Status: 3 },
    'bgp.tools': { asn: 15169, name: 'GOOGLE', descr: 'Google LLC', country: 'US' },
  };
  const spy = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    for (const [pattern, body] of Object.entries(router)) {
      if (url.includes(pattern)) {
        return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
    }
    return new Response('mock: no route', { status: 404 });
  });
  vi.stubGlobal('fetch', spy);
  return spy;
}

beforeEach(() => {
  installMockFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('路由与响应协商', () => {
  it('OPTIONS 预检返回 204 + CORS', async () => {
    const res = await SELF.fetch('https://example.com/api', { method: 'OPTIONS' });
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('非 GET 返回 405', async () => {
    const res = await SELF.fetch('https://example.com/api', { method: 'POST' });
    expect(res.status).toBe(405);
  });

  it('无效 IP 返回 400 JSON', async () => {
    const res = await SELF.fetch('https://example.com/api?ip=999.1.1.1');
    expect(res.status).toBe(400);
    const j = (await res.json()) as Record<string, any>;
    expect(j.error).toMatch(/无效/);
  });

  it('/ip 返回纯文本 IP', async () => {
    const res = await SELF.fetch('https://example.com/ip?ip=8.8.8.8');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toMatch(/text\/plain/);
    expect((await res.text()).trim()).toBe('8.8.8.8');
  });

  it('curl UA 访问 / 返回纯文本摘要', async () => {
    const res = await SELF.fetch('https://example.com/?ip=8.8.8.8', {
      headers: { 'User-Agent': 'curl/8.4.0' },
    });
    expect(res.headers.get('Content-Type')).toMatch(/text\/plain/);
    const text = await res.text();
    expect(text).toMatch(/8\.8\.8\.8/);
    expect(text).toMatch(/Google/);
  });

  it('浏览器 UA 访问 / 返回 HTML', async () => {
    const res = await SELF.fetch('https://example.com/', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120' },
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toMatch(/<html lang="zh-CN">/);
    expect(html).toMatch(/IP 查询/);
  });

  it('静态资源可访问', async () => {
    const res = await SELF.fetch('https://example.com/assets/style.css');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toMatch(/css/);
  });
});

describe('查询主流程', () => {
  it('/api?ip= 返回完整 schema', async () => {
    const res = await SELF.fetch('https://example.com/api?ip=8.8.4.4');
    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(res.headers.get('X-Cache')).toBe('MISS');
    const j = (await res.json()) as Record<string, any>;
    expect(j.ip).toBe('8.8.4.4');
    expect(j.version).toBe(4);
    expect(j.isPublic).toBe(true);
    expect(j.location.country).toBe('United States');
    expect(j.location.city).toBe('Mountain View');
    expect(j.network.asn).toBe(15169);
    expect(j.network.isp).toBe('Google LLC');
    expect(j.network.range.cidr).toBe('8.8.8.0/24');
    expect(j.network.rir).toBe('ARIN');
    expect(j.network.abuseEmail).toBe('arin-contact@google.com');
    expect(j.network.asName).toBe('GOOGLE');
    expect(j.node.rdns).toEqual(['dns.google']);
    expect(j.node.hosting.value).toBe(true);
    expect(j.reputation.dnsbl).toHaveLength(5);
    expect(j.reputation.dnsblListedCount).toBe(0);
    expect(j.meta.sources.length).toBeGreaterThan(3);
    expect(j.meta.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('第二次查询命中缓存（X-Cache: HIT）', async () => {
    await SELF.fetch('https://example.com/api?ip=1.1.1.1'); // 预热（mock 数据仍返回 Google）
    const res = await SELF.fetch('https://example.com/api?ip=1.1.1.1');
    expect(res.headers.get('X-Cache')).toBe('HIT');
  });

  it('自身查询填充 connection 区', async () => {
    const res = await SELF.fetch('https://example.com/api', {
      headers: { 'CF-Connecting-IP': '8.8.8.8', 'User-Agent': 'Mozilla/5.0 test' },
    });
    const j = (await res.json()) as Record<string, any>;
    expect(j.ip).toBe('8.8.8.8');
    expect(j.connection).not.toBeNull();
    expect(j.connection.userAgent).toBe('Mozilla/5.0 test');
  });

  it('bogon 短路：零外部请求', async () => {
    const spy = installMockFetch();
    spy.mockClear();
    const res = await SELF.fetch('https://example.com/api?ip=10.0.0.1');
    expect(res.status).toBe(200);
    const j = (await res.json()) as Record<string, any>;
    expect(j.isPublic).toBe(false);
    expect(j.class).toBe('private');
    expect(j.meta.warnings.join(' ')).toMatch(/私有/);
    expect(spy).not.toHaveBeenCalled();
  });

  it('IPv6 全链路可用', async () => {
    const res = await SELF.fetch('https://example.com/api?ip=2606:4700::1111');
    const j = (await res.json()) as Record<string, any>;
    expect(j.version).toBe(6);
    expect(j.ip).toBe('2606:4700::1111');
    expect(j.meta.warnings.join(' ')).toMatch(/IPv6/); // ip2region v6 数据提示
  });

  it('未知路径委托静态资源（404）', async () => {
    const res = await SELF.fetch('https://example.com/nope.js');
    expect(res.status).toBe(404);
  });
});
