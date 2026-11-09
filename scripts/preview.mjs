#!/usr/bin/env node
/**
 * 本地静态预览服务（仅用于看页面效果，不跑 Workers 逻辑）。
 *
 * 为什么需要它：index.html 用绝对路径 /assets/... 引用样式与脚本，
 * 而设计预览页在 design-demos/ 下用 ../public/assets/... 相对引用，
 * 直接 file:// 打开或只服务单个 HTML 都会丢样式。这里用一个根目录
 * 同时覆盖两种路径形态：
 *   /                    → public/index.html
 *   /assets/* /data/*    → public/*
 *   /design-demos/*      → 项目根
 *
 * 用法：npm run preview   （默认 http://127.0.0.1:8099）
 *       PORT=8100 npm run preview
 * 注意：/api 无后端，会返回 404 JSON，页面因此显示“本地预览无后端”。
 */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PUBLIC = join(ROOT, 'public');
const PORT = Number(process.env.PORT ?? 8099);
const HOST = process.env.HOST ?? '127.0.0.1';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.md': 'text/markdown; charset=utf-8',
  '.xdb': 'application/octet-stream',
};

/** 把 URL 路径翻译成候选磁盘文件（按优先级） */
function candidates(pathname) {
  const clean = decodeURIComponent(pathname).replace(/\\/g, '/');
  const rel = normalize(clean).replace(/^[/\\]+/, '').replace(/^\.\.(\/|$)/, '');
  const list = [];

  if (!rel || rel === '.') list.push(join(PUBLIC, 'index.html'));
  else if (/^(assets|data)\//.test(rel) || rel === 'favicon.svg') list.push(join(PUBLIC, rel));

  list.push(join(ROOT, rel), join(PUBLIC, rel));
  return list.filter((f) => resolve(f) === ROOT || resolve(f).startsWith(ROOT + sep));
}

async function findFile(pathname) {
  for (const f of candidates(pathname)) {
    try {
      const s = await stat(f);
      if (s.isFile()) return f;
      if (s.isDirectory()) {
        const idx = join(f, 'index.html');
        if ((await stat(idx)).isFile()) return idx;
      }
    } catch {
      /* 继续下一个候选 */
    }
  }
  return null;
}

const server = createServer(async (req, res) => {
  const { pathname } = new URL(req.url, `http://${req.headers.host ?? HOST}`);

  if (pathname.startsWith('/api')) {
    res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: '本地预览无后端，查询请用 wrangler dev' }));
    return;
  }

  const file = await findFile(pathname);
  if (!file) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(`404: ${pathname}`);
    return;
  }

  try {
    const body = await readFile(file);
    res.writeHead(200, {
      'content-type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    });
    res.end(body);
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(`500: ${e.message}`);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`CFIP 本地预览已启动：`);
  console.log(`  真实页面  http://${HOST}:${PORT}/`);
  console.log(`  样式预览  http://${HOST}:${PORT}/design-demos/demo-e-clay.html`);
  console.log(`  暗色主题  http://${HOST}:${PORT}/design-demos/demo-e-clay.html?theme=dark`);
  console.log(`  Ctrl+C 停止。API 未启动，查询类交互不可用（npm run dev 走 wrangler）。`);
});
