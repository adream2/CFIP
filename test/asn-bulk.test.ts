import { describe, it, expect, vi, afterEach } from 'vitest';
import { SELF } from 'cloudflare:test';
import { parseAsn, runAsnReport } from '../src/tools/asn';
import { parseIpList, runBulk, readBodyLimited, BULK_LIMIT } from '../src/tools/bulk';
import { speedBytesOf, SPEED_MAX_BYTES, SPEED_DEFAULT_BYTES } from '../src/tools/speed';

afterEach(() => {
  vi.unstubAllGlobals();
});

function mockFetch(routes: Record<string, { body?: unknown; status?: number }>): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    for (const [pattern, r] of Object.entries(routes)) {
      if (url.includes(pattern)) {
        return new Response(JSON.stringify(r.body ?? {}), {
          status: r.status ?? 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }
    return new Response('not found', { status: 404 });
  }) as unknown as typeof fetch;
}

describe('asn：解析', () => {
  it('接受 AS 前缀与裸数字', () => {
    expect(parseAsn('AS13335')).toBe(13335);
    expect(parseAsn('as13335')).toBe(13335);
    expect(parseAsn(' 13335 ')).toBe(13335);
  });

  it('拒绝非法输入', () => {
    expect(parseAsn('')).toBeNull();
    expect(parseAsn('AS')).toBeNull();
    expect(parseAsn('AS0')).toBeNull();
    expect(parseAsn('13335.5')).toBeNull();
    expect(parseAsn('99999999999999')).toBeNull();
    expect(parseAsn(null)).toBeNull();
  });
});

describe('asn：RIPEstat 聚合', () => {
  it('汇总 holder / 邻居排序 / 前缀样本', async () => {
    vi.stubGlobal('fetch', mockFetch({
      'as-overview': { body: { data: { holder: 'CLOUDFLARENET', announced: true } } },
      'asn-neighbours': {
        body: {
          data: {
            neighbours: [
              { asn: 174, type: 'left', power: 10 },
              { asn: 3356, type: 'left', power: 99 },
              { asn: 13335, type: 'right', power: 5 },
              { asn: 65000, type: 'uncertain', power: 1 },
            ],
          },
        },
      },
      'announced-prefixes': { body: { data: { prefixes: [{ prefix: '1.1.1.0/24' }, { prefix: '1.0.0.0/24' }] } } },
    }));
    const r = await runAsnReport(fetch, 13335);
    expect(r.holder).toBe('CLOUDFLARENET');
    expect(r.announced).toBe(true);
    expect(r.neighbours.upstream.map((n) => n.asn)).toEqual([3356, 174]);
    expect(r.neighbours.downstream.map((n) => n.asn)).toEqual([13335]);
    expect(r.neighbours.uncertainCount).toBe(1);
    expect(r.prefixes.count).toBe(2);
    expect(r.provider?.name).toBe('Cloudflare');
  });

  it('单个数据集失败不影响整体，warnings 记录原因', async () => {
    vi.stubGlobal('fetch', mockFetch({
      'as-overview': { body: { data: { holder: 'TEST' } } },
      'asn-neighbours': { status: 503 },
      'announced-prefixes': { body: { data: { prefixes: [] } } },
    }));
    const r = await runAsnReport(fetch, 64512);
    expect(r.holder).toBe('TEST');
    expect(r.neighbours.upstream).toEqual([]);
    expect(r.warnings.join(' ')).toMatch(/邻居信息获取失败/);
  });
});

describe('bulk：IP 列表解析', () => {
  it('多种分隔符 + 去重 + 规范化', () => {
    const { ips, invalid } = parseIpList('1.1.1.1, 8.8.8.8\n2001:0db8::1 1.1.1.1');
    expect(ips).toEqual(['1.1.1.1', '8.8.8.8', '2001:db8::1']);
    expect(invalid).toEqual([]);
  });

  it('无效项单独返回，数量上限生效', () => {
    const { ips, invalid } = parseIpList('not-an-ip 1.1.1.1');
    expect(invalid).toEqual(['not-an-ip']);
    expect(ips).toEqual(['1.1.1.1']);

    const many = Array.from({ length: BULK_LIMIT + 5 }, (_, i) => `1.1.1.${i}`).join(' ');
    expect(parseIpList(many).ips).toHaveLength(BULK_LIMIT);
  });
});

