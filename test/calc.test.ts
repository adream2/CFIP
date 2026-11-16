import { describe, it, expect } from 'vitest';
import {
  calcIp,
  calcIpv4,
  calcIpv6,
  ipv4ToInt,
  intToIpv4,
  maskToPrefix,
  rangeToCidrs,
  parseIpv6Groups,
  compressIpv6,
} from '../public/assets/calc.js';

describe('calc：IPv4 基础换算', () => {
  it('整数互转', () => {
    expect(ipv4ToInt('255.255.255.255')).toBe(4294967295);
    expect(ipv4ToInt('0.0.0.0')).toBe(0);
    expect(intToIpv4(3232235777)).toBe('192.168.1.1');
    expect(ipv4ToInt('1.2.3.400')).toBeNull();
    expect(ipv4ToInt('a.b.c.d')).toBeNull();
  });

  it('掩码与前缀互推', () => {
    expect(maskToPrefix('255.255.255.0')).toBe(24);
    expect(maskToPrefix('255.255.0.0')).toBe(16);
    expect(maskToPrefix('255.0.255.0')).toBeNull(); // 非连续
    expect(maskToPrefix('0.0.0.0')).toBe(0);
  });
});

describe('calc：IPv4 网段计算', () => {
  it('/24 全字段', () => {
    const r = calcIpv4('192.168.1.10/24');
    expect(r.ok).toBe(true);
    expect(r.cidr).toBe('192.168.1.0/24');
    expect(r.network).toBe('192.168.1.0');
    expect(r.broadcast).toBe('192.168.1.255');
    expect(r.firstHost).toBe('192.168.1.1');
    expect(r.lastHost).toBe('192.168.1.254');
    expect(r.netmask).toBe('255.255.255.0');
    expect(r.wildcard).toBe('0.0.0.255');
    expect(r.totalAddresses).toBe(256);
    expect(r.usableHosts).toBe(254);
    expect(r.ipHex).toBe('0xC0A8010A');
    expect(r.kind).toMatch(/私有/);
  });

  it('/31 与 /32 的可用主机特例', () => {
    expect(calcIpv4('10.0.0.0/31').usableHosts).toBe(2);
    expect(calcIpv4('10.0.0.1/32').usableHosts).toBe(1);
    expect(calcIpv4('10.0.0.1/32').network).toBe('10.0.0.1');
  });

  it('点分掩码写法与空格分隔写法等价', () => {
    expect(calcIpv4('10.0.0.5 255.255.255.0').cidr).toBe('10.0.0.0/24');
    expect(calcIpv4('10.0.0.5/255.255.255.0').cidr).toBe('10.0.0.0/24');
  });

  it('非法输入给出错误而不是抛异常', () => {
    expect(calcIpv4('10.0.0.5/33').ok).toBe(false);
    expect(calcIpv4('10.0.0.5/255.0.255.0').ok).toBe(false);
    expect(calcIpv4('300.1.1.1').ok).toBe(false);
  });

  it('B 类地址与公网判定', () => {
    const r = calcIpv4('8.8.8.8/17');
    expect(r.kind).toMatch(/公网/);
    expect(r.cidr).toBe('8.8.0.0/17');
  });
});

describe('calc：范围聚合为 CIDR', () => {
  it('整段 /24 合并为单条', () => {
    expect(rangeToCidrs(ipv4ToInt('1.2.3.0'), ipv4ToInt('1.2.3.255'))).toEqual(['1.2.3.0/24']);
  });
  it('非对齐范围拆分为多条', () => {
    const cidrs = rangeToCidrs(ipv4ToInt('1.2.3.4'), ipv4ToInt('1.2.3.7'));
    expect(cidrs).toEqual(['1.2.3.4/30']);
    const multi = rangeToCidrs(ipv4ToInt('10.0.0.5'), ipv4ToInt('10.0.0.10'));
    expect(multi).toEqual(['10.0.0.5/32', '10.0.0.6/31', '10.0.0.8/31', '10.0.0.10/32']);
  });
  it('范围写法直接输出集合', () => {
    const r = calcIpv4('192.168.1.1-192.168.1.6');
    expect(r.ok).toBe(true);
    expect(r.mode).toBe('range');
    expect(r.totalAddresses).toBe(6);
    expect(r.cidrs).toContain('192.168.1.1/32');
  });
});

describe('calc：IPv6', () => {
  it('解析与 RFC 5952 压缩', () => {
    expect(parseIpv6Groups('2001:db8::1')).toHaveLength(8);
    expect(compressIpv6(parseIpv6Groups('2001:0db8:0000:0000:0000:0000:0000:0001'))).toBe('2001:db8::1');
    expect(compressIpv6(parseIpv6Groups('::'))).toBe('::');
    expect(compressIpv6(parseIpv6Groups('::1'))).toBe('::1');
    expect(parseIpv6Groups('1::2::3')).toBeNull();
  });

  it('/64 网络与地址总数', () => {
    const r = calcIpv6('2001:db8::1/64');
    expect(r.ok).toBe(true);
    expect(r.expanded).toBe('2001:0db8:0000:0000:0000:0000:0000:0001');
    expect(r.network).toBe('2001:db8::');
    expect(r.last).toBe('2001:db8::ffff:ffff:ffff:ffff');
    expect(r.totalAddresses).toBe('18446744073709551616');
    expect(r.kind).toMatch(/文档示例/);
  });

  it('IPv4 映射地址与链路本地识别', () => {
    expect(calcIpv6('::ffff:192.168.1.1').kind).toMatch(/IPv4 映射/);
    expect(calcIpv6('fe80::1').kind).toMatch(/链路本地/);
    expect(calcIpv6('fd00::1').kind).toMatch(/ULA/);
  });

  it('非法前缀与地址', () => {
    expect(calcIpv6('2001:db8::1/129').ok).toBe(false);
    expect(calcIpv6('2001:db8:::1').ok).toBe(false);
  });

  it('统一入口分派', () => {
    expect(calcIp('').ok).toBe(false);
    expect(calcIp('192.168.0.1').version).toBe(4);
    expect(calcIp('::1').version).toBe(6);
  });
});
