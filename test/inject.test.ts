import { describe, it, expect } from 'vitest';
import { env, createExecutionContext } from 'cloudflare:test';
import worker from '../src/index';
import type { Env } from '../src/env';
import { injectHeadHtml, renderHtml } from '../src/inject';

/** HTML 出站渲染：<head> 注入 + 站点绝对地址占位符替换 */

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36';
const META = '<meta name="google-site-verification" content="test-token">';

describe('injectHeadHtml（纯函数）', () => {
  it('命中锚点时原地替换，保留缩进', () => {
    const html = '<head>\n  <title>x</title>\n  <!--HEAD_INJECT-->\n</head>';
    const out = injectHeadHtml(html, META);
    expect(out).toBe(`<head>\n  <title>x</title>\n  ${META}\n</head>`);
    expect(out).not.toContain('<!--HEAD_INJECT-->');
  });

  it('锚点大小写/空格容错', () => {
    for (const marker of ['<!-- head-inject -->', '<!--Head Inject-->', '<!--  HEAD_INJECT  -->']) {
      expect(injectHeadHtml(`<head>${marker}</head>`, META)).toBe(`<head>${META}</head>`);
    }
  });

  it('无锚点时插在 </head> 之前', () => {
    const out = injectHeadHtml('<html><head><title>x</title></HEAD><body>b</body></html>', META);
    expect(out).toBe(`<html><head><title>x</title>${META}\n</HEAD><body>b</body></html>`);
  });

  it('缺 </head> 时退回 <body> 之前；两者都缺则原样返回', () => {
    expect(injectHeadHtml('<html><body>b</body></html>', META)).toBe(`<html>${META}\n<body>b</body></html>`);
    expect(injectHeadHtml('plain text', META)).toBe('plain text');
  });

  it('片段为空（含纯空白）时不改动 HTML', () => {
    expect(injectHeadHtml('<head></head>', '')).toBe('<head></head>');
    expect(injectHeadHtml('<head></head>', '  \n\t ')).toBe('<head></head>');
  });

  it('多行片段原样保留', () => {
    const snippet = '<meta name="a" content="1">\n<meta name="b" content="2">';
    expect(injectHeadHtml('<head><!--HEAD_INJECT--></head>', snippet)).toBe(`<head>${snippet}</head>`);
  });
});

describe('renderHtml（纯函数）', () => {
  it('替换全部站点地址占位符', () => {
    const html = '<link rel="canonical" href="__SITE_ORIGIN__/">\n{"url":"__SITE_ORIGIN__/"}\n{"@id":"__SITE_ORIGIN__/#org"}';
    const out = renderHtml(html, { origin: 'https://ip.example.com' });
    expect(out).not.toContain('__SITE_ORIGIN__');
    expect(out).toContain('href="https://ip.example.com/"');
    expect(out).toContain('"https://ip.example.com/#org"');
  });

  it('片段内的占位符同样被替换（先注入后替换）', () => {
    const out = renderHtml('<head><!--HEAD_INJECT--></head>', {
      origin: 'https://a.test',
      head: '<meta name="x" content="__SITE_ORIGIN__">',
    });
    expect(out).toBe('<head><meta name="x" content="https://a.test"></head>');
  });

  it('无占位符、无片段时保持原样', () => {
    expect(renderHtml('<head></head>', { origin: 'https://a.test' })).toBe('<head></head>');
  });
});

describe('Worker 侧渲染（集成）', () => {
  const withEnv = (over: Partial<Env>): Env => ({
    ASSETS: (env as unknown as Env).ASSETS,
    ...over,
  }) as unknown as Env;

  const get = async (path: string, over: Partial<Env> = {}, headers: Record<string, string> = {}) => {
    const ctx = createExecutionContext();
    return worker.fetch(
      new Request(`https://cfip.test${path}`, { headers: { 'user-agent': BROWSER_UA, ...headers } }),
      withEnv(over),
      ctx,
    );
  };

  it('返回的 HTML 已把占位符替换成请求 origin', async () => {
    const html = await (await get('/')).text();
    expect(html).not.toContain('__SITE_ORIGIN__');
    expect(html).toContain('<link rel="canonical" href="https://cfip.test/">');
    expect(html).toContain('content="https://cfip.test/assets/og.png"');
  });

  it('SITE_URL 优先于请求 origin（固定主域名，避免重复内容）', async () => {
    const html = await (await get('/', { SITE_URL: 'https://ip.example.com/' })).text();
    expect(html).toContain('href="https://ip.example.com/"');
    expect(html).not.toContain('cfip.test/assets/og.png');
  });

  it('配置 HEAD_INJECT 后 meta 出现，且锚点被替换', async () => {
    const res = await get('/', { HEAD_INJECT: META });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const html = await res.text();
    expect(html).toContain(META);
    expect(html).not.toContain('<!--HEAD_INJECT-->');
    expect(res.headers.get('etag')).toBeTruthy();
    expect(res.headers.get('content-length')).toBeNull();
  });

  it('未配置 HEAD_INJECT 时锚点保留在 HTML 里', async () => {
    const html = await (await get('/', { HEAD_INJECT: '' })).text();
    expect(html).toContain('<!--HEAD_INJECT-->');
    expect(html).not.toContain('google-site-verification');
  });

  it('ETag 协商：同片段命中 304，改片段则重新 200', async () => {
    const first = await get('/', { HEAD_INJECT: META });
    const etag = first.headers.get('etag')!;
    const hit = await get('/', { HEAD_INJECT: META }, { 'if-none-match': etag });
    expect(hit.status).toBe(304);
    expect(await hit.text()).toBe('');

    const changed = await get('/', { HEAD_INJECT: META.replace('test-token', 'other') }, { 'if-none-match': etag });
    expect(changed.status).toBe(200);
  });

  it('JSON / 文本端点不受渲染影响', async () => {
    const api = await get('/ip?ip=8.8.8.8', { HEAD_INJECT: META });
    expect(await api.text()).not.toContain('google-site-verification');
  });
});
