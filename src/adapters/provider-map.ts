/**
 * 静态 ASN → 云厂商 / CDN / 运营商 映射。
 * 用于 node.provider 兜底与 anycast 判定（推断值，confidence=medium）。
 */

import type { Judgement, SourceId } from '../types';

export interface AsnRecord {
  name: string;
  type: 'cloud' | 'cdn' | 'hosting' | 'isp' | 'education' | 'government' | 'unknown';
  anycast?: boolean;
}

/** 知名 ASN 表（按 ASN 数字） */
export const ASN_TABLE: Record<number, AsnRecord> = {
  // —— CDN / Anycast ——
  13335: { name: 'Cloudflare', type: 'cdn', anycast: true },
  54113: { name: 'Fastly', type: 'cdn', anycast: true },
  16625: { name: 'Akamai', type: 'cdn', anycast: true },
  20940: { name: 'Akamai', type: 'cdn', anycast: true },
  32751: { name: 'Akamai', type: 'cdn', anycast: true },
  15169: { name: 'Google', type: 'cloud', anycast: true },
  36040: { name: 'Google', type: 'cloud', anycast: true },
  19281: { name: 'Quad9', type: 'cdn', anycast: true },
  36692: { name: 'Cisco OpenDNS', type: 'cdn', anycast: true },
  // —— 云厂商 ——
  16509: { name: 'Amazon AWS', type: 'cloud' },
  14618: { name: 'Amazon AWS', type: 'cloud' },
  8075: { name: 'Microsoft Azure', type: 'cloud' },
  8068: { name: 'Microsoft', type: 'cloud' },
  45102: { name: '阿里云', type: 'cloud' },
  37963: { name: '阿里云', type: 'cloud' },
  45090: { name: '腾讯云', type: 'cloud' },
  132203: { name: '腾讯云', type: 'cloud' },
  55990: { name: '华为云', type: 'cloud' },
  136907: { name: '华为云', type: 'cloud' },
  55967: { name: '百度云', type: 'cloud' },
  38365: { name: 'IBM Cloud', type: 'cloud' },
  36351: { name: 'IBM SoftLayer', type: 'hosting' },
  37987: { name: 'Google Cloud (Pacnet)', type: 'cloud' },
  // —— 托管 / IDC ——
  14061: { name: 'DigitalOcean', type: 'hosting' },
  63949: { name: 'Linode (Akamai Cloud)', type: 'hosting' },
  16276: { name: 'OVH', type: 'hosting' },
  24940: { name: 'Hetzner', type: 'hosting' },
  51167: { name: 'Contabo', type: 'hosting' },
  60781: { name: 'LeaseWeb', type: 'hosting' },
  49505: { name: 'Selectel', type: 'hosting' },
  35916: { name: 'M247', type: 'hosting' },
  60068: { name: 'CDN77', type: 'cdn' },
  16591: { name: 'Google Fiber', type: 'isp' },
  // —— 中国运营商 ——
  4134: { name: '中国电信', type: 'isp' },
  4837: { name: '中国联通', type: 'isp' },
  4808: { name: '中国联通', type: 'isp' },
  9808: { name: '中国移动', type: 'isp' },
  24400: { name: '中国移动', type: 'isp' },
  4538: { name: '中国教育和科研计算机网 CERNET', type: 'education' },
  9389: { name: '中国长城宽带', type: 'isp' },
  58519: { name: '中国移动', type: 'isp' },
  137693: { name: '中国电信', type: 'isp' },
  // —— 海外运营商 / 骨干 ——
  7922: { name: 'Comcast', type: 'isp' },
  7018: { name: 'AT&T', type: 'isp' },
  3356: { name: 'Lumen (Level3)', type: 'isp' },
  6939: { name: 'Hurricane Electric', type: 'isp' },
  174: { name: 'Cogent', type: 'isp' },
  3257: { name: 'GTT', type: 'isp' },
  1299: { name: 'Arelion (Telia)', type: 'isp' },
  2914: { name: 'NTT', type: 'isp' },
  2497: { name: 'IIJ', type: 'isp' },
  4713: { name: 'NTT Communications', type: 'isp' },
  3491: { name: 'PCCW', type: 'isp' },
  4766: { name: 'Korea Telecom', type: 'isp' },
  9318: { name: 'SK Broadband', type: 'isp' },
  55836: { name: 'Reliance Jio', type: 'isp' },
  9498: { name: 'Bharti Airtel', type: 'isp' },
  4760: { name: 'Telstra', type: 'isp' },
  7545: { name: 'TPG Telecom', type: 'isp' },
  6830: { name: 'Liberty Global', type: 'isp' },
  3320: { name: 'Deutsche Telekom', type: 'isp' },
  680: { name: 'DFN (德国科研网)', type: 'education' },
  2603: { name: 'NORDUnet', type: 'education' },
};

const SOURCE: SourceId = 'static';

export function lookupAsn(asn: number | null): AsnRecord | null {
  if (asn == null) return null;
  return ASN_TABLE[asn] ?? null;
}

export function asnProvider(asn: number | null): { provider: string; providerType: AsnRecord['type'] } | null {
  const rec = lookupAsn(asn);
  if (!rec) return null;
  return { provider: rec.name, providerType: rec.type };
}

export function asnAnycast(asn: number | null): Judgement<boolean> | null {
  const rec = lookupAsn(asn);
  if (!rec?.anycast) return null;
  return { value: true, confidence: 'medium', source: SOURCE };
}
