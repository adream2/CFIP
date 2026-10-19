/** CFIP 前端逻辑：查询、分区渲染、工具箱、查询历史。零外部依赖。 */

import { esc, dash, flagEmoji, row, rows, badge, judgement, yn, mapSvg } from './render.js';

const $ = (sel) => document.querySelector(sel);

const form = $('#search-form');
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
  renderIp(info);
  renderLocation(info);
  renderNetwork(info);
  renderNode(info);
  renderReputation(info);
  renderConnection(info);
  renderMeta(info);
  $('#raw-json-body').textContent = JSON.stringify(info, null, 2);
}

function renderIp(info) {
  const cls = info.isPublic ? badge('公网', 'ok') : badge(info.class, 'warn');
  $('#zone-ip').innerHTML = `
    <h2>IP 地址</h2>
    <div class="ip-big">
      <span class="ip">${esc(info.ip)}</span>
      ${badge(`IPv${info.version}`)}
      ${cls}
      <button class="btn-copy" id="btn-copy-ip">复制</button>
    </div>`;
  $('#btn-copy-ip').addEventListener('click', async () => {
    await navigator.clipboard?.writeText(info.ip);
    $('#btn-copy-ip').textContent = '已复制';
    setTimeout(() => { $('#btn-copy-ip').textContent = '复制'; }, 1200);
  });
}

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
  $('#zone-location').innerHTML = `
    <h2>地理位置</h2>
    ${rows([
      row('国家/地区', `${flagEmoji(L.countryCode)} ${L.country ?? dash}${L.countryCode ? ` (${L.countryCode})` : ''}${L.countryNative && L.countryNative !== L.country ? ` · ${L.countryNative}` : ''}`),
      row('省/市/区', place || dash),
      row('邮编', L.postalCode, { mono: true }),
      row('经纬度', L.latitude != null && L.longitude != null ? `${L.latitude}, ${L.longitude}` : dash, { mono: true }),
      row('时区', L.timezone ? `${L.timezone}${L.utcOffsetSeconds != null ? ` (UTC${L.utcOffsetSeconds >= 0 ? '+' : ''}${L.utcOffsetSeconds / 3600})` : ''}` : dash),
      row('洲', [L.continent, L.continentCode].filter(Boolean).join(' ') || dash),
      row('首都 / 电话码', [L.capital, L.callingCode ? `+${L.callingCode}` : null].filter(Boolean).join(' · ') || dash),
    ])}
    ${mapSvg(L.latitude, L.longitude)}
    ${compareHtml}`;
}

function renderNetwork(info) {
  const N = info.network;
  $('#zone-network').innerHTML = `
    <h2>网络与注册信息</h2>
    ${rows([
      row('ASN', N.asnLabel ?? (N.asn != null ? `AS${N.asn}` : null), { mono: true }),
      row('ISP / 运营商', N.isp || dash),
      row('组织', N.org || dash),
      row('AS 名称', N.asName || dash, { mono: true }),
      row('AS 域名', N.asDomain || dash, { mono: true }),
      row('网段', N.range.cidr ? `${N.range.cidr}${N.range.count ? ` · ${N.range.count.toLocaleString()} 个地址` : ''}` : (N.range.start && N.range.end ? `${N.range.start} – ${N.range.end}` : dash), { mono: true }),
      row('注册局', N.rir || dash),
      row('注册时间', N.allocationDate ? N.allocationDate.slice(0, 10) : dash, { mono: true }),
      row('滥用投诉邮箱', N.abuseEmail || dash, { mono: true }),
      row('用途类型', N.usageType || dash),
    ])}`;
}

function renderNode(info) {
  const nd = info.node;
  const typeLabels = { cloud: '云厂商', cdn: 'CDN', hosting: '托管/IDC', isp: '运营商', education: '教育网', government: '政府', unknown: '未知' };
  $('#zone-node').innerHTML = `
    <h2>节点归属</h2>
    ${rows([
      row('云厂商 / CDN', nd.provider ? `${nd.provider}${nd.providerType ? ` · ${typeLabels[nd.providerType] ?? nd.providerType}` : ''}` : dash),
      row('托管 / 数据中心', judgement(nd.hosting), { raw: true }),
      row('Anycast', judgement(nd.anycast), { raw: true }),
      row('移动网络', judgement(nd.isMobile), { raw: true }),
      row('住宅宽带', judgement(nd.isBroadband, '是', '否'), { raw: true }),
      row('反向解析', nd.rdns?.length ? nd.rdns.join(' · ') : (nd.rdnsError ? `查询失败：${nd.rdnsError}` : dash), { mono: true }),
    ])}`;
}

