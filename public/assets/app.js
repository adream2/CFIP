/** CFIP 前端逻辑：仪表盘渲染、工具箱、查询历史。零外部依赖。 */

import { esc, dash, flagEmoji, row, rows, badge, judgement, yn, mapSvg } from './render.js';

const $ = (sel) => document.querySelector(sel);

const form = $('#ip-input')?.closest('.searchbar');
const input = $('#ip-input');
const btn = $('#btn-query');
const statusEl = $('#status');
const resultEl = $('#result');

function setStatus(text, isError = false) {
  if (!text) {
    statusEl.hidden = true;
    return;
  }
  statusEl.hidden = false;
  statusEl.textContent = text;
  statusEl.classList.toggle('error', isError);
}

async function lookup(ip) {
  btn.disabled = true;
  setStatus('查询中…');
  try {
    const url = ip ? `/api?ip=${encodeURIComponent(ip)}` : '/api';
    const res = await fetch(url);
    const body = await res.json().catch(() => null);
    if (!res.ok || !body || body.error) {
      setStatus(body?.error || `查询失败（HTTP ${res.status}）`, true);
      resultEl.hidden = true;
      return;
    }
    renderAll(body);
    setStatus('');
    saveHistory(ip);
    const u = new URL(location.href);
    if (ip) u.searchParams.set('ip', ip);
    else u.searchParams.delete('ip');
    history.replaceState(null, '', u);
  } catch (e) {
    setStatus(`网络错误：${e.message}`, true);
  } finally {
    btn.disabled = false;
  }
}

function renderAll(info) {
  resultEl.hidden = false;
  renderKpis(info);
  renderLocation(info);
  renderNetwork(info);
  renderNode(info);
  renderReputation(info);
  renderConnection(info);
  renderMeta(info);
  $('#raw-json-body').textContent = JSON.stringify(info, null, 2);
}

/* —— KPI 大数块 —— */
function renderKpis(info) {
  const L = info.location;
  const N = info.network;
  const listed = info.reputation.dnsblListedCount;
  const total = info.reputation.dnsbl.length;
  const proxyClean = info.reputation.proxy.isProxy === false;

  $('#kpi-ip').textContent = info.ip;
  $('#kpi-ip-sub').innerHTML =
    `<span class="pill">IPv${info.version}</span> ` +
    (info.isPublic ? `<span class="pill ok">公网</span>` : `<span class="pill warn">${esc(info.class)}</span>`);

  const place = [L.city, L.region].filter(Boolean).join(', ');
  $('#kpi-loc').textContent = place || L.country || '—';
  $('#kpi-loc-sub').innerHTML =
    `${flagEmoji(L.countryCode)} ${esc(L.country ?? '—')}` +
    (L.timezone ? ` · ${esc(L.timezone)}` : '');

  $('#kpi-net').textContent = N.asn != null ? `AS${N.asn}` : (N.isp || '—');
  $('#kpi-net-sub').textContent = N.isp || N.org || N.asnLabel || '—';

  const risk = total > 0 ? `${listed}/${total}` : '—';
  const riskEl = $('#kpi-risk');
  riskEl.textContent = risk;
  riskEl.style.color = listed > 0 ? 'var(--bad)' : 'var(--ok)';
  $('#kpi-risk-sub').innerHTML =
    `DNSBL${proxyClean ? ' · <span class="pill ok">无代理</span>' : ''}`;
}

