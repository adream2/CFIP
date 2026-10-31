/**
 * SEO / GEO（生成式引擎优化）端点：robots.txt、sitemap.xml、llms.txt。
 *
 * 都是 Worker 动态生成而非静态文件，因为站点绝对地址取决于部署域名
 * （workers.dev 或自定义域）：优先 env.SITE_URL，其次取请求 origin。
 */

import type { Env } from './env';

/** 站点绝对地址（不带尾部斜杠） */
export function siteOrigin(url: URL, env: Env): string {
  const raw = (env.SITE_URL ?? '').trim();
  if (!raw) return url.origin;
  const s = raw.replace(/\/+$/, '');
  return /^https?:\/\//i.test(s) ? s : `https://${s}`;
}

/** 主流搜索引擎 + 生成式引擎（AI 爬虫）显式放行；接口与纯文本端点不入索引 */
const AI_AGENTS = [
  'GPTBot',
  'OAI-SearchBot',
  'ChatGPT-User',
  'ClaudeBot',
  'Claude-Web',
  'anthropic-ai',
  'PerplexityBot',
  'Perplexity-User',
  'Google-Extended',
  'Applebot-Extended',
  'CCBot',
  'Amazonbot',
  'DuckAssistBot',
  'Meta-ExternalAgent',
  'Bytespider',
];

export function robotsTxt(origin: string): string {
  return [
    '# CFIP — IP 地址详细信息查询',
    '# 页面可自由抓取；/api 与 /ip 返回机器数据，不参与索引。',
    '',
    'User-agent: *',
    'Allow: /',
    'Disallow: /api/',
    'Disallow: /ip',
    '',
    '# —— 生成式引擎（GEO）：显式允许抓取与引用 ——',
    ...AI_AGENTS.map((a) => `User-agent: ${a}`),
    'Allow: /',
    'Disallow: /api/',
    'Disallow: /ip',
    '',
    `Sitemap: ${origin}/sitemap.xml`,
    '',
  ].join('\n');
}

export function sitemapXml(origin: string): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    '  <url>',
    `    <loc>${origin}/</loc>`,
    '    <changefreq>weekly</changefreq>',
    '    <priority>1.0</priority>',
    '  </url>',
    '</urlset>',
    '',
  ].join('\n');
}

/** llms.txt：给 LLM / AI 搜索的站点摘要（Markdown，机器友好） */
export function llmsTxt(origin: string): string {
  return `# CFIP

> 免费的 IP 地址详细信息查询工具：输入 IPv4 / IPv6，一次返回归属地（国家/省/市/邮编/经纬度/时区）、
> 运营商、ASN、节点归属（云厂商 / CDN / Anycast）、反向解析、DNSBL 黑名单、代理/VPN/Tor 识别，
> 并附带出口探测、域名工具箱、全球 Ping 与免费 JSON API。默认数据源均无需 API Key。

## 能查什么

- 归属地：国家、省/州、城市、区县、邮编、经纬度、时区（多源聚合 + 多源位置对比）
- 网络：ASN、ISP / ORG、网段 CIDR、RIR、注册局滥用邮箱（RDAP）
- 节点归属：云厂商 / CDN 识别、托管 vs 住宅（带置信度与来源）、Anycast 推断
- 信誉：5 个 DNSBL 黑名单逐列表结果、代理 / VPN / Tor 判定
- 连接层（仅查询自身 IP 时）：HTTP 协议、TLS 版本与套件、TCP RTT、边缘节点 colo

## 接口

- [完整 JSON](${origin}/api)：GET /api?ip=8.8.8.8，CORS 全开，meta 中含各数据源状态与耗时
- [纯文本 IP](${origin}/ip)：GET /ip，脚本友好，留空返回请求方自身 IP
- [出口探测](${origin}/api/probe)：各 AI / 云服务视角下的出口 IP 与可达性
- [域名工具箱](${origin}/api/domain?domain=github.com)：DoH 解析 + CDN 识别 + RDAP WHOIS
- [全球 Ping](${origin}/api/ping?target=1.1.1.1&type=ping)：Globalping 分布式探针测量
- [服务状态](${origin}/api/status)：Cloudflare / GitHub / OpenAI / Anthropic 状态聚合

## 使用说明

- 结果按 IP 缓存最长 6 小时（Cache API），复用未命中时实时聚合
- 不记录查询日志、不建查询数据库
- 商业使用请注意 ip-api.com 免费档限制，可关闭该降级源

## 常见问题

- 归属地精度：城市级为行业常态；移动网络 / CGNAT / 代理会使注册地与使用者位置不一致
- IPv6：完全支持；离线中文库 ip2region 仅含 IPv4，IPv6 由在线源覆盖

## Optional

- [GitHub 仓库](https://github.com/adream2/CFIP)
- [ZT折腾簿](https://www.ztsite.com)
`;
}
