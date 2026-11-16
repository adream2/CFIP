/** CFIP 前端逻辑：仪表盘渲染、工具箱、查询历史。零外部依赖。 */

import { esc, dash, flagEmoji, row, rows, badge, judgement, yn, mapSvg } from './render.js';
import { initSitePlugins } from './site-plugins.js';
import { calcIp } from './calc.js';
import { initLabs } from './labs.js';

const $ = (sel) => document.querySelector(sel);

const form = $('#ip-form');
const input = $('#ip-input');
const btn = $('#btn-query');
const statusEl = $('#status');
const resultEl = $('#result');

/** 最近一次查询结果：复制 / 导出用 */
let lastInfo = null;

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
  lastInfo = info;
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
      <div><dt>注册国家</dt><dd>${esc(N.registryCountry ?? '—')}</dd></div>
      <div><dt>滥用邮箱</dt><dd>${esc(N.abuseEmail ?? '—')}</dd></div>
      <div><dt>用途</dt><dd>${esc(N.usageType ?? '—')}</dd></div>
    </dl>`;
}

/* —— 面板：节点归属 —— */
const IP_TYPE_LABELS = { native: '原生 IP', broadcast: '广播 IP', unknown: '无法判定' };
const CONF_LABELS = { high: '高', medium: '中', low: '低' };

/** IP 类型徽章 + 可选折叠的判定依据 */
function ipTypeHtml(t) {
  if (!t) return '—';
  const tone = t.value === 'broadcast' ? 'bad' : t.value === 'native' ? 'ok' : '';
  const detail = t.reasons?.length
    ? `<details class="reasons"><summary>判定依据（${t.reasons.length}）</summary><ul>${t.reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul></details>`
    : '';
  return `${badge(IP_TYPE_LABELS[t.value] ?? t.value, tone)}${badge(`置信度 ${CONF_LABELS[t.confidence] ?? t.confidence}`)}${detail}`;
}

function renderNode(info) {
  const nd = info.node;
  const typeLabels = { cloud: '云厂商', cdn: 'CDN', hosting: '托管/IDC', isp: '运营商', education: '教育网', government: '政府', unknown: '未知' };
  $('#panel-node').innerHTML = `
    <dl class="kv">
      <div><dt>类型</dt><dd>${nd.provider ? `${esc(nd.provider)}${nd.providerType ? ` · ${esc(typeLabels[nd.providerType] ?? nd.providerType)}` : ''}` : '—'}</dd></div>
      <div><dt>IP 类型</dt><dd>${ipTypeHtml(nd.ipType)}</dd></div>
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
        else if (data.type === 'mtr') out = p.hops?.length ? hopsHtml(p.hops) : (p.error ?? '—');
        return `<tr><td>${esc([p.city, p.country].filter(Boolean).join(', ') || '—')}${p.asn != null ? ` <span class="mono">AS${p.asn}</span>` : ''}</td><td class="mono">${out}</td></tr>`;
      }).join('')}
    </tbody></table>`;
    return;
  }
  if (name === 'dns') {
    const rowsHtml = data.resolvers.map((r) => `
      <tr class="${r.divergent ? 'divergent' : ''}">
        <td>${esc(r.name)} <span class="reason">${esc(r.region)}</span></td>
        <td class="mono">${r.ok ? (r.answers.length ? r.answers.map(esc).join('<br>') : '（空记录）') : `<span class="reason">${esc(r.error ?? '查询失败')}</span>`}</td>
        <td class="mono">${r.ms} ms</td>
      </tr>`).join('');
    const verdict = data.consistent
      ? '<span class="pill ok">结果一致</span>'
      : `<span class="pill warn">存在分歧</span> <span class="reason">${esc(data.divergentResolvers.join(', '))}</span>`;
    el.innerHTML = `
      <p class="status" style="text-align:left;margin:0 0 8px">${verdict}${data.note ? ` · ${esc(data.note)}` : ''}</p>
      <table class="meta-table">
        <thead><tr><th>解析器</th><th>${esc(data.type)} 记录</th><th>耗时</th></tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>`;
    return;
  }
  el.innerHTML = `<pre>${esc(JSON.stringify(data, null, 2))}</pre>`;
}

/** MTR 逐跳列表 */
function hopsHtml(hops) {
  const items = hops.map((h) => `
    <div class="hop">
      <span class="hop-n mono">${h.hop}</span>
      <span class="hop-ip mono">${esc(h.ip ?? '*')}</span>
      <span class="hop-host">${esc(h.hostname ?? '')}</span>
      <span class="hop-rtt mono">${h.rttMs != null ? `${h.rttMs} ms` : '—'}</span>
    </div>`).join('');
  return `<div class="hops">${items}</div>`;
}

/* —— IP 计算器（纯本地计算，零请求） —— */
function renderCalc(raw) {
  const el = $('#tool-calc-body');
  el.hidden = false;
  const r = calcIp(raw);
  if (!r.ok) {
    el.innerHTML = `<p class="status error" style="text-align:left">${esc(r.error)}</p>`;
    return;
  }
  const dl = (items) => `<dl class="kv">${items
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v, mono = true]) => `<div><dt>${esc(k)}</dt><dd class="${mono ? 'mono' : ''}">${esc(String(v))}</dd></div>`)
    .join('')}</dl>`;

  if (r.mode === 'range') {
    el.innerHTML = dl([
      ['范围', `${r.start} – ${r.end}`],
      ['地址数', r.totalAddresses.toLocaleString()],
      ['CIDR 集合', r.cidrs.join('\n')],
    ]);
    return;
  }
  if (r.version === 4) {
    el.innerHTML = dl([
      ['网络地址', r.cidr],
      ['广播地址', r.broadcast],
      ['子网掩码', r.netmask],
      ['通配符', r.wildcard],
      ['可用主机', r.usableHosts.toLocaleString()],
      ['主机范围', `${r.firstHost} – ${r.lastHost}`],
      ['地址总数', r.totalAddresses.toLocaleString()],
      ['整数', r.ipInt],
      ['十六进制', r.ipHex],
      ['二进制', r.ipBinary],
      ['地址类型', r.kind, false],
    ]);
    return;
  }
  el.innerHTML = dl([
    ['规范化', r.ip],
    ['网络', r.cidr],
    ['展开形式', r.expanded],
    ['末地址', r.last],
    ['地址总数', BigInt(r.totalAddresses).toLocaleString()],
    ['地址类型', r.kind, false],
  ]);
}

/* —— 导出：复制 JSON / 复制 Markdown 报告 / 下载 JSON（全部本地生成） —— */
function markdownReport(info) {
  const L = info.location;
  const N = info.network;
  const nd = info.node;
  const r = info.reputation;
  const lines = [];
  const kv = (k, v) => { if (v !== null && v !== undefined && v !== '' && v !== '—') lines.push(`- ${k}：${v}`); };
  const flagCC = L.countryCode ? ` (${L.countryCode})` : '';

  lines.push(`# CFIP 诊断报告 · ${info.ip}`, '');
  kv('查询时间', info.meta.generatedAt);
  kv('IP 版本', `IPv${info.version}`);
  if (nd.ipType) kv('IP 类型', `${IP_TYPE_LABELS[nd.ipType.value]}（置信度 ${CONF_LABELS[nd.ipType.confidence]}）`);

  lines.push('', '## 归属地', '');
  kv('国家', `${L.country ?? '—'}${flagCC}`);
  kv('省 / 市', [L.region, L.city, L.district].filter(Boolean).join(' · '));
  kv('邮编', L.postalCode);
  kv('坐标', L.latitude != null && L.longitude != null ? `${L.latitude}, ${L.longitude}` : null);
  kv('时区', L.timezone);

  lines.push('', '## 网络与注册', '');
  kv('ASN', N.asn != null ? `AS${N.asn}${N.asnLabel ? ` ${N.asnLabel}` : ''}` : null);
  kv('ISP / 组织', N.isp ?? N.org);
  kv('网段', N.range.cidr ?? (N.range.start ? `${N.range.start} – ${N.range.end}` : null));
  kv('RIR / 注册地', [N.rir, N.registryCountry].filter(Boolean).join(' · '));
  kv('滥用邮箱', N.abuseEmail);

  lines.push('', '## 节点与信誉', '');
  kv('节点归属', nd.provider ? `${nd.provider}${nd.providerType ? `（${nd.providerType}）` : ''}` : null);
  kv('托管 / Anycast', `托管 ${nd.hosting ? (nd.hosting.value ? '是' : '否') : '未知'} · Anycast ${nd.anycast ? (nd.anycast.value ? '是' : '否') : '未知'}`);
  kv('rDNS', nd.rdns.join(', '));
  kv('DNSBL', r.dnsbl.length ? `${r.dnsblListedCount}/${r.dnsbl.length} 个列表列名` : null);
  kv('代理 / VPN / Tor', [r.proxy.isProxy, r.proxy.isVpn, r.proxy.isTor].map((v) => (v == null ? '未知' : v ? '是' : '否')).join(' / '));

  if (info.comparison?.locations?.length > 1) {
    lines.push('', '## 多源位置对比', '', '| 来源 | 国家 | 省/州 | 城市 |', '| --- | --- | --- | --- |');
    for (const l of info.comparison.locations) {
      lines.push(`| ${l.id} | ${l.country ?? '—'} | ${l.region ?? '—'} | ${l.city ?? '—'} |`);
    }
  }

  lines.push('', '## 数据源', '', '| 数据源 | 状态 | 耗时 |', '| --- | --- | --- |');
  for (const s of info.meta.sources) {
    lines.push(`| ${s.id} | ${s.ok ? '成功' : `失败 ${s.error ?? ''}`} | ${s.ms} ms |`);
  }
  return lines.join('\n') + '\n';
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { return document.execCommand('copy'); } finally { ta.remove(); }
  }
}

