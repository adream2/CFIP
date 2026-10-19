import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { env } from 'cloudflare:test';
import { ipwhoisAdapter } from '../src/adapters/ipwhois';
import { ipapiAdapter, parseAsnField } from '../src/adapters/ipapi';
import { rdapAdapter, v4RangeToCidr } from '../src/adapters/rdap';
import { dohAdapter } from '../src/adapters/doh';
import { bgptoolsAdapter } from '../src/adapters/bgptools';
import { ipinfoAdapter } from '../src/adapters/ipinfo';
import { abuseipdbAdapter } from '../src/adapters/abuseipdb';
import { ip2regionAdapter, resetSearcherCache, __setXdbBytesSourceForTest } from '../src/adapters/ip2region';
import { buildAdapters, runAdapters } from '../src/adapters';
import { breaker } from '../src/adapters/breaker';
import { buildSyntheticXdb } from './helpers/synthetic-xdb';
import { emptyIpInfo } from '../src/types';
import type { AdapterCtx } from '../src/adapters/types';

function makeCtx(overrides: Partial<AdapterCtx> = {}): AdapterCtx {
  return {
    ip: '8.8.8.8',
    isSelf: false,
    clientIp: null,
    cf: undefined,
    userAgent: 'test',
    env: env as unknown as AdapterCtx['env'],
    fetchFn: fetch,
    ...overrides,
  };
}

/** 按 URL 路由的 mock fetch */
function mockFetch(routes: Record<string, unknown | (() => never)>): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    for (const [pattern, resp] of Object.entries(routes)) {
      if (url.includes(pattern)) {
        if (typeof resp === 'function') resp();
        return new Response(JSON.stringify(resp), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }
    return new Response('not found', { status: 404 });
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  breaker.reset();
  resetSearcherCache();
  __setXdbBytesSourceForTest(null); // 默认走生产路径（ASSETS 绑定），各测试按需注入
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ipwhois 适配器', () => {
  it('映射字段', async () => {
    vi.stubGlobal('fetch', mockFetch({
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
    }));
    const { data } = await ipwhoisAdapter.run(makeCtx());
    expect(data.location?.country).toBe('United States');
    expect(data.location?.callingCode).toBe('1');
    expect(data.network?.asn).toBe(15169);
    expect(data.network?.asDomain).toBe('google.com');
    expect(data.node?.hosting).toEqual({ value: true, confidence: 'medium', source: 'ipwhois' });
    expect(data.reputation?.proxy?.isTor).toBe(false);
  });

  it('success=false 时抛错', async () => {
    vi.stubGlobal('fetch', mockFetch({ 'ipwho.is': { success: false, message: 'rate limited' } }));
    await expect(ipwhoisAdapter.run(makeCtx())).rejects.toThrow(/rate limited/);
  });

  it('HTTP 429 时抛错', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 429 })) as unknown as typeof fetch);
    await expect(ipwhoisAdapter.run(makeCtx())).rejects.toThrow(/429/);
  });
});

describe('ipapi 适配器', () => {
  it('解析 as 字段与映射', async () => {
    vi.stubGlobal('fetch', mockFetch({
      'ip-api.com': {
        status: 'success',
        country: 'United States', countryCode: 'US',
        regionName: 'Virginia', region: 'VA', city: 'Ashburn',
        lat: 39.03, lon: -77.5, timezone: 'America/New_York', offset: -14400,
        isp: 'Google LLC', org: 'Google Public DNS', as: 'AS15169 Google LLC', asname: 'GOOGLE',
        reverse: 'dns.google', mobile: false, proxy: false, hosting: true,
      },
    }));
    const { data } = await ipapiAdapter.run(makeCtx());
    expect(data.network?.asn).toBe(15169);
    expect(data.network?.isp).toBe('Google LLC');
    expect(data.network?.asName).toBe('GOOGLE');
    expect(data.node?.rdns).toEqual(['dns.google']);
    expect(data.location?.utcOffsetSeconds).toBe(-14400);
    expect(data.node?.isMobile).toEqual({ value: false, confidence: 'medium', source: 'ipapi' });
  });

  it('parseAsnField', () => {
    expect(parseAsnField('AS15169 Google LLC')).toBe(15169);
    expect(parseAsnField('as4134')).toBe(4134);
    expect(parseAsnField(undefined)).toBeNull();
    expect(parseAsnField('Google')).toBeNull();
  });
});

