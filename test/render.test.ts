import { describe, it, expect } from 'vitest';
import { esc, badge, judgement, yn, row, rows } from '../public/assets/render.js';

/** 渲染助手回归测试：曾因 row() 对可信 HTML 也做 esc() 转义，
 *  导致页面上直接显示 <span class="badge ok"> 等标签文本（线上事故）。 */

describe('esc 转义', () => {
  it('转义全部危险字符', () => {
    expect(esc('<span class="badge">')).toBe('&lt;span class=&quot;badge&quot;&gt;');
    expect(esc("a'b&c")).toBe('a&#39;b&amp;c');
    expect(esc(null)).toBe('');
    expect(esc(undefined)).toBe('');
  });
});

describe('badge / judgement / yn', () => {
  it('badge 生成徽章 HTML 且转义文本', () => {
    expect(badge('否', 'ok')).toBe('<span class="badge ok">否</span>');
    expect(badge('<x>')).toBe('<span class="badge ">&lt;x&gt;</span>');
  });

  it('judgement 生成双徽章（值 + 置信度）', () => {
    const j = { value: false, confidence: 'medium', source: 'ipwhois' };
    expect(judgement(j)).toBe('<span class="badge ok">否</span><span class="badge">置信度 中</span>');
    expect(judgement({ value: true, confidence: 'high', source: 'x' })).toContain('置信度 高');
    expect(judgement(null)).toBe('—');
  });

  it('yn 三态', () => {
    expect(yn(true)).toBe('<span class="badge bad">是</span>');
    expect(yn(false)).toBe('<span class="badge ok">否</span>');
    expect(yn(null)).toBe('—');
  });
});

describe('row 的转义策略', () => {
  it('默认转义值（防注入）', () => {
    expect(row('k', '<b>x</b>')).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(row('k', null)).toContain('—');
    expect(row('<l>', 'v')).toContain('&lt;l&gt;'); // label 同样转义
  });

  it('raw: true 时原样插入可信 HTML（judgement/yn 场景）——本仓库头号渲染事故回归', () => {
    const j = { value: false, confidence: 'medium', source: 'ipwhois' };
    const html = row('托管 / 数据中心', judgement(j), { raw: true });
    expect(html).toContain('<span class="badge ok">否</span>');
    expect(html).not.toContain('&lt;span');
    const proxy = row('代理 / VPN / Tor', `${yn(false)} ${yn(null)}`, { raw: true });
    expect(proxy).not.toContain('&lt;span');
    expect(proxy).toContain('<span class="badge ok">否</span>');
  });

  it('rows 拼接多条', () => {
    expect(rows([row('a', '1'), row('b', '2')])).toBe('<dl class="rows"><div class="row"><dt>a</dt><dd class="">1</dd></div><div class="row"><dt>b</dt><dd class="">2</dd></div></dl>');
  });
});
