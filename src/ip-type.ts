/**
 * IP 类型判定：原生 IP / 广播 IP。
 *
 * 概念（参考 MyIP 的 IP 类型卡片）：原生 IP 指 IP 的注册地与实际使用地一致；
 * 广播 IP 指注册在 A 国、实际广播使用在 B 国（常见于跨境机房、CDN 回源、代理池）。
 *
 * 这里只做启发式推断：以 RDAP 登记国家为权威，缺失时退回 AS 注册国家；
 * 与地理归属国家比对得出结论，并把判定依据一并返回，避免黑箱结论。
 */

import type { IpInfo, IpTypeVerdict } from './types';

/** rDNS 命中这些关键词时基本可判定为云 / IDC 机器 */
const CLOUD_RDNS = /(cloud|amazonaws|googleusercontent|azure|akamai|fastly|cdn|hosting|vps|server|dedicated|datacenter|idc|colocation|oracle|alibaba|aliyun|tencent|ovh|hetzner|digitalocean|linode|vultr|contabo|leaseweb|m247)/i;

const PROVIDER_LABELS: Record<string, string> = {
  cloud: '云厂商',
  cdn: 'CDN',
  hosting: '托管/IDC',
  isp: '运营商',
  education: '教育网',
  government: '政府',
  unknown: '未知',
};

function cc(v: string | null | undefined): string | null {
  const s = (v ?? '').trim().toUpperCase();
  return s.length === 2 ? s : null;
}

export function deriveIpType(info: IpInfo): IpTypeVerdict | null {
  if (!info.isPublic) return null;

  const geo = cc(info.location.countryCode);
  const registry = cc(info.network.registryCountry);
  const asReg = cc(info.network.asCountry);
  const reasons: string[] = [];

  // 机房属性：与原生/广播无关，但对「这个 IP 能不能当住宅用」很关键
  const cloudRdns = info.node.rdns.find((h) => CLOUD_RDNS.test(h));
  if (cloudRdns) reasons.push(`rDNS 指向云 / IDC：${cloudRdns}`);

  if (!geo) {
    return { value: 'unknown', confidence: 'low', source: 'static', reasons: [...reasons, '缺少地理归属国家，无法比对注册地'] };
  }

  const basedOn = registry ? 'RDAP 注册地' : asReg ? 'AS 注册国家' : null;
  const registered = registry ?? asReg;
  if (!registered) {
    return { value: 'unknown', confidence: 'low', source: 'static', reasons: [...reasons, '缺少注册地信息（RDAP / bgp.tools 均无返回值）'] };
  }

  reasons.push(`地理归属 ${geo}，${basedOn} ${registered}`);
  if (info.node.provider) {
    const t = info.node.providerType ? PROVIDER_LABELS[info.node.providerType] ?? info.node.providerType : null;
    reasons.push(`ASN 归属：${info.node.provider}${t ? `（${t}）` : ''}`);
  }

  // 注册地 = 使用地 → 原生；否则 → 广播
  const same = geo === registered;
  const confidence: IpTypeVerdict['confidence'] = registry ? 'high' : 'medium';
  return {
    value: same ? 'native' : 'broadcast',
    confidence,
    source: registry ? 'rdap' : 'bgptools',
    reasons: same
      ? [...reasons, '注册地与使用地一致，按原生 IP 判定']
      : [...reasons, `注册地与使用地不一致（${registered} → ${geo}），按广播 IP 判定`],
  };
}

export const IP_TYPE_LABELS: Record<IpTypeVerdict['value'], string> = {
  native: '原生 IP',
  broadcast: '广播 IP',
  unknown: '无法判定',
};