describe('rdap 适配器', () => {
  it('提取网段 / RIR / 滥用邮箱 / 注册时间', async () => {
    vi.stubGlobal('fetch', mockFetch({
    'rdap.org': {
      name: 'CHINANET-GD',
      type: 'DIRECT ALLOCATION',
      country: 'CN',
      port43: 'whois.apnic.net',
      startAddress: '223.104.0.0',
      endAddress: '223.107.255.255',
        events: [{ eventAction: 'registration', eventDate: '2018-01-01T00:00:00Z' }],
        entities: [
          {
            roles: ['abuse'],
            vcardArray: ['vcard', [
              ['version', {}, 'text', '4.0'],
              ['email', {}, 'text', 'abuse@example.com'],
            ]],
          },
        ],
      },
    }));
    const { data } = await rdapAdapter.run(makeCtx({ ip: '223.104.60.60' }));
    expect(data.network?.range?.cidr).toBe('223.104.0.0/14');
    expect(data.network?.range?.count).toBe(262144);
    expect(data.network?.rir).toBe('APNIC');
    expect(data.network?.abuseEmail).toBe('abuse@example.com');
    expect(data.network?.allocationDate).toBe('2018-01-01T00:00:00Z');
    expect(data.network?.asName).toBe('CHINANET-GD');
  });

  it('v4RangeToCidr 边界', () => {
    expect(v4RangeToCidr('8.8.8.0', '8.8.8.255')).toBe('8.8.8.0/24');
    expect(v4RangeToCidr('1.2.3.4', '1.2.3.5')).toBe('1.2.3.4/31'); // RFC 3021 合法对齐块
    expect(v4RangeToCidr('1.2.3.1', '1.2.3.2')).toBeNull(); // 大小是 2 的幂但未对齐
    expect(v4RangeToCidr('1.2.3.4', '1.2.3.6')).toBeNull(); // 非 2 的幂
    expect(v4RangeToCidr('10.0.0.0', '10.255.255.255')).toBe('10.0.0.0/8');
    expect(v4RangeToCidr('9.9.9.9', '9.9.9.8')).toBeNull(); // 反序
  });
});

describe('doh 适配器', () => {
  it('PTR 反解 + DNSBL 判定', async () => {
    vi.stubGlobal('fetch', mockFetch({
      'in-addr.arpa&type=PTR': { Status: 0, Answer: [{ name: '8.8.8.8.in-addr.arpa', type: 12, TTL: 3600, data: 'dns.google.' }] },
      'zen.spamhaus.org': { Status: 0, Answer: [{ name: 'x', type: 1, TTL: 60, data: '127.0.0.2' }] },
      'barracuda': { Status: 3 }, // NXDOMAIN = 未列名
      'spamcop': { Status: 0, Answer: [{ name: 'x', type: 1, TTL: 60, data: '127.0.0.4' }] },
      'sorbs': { Status: 2 }, // 服务失败
      'dronebl': { Status: 0, Answer: [] },
    }));
    const { data } = await dohAdapter.run(makeCtx());
    expect(data.node?.rdns).toEqual(['dns.google']);
    const spamhaus = data.reputation?.dnsbl?.find((d) => d.list === 'zen.spamhaus.org');
    expect(spamhaus?.listed).toBe(true);
    expect(spamhaus?.returnCode).toBe('127.0.0.2');
    expect(data.reputation?.dnsblListedCount).toBe(2); // spamhaus + spamcop
  });

  it('DoH 整体失败时 rdnsError 有值', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 500 })) as unknown as typeof fetch);
    const { data } = await dohAdapter.run(makeCtx());
    expect(data.node?.rdnsError).toBeTruthy();
  });
});

describe('bgptools 适配器', () => {
  it('无 ASN 时不发请求', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const { data } = await bgptoolsAdapter.run(makeCtx());
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(data).toEqual({});
  });

  it('有 ASN 时映射 AS 详情', async () => {
    vi.stubGlobal('fetch', mockFetch({
      'bgp.tools': { asn: 15169, name: 'GOOGLE', descr: 'Google LLC', country: 'US', org: 'Google LLC' },
    }));
    const merged = emptyIpInfo('8.8.8.8', 4, 'public', 21600);
    merged.network.asn = 15169;
    const { data } = await bgptoolsAdapter.run(makeCtx({ merged }));
    expect(data.network?.asName).toBe('GOOGLE');
    expect(data.network?.org).toBe('Google LLC');
    expect(data.network?.asCountry).toBe('US');
  });
});

