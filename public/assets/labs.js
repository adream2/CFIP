/** CFIP 实验台（labs）：连通性检测 / WebRTC 泄漏 / 浏览器指纹 / 测速 / ASN / 批量查询。
 *  纯逻辑在 diag.js（可单测），这里只做 DOM 采集与渲染。 */

import { esc } from './render.js';
import {
  SITE_GROUPS,
  minOf,
  mbps,
  parseUa,
  classifyCandidate,
  summarizeConnectivity,
  fingerprintDigest,
} from './diag.js';

const $ = (sel) => document.querySelector(sel);

function bodyOf(sel) {
  const el = $(sel);
  if (el) el.hidden = false;
  return el;
}

/* ===== 连通性检测 ===== */

async function probeSite(site, rounds = 2) {
  const times = [];
  for (let i = 0; i < rounds; i++) {
    const t0 = performance.now();
    try {
      const sep = site.url.includes('?') ? '&' : '?';
      await fetch(`${site.url}${sep}cfip=${Math.random().toString(36).slice(2)}`, {
        mode: 'no-cors',
        cache: 'no-store',
        redirect: 'follow',
        signal: AbortSignal.timeout(8000),
      });
      times.push(performance.now() - t0);
    } catch {
      // 超时 / DNS 失败 / 被拦截：本轮不计入
    }
  }
  return times;
}

export async function runConnectivity(el, groups) {
  const wanted = new Set(groups);
  const sites = SITE_GROUPS
    .filter((g) => wanted.has(g.id))
    .flatMap((g) => g.sites.map((s) => ({ ...s, group: g.id, groupLabel: g.label })));
  if (!sites.length) return;

  el.hidden = false;
  el.innerHTML = `<p class="status live" style="text-align:left">检测中… 0 / ${sites.length}</p>`;
  const progress = el.querySelector('.status.live');
  const results = new Array(sites.length);
  let done = 0;
  let next = 0;

  const worker = async () => {
    while (next < sites.length) {
      const i = next++;
      const site = sites[i];
      const times = await probeSite(site);
      const ms = minOf(times);
      results[i] = {
        name: site.name,
        url: site.url,
        group: site.group,
        groupLabel: site.groupLabel,
        ok: ms != null,
        ms: ms != null ? Math.round(ms) : null,
      };
      done++;
      if (progress) progress.textContent = `检测中… ${done} / ${sites.length}`;
    }
  };

  await Promise.all(Array.from({ length: Math.min(6, sites.length) }, worker));

  const sum = summarizeConnectivity(results);
  const tone = sum.reachable === sum.total ? 'ok' : sum.reachable === 0 ? 'bad' : 'warn';
  const head = sum.offline
    ? '<span class="pill bad">全部不可达</span> 当前网络可能无法访问所选站点，或有全局代理 / 防火墙拦截'
    : `<span class="pill ${tone}">${sum.reachable} / ${sum.total} 可达</span> ${
      sum.fastest ? `最快 ${esc(sum.fastest)}` : ''
    }${sum.slowest && sum.slowest !== sum.fastest ? ` · 最慢 ${esc(sum.slowest)}` : ''}`;

  const rows = [...results].sort((a, b) => (a.ok === b.ok ? (a.ms ?? 9e9) - (b.ms ?? 9e9) : a.ok ? -1 : 1));
  el.innerHTML = `
    <p class="status" style="text-align:left;margin:0 0 8px">${head}</p>
    <table class="meta-table">
      <thead><tr><th>站点</th><th>分组</th><th>最小延迟</th><th>状态</th></tr></thead>
      <tbody>${rows.map((r) => `
        <tr>
          <td><a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.name)}</a></td>
          <td class="reason">${esc(r.groupLabel)}</td>
          <td class="mono">${r.ms != null ? `${r.ms} ms` : '—'}</td>
          <td>${r.ok ? '<span class="pill ok">可达</span>' : '<span class="pill bad">不可达</span>'}</td>
        </tr>`).join('')}</tbody>
    </table>
    <p class="hint">no-cors 探测只验证连通性（能否握手），不代表页面内容可正常使用；两轮取最小值以降低抖动。</p>`;
}

