/**
 * 字段级数据源优先级表。
 * key 为 IpInfo 的点分路径；合并时按顺序取第一个非空值。
 * 未列出的路径使用 DEFAULT_ORDER。
 */

import type { SourceId } from '../types';

export const DEFAULT_ORDER: SourceId[] = [
  'ipwhois',
  'ip2region',
  'ipapi',
  'rdap',
  'doh',
  'bgptools',
  'ipinfo',
  'abuseipdb',
];

export const FIELD_PRIORITIES: Record<string, SourceId[]> = {
  // —— 地理位置 ——
  // ip2region 的国内数据为中文省市区，优先；其空值（"0"）自然落空交给后续源
  'location.continent': ['ipwhois', 'ipapi'],
  'location.continentCode': ['ipwhois', 'ipapi'],
  'location.country': ['ip2region', 'ipwhois', 'ipapi', 'rdap'],
  'location.countryCode': ['ipwhois', 'ipapi', 'rdap', 'ipinfo'],
  'location.countryNative': ['ipwhois', 'ipinfo'],
  'location.capital': ['ipwhois'],
  'location.region': ['ip2region', 'ipwhois', 'ipapi', 'rdap'],
  'location.regionCode': ['ipwhois', 'ipapi'],
  'location.city': ['ip2region', 'ipwhois', 'ipapi'],
  'location.district': ['ipwhois', 'ipapi'],
  'location.postalCode': ['ipwhois', 'ipapi'],
  'location.latitude': ['ipwhois', 'ipapi', 'ipinfo'],
  'location.longitude': ['ipwhois', 'ipapi', 'ipinfo'],
  'location.timezone': ['ipwhois', 'ipapi'],
  'location.utcOffsetSeconds': ['ipwhois', 'ipapi'],
  'location.callingCode': ['ipwhois'],

  // —— 网络 ——
  'network.asn': ['ipwhois', 'ipapi', 'ipinfo', 'cf'],
  'network.asnLabel': ['ipwhois', 'ipapi', 'ipinfo'],
  'network.isp': ['ipapi', 'ipwhois', 'rdap', 'ipinfo'],
  'network.org': ['ipapi', 'ipwhois', 'rdap', 'bgptools', 'ipinfo'],
  'network.asName': ['bgptools', 'rdap', 'ipwhois', 'ipapi'],
  'network.asDomain': ['ipwhois', 'rdap'],
  'network.asCountry': ['bgptools', 'rdap'],
  'network.range.start': ['rdap'],
  'network.range.end': ['rdap'],
  'network.range.cidr': ['rdap'],
  'network.range.count': ['rdap'],
  'network.rir': ['rdap'],
  'network.allocationDate': ['rdap'],
  'network.abuseEmail': ['rdap'],
  'network.usageType': ['rdap'],
  'network.rdapServer': ['rdap'],

  // —— 节点 ——
  'node.hosting': ['ipwhois', 'ipapi', 'ipinfo'],
  'node.anycast': ['ipwhois', 'ipapi', 'ipinfo'],
  'node.provider': ['ip2region', 'ipwhois', 'ipinfo'],
  'node.providerType': ['ipwhois', 'ipapi', 'ipinfo'],
  'node.isMobile': ['ipapi', 'ipwhois', 'ipinfo'],
  'node.isBroadband': ['ipapi', 'ipwhois'],
  'node.rdns': ['doh', 'ipapi'],
  'node.rdnsError': ['doh'],

  // —— 原子叶子对象（整体胜出，见 merge.ts LEAF_OBJECT_PATHS） ——
  'network.range': ['rdap'],
  'connection': ['cf'],

  // —— 信誉 ——
  'reputation.dnsbl': ['doh'],
  'reputation.dnsblListedCount': ['doh'],
  'reputation.proxy.isProxy': ['ipwhois', 'ipapi', 'ipinfo'],
  'reputation.proxy.isVpn': ['ipwhois', 'ipapi', 'ipinfo'],
  'reputation.proxy.isTor': ['ipwhois', 'ipapi', 'ipinfo'],
  'reputation.proxy.isAnonymous': ['ipwhois', 'ipapi', 'ipinfo'],
  'reputation.proxy.sources': ['ipwhois', 'ipapi', 'ipinfo'],
  'reputation.abuseScore': ['abuseipdb'],
  'reputation.abuseReports': ['abuseipdb'],

  // —— 连接（仅自身查询） ——
  'connection.httpProtocol': ['cf'],
  'connection.tlsVersion': ['cf'],
  'connection.tlsCipher': ['cf'],
  'connection.clientTcpRttMs': ['cf'],
  'connection.colo': ['cf'],
  'connection.asOrganization': ['cf'],
  'connection.userAgent': ['cf'],
};

export function getPriority(path: string): SourceId[] {
  return FIELD_PRIORITIES[path] ?? DEFAULT_ORDER;
}
