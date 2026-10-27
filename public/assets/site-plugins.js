/**
 * CFIP 统计与广告插件：按 site-config.js（或 /api/site-config 的环境变量覆盖）
 * 动态注入第三方脚本。全部留空时零外部请求，一个字节都不加载。
 */

import { siteConfig } from './site-config.js';
import { esc } from './render.js';

const CONFIG_ENDPOINT = '/api/site-config';
const CONFIG_TIMEOUT_MS = 1500;

/** 远端（Workers 变量）非空值覆盖本地配置 */
function pick(remote, local) {
  const v = typeof remote === 'string' ? remote.trim() : '';
  return v || local || '';
}

function mergeConfig(local, remote) {
  if (!remote) return local;
  const r = remote.analytics ?? {};
  const a = remote.adsense ?? {};
  const rs = a.slots ?? {};
  return {
    analytics: {
      ga4: pick(r.ga4, local.analytics.ga4),
      bing: pick(r.bing, local.analytics.bing),
      baidu: pick(r.baidu, local.analytics.baidu),
      cloudflare: pick(r.cloudflare, local.analytics.cloudflare),
    },
    adsense: {
      client: pick(a.client, local.adsense.client),
      slots: {
        afterResult: pick(rs.afterResult, local.adsense.slots.afterResult),
        beforeFooter: pick(rs.beforeFooter, local.adsense.slots.beforeFooter),
      },
    },
  };
}

/** 读取 Worker 侧配置（超时/失败静默回落到本地文件） */
async function fetchRemoteConfig() {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), CONFIG_TIMEOUT_MS);
    const res = await fetch(CONFIG_ENDPOINT, {
      signal: ctrl.signal,
      headers: { accept: 'application/json' },
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function injectScript(src, attrs = {}) {
  const s = document.createElement('script');
  s.async = true;
  s.src = src;
  for (const [k, v] of Object.entries(attrs)) s.setAttribute(k, v);
  document.head.appendChild(s);
  return s;
}

/* —— 统计 —— */
function initAnalytics(a) {
  if (a.ga4) {
    injectScript(`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(a.ga4)}`);
    window.dataLayer = window.dataLayer || [];
    window.gtag = function gtag() { window.dataLayer.push(arguments); };
    window.gtag('js', new Date());
    window.gtag('config', a.ga4);
  }

  if (a.bing) {
    // Bing UET 官方片段（Spa 追踪开启，查询是前端行为，不会产生额外 PV）
    (function (w, d, t, r, u) {
      let f; let n; let i;
      w[u] = w[u] || [];
      f = function () {
        const o = { ti: a.bing, enableAutoSpaTracking: true };
        o.q = w[u];
        w[u] = new UET(o);
        w[u].push('pageLoad');
      };
      n = d.createElement(t);
      n.src = r;
      n.async = 1;
      n.onload = n.onreadystatechange = function () {
        const s = this.readyState;
        if ((s && s !== 'loaded' && s !== 'complete') || f.done) return;
        f.done = true;
        f();
        n.onload = n.onreadystatechange = null;
      };
      i = d.getElementsByTagName(t)[0];
      i.parentNode.insertBefore(n, i);
    })(window, document, 'script', 'https://bat.bing.com/bat.js', 'uetq');
  }

  if (a.baidu) {
    window._hmt = window._hmt || [];
    injectScript(`https://hm.baidu.com/hm.js?${encodeURIComponent(a.baidu)}`);
  }

  if (a.cloudflare) {
    injectScript('https://static.cloudflareinsights.com/beacon.min.js', {
      'data-cf-beacon': JSON.stringify({ token: a.cloudflare }),
    });
  }
}

/* —— 广告 —— */
function initAdsense(ads) {
  if (!ads.client) return;

  injectScript(
    `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(ads.client)}`,
    { crossorigin: 'anonymous' },
  );

  window.adsbygoogle = window.adsbygoogle || [];

  for (const [key, slot] of Object.entries(ads.slots)) {
    if (!slot) continue;
    const el = document.querySelector(`[data-ad-slot="${key}"]`);
    if (!el || el.dataset.filled) continue;
    el.innerHTML =
      `<ins class="adsbygoogle" style="display:block"` +
      ` data-ad-client="${esc(ads.client)}" data-ad-slot="${esc(slot)}"` +
      ` data-ad-format="auto" data-full-width-responsive="true"></ins>`;
    el.hidden = false;
    el.dataset.filled = '1';
    window.adsbygoogle.push({});
  }
}

/** 启用任何插件后，页脚「零外部请求」不再成立，改为更准确的隐私声明 */
function markFooter(active) {
  const note = document.getElementById('footer-note');
  if (note) note.textContent = active ? '统计/广告已启用' : '零外部请求';
}

export async function initSitePlugins() {
  const cfg = mergeConfig(siteConfig, await fetchRemoteConfig());
  const active =
    Object.values(cfg.analytics).some(Boolean) || !!cfg.adsense.client;

  try {
    initAnalytics(cfg.analytics);
    initAdsense(cfg.adsense);
  } catch {
    /* 第三方脚本异常不影响查询主流程 */
  }
  markFooter(active);
}