/* ===== WebRTC 泄漏 ===== */

export function runWebrtc(el) {
  el.hidden = false;
  if (typeof RTCPeerConnection === 'undefined') {
    el.innerHTML = '<p class="status error" style="text-align:left">当前浏览器不支持 WebRTC</p>';
    return;
  }
  el.innerHTML = '<p class="status live" style="text-align:left">正在收集 ICE candidate…（最多 6 秒）</p>';

  const seen = new Map();
  let done = false;
  const pc = new RTCPeerConnection({
    iceServers: [
      { urls: 'stun:stun.cloudflare.com:3478' },
      { urls: 'stun:stun.l.google.com:19302' },
    ],
  });

  const finish = () => {
    if (done) return;
    done = true;
    try { pc.close(); } catch { /* 忽略 */ }
    render(seen);
  };
  const timer = setTimeout(finish, 6000);

  pc.onicecandidate = (e) => {
    if (!e.candidate) {
      clearTimeout(timer);
      finish();
      return;
    }
    const c = classifyCandidate(e.candidate.candidate);
    if (c) seen.set(`${c.type}:${c.address}`, c);
  };

  pc.createDataChannel('cfip');
  pc.createOffer()
    .then((offer) => pc.setLocalDescription(offer))
    .catch(() => {
      clearTimeout(timer);
      el.innerHTML = '<p class="status error" style="text-align:left">创建 WebRTC 会话失败（可能被浏览器策略禁用）</p>';
    });

  function render(map) {
    const all = [...map.values()];
    const srflx = all.filter((c) => c.type === 'srflx');
    const host = all.filter((c) => c.type === 'host');
    const relay = all.filter((c) => c.type === 'relay');
    const pageIp = ($('#kpi-ip')?.textContent ?? '').trim();
    const pageIpOk = /^[0-9a-fA-F:.]+$/.test(pageIp) && pageIp !== '—';
    const publicIps = [...new Set(srflx.map((c) => c.address))];
    const exposed = pageIpOk ? publicIps.filter((ip) => ip !== pageIp) : [];

    let verdict;
    if (publicIps.length === 0 && host.length > 0 && host.every((c) => c.mdns)) {
      verdict = '<span class="pill ok">未泄漏公网 IP</span> 仅返回 mDNS 混淆地址，浏览器隐私保护生效';
    } else if (publicIps.length === 0) {
      verdict = '<span class="pill warn">未取到公网 IP</span> STUN 可能被拦截，或仅有内网候选';
    } else if (exposed.length > 0 && pageIpOk) {
      verdict = `<span class="pill bad">发现 IP 差异</span> WebRTC 暴露的 ${esc(exposed.join(', '))} 与页面出口 ${esc(pageIp)} 不同，代理可能未覆盖 WebRTC`;
    } else if (pageIpOk) {
      verdict = `<span class="pill ok">与页面出口一致</span> WebRTC 出口 ${esc(publicIps.join(', '))}`;
    } else {
      verdict = `<span class="pill warn">暴露公网 IP</span> ${esc(publicIps.join(', '))}（当前页面无查询结果，未与出口比对）`;
    }

    const rows = all.map((c) => `
      <tr>
        <td class="mono">${esc(c.type)}</td>
        <td class="mono">${esc(c.address)}</td>
        <td>${c.mdns ? '<span class="pill ok">mDNS 混淆</span>' : c.private ? '<span class="pill warn">内网地址</span>' : '<span class="pill bad">公网地址</span>'}</td>
        <td class="mono">${esc(c.protocol ?? '—')}</td>
      </tr>`).join('');

    el.innerHTML = `
      <p class="status" style="text-align:left;margin:0 0 8px">${verdict}</p>
      ${all.length ? `<table class="meta-table">
        <thead><tr><th>类型</th><th>地址</th><th>判定</th><th>协议</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>` : '<p class="hint">未收集到任何 candidate（可能全部被浏览器策略拦截）</p>'}
      <p class="hint">srflx = 经 STUN 反射出的公网地址；host = 本机地址（现代浏览器会以 mDNS 保护）；relay = TURN 中继。${relay.length ? '' : ' 未配置 TURN，仅测 STUN 视角。'}</p>`;
  }
}

