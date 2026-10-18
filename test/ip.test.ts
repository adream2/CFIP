import { describe, it, expect } from 'vitest';
import {
  parseIp, parseIpv4, parseIpv6, ipVersion, ipToBytes,
  classifyIp, reverseArpa, isChinaMainland, compressIpv6, parseIpv6Groups,
} from '../src/ip';

describe('parseIpv4', () => {
  it('accepts valid dotted quads', () => {
    expect(parseIpv4('8.8.8.8')).toBe('8.8.8.8');
    expect(parseIpv4('0.0.0.0')).toBe('0.0.0.0');
    expect(parseIpv4('255.255.255.255')).toBe('255.255.255.255');
    expect(parseIpv4('192.168.1.100')).toBe('192.168.1.100');
  });
  it('rejects malformed', () => {
    for (const bad of ['', '8.8.8', '256.1.1.1', '1.2.3.04', '01.2.3.4', '1.2.3.-1', 'a.b.c.d', '1.2.3.4.5', '1..2.3']) {
      expect(parseIpv4(bad), bad).toBeNull();
    }
  });
});

describe('parseIpv6', () => {
  it('normalizes to compressed canonical form', () => {
    expect(parseIpv6('::1')).toBe('::1');
    expect(parseIpv6('0:0:0:0:0:0:0:0')).toBe('::');
    expect(parseIpv6('2001:0db8:0000:0000:0000:0000:0000:0001')).toBe('2001:db8::1');
    expect(parseIpv6('2001:DB8::1')).toBe('2001:db8::1');
    expect(parseIpv6('fe80:0000:0000:0000:0202:b3ff:fe1e:8329')).toBe('fe80::202:b3ff:fe1e:8329');
    expect(parseIpv6('2606:4700:4700::1111')).toBe('2606:4700:4700::1111');
    expect(parseIpv6('::ffff:192.168.1.1')).toBe('::ffff:192.168.1.1');
    expect(parseIpv6('fe80::1%eth0')).toBe('fe80::1');
  });
  it('rejects malformed', () => {
    for (const bad of ['', ':::', '1::2::3', '12345::', '1:2:3:4:5:6:7', '1:2:3:4:5:6:7:8:9', 'gggg::1', '::ffff:300.1.1.1', '::ffff:1.2.3', '1:2:3:4:5:6:7:1.2.3.4']) {
      expect(parseIpv6(bad), bad).toBeNull();
    }
  });
  it('accepts embedded IPv4 in tail groups', () => {
    // RFC 4291 允许最后两组使用点分十进制
    expect(parseIpv6('1:2:3:4:5:6:1.2.3.4')).toBe('1:2:3:4:5:6:102:304');
  });
});

describe('parseIp', () => {
  it('routes and normalizes', () => {
    expect(parseIp('8.8.8.8')).toBe('8.8.8.8');
    expect(parseIp(' 2001:db8::1 ')).toBe('2001:db8::1');
    expect(parseIp('not-an-ip')).toBeNull();
    expect(parseIp('')).toBeNull();
  });
});

describe('ipVersion / ipToBytes', () => {
  it('detects version', () => {
    expect(ipVersion('8.8.8.8')).toBe(4);
    expect(ipVersion('::1')).toBe(6);
  });
  it('converts to bytes', () => {
    expect(Array.from(ipToBytes('8.8.8.8'))).toEqual([8, 8, 8, 8]);
    expect(Array.from(ipToBytes('::1'))).toEqual([0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1]);
    expect(Array.from(ipToBytes('2001:db8::1'))).toEqual([0x20,0x01,0x0d,0xb8,0,0,0,0,0,0,0,0,0,0,0,1]);
  });
});

describe('classifyIp', () => {
  const cases: Array<[string, string]> = [
    ['8.8.8.8', 'public'],
    ['1.1.1.1', 'public'],
    ['172.32.0.1', 'public'],
    ['0.0.0.0', 'bogon'],
    ['0.1.2.3', 'bogon'],
    ['10.1.2.3', 'private'],
    ['100.64.0.1', 'cgnat'],
    ['127.0.0.1', 'loopback'],
    ['169.254.1.1', 'link-local'],
    ['172.16.0.1', 'private'],
    ['172.31.255.255', 'private'],
    ['192.0.0.1', 'reserved'],
    ['192.0.2.5', 'documentation'],
    ['192.88.99.1', 'reserved'],
    ['192.168.0.1', 'private'],
    ['198.18.0.1', 'reserved'],
    ['198.51.100.1', 'documentation'],
    ['203.0.113.1', 'documentation'],
    ['224.0.0.1', 'multicast'],
    ['240.0.0.1', 'bogon'],
    ['255.255.255.255', 'bogon'],
    // IPv6
    ['::', 'bogon'],
    ['::1', 'loopback'],
    ['fc00::1', 'private'],
    ['fd12:3456::1', 'private'],
    ['fe80::1', 'link-local'],
    ['ff02::1', 'multicast'],
    ['2001:db8::1', 'documentation'],
    ['2002::1', 'reserved'],
    ['100::1', 'reserved'],
    ['2606:4700::1111', 'public'],
    ['::ffff:10.0.0.1', 'private'],
    ['::ffff:8.8.8.8', 'public'],
    ['64:ff9b::8.8.8.8', 'public'],
  ];
  for (const [ip, expected] of cases) {
    it(`${ip} → ${expected}`, () => {
      expect(classifyIp(ip)).toBe(expected);
    });
  }
});

describe('reverseArpa', () => {
  it('ipv4', () => {
    expect(reverseArpa('8.8.8.8')).toBe('8.8.8.8.in-addr.arpa');
    expect(reverseArpa('1.2.3.4')).toBe('4.3.2.1.in-addr.arpa');
  });
  it('ipv6 full nibble', () => {
    const arpa = reverseArpa('2001:db8::1')!;
    expect(arpa.endsWith('.ip6.arpa')).toBe(true);
    const nibbles = arpa.replace('.ip6.arpa', '').split('.');
    expect(nibbles.length).toBe(32);
    expect(nibbles[0]).toBe('1'); // 最低字节的最低位 nibble
  });
});

describe('isChinaMainland', () => {
  it('detects CN only', () => {
    expect(isChinaMainland('CN')).toBe(true);
    expect(isChinaMainland('cn')).toBe(true);
    expect(isChinaMainland('HK')).toBe(false);
    expect(isChinaMainland('TW')).toBe(false);
    expect(isChinaMainland(null)).toBe(false);
  });
});

describe('compressIpv6 edge cases', () => {
  it('single zero group is not compressed', () => {
    expect(compressIpv6(parseIpv6Groups('1:0:2:3:4:5:6:7')!)).toBe('1:0:2:3:4:5:6:7');
  });
  it('compresses the longest run', () => {
    expect(compressIpv6(parseIpv6Groups('1:0:0:2:0:0:0:3')!)).toBe('1:0:0:2::3');
  });
});