describe('可选适配器', () => {
  it('ipinfo 无 secret 时不注册', () => {
    const adapters = buildAdapters(env as unknown as AdapterCtx['env']);
    expect(adapters.find((a) => a.id === 'ipinfo')).toBeUndefined();
    expect(adapters.find((a) => a.id === 'abuseipdb')).toBeUndefined();
  });

  it('ipinfo 有 token 时映射', async () => {
    vi.stubGlobal('fetch', mockFetch({
      'ipinfo.io': {
        city: 'Mountain View', region: 'California', country: 'US', loc: '37.386,-122.0838',
        org: 'AS15169 Google LLC', timezone: 'America/Los_Angeles', anycast: true, hostname: 'dns.google',
        privacy: { vpn: false, proxy: false, tor: false, hosting: true },
      },
    }));
    const { data } = await ipinfoAdapter.run(makeCtx({ env: { ...(env as object), IPINFO_TOKEN: 'tok' } as unknown as AdapterCtx['env'] }));
    expect(data.network?.asn).toBe(15169);
    expect(data.network?.org).toBe('Google LLC');
    expect(data.location?.latitude).toBe(37.386);
    expect(data.node?.anycast).toEqual({ value: true, confidence: 'medium', source: 'ipinfo' });
    expect(data.reputation?.proxy?.isVpn).toBe(false);
  });

  it('abuseipdb 映射信誉分', async () => {
    vi.stubGlobal('fetch', mockFetch({
      'abuseipdb': { data: { abuseConfidenceScore: 42, totalReports: 7 } },
    }));
    const { data } = await abuseipdbAdapter.run(makeCtx({ env: { ...(env as object), ABUSEIPDB_KEY: 'k' } as unknown as AdapterCtx['env'] }));
    expect(data.reputation?.abuseScore).toBe(42);
    expect(data.reputation?.abuseReports).toBe(7);
  });
});

describe('ip2region 适配器（注入合成数据）', () => {
  it('命中中文省市区与运营商', async () => {
    __setXdbBytesSourceForTest(async () => buildSyntheticXdb());
    const { data } = await ip2regionAdapter.run(makeCtx({ ip: '1.2.3.4' }));
    expect(data.location).toMatchObject({ country: '中国', region: '测试省', city: '测试市' });
    expect(data.node?.provider).toBe('测试运营商');
  });

  it('未命中网段返回空数据', async () => {
    __setXdbBytesSourceForTest(async () => buildSyntheticXdb());
    const { data } = await ip2regionAdapter.run(makeCtx({ ip: '9.9.9.9' }));
    expect(data).toEqual({});
  });

  it('IPv6 给出提示性 warning', async () => {
    __setXdbBytesSourceForTest(async (v) => (v === 4 ? buildSyntheticXdb() : null));
    const res = await ip2regionAdapter.run(makeCtx({ ip: '2606:4700::1111' }));
    expect(res.warnings?.join(' ')).toMatch(/IPv6/);
  });

  it('数据源缺失时给出配置提示', async () => {
    __setXdbBytesSourceForTest(async () => null);
    const res = await ip2regionAdapter.run(makeCtx({ ip: '1.2.3.4' }));
    expect(res.warnings?.join(' ')).toMatch(/未配置/);
  });
});

describe('ip2region 适配器（真实资产数据，走 ASSETS 绑定）', () => {
  it('加载 public/data/ip2region_v4.xdb 命中国内 IP', async () => {
    const { data, warnings } = await ip2regionAdapter.run(makeCtx({ ip: '223.5.5.5' }));
    expect(warnings ?? []).toEqual([]);
    expect(data.location?.country).toBe('中国');
    expect(data.location?.region).toBeTruthy();
    expect(data.node?.provider).toBeTruthy();
  });
});

describe('熔断器', () => {
  it('连续失败 3 次后进入跳过窗口', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 500 })) as unknown as typeof fetch);
    const ctx = makeCtx();
    for (let i = 0; i < 3; i++) {
      await runAdapters([ipwhoisAdapter], ctx);
    }
    const outcomes = await runAdapters([ipwhoisAdapter], ctx);
    expect(outcomes[0].ok).toBe(false);
    expect(outcomes[0].error).toMatch(/熔断/);
  });
});
