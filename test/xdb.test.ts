import { describe, it, expect } from 'vitest';
import { XdbSearcher, parseRegion } from '../src/xdb/searcher';
import { buildSyntheticXdb } from './helpers/synthetic-xdb';

describe('XdbSearcher（合成数据）', () => {
  const searcher = new XdbSearcher(buildSyntheticXdb());

  it('命中网段内 IP', () => {
    expect(searcher.search('1.2.3.4')).toBe('中国|测试省|测试市|测试运营商|CN');
    expect(searcher.search('8.8.8.8')).toBe('United States|California|0|Google LLC|US');
  });

  it('命中网段边界', () => {
    expect(searcher.search('1.2.0.0')).toBe('中国|测试省|测试市|测试运营商|CN');
    expect(searcher.search('1.2.255.255')).toBe('中国|测试省|测试市|测试运营商|CN');
    expect(searcher.search('8.8.8.0')).toBe('United States|California|0|Google LLC|US');
    expect(searcher.search('8.8.8.255')).toBe('United States|California|0|Google LLC|US');
  });

  it('未覆盖/越界返回空串', () => {
    expect(searcher.search('9.9.9.9')).toBe('');
    expect(searcher.search('1.1.255.255')).toBe('');
    expect(searcher.search('1.3.0.0')).toBe('');
    expect(searcher.search('8.8.9.0')).toBe('');
  });

  it('IPv6 查询抛版本不匹配错误', () => {
    expect(() => searcher.search('::1')).toThrow(/version mismatch/);
  });
});

describe('parseRegion', () => {
  it('解析新格式（国家|省|市|运营商|ISO）', () => {
    const r = parseRegion('中国|江苏省|南京市|0|CN');
    expect(r).toMatchObject({ country: '中国', province: '江苏省', city: '南京市', isp: '0', iso: 'CN' });
  });
  it('解析旧格式（国家|区域|省|市|运营商）', () => {
    const r = parseRegion('中国|华北|北京|北京|电信');
    expect(r).toMatchObject({ country: '中国', province: '北京', city: '北京', isp: '电信' });
  });
  it('字段不足时容错', () => {
    const r = parseRegion('中国');
    expect(r.country).toBe('中国');
    expect(r.province).toBe('');
  });
});