/* —— 面板：地理位置 —— */
function renderLocation(info) {
  const L = info.location;
  const place = [L.region, L.city, L.district].filter(Boolean).join(' · ');
  const locations = info.comparison?.locations ?? [];
  const compareHtml = locations.length > 1
    ? `<details class="compare"><summary>多源位置对比（${locations.length} 个源）</summary>
        <table class="meta-table"><thead><tr><th>来源</th><th>国家</th><th>省/州</th><th>城市</th><th>坐标</th></tr></thead>
        <tbody>${locations.map((l) => `<tr><td class="mono">${esc(l.id)}</td><td>${esc(l.country ?? '—')}</td><td>${esc(l.region ?? '—')}</td><td>${esc(l.city ?? '—')}</td><td class="mono">${l.latitude != null ? `${esc(l.latitude)}, ${esc(l.longitude)}` : '—'}</td></tr>`).join('')}</tbody></table>
      </details>`
    : '';
  $('#panel-location').innerHTML = `
    <dl class="kv">
      <div><dt>国家</dt><dd>${flagEmoji(L.countryCode)} ${esc(L.country ?? '—')}${L.countryCode ? ` (${esc(L.countryCode)})` : ''}</dd></div>
      <div><dt>省/市</dt><dd>${esc(place || '—')}</dd></div>
      <div><dt>坐标</dt><dd>${L.latitude != null && L.longitude != null ? `${esc(L.latitude)}, ${esc(L.longitude)}` : '—'}</dd></div>
      <div><dt>时区</dt><dd>${esc(L.timezone ?? '—')}${L.utcOffsetSeconds != null ? ` (UTC${L.utcOffsetSeconds >= 0 ? '+' : ''}${L.utcOffsetSeconds / 3600})` : ''}</dd></div>
      <div><dt>洲 / 电话码</dt><dd>${esc([L.continent, L.callingCode ? `+${L.callingCode}` : ''].filter(Boolean).join(' · ') || '—')}</dd></div>
    </dl>
    ${mapSvg(L.latitude, L.longitude)}
    ${compareHtml}`;
}

/* —— 面板：网络与注册 —— */
function renderNetwork(info) {
  const N = info.network;
  $('#panel-network').innerHTML = `
    <dl class="kv">
      <div><dt>ASN</dt><dd>${N.asn != null ? `AS${N.asn}` : '—'}${N.asnLabel ? ` ${esc(N.asnLabel)}` : ''}</dd></div>
      <div><dt>ISP / 组织</dt><dd>${esc(N.isp || N.org || '—')}</dd></div>
      <div><dt>AS 名称</dt><dd>${esc(N.asName ?? '—')}</dd></div>
      <div><dt>网段</dt><dd>${N.range.cidr ? `${esc(N.range.cidr)}${N.range.count ? ` (${N.range.count.toLocaleString()} 地址)` : ''}` : (N.range.start && N.range.end ? `${esc(N.range.start)} – ${esc(N.range.end)}` : '—')}</dd></div>
      <div><dt>注册局</dt><dd>${esc(N.rir ?? '—')}${N.allocationDate ? ` · ${esc(N.allocationDate.slice(0, 10))}` : ''}</dd></div>
      <div><dt>滥用邮箱</dt><dd>${esc(N.abuseEmail ?? '—')}</dd></div>
      <div><dt>用途</dt><dd>${esc(N.usageType ?? '—')}</dd></div>
    </dl>`;
}

/* —— 面板：节点归属 —— */
function renderNode(info) {
  const nd = info.node;
  const typeLabels = { cloud: '云厂商', cdn: 'CDN', hosting: '托管/IDC', isp: '运营商', education: '教育网', government: '政府', unknown: '未知' };
  $('#panel-node').innerHTML = `
    <dl class="kv">
      <div><dt>类型</dt><dd>${nd.provider ? `${esc(nd.provider)}${nd.providerType ? ` · ${esc(typeLabels[nd.providerType] ?? nd.providerType)}` : ''}` : '—'}</dd></div>
      <div><dt>托管</dt><dd>${judgement(nd.hosting)}</dd></div>
      <div><dt>Anycast</dt><dd>${judgement(nd.anycast)}</dd></div>
      <div><dt>移动网络</dt><dd>${judgement(nd.isMobile)}</dd></div>
      <div><dt>住宅宽带</dt><dd>${judgement(nd.isBroadband, '是', '否')}</dd></div>
      <div><dt>rDNS</dt><dd>${nd.rdns?.length ? esc(nd.rdns.join(' · ')) : (nd.rdnsError ? `查询失败：${esc(nd.rdnsError)}` : '—')}</dd></div>
    </dl>`;
}