/* ===== 浏览器指纹 ===== */

function canvasSignature() {
  try {
    const c = document.createElement('canvas');
    c.width = 240;
    c.height = 60;
    const ctx = c.getContext('2d');
    if (!ctx) return 'no-2d';
    const g = ctx.createLinearGradient(0, 0, 240, 60);
    g.addColorStop(0, '#0f766e');
    g.addColorStop(1, '#2dd4bf');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 240, 60);
    ctx.font = '16px "Arial"';
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillText('CFIP 指纹 🛠️ 0123456789', 8, 26);
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.arc(190, 40, 14, 0, Math.PI * 2);
    ctx.stroke();
    return c.toDataURL();
  } catch {
    return 'error';
  }
}

function webglInfo() {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl') ?? c.getContext('experimental-webgl');
    if (!gl) return { vendor: 'n/a', renderer: 'n/a' };
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      vendor: ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
      renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    };
  } catch {
    return { vendor: 'error', renderer: 'error' };
  }
}

function detectFonts() {
  const base = ['monospace', 'sans-serif', 'serif'];
  const candidates = [
    'Arial', 'Helvetica', 'Times New Roman', 'Courier New', 'Georgia', 'Verdana', 'Tahoma',
    'Trebuchet MS', 'Impact', 'Comic Sans MS', 'Consolas', 'Calibri', 'Cambria', 'Segoe UI',
    'Microsoft YaHei', 'SimSun', 'SimHei', 'PingFang SC', 'Hiragino Sans GB', 'Noto Sans SC',
    'DingTalk JinBuTi', 'Menlo', 'Monaco', 'Ubuntu', 'Roboto', 'SF Pro Text',
  ];
  const span = document.createElement('span');
  span.style.cssText = 'position:absolute;left:-9999px;top:0;font-size:72px;visibility:hidden;white-space:nowrap';
  span.textContent = 'mmmmmmmmmmlli中文测试';
  document.body.appendChild(span);
  try {
    const widths = {};
    for (const b of base) {
      span.style.fontFamily = b;
      widths[b] = span.offsetWidth;
    }
    const found = [];
    for (const f of candidates) {
      const hit = base.some((b) => {
        span.style.fontFamily = `"${f}",${b}`;
        return span.offsetWidth !== widths[b];
      });
      if (hit) found.push(f);
    }
    return found;
  } finally {
    span.remove();
  }
}

async function audioSignature() {
  const Ctx = window.OfflineAudioContext ?? window.webkitOfflineAudioContext;
  if (!Ctx) return 'n/a';
  const ctx = new Ctx(1, 44100, 44100);
  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  osc.frequency.value = 10000;
  const comp = ctx.createDynamicsCompressor();
  osc.connect(comp);
  comp.connect(ctx.destination);
  osc.start(0);
  const buf = await ctx.startRendering();
  const data = buf.getChannelData(0);
  let sum = 0;
  for (let i = 4500; i < 5000; i++) sum += Math.abs(data[i]);
  return sum.toFixed(6);
}