function flash(btn, text) {
  const old = btn.textContent;
  btn.textContent = text;
  setTimeout(() => { btn.textContent = old; }, 1400);
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

$('#dns-form')?.addEventListener('submit', (e) => {
  e.preventDefault();
  const d = $('#dns-input').value.trim();
  const type = $('#dns-type').value;
  if (d) runTool('dns', `/api/dns?domain=${encodeURIComponent(d)}&type=${encodeURIComponent(type)}`, $('#tool-dns-body'));
});

$('#calc-form')?.addEventListener('submit', (e) => {
  e.preventDefault();
  const v = $('#calc-input').value.trim();
  if (v) renderCalc(v);
});

/* —— 导出事件 —— */
$('#export-copy-json')?.addEventListener('click', async (e) => {
  if (!lastInfo) return;
  if (await copyText(JSON.stringify(lastInfo, null, 2))) flash(e.currentTarget, '已复制');
});

$('#export-copy-md')?.addEventListener('click', async (e) => {
  if (!lastInfo) return;
  if (await copyText(markdownReport(lastInfo))) flash(e.currentTarget, '已复制');
});

$('#export-download')?.addEventListener('click', () => {
  if (!lastInfo) return;
  const blob = new Blob([JSON.stringify(lastInfo, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `cfip-${lastInfo.ip.replace(/[:]/g, '-')}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

/* —— 键盘快捷键：/ 聚焦查询框，Esc 失焦清空 —— */
document.addEventListener('keydown', (e) => {
  const tag = (e.target?.tagName ?? '').toLowerCase();
  const typing = tag === 'input' || tag === 'textarea' || tag === 'select' || e.target?.isContentEditable;
  if (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
    e.preventDefault();
    input.focus();
    input.select();
    return;
  }
  if (e.key === 'Escape' && typing) {
    const target = e.target;
    if (target === input) input.value = '';
    target.blur();
  }
});

/* —— 启动：深链 ?ip= 或查询本机；渲染查询历史 —— */
function boot() {
  renderHistory();
  initSitePlugins();
  initLabs();
  // PWA 离线壳（仅 https / localhost 生效，失败静默）
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
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
