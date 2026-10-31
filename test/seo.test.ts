import { describe, it, expect } from 'vitest';
import { env, createExecutionContext } from 'cloudflare:test';
import worker from '../src/index';
import type { Env } from '../src/env';
import { siteOrigin, robotsTxt, sitemapXml, llmsTxt } from '../src/seo';

/** SEO / GEO 端点：robots.txt、sitemap.xml、llms.txt */

const ORIGIN = 'https://ip.example.com';

describe('siteOrigin', () => {
  const url = new URL('https://cfip.test/robots.txt');

  it('未配置 SITE_URL 时取请求 origin', () => {
    expect(siteOrigin(url, {} as Env)).toBe('https://cfip.test');
  });

  it('SITE_URL 去尾部斜杠、缺协议时补 https', () => {
    expect(siteOrigin(url, { SITE_URL: 'https://a.test/' } as Env)).toBe('https://a.test');
    expect(siteOrigin(url, { SITE_URL: 'a.test' } as Env)).toBe('https://a.test');
    expect(siteOrigin(url, { SITE_URL: '  http://b.test//  ' } as Env)).toBe('http://b.test');
    expect(siteOrigin(url, { SITE_URL: '   ' } as Env)).toBe('https://cfip.test');
  });
});

describe('robots.txt', () => {
  const txt = robotsTxt(ORIGIN);

  it('声明 sitemap 绝对地址', () => {
    expect(txt).toContain(`Sitemap: ${ORIGIN}/sitemap.xml`);
  });

  it('默认放行页面、屏蔽接口', () => {
    expect(txt).toContain('User-agent: *');
    expect(txt).toContain('Disallow: /api/');
    expect(txt).toContain('Disallow: /ip');
  });

  it('显式放行主流生成式引擎爬虫（GEO）', () => {
    for (const ua of ['GPTBot', 'OAI-SearchBot', 'ClaudeBot', 'PerplexityBot', 'Google-Extended', 'CCBot']) {
      expect(txt).toContain(`User-agent: ${ua}`);
    }
    // 多个 User-agent 行共享一个规则组：AI 组同样屏蔽接口
    const aiGroup = txt.split('# —— 生成式引擎（GEO）：显式允许抓取与引用 ——')[1];
    expect(aiGroup).toContain('Allow: /');
    expect(aiGroup).toContain('Disallow: /api/');
  });
});

describe('sitemap.xml', () => {
  const xml = sitemapXml(ORIGIN);

  it('是合法结构的最小 sitemap', () => {
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(xml).toContain(`<loc>${ORIGIN}/</loc>`);
    expect(xml.trimEnd().endsWith('</urlset>')).toBe(true);
    // 只有一个首页 URL（工具站单页）
    expect(xml.match(/<url>/g)?.length).toBe(1);
  });
});

describe('llms.txt', () => {
  const md = llmsTxt(ORIGIN);

  it('含 H1 标题与摘要引用块（llms.txt 规范）', () => {
    expect(md.startsWith('# CFIP')).toBe(true);
    expect(md).toContain('\n> ');
  });

  it('列出各接口的绝对地址', () => {
    for (const p of ['/api', '/ip', '/api/probe', '/api/domain', '/api/ping', '/api/status']) {
      expect(md).toContain(`${ORIGIN}${p}`);
    }
  });
});

describe('端点集成（Worker）', () => {
  const call = async (path: string, over: Partial<Env> = {}) => {
    const ctx = createExecutionContext();
    return worker.fetch(
      new Request(`https://cfip.test${path}`),
      { ASSETS: (env as unknown as Env).ASSETS, ...over } as unknown as Env,
      ctx,
    );
  };

  it('GET /robots.txt → text/plain，Sitemap 用请求域名', async () => {
    const res = await call('/robots.txt');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/plain');
    expect(res.headers.get('cache-control')).toContain('max-age=3600');
    expect(await res.text()).toContain('Sitemap: https://cfip.test/sitemap.xml');
  });

  it('GET /sitemap.xml → application/xml', async () => {
    const res = await call('/sitemap.xml');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/xml');
    expect(await res.text()).toContain('<loc>https://cfip.test/</loc>');
  });

  it('GET /llms.txt → text/plain', async () => {
    const res = await call('/llms.txt');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('# CFIP');
  });

  it('SITE_URL 统一覆盖三个端点的域名', async () => {
    const robots = await (await call('/robots.txt', { SITE_URL: ORIGIN })).text();
    const sitemap = await (await call('/sitemap.xml', { SITE_URL: ORIGIN })).text();
    const llms = await (await call('/llms.txt', { SITE_URL: ORIGIN })).text();
    for (const body of [robots, sitemap, llms]) expect(body).toContain(ORIGIN);
    for (const body of [robots, sitemap, llms]) expect(body).not.toContain('cfip.test');
  });
});
