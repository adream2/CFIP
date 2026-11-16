import { describe, it, expect } from 'vitest';
import { emptyIpInfo } from '../src/types';
import type { IpInfo } from '../src/types';
import { deriveIpType, IP_TYPE_LABELS } from '../src/ip-type';

function base(ip = '8.8.8.8'): IpInfo {
  return emptyIpInfo(ip, ip.includes(':') ? 6 : 4, 'public', 21600);
}

describe('IP 类型判定：原生 / 广播', () => {
  it('非公网地址不判定', () => {
    expect(deriveIpType(emptyIpInfo('192.168.1.1', 4, 'private', 60))).toBeNull();
  });

  it('注册地 = 使用地 → 原生，RDAP 在场时高置信度', () => {
    const info = base();
    info.location.countryCode = 'US';
    info.network.registryCountry = 'us';
    const v = deriveIpType(info)!;
    expect(v.value).toBe('native');
    expect(v.confidence).toBe('high');
    expect(v.source).toBe('rdap');
    expect(v.reasons.join(' ')).toMatch(/一致/);
  });

  it('注册地与使用地不一致 → 广播', () => {
    const info = base();
    info.location.countryCode = 'CN';
    info.network.registryCountry = 'US';
    info.node.provider = 'Example Cloud';
    info.node.providerType = 'cloud';
    const v = deriveIpType(info)!;
    expect(v.value).toBe('broadcast');
    expect(v.confidence).toBe('high');
    expect(v.reasons.join(' ')).toMatch(/US → CN/);
    expect(v.reasons.join(' ')).toMatch(/云厂商/);
  });

  it('无 RDAP 时退回 AS 注册国家，置信度降为 medium', () => {
    const info = base();
    info.location.countryCode = 'JP';
    info.network.asCountry = 'JP';
    const v = deriveIpType(info)!;
    expect(v.value).toBe('native');
    expect(v.confidence).toBe('medium');
    expect(v.source).toBe('bgptools');
  });

  it('缺少注册地信息 → unknown', () => {
    const info = base();
    info.location.countryCode = 'JP';
    const v = deriveIpType(info)!;
    expect(v.value).toBe('unknown');
    expect(v.confidence).toBe('low');
  });

  it('rDNS 云关键词作为附加依据输出', () => {
    const info = base();
    info.location.countryCode = 'DE';
    info.network.registryCountry = 'DE';
    info.node.rdns = ['static.1.2.3.4.clients.your-server.de'];
    const v = deriveIpType(info)!;
    expect(v.reasons.join(' ')).toMatch(/rDNS 指向云/);
  });

  it('中文标签齐全', () => {
    expect(IP_TYPE_LABELS.native).toBe('原生 IP');
    expect(IP_TYPE_LABELS.broadcast).toBe('广播 IP');
    expect(IP_TYPE_LABELS.unknown).toBe('无法判定');
  });
});
