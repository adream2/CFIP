/**
 * HTML 出站渲染：注入 <head> 片段、替换站点绝对地址占位符。
 *
 * 为什么在 Worker 侧改正文而不是纯静态：
 * - 验证类 meta（Google / Bing / 百度站长）必须出现在服务端返回的原始 HTML 中，JS 插入对部分爬虫不可见
 * - canonical / og:url / JSON-LD 需要绝对地址，而部署域名（workers.dev / 自定义域）在构建期未知
 *
 * 开关：HEAD_INJECT 为空时不注入片段；地址占位符则始终替换。
 */

/** index.html 里的落点锚点；命中时原地替换，保留既有缩进 */
const MARKER = /<!--\s*head[-_ ]?inject\s*-->/i;

/** 站点绝对地址占位符（canonical / og:url / JSON-LD） */
const ORIGIN_TOKEN = '__SITE_ORIGIN__';

export interface RenderOptions {
  /** 站点绝对地址，不带尾部斜杠 */
  origin: string;
  /** 注入到 <head> 的原始 HTML 片段，空/未定义 = 不注入 */
  head?: string;
}

/** 纯函数：把片段注入 HTML；找不到任何落点时原样返回（绝不破坏文档） */
export function injectHeadHtml(html: string, snippet: string): string {
  const code = snippet.trim();
  if (!code) return html;

  const marker = MARKER.exec(html);
  if (marker) {
    return html.slice(0, marker.index) + code + html.slice(marker.index + marker[0].length);
  }

  const head = /<\/head\s*>/i.exec(html);
  if (head) return html.slice(0, head.index) + code + '\n' + html.slice(head.index);

  const body = /<body[\s>]/i.exec(html);
  if (body) return html.slice(0, body.index) + code + '\n' + html.slice(body.index);

  return html;
}

/** 纯函数：注入 head 片段 + 替换站点地址占位符 */
export function renderHtml(html: string, opts: RenderOptions): string {
  const out = injectHeadHtml(html, opts.head ?? '');
  return out.includes(ORIGIN_TOKEN) ? out.split(ORIGIN_TOKEN).join(opts.origin) : out;
}

/** FNV-1a 32 位哈希：给渲染后的 HTML 生成稳定 ETag（同步，避免 crypto 异步开销） */
function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/**
 * 对 HTML 响应做渲染。非 200、非 text/html 一律原样返回。
 * 正文变了，压缩/长度/校验相关头全部失效，重新生成 ETag 并支持 304。
 */
export async function withHtmlRender(
  request: Request,
  res: Response,
  opts: RenderOptions,
): Promise<Response> {
  if (res.status !== 200) return res;

  const ct = res.headers.get('content-type') ?? '';
  if (!/text\/html/i.test(ct)) return res;

  // HEAD 无正文可渲染：抹掉与渲染后正文对不上的校验头，避免误导缓存
  if (request.method !== 'GET') {
    const h = new Headers(res.headers);
    for (const k of ['content-length', 'content-encoding', 'etag', 'last-modified']) h.delete(k);
    return new Response(null, { status: res.status, headers: h });
  }

  const html = renderHtml(await res.text(), opts);

  const headers = new Headers(res.headers);
  for (const h of ['content-encoding', 'content-length', 'etag', 'last-modified', 'content-md5']) {
    headers.delete(h);
  }

  const etag = `"${fnv1a(html)}"`;
  const inm = request.headers.get('if-none-match');
  if (inm && inm.split(',').some((t) => t.trim() === etag || t.trim() === '*')) {
    return new Response(null, { status: 304, headers });
  }
  headers.set('etag', etag);
  return new Response(html, { status: res.status, headers });
}
