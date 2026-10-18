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