/* —— 面板：信誉与风险 —— */
function renderReputation(info) {
  const r = info.reputation;
  const p = r.proxy;
  const hasProxy = p.isProxy != null || p.isVpn != null || p.isTor != null || p.isAnonymous != null;
  $('#panel-reputation').innerHTML = `
    <dl class="kv">
      <div><dt>代理</dt><dd>${hasProxy ? judgement({ value: !!p.isProxy, confidence: 'medium', source: 'ipwhois' }) : '—'}</dd></div>
      <div><dt>VPN / Tor</dt><dd>${hasProxy ? `${yn(p.isVpn)} / ${yn(p.isTor)}` : '—'}</dd></div>
      <div><dt>滥用评分</dt><dd>${r.abuseScore != null ? `${r.abuseScore} / 100${r.abuseReports != null ? ` · ${r.abuseReports} 举报` : ''}` : '—'}</dd></div>
    </dl>
    ${r.dnsbl.length ? `<div class="dots">${r.dnsbl.map((d) =>
      `<span class="p${d.listed ? ' hit' : ''}"><i></i>${esc(d.list.replace(/\.(org|net|com)$/, ''))}${d.listed ? ` · ${esc(d.returnCode ?? '')}` : ''}</span>`).join('')}</div>`
    : '<p class="status" style="text-align:left;margin:0">暂无黑名单数据</p>'}`;
}

/* —— 面板：连接信息 —— */
function renderConnection(info) {
  const wrap = $('#panel-connection-wrap');
  if (!info.connection) { wrap.hidden = true; return; }
  wrap.hidden = false;
  const c = info.connection;
  $('#panel-connection').innerHTML = `
    <dl class="kv">
      <div><dt>协议 / TLS</dt><dd>${[c.httpProtocol, c.tlsVersion].filter(Boolean).join(' · ') || '—'}${c.tlsCipher ? ` (${esc(c.tlsCipher)})` : ''}</dd></div>
      <div><dt>边缘节点</dt><dd>${esc(c.colo ?? '—')}${c.clientTcpRttMs != null ? ` · RTT ${c.clientTcpRttMs}ms` : ''}</dd></div>
      <div><dt>AS 组织</dt><dd>${esc(c.asOrganization ?? '—')}</dd></div>
      <div><dt>User-Agent</dt><dd>${esc(c.userAgent ?? '—')}</dd></div>
    </dl>`;
}

/* —— 面板：查询元信息 —— */
function renderMeta(info) {
  const m = info.meta;
  const warnings = m.warnings.length
    ? `<ul class="warnings">${m.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>`
    : '';
  $('#panel-meta').innerHTML = `
    ${warnings}
    <table class="meta-table">
      <thead><tr><th>数据源</th><th>状态</th><th>耗时</th></tr></thead>
      <tbody>
        ${m.sources.map((s) => `
          <tr>
            <td class="mono">${esc(s.id)}</td>
            <td>${s.ok ? '<span class="pill ok">成功</span>' : `<span class="pill bad">失败</span> <span class="reason">${esc(s.error ?? '')}</span>`}</td>
            <td class="mono">${s.ms} ms</td>
          </tr>`).join('')}
      </tbody>
    </table>
    <p class="status" style="text-align:left;margin:8px 0 0">生成时间：${esc(m.generatedAt)} · 缓存 ${Math.round((m.cacheTtlSec ?? 0) / 3600)} 小时</p>`;
}

/* —— 查询历史（localStorage） —— */
const HISTORY_KEY = 'cfip-history';

function loadHistory() {
  try {
    const arr = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]');
    return Array.isArray(arr) ? arr.filter((x) => typeof x === 'string').slice(0, 10) : [];
  } catch {
    return [];
  }
}

