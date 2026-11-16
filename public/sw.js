/**
 * CFIP Service Worker：离线壳 + 静态资源 stale-while-revalidate。
 *
 * 策略：
 *   - 导航请求（HTML）network-first：保证 HEAD_INJECT / 站点地址等动态渲染总是最新，离线时回落缓存
 *   - 同源静态资源 stale-while-revalidate：先给缓存，后台更新（部署后第二次访问即生效）
 *   - /api、/ip 直接放行，不进缓存
 */

const VERSION = 'cfip-shell-v1';

const SHELL = [
  '/',
  '/favicon.svg',
  '/assets/style.css',
  '/assets/app.js',
  '/assets/render.js',
  '/assets/calc.js',
  '/assets/diag.js',
  '/assets/labs.js',
  '/assets/site-config.js',
  '/assets/site-plugins.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION)
      .then((cache) => cache.addAll(SHELL).catch(() => undefined))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function offlineResponse() {
  return new Response('离线状态：该内容未缓存。', {
    status: 503,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api') || url.pathname === '/ip') return;

  // 导航：网络优先，离线回落缓存首页
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put('/', copy)).catch(() => undefined);
          return res;
        })
        .catch(() => caches.match('/').then((hit) => hit ?? offlineResponse())),
    );
    return;
  }

  // 静态资源：stale-while-revalidate
  event.respondWith(
    caches.match(req).then((hit) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(VERSION).then((c) => c.put(req, copy)).catch(() => undefined);
          }
          return res;
        })
        .catch(() => hit ?? offlineResponse());
      return hit ?? network;
    }),
  );
});