function renderReputation(info) {
  const r = info.reputation;
  const dnsblHtml = r.dnsbl.length
    ? `<div class="dnsbl">${r.dnsbl.map((d) => `
        <div class="dnsbl-item">
          <span class="dot ${d.listed ? 'bad' : 'ok'}"></span>
          <span class="list">${esc(d.list)}</span>
          <span>${d.listed ? `已列名（${esc(d.returnCode ?? '')}）` : '未列名'}</span>
          ${d.reason ? `<span class="reason">${esc(d.reason)}</span>` : ''}
        </div>`).join('')}</div>`
    : '<p class="status">暂无黑名单数据</p>';
  const p = r.proxy;
  const hasProxy = p.isProxy != null || p.isVpn != null || p.isTor != null || p.isAnonymous != null;
  $('#zone-reputation').innerHTML = `
    <h2>信誉与风险</h2>
    ${rows([
      row('代理 / VPN / Tor', hasProxy ? `${yn(p.isProxy)} ${yn(p.isVpn)} ${yn(p.isTor)}` : dash, { raw: true }),
      row('滥用评分', r.abuseScore != null ? `${r.abuseScore} / 100${r.abuseReports != null ? ` · ${r.abuseReports} 次举报` : ''}` : dash, { mono: true }),
      row('黑名单', r.dnsbl.length ? `${r.dnsblListedCount} / ${r.dnsbl.length} 个列表列名` : dash),
    ])}
    ${dnsblHtml}`;
}

function renderConnection(info) {
  const zone = $('#zone-connection');
  if (!info.connection) { zone.hidden = true; return; }
  zone.hidden = false;
  const c = info.connection;
  zone.innerHTML = `
    <h2>本次连接（来自边缘节点）</h2>
    ${rows([
      row('协议 / TLS', [c.httpProtocol, c.tlsVersion].filter(Boolean).join(' · ') || dash, { mono: true }),
      row('TLS 套件', c.tlsCipher || dash, { mono: true }),
      row('延迟 RTT', c.clientTcpRttMs != null ? `${c.clientTcpRttMs} ms` : dash, { mono: true }),
      row('边缘节点', c.colo || dash, { mono: true }),
      row('AS 组织', c.asOrganization || dash),
      row('User-Agent', c.userAgent || dash, { mono: true }),
    ])}`;
}

function renderMeta(info) {
  const m = info.meta;
  const warnings = m.warnings.length
    ? `<ul class="warnings">${m.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>`
    : '';
  $('#zone-meta').innerHTML = `
    <h2>查询元信息</h2>
    <table class="meta-table">
      <thead><tr><th>数据源</th><th>状态</th><th>耗时</th></tr></thead>
      <tbody>
        ${m.sources.map((s) => `
          <tr>
            <td class="mono">${esc(s.id)}</td>
            <td>${s.ok ? badge('成功', 'ok') : badge('失败', 'bad')}${s.error ? ` <span class="dnsbl-item reason">${esc(s.error)}</span>` : ''}</td>
            <td class="mono">${s.ms} ms</td>
          </tr>`).join('')}
      </tbody>
    </table>
    <p class="status" style="text-align:left">生成时间：${esc(m.generatedAt)} · 缓存 ${Math.round((m.cacheTtlSec ?? 0) / 3600)} 小时</p>
    ${warnings}`;
}

// —— 查询历史（localStorage） ——
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

// —— 工具箱 ——
async function runTool(name, path, bodyEl) {
  bodyEl.hidden = false;
  bodyEl.innerHTML = '<p class="status">查询中…</p>';
  try {
    const res = await fetch(path);
    const data = await res.json().catch(() => null);
    if (!res.ok || !data) {
      bodyEl.innerHTML = `<p class="status error">查询失败（HTTP ${res.status}）</p>`;
      return;
    }
    if (data.error) {
      bodyEl.innerHTML = `<p class="status error">${esc(data.error)}</p>`;
      return;
    }
    renderTool(name, data, bodyEl);
  } catch (e) {
    bodyEl.innerHTML = `<p class="status error">网络错误：${esc(e.message)}</p>`;
  }
}