describe('bulk：并发查询', () => {
  it('保持输入顺序、非公网短路', async () => {
    vi.stubGlobal('fetch', mockFetch({
      'ipwho.is/1.1.1.1': { body: { success: true, country: 'Australia', country_code: 'AU', city: 'Sydney', connection: { asn: 13335, org: 'Cloudflare' }, timezone: { id: 'Australia/Sydney' } } },
      'ipwho.is/8.8.8.8': { body: { success: true, country: 'United States', country_code: 'US', connection: { asn: 15169, org: 'Google' } } },
    }));
    const r = await runBulk(fetch, ['8.8.8.8', '192.168.1.1', '1.1.1.1']);
    expect(r.rows.map((x) => x.ip)).toEqual(['8.8.8.8', '192.168.1.1', '1.1.1.1']);
    expect(r.rows[0]).toMatchObject({ ok: true, country: 'United States', asn: 15169 });
    expect(r.rows[1].ok).toBe(false);
    expect(r.rows[1].error).toMatch(/非公网/);
    expect(r.rows[2]).toMatchObject({ ok: true, city: 'Sydney', timezone: 'Australia/Sydney' });
  });

  it('上游失败时逐行报错', async () => {
    vi.stubGlobal('fetch', mockFetch({ 'ipwho.is/1.1.1.1': { status: 429 } }));
    const r = await runBulk(fetch, ['1.1.1.1']);
    expect(r.rows[0].ok).toBe(false);
    expect(r.rows[0].error).toMatch(/429/);
  });
});

describe('bulk：请求体限长', () => {
  it('readBodyLimited 正常读取与超限拒绝', async () => {
    const ok = new Request('https://x.test/', { method: 'POST', body: 'hello' });
    expect(await readBodyLimited(ok, 64)).toBe('hello');
    const big = new Request('https://x.test/', { method: 'POST', body: 'a'.repeat(200) });
    expect(await readBodyLimited(big, 64)).toBeNull();
  });

  it('POST /api/bulk 超过 8KB 返回 413', async () => {
    const res = await SELF.fetch('https://example.com/api/bulk', { method: 'POST', body: 'a'.repeat(9000) });
    expect(res.status).toBe(413);
  });
});

describe('speed：字节数夹取', () => {
  it('默认值 / 下限 / 上限', () => {
    expect(speedBytesOf(null)).toBe(SPEED_DEFAULT_BYTES);
    expect(speedBytesOf('abc')).toBe(SPEED_DEFAULT_BYTES);
    expect(speedBytesOf('1')).toBe(1024);
    expect(speedBytesOf('999999999')).toBe(SPEED_MAX_BYTES);
  });
});

describe('新端点路由（handler 集成）', () => {
  it('/api/asn 无效 400、有效 200', async () => {
    const bad = await SELF.fetch('https://example.com/api/asn?asn=abc');
    expect(bad.status).toBe(400);

    vi.stubGlobal('fetch', mockFetch({
      'as-overview': { body: { data: { holder: 'TEST-NET', announced: true } } },
      'asn-neighbours': { body: { data: { neighbours: [] } } },
      'announced-prefixes': { body: { data: { prefixes: [] } } },
    }));
    const res = await SELF.fetch('https://example.com/api/asn?asn=AS64512');
    expect(res.status).toBe(200);
    const j = (await res.json()) as { asn: number; holder: string };
    expect(j.asn).toBe(64512);
    expect(j.holder).toBe('TEST-NET');
  });

  it('/api/bulk 缺少参数 400、GET 正常', async () => {
    expect((await SELF.fetch('https://example.com/api/bulk')).status).toBe(400);

    vi.stubGlobal('fetch', mockFetch({
      'ipwho.is/1.1.1.1': { body: { success: true, country: 'Australia', connection: { asn: 13335 } } },
    }));
    const res = await SELF.fetch('https://example.com/api/bulk?ips=1.1.1.1,8.8.8.8');
    expect(res.status).toBe(200);
    const j = (await res.json()) as { rows: Array<{ ip: string; ok: boolean }> };
    expect(j.rows.map((r) => r.ip)).toEqual(['1.1.1.1', '8.8.8.8']);
  });

  it('/api/bulk 支持 POST 文本体', async () => {
    vi.stubGlobal('fetch', mockFetch({
      'ipwho.is/1.1.1.1': { body: { success: true, country: 'Australia', connection: { asn: 13335 } } },
    }));
    const res = await SELF.fetch('https://example.com/api/bulk', { method: 'POST', body: '1.1.1.1' });
    expect(res.status).toBe(200);
    const j = (await res.json()) as { rows: unknown[] };
    expect(j.rows).toHaveLength(1);
  });

  it('/api/speed 下载返回指定字节数', async () => {
    const res = await SELF.fetch('https://example.com/api/speed?bytes=2048');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Length')).toBe('2048');
    expect(res.headers.get('Cache-Control')).toContain('no-store');
    expect((await res.arrayBuffer()).byteLength).toBe(2048);
  });

  it('/api/speed POST 返回接收字节数', async () => {
    const res = await SELF.fetch('https://example.com/api/speed', { method: 'POST', body: 'x'.repeat(4096) });
    expect(res.status).toBe(200);
    const j = (await res.json()) as { received: number };
    expect(j.received).toBe(4096);
  });

  it('/api/speed HEAD 只回头部，不返回字节', async () => {
    const res = await SELF.fetch('https://example.com/api/speed?bytes=4096', { method: 'HEAD' });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Length')).toBe('4096');
    expect((await res.arrayBuffer()).byteLength).toBe(0);
  });

  it('不支持的路径 POST 仍被拒绝', async () => {
    const res = await SELF.fetch('https://example.com/api/status', { method: 'POST' });
    expect(res.status).toBe(405);
  });
});