function saveHistory(ip) {
  if (!ip) return;
  const list = [ip, ...loadHistory().filter((x) => x !== ip)].slice(0, 10);
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(list)); } catch { /* 隐私模式下忽略 */ }
  renderHistory();
}

function renderHistory() {
  const el = $('#history');
  if (!el) return;
  const list = loadHistory();
  el.hidden = list.length === 0;
  el.innerHTML = `<span class="chips-label">历史</span>`
    + list.map((ip) => `<button type="button" class="chip" data-ip="${esc(ip)}">${esc(ip)}</button>`).join('')
    + `<button type="button" class="chip" id="history-clear">清空</button>`;
  $('#history-clear')?.addEventListener('click', () => {
    try { localStorage.removeItem(HISTORY_KEY); } catch { /* 忽略 */ }
    renderHistory();
  });
}

/* —— 工具箱 —— */
async function runTool(name, path, bodyEl) {
  bodyEl.hidden = false;
  bodyEl.innerHTML = '<p class="status" style="text-align:left">查询中…</p>';
  try {
    const res = await fetch(path);
    const data = await res.json().catch(() => null);
    if (!res.ok || !data) {
      bodyEl.innerHTML = `<p class="status error" style="text-align:left">查询失败（HTTP ${res.status}）</p>`;
      return;
    }
    if (data.error) {
      bodyEl.innerHTML = `<p class="status error" style="text-align:left">${esc(data.error)}</p>`;
      return;
    }
    renderTool(name, data, bodyEl);
  } catch (e) {
    bodyEl.innerHTML = `<p class="status error" style="text-align:left">网络错误：${esc(e.message)}</p>`;
  }
}

function renderTool(name, data, el) {
  if (name === 'probe') {
    el.innerHTML = `<table class="meta-table"><thead><tr><th>服务</th><th>可达</th><th>出口 IP</th><th>边缘</th><th>国家</th><th>耗时</th></tr></thead><tbody>
      ${data.probes.map((p) => `<tr><td class="mono">${esc(p.service)}</td><td>${p.reachable ? '<span class="pill ok">是</span>' : `<span class="pill bad">否</span> <span class="reason">${esc(p.error ?? '')}</span>`}</td><td class="mono">${esc(p.exitIp ?? '—')}</td><td class="mono">${esc(p.colo ?? '—')}</td><td class="mono">${esc(p.loc ?? '—')}</td><td class="mono">${p.ms} ms</td></tr>`).join('')}
    </tbody></table>`;
    return;
  }
  if (name === 'status') {
    const labels = { none: '正常', minor: '轻微', major: '严重', critical: '紧急', maintenance: '维护' };
    el.innerHTML = `<table class="meta-table"><thead><tr><th>服务</th><th>状态</th><th>说明</th></tr></thead><tbody>
      ${data.services.map((s) => {
        const tone = s.indicator === 'none' ? 'ok' : s.indicator ? 'bad' : '';
        return `<tr><td class="mono">${esc(s.service)}</td><td><span class="pill ${tone}">${labels[s.indicator] ?? '未知'}</span>${s.error ? ` <span class="reason">${esc(s.error)}</span>` : ''}</td><td>${esc(s.description ?? '—')}</td></tr>`;
      }).join('')}
    </tbody></table>`;
    return;
  }
  if (name === 'domain') {
    const r = data.rdap ?? {};
    el.innerHTML = `
      <p class="status" style="text-align:left;margin:0 0 8px">DNS 解析与注册信息</p>
      <dl class="kv">
        <div><dt>A</dt><dd>${data.dns.a.map(esc).join(' · ') || '—'}</dd></div>
        <div><dt>AAAA</dt><dd>${data.dns.aaaa.map(esc).join(' · ') || '—'}</dd></div>
        <div><dt>CNAME</dt><dd>${data.dns.cname.map(esc).join(' · ') || '—'}</dd></div>
        <div><dt>CDN</dt><dd>${data.cdn.isCdn ? `${esc(data.cdn.provider)}${data.cdn.evidence ? `（${esc(data.cdn.evidence)}）` : ''}` : '未检测到'}</dd></div>
        <div><dt>注册局</dt><dd>${esc(r.registrar ?? '—')}</dd></div>
        <div><dt>注册 / 到期</dt><dd>${[r.created, r.expires].filter(Boolean).map((d) => esc(d.slice(0, 10))).join(' → ') || '—'}</dd></div>
        <div><dt>NS</dt><dd>${(r.nameservers ?? []).map(esc).join(' · ') || '—'}</dd></div>
        <div><dt>滥用邮箱</dt><dd>${esc(r.abuseEmail ?? '—')}</dd></div>
      </dl>`;
    return;
  }
  if (name === 'ping') {
    const head = `<p class="status" style="text-align:left;margin:0 0 8px">测量状态：${esc(data.status)} · 目标：${esc(data.target)}</p>`;
    el.innerHTML = head + `<table class="meta-table"><thead><tr><th>探针</th><th>结果</th></tr></thead><tbody>
      ${data.results.map((p) => {
        let out = '';
        if (data.type === 'ping') out = p.rttMs != null ? `${p.rttMs} ms（${p.minMs}–${p.maxMs}）` : (p.error ?? '—');
        else if (data.type === 'http') out = p.statusCode != null ? `HTTP ${p.statusCode} · ${p.totalMs != null ? `${p.totalMs} ms` : ''}` : (p.error ?? '—');
        else if (data.type === 'dns') out = p.records.length ? p.records.map(esc).join(' · ') : (p.error ?? '—');
        return `<tr><td>${esc([p.city, p.country].filter(Boolean).join(', ') || '—')}${p.asn != null ? ` <span class="mono">AS${p.asn}</span>` : ''}</td><td class="mono">${out}</td></tr>`;
      }).join('')}
    </tbody></table>`;
    return;
  }
  el.innerHTML = `<pre>${esc(JSON.stringify(data, null, 2))}</pre>`;
}