function renderTool(name, data, el) {
  if (name === 'probe') {
    el.innerHTML = `<table class="meta-table"><thead><tr><th>服务</th><th>可达</th><th>出口 IP</th><th>边缘</th><th>国家</th><th>耗时</th></tr></thead><tbody>
      ${data.probes.map((p) => `<tr><td class="mono">${esc(p.service)}</td><td>${p.reachable ? badge('是', 'ok') : badge('否', 'bad')}${p.error ? ` <span class="reason">${esc(p.error)}</span>` : ''}</td><td class="mono">${esc(p.exitIp ?? '—')}</td><td class="mono">${esc(p.colo ?? '—')}</td><td class="mono">${esc(p.loc ?? '—')}</td><td class="mono">${p.ms} ms</td></tr>`).join('')}
    </tbody></table>`;
    return;
  }
  if (name === 'status') {
    const labels = { none: '正常', minor: '轻微', major: '严重', critical: '紧急', maintenance: '维护' };
    el.innerHTML = `<table class="meta-table"><thead><tr><th>服务</th><th>状态</th><th>说明</th></tr></thead><tbody>
      ${data.services.map((s) => {
        const tone = s.indicator === 'none' ? 'ok' : s.indicator ? 'bad' : '';
        return `<tr><td class="mono">${esc(s.service)}</td><td>${badge(labels[s.indicator] ?? '未知', tone)}${s.error ? ` <span class="reason">${esc(s.error)}</span>` : ''}</td><td>${esc(s.description ?? '—')}</td></tr>`;
      }).join('')}
    </tbody></table>`;
    return;
  }
  if (name === 'domain') {
    const r = data.rdap ?? {};
    el.innerHTML = `
      <h3 class="tool-sub">DNS</h3>
      ${rows([
        row('A', data.dns.a.join(' · ') || dash, { mono: true }),
        row('AAAA', data.dns.aaaa.join(' · ') || dash, { mono: true }),
        row('CNAME', data.dns.cname.join(' · ') || dash, { mono: true }),
        row('CDN', data.cdn.isCdn ? `${esc(data.cdn.provider)}${data.cdn.evidence ? `（${esc(data.cdn.evidence)}）` : ''}` : '未检测到'),
      ])}
      <h3 class="tool-sub">WHOIS（RDAP）</h3>
      ${rows([
        row('注册局', r.registrar || dash),
        row('注册时间', r.created ? r.created.slice(0, 10) : dash, { mono: true }),
        row('到期时间', r.expires ? r.expires.slice(0, 10) : dash, { mono: true }),
        row('NS', (r.nameservers ?? []).join(' · ') || dash, { mono: true }),
        row('状态', (r.status ?? []).join(' · ') || dash, { mono: true }),
        row('滥用邮箱', r.abuseEmail || dash, { mono: true }),
      ])}`;
    return;
  }
  if (name === 'ping') {
    const head = `<p class="status" style="text-align:left">测量状态：${esc(data.status)} · 目标：${esc(data.target)}</p>`;
    el.innerHTML = head + `<table class="meta-table"><thead><tr><th>探针</th><th>结果</th></tr></thead><tbody>
      ${data.results.map((p) => {
        let out = '';
        if (data.type === 'ping') out = p.rttMs != null ? `${p.rttMs} ms（${p.minMs}–${p.maxMs}）` : (p.error ?? '—');
        else if (data.type === 'http') out = p.statusCode != null ? `HTTP ${p.statusCode} · ${p.totalMs != null ? `${p.totalMs} ms` : ''}` : (p.error ?? '—');
        else if (data.type === 'dns') out = p.records.length ? p.records.join(' · ') : (p.error ?? '—');
        return `<tr><td>${esc([p.city, p.country].filter(Boolean).join(', ') || '—')}${p.asn != null ? ` <span class="mono">AS${p.asn}</span>` : ''}</td><td class="mono">${esc(out)}</td></tr>`;
      }).join('')}
    </tbody></table>`;
    return;
  }
  el.innerHTML = `<pre>${esc(JSON.stringify(data, null, 2))}</pre>`;
}

// —— 事件 ——
form.addEventListener('submit', (e) => {
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

$('#tool-probe .tool-go')?.addEventListener('click', () => {
  runTool('probe', '/api/probe', $('#tool-probe-body'));
});
$('#tool-status .tool-go')?.addEventListener('click', () => {
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

// —— 启动：深链 ?ip= 或查询本机；渲染查询历史 ——
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
