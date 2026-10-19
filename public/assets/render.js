/** CFIP 纯渲染助手：字符串拼接、无 DOM 依赖，可单测（见 test/render.test.ts）。
 *  注意：row() 默认对值做 HTML 转义（防注入）；judgement()/yn() 产生的可信徽章
 *  HTML 必须显式传 { raw: true }，否则会被转义成可见的标签文本。 */

export const dash = '—';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

export function flagEmoji(cc) {
  if (!cc || !/^[A-Za-z]{2}$/.test(cc)) return '';
  return String.fromCodePoint(...[...cc.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

/** label 始终转义；value 默认转义，raw: true 时按可信 HTML 原样插入 */
export function row(label, value, { mono = false, raw = false } = {}) {
  const empty = value === null || value === undefined || value === '';
  return `<div class="row"><dt>${esc(label)}</dt><dd class="${mono ? 'mono' : ''}">${empty ? dash : raw ? value : esc(value)}</dd></div>`;
}

export function rows(items) {
  return `<dl class="rows">${items.join('')}</dl>`;
}

export function badge(text, tone = '') {
  return `<span class="badge ${tone}">${esc(text)}</span>`;
}

export function judgement(j, yesText = '是', noText = '否') {
  if (!j) return dash;
  const tone = j.value ? 'bad' : 'ok';
  return `${badge(j.value ? yesText : noText, tone)}<span class="badge">置信度 ${j.confidence === 'high' ? '高' : j.confidence === 'medium' ? '中' : '低'}</span>`;
}

export function yn(v) {
  return v === null || v === undefined ? dash : badge(v ? '是' : '否', v ? 'bad' : 'ok');
}

/** 等距圆柱投影内联 SVG 地图（经纬网格 + 定位点），零外部请求 */
export function mapSvg(lat, lng) {
  if (lat == null || lng == null) return '';
  const W = 360, H = 180;
  const x = ((lng + 180) / 360 * W).toFixed(1);
  const y = ((90 - lat) / 180 * H).toFixed(1);
  let grid = '';
  for (let i = 1; i < 12; i++) grid += `<line x1="${i * 30}" y1="0" x2="${i * 30}" y2="${H}"/>`;
  for (let i = 1; i < 6; i++) grid += `<line x1="0" y1="${i * 30}" x2="${W}" y2="${i * 30}"/>`;
  return `<svg class="map" viewBox="0 0 ${W} ${H}" role="img" aria-label="经纬度位置图">
    <g class="map-grid">${grid}</g>
    <line class="map-equator" x1="0" y1="90" x2="${W}" y2="90"/>
    <circle class="map-ring" cx="${x}" cy="${y}" r="8"/>
    <circle class="map-dot" cx="${x}" cy="${y}" r="3.5"/>
    <text class="map-label" x="${W - 4}" y="${H - 5}" text-anchor="end">${Number(lat).toFixed(2)}, ${Number(lng).toFixed(2)}</text>
  </svg>`;
}