/* —— 事件 —— */
form?.addEventListener('submit', (e) => {
  e.preventDefault();
  const ip = input.value.trim();
  lookup(ip || null);
});

$('#chips').addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (!chip || chip.id === 'history-clear') return;
  if (!chip.dataset.ip) return;
  input.value = chip.dataset.ip;
  lookup(chip.dataset.ip);
});

$('#history')?.addEventListener('click', (e) => {
  if (e.target.id === 'history-clear') {
    try { localStorage.removeItem(HISTORY_KEY); } catch { /* 忽略 */ }
    renderHistory();
  }
});

$('#theme-toggle')?.addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('cfip-theme', next); } catch { /* 忽略 */ }
});

$('#tool-probe-go')?.addEventListener('click', () => {
  runTool('probe', '/api/probe', $('#tool-probe-body'));
});
$('#tool-status-go')?.addEventListener('click', () => {
  runTool('status', '/api/status', $('#tool-status-body'));
});
$('#domain-form')?.addEventListener('submit', (e) => {
  e.preventDefault();
  const d = $('#domain-input').value.trim();
  if (d) runTool('domain', `/api/domain?domain=${encodeURIComponent(d)}`, $('#tool-domain-body'));
});
$('#ping-form')?.addEventListener('submit', (e) => {
  e.preventDefault();
  const t = $('#ping-input').value.trim();
  const type = $('#ping-type').value;
  if (t) runTool('ping', `/api/ping?target=${encodeURIComponent(t)}&type=${encodeURIComponent(type)}`, $('#tool-ping-body'));
});

/* —— 启动：深链 ?ip= 或查询本机；渲染查询历史 —— */
function boot() {
  renderHistory();
  const paramIp = new URLSearchParams(location.search).get('ip');
  if (paramIp) {
    input.value = paramIp;
    lookup(paramIp);
  } else {
    lookup(null);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