export async function runFingerprint(el) {
  el.hidden = false;
  el.innerHTML = '<p class="status live" style="text-align:left">采集中…（Canvas / WebGL / 字体 / 音频）</p>';

  const gl = webglInfo();
  const parts = {
    ua: navigator.userAgent,
    platform: navigator.platform ?? '',
    languages: (navigator.languages ?? [navigator.language]).join(','),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? '',
    screen: `${screen.width}x${screen.height}x${screen.colorDepth}@${window.devicePixelRatio}`,
    cores: String(navigator.hardwareConcurrency ?? '?'),
    memory: String(navigator.deviceMemory ?? '?'),
    touch: String(navigator.maxTouchPoints ?? 0),
    dnt: String(navigator.doNotTrack ?? ''),
    canvas: canvasSignature(),
    webgl: `${gl.vendor} / ${gl.renderer}`,
    fonts: detectFonts().join(','),
  };
  try {
    parts.audio = await audioSignature();
  } catch {
    parts.audio = 'n/a';
  }

  const digest = fingerprintDigest(parts);
  const ua = parseUa(parts.ua);
  const fonts = parts.fonts ? parts.fonts.split(',') : [];
  const rows = [
    ['浏览器', `${ua.browser}${ua.version ? ` ${ua.version}` : ''}`],
    ['系统', `${ua.os}${ua.mobile ? '（移动端）' : ''}`],
    ['语言', parts.languages],
    ['时区', parts.timezone],
    ['屏幕', parts.screen],
    ['CPU 核心', parts.cores],
    ['内存(GB)', parts.memory],
    ['触控点', parts.touch],
    ['Do Not Track', parts.dnt || '未设置'],
    ['WebGL', parts.webgl],
    ['Canvas', fingerprintDigest({ c: parts.canvas })],
    ['音频', parts.audio],
    ['字体', fonts.length ? `${fonts.length} 个：${fonts.slice(0, 8).join(' · ')}${fonts.length > 8 ? ' …' : ''}` : '未探测到'],
  ].map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('');

  el.innerHTML = `
    <p class="status" style="text-align:left;margin:0 0 8px">
      <span class="pill">指纹 ${esc(digest)}</span>
      同一浏览器 / 设备组合通常稳定；升级浏览器、换字体或显卡驱动都会改变它
    </p>
    <dl class="kv kv-compact">${rows}</dl>
    <p class="hint">全部在本地计算，不上传任何字段。指纹用于说明「去 Cookie 后仍可被识别」的程度。</p>`;
}

/* ===== 测速 ===== */

async function measureLatency(rounds = 5) {
  const times = [];
  for (let i = 0; i < rounds; i++) {
    const t0 = performance.now();
    try {
      await fetch(`/api/speed?bytes=1024&r=${Math.random()}`, { cache: 'no-store' });
      times.push(performance.now() - t0);
    } catch { /* 忽略单轮失败 */ }
  }
  return times;
}

async function measureDownload(bytes) {
  const t0 = performance.now();
  const res = await fetch(`/api/speed?bytes=${bytes}&r=${Math.random()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const colo = res.headers.get('X-Cfip-Colo');
  const buf = await res.arrayBuffer();
  const ms = performance.now() - t0;
  return { ms, bytes: buf.byteLength, mbps: mbps(buf.byteLength, ms), colo };
}

async function measureUpload(bytes) {
  const blob = new Blob([new Uint8Array(bytes)]);
  const t0 = performance.now();
  const res = await fetch(`/api/speed?r=${Math.random()}`, {
    method: 'POST',
    body: blob,
    cache: 'no-store',
    headers: { 'Content-Type': 'application/octet-stream' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  await res.json().catch(() => null);
  const ms = performance.now() - t0;
  return { ms, bytes, mbps: mbps(bytes, ms) };
}

export async function runSpeed(el) {
  el.hidden = false;
  el.innerHTML = '<p class="status live" style="text-align:left">测延迟…</p>';

  const stage = (text) => {
    const node = el.querySelector('.status.live');
    if (node) node.textContent = text;
  };

  let latency = null;
  let dl = [];
  let ul = [];
  let colo = null;
  try {
    latency = minOf(await measureLatency(5));
    stage('测下载…');

    let size = 2 * 1024 * 1024;
    for (let i = 0; i < 3; i++) {
      const r = await measureDownload(size);
      colo = r.colo ?? colo;
      dl.push(r.mbps);
      // 网速很快时自动加码，避免低估
      if (i === 0 && r.ms < 300) size = 8 * 1024 * 1024;
    }

    stage('测上传…');
    for (let i = 0; i < 2; i++) {
      try {
        const r = await measureUpload(1024 * 1024);
        ul.push(r.mbps);
      } catch { /* 上传失败不影响结论 */ }
    }
  } catch (e) {
    el.innerHTML = `<p class="status error" style="text-align:left">测速失败：${esc(e.message ?? '网络错误')}</p>`;
    return;
  }

  const down = Math.max(...dl.filter((n) => n != null), 0);
  const up = ul.length ? Math.max(...ul) : null;
  const fmt = (v) => (v == null ? '—' : v >= 100 ? v.toFixed(0) : v.toFixed(1));

  el.innerHTML = `
    <div class="speed-grid">
      <div class="speed kpi-down"><div class="label">下载</div><div class="value">${fmt(down)}<small>Mbps</small></div></div>
      <div class="speed kpi-up"><div class="label">上传</div><div class="value">${up == null ? '—' : fmt(up)}<small>${up == null ? '' : 'Mbps'}</small></div></div>
      <div class="speed kpi-lat"><div class="label">延迟</div><div class="value">${latency != null ? Math.round(latency) : '—'}<small>ms</small></div></div>
    </div>
    <p class="hint">测速对象是本站 Worker 边缘节点${colo ? `（${esc(colo)}）` : ''}，反映「到你最近的 Cloudflare 机房」的链路；下载取三轮最优、上传取两轮最优。无广告、无第三方测速站。</p>`;
}

/* ===== ASN 查询 ===== */

export async function runAsn(el, raw) {
  el.hidden = false;
  el.innerHTML = '<p class="status live" style="text-align:left">查询中…</p>';
  try {
    const res = await fetch(`/api/asn?asn=${encodeURIComponent(raw)}`);
    const d = await res.json();
    if (!res.ok || d.error) throw new Error(d.error ?? `HTTP ${res.status}`);
    const nb = (list) => (list.length
      ? list.map((n) => `<a class="neigh" href="https://bgp.tools/as/${n.asn}" target="_blank" rel="noopener">AS${n.asn}</a>`).join(' ')
      : '<span class="reason">无</span>');
    el.innerHTML = `
      <dl class="kv kv-compact">
        <div><dt>AS</dt><dd>${esc(d.asnLabel)}</dd></div>
        <div><dt>名称</dt><dd>${esc(d.holder ?? '—')}</dd></div>
        <div><dt>已宣告</dt><dd>${d.announced == null ? '—' : d.announced ? '<span class="pill ok">是</span>' : '<span class="pill warn">否</span>'}</dd></div>
        <div><dt>归属</dt><dd>${d.provider ? `${esc(d.provider.name)} · ${esc(d.provider.type)}` : '—'}${d.anycast ? ' · Anycast' : ''}</dd></div>
        <div><dt>宣告前缀</dt><dd>${d.prefixes.count} 条${d.prefixes.sample.length ? ` · ${d.prefixes.sample.slice(0, 4).map(esc).join(' ')}` : ''}</dd></div>
        <div><dt>上游 (left)</dt><dd>${nb(d.neighbours.upstream)}</dd></div>
        <div><dt>下游 (right)</dt><dd>${nb(d.neighbours.downstream)}</dd></div>
      </dl>
      ${d.warnings?.length ? `<ul class="warnings">${d.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
      <p class="hint">数据来自 RIPEstat（as-overview / asn-neighbours / announced-prefixes），缓存 1 小时。</p>`;
  } catch (e) {
    el.innerHTML = `<p class="status error" style="text-align:left">${esc(e.message)}</p>`;
  }
}

/* ===== 批量查询 ===== */

export async function runBulkLookup(el, text) {
  el.hidden = false;
  el.innerHTML = '<p class="status live" style="text-align:left">批量查询中…（最多 20 个，并发 5）</p>';
  try {
    const res = await fetch('/api/bulk', {
      method: 'POST',
      body: text,
      headers: { 'Content-Type': 'text/plain' },
    });
    const d = await res.json();
    if (!res.ok || d.error) throw new Error(d.error ?? `HTTP ${res.status}`);
    const rows = d.rows ?? [];
    const ok = rows.filter((r) => r.ok).length;
    el.innerHTML = `
      <p class="status" style="text-align:left;margin:0 0 8px">
        <span class="pill ${ok === rows.length ? 'ok' : 'warn'}">${ok} / ${rows.length} 成功</span>
        ${d.invalid?.length ? `<span class="reason">已忽略无效项：${esc(d.invalid.slice(0, 5).join(', '))}</span>` : ''}
      </p>
      <table class="meta-table">
        <thead><tr><th>IP</th><th>国家</th><th>省 / 市</th><th>ASN / 组织</th></tr></thead>
        <tbody>${rows.map((r) => `
          <tr>
            <td class="mono">${esc(r.ip)}</td>
            <td>${r.ok ? esc([r.countryCode, r.country].filter(Boolean).join(' ')) : `<span class="reason">${esc(r.error ?? '失败')}</span>`}</td>
            <td>${esc([r.region, r.city].filter(Boolean).join(' · ') || '—')}</td>
            <td class="mono">${r.asn != null ? `AS${r.asn}` : '—'} <span class="reason">${esc(r.org ?? '')}</span></td>
          </tr>`).join('')}</tbody>
      </table>
      <div class="tool-actions">
        <button type="button" class="export-btn" id="bulk-csv">复制 CSV</button>
      </div>
      <p class="hint">轻量查询只取国家/城市/ASN；需要完整字段（黑名单、代理、rDNS）请逐个用顶部查询框。</p>`;

    $('#bulk-csv')?.addEventListener('click', async (e) => {
      const csv = ['ip,country_code,country,region,city,asn,org']
        .concat(rows.map((r) => [r.ip, r.countryCode, r.country, r.region, r.city, r.asn, r.org]
          .map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')))
        .join('\n');
      try {
        await navigator.clipboard.writeText(csv);
        const btn = e.currentTarget;
        const old = btn.textContent;
        btn.textContent = '已复制';
        setTimeout(() => { btn.textContent = old; }, 1400);
      } catch { /* 忽略 */ }
    });
  } catch (e) {
    el.innerHTML = `<p class="status error" style="text-align:left">${esc(e.message)}</p>`;
  }
}

/* ===== 初始化 ===== */

export function initLabs() {
  const connForm = $('#conn-form');
  connForm?.addEventListener('submit', (e) => {
    e.preventDefault();
    const groups = [...connForm.querySelectorAll('input[name="conn-group"]:checked')].map((i) => i.value);
    if (groups.length) runConnectivity(bodyOf('#tool-conn-body'), groups);
  });

  $('#tool-webrtc-go')?.addEventListener('click', () => runWebrtc(bodyOf('#tool-webrtc-body')));
  $('#tool-fp-go')?.addEventListener('click', () => runFingerprint(bodyOf('#tool-fp-body')));
  $('#tool-speed-go')?.addEventListener('click', () => runSpeed(bodyOf('#tool-speed-body')));

  const asnForm = $('#asn-form');
  asnForm?.addEventListener('submit', (e) => {
    e.preventDefault();
    const v = $('#asn-input').value.trim();
    if (v) runAsn(bodyOf('#tool-asn-body'), v);
  });

  const bulkForm = $('#bulk-form');
  bulkForm?.addEventListener('submit', (e) => {
    e.preventDefault();
    const v = $('#bulk-input').value.trim();
    if (v) runBulkLookup(bodyOf('#tool-bulk-body'), v);
  });

  // 深链：?asn=AS13335 自动查询
  const asnParam = new URLSearchParams(location.search).get('asn');
  if (asnParam) {
    const input = $('#asn-input');
    if (input) input.value = asnParam;
    runAsn(bodyOf('#tool-asn-body'), asnParam);
  }
}

