/**
 * 响应协商：JSON / 纯文本 / 静态资源委托。
 */

import type { IpInfo } from './types';

/** CLI 工具 UA 判定（浏览器 UA 走 HTML） */
export function wantsText(request: Request): boolean {
  const ua = request.headers.get('user-agent') ?? '';
  return /curl|wget|httpie|powershell|python-requests|python-urllib|go-http-client|okhttp|java\/|libwww-perl|node-fetch|undici|postman|insomnia/i.test(ua);
}

export function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

export function jsonResponse(info: IpInfo, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(info, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...corsHeaders(),
      ...extra,
    },
  });
}

export function errorJson(message: string, status = 400, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ error: message }, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...corsHeaders(),
      ...extra,
    },
  });
}

function v(x: string | number | boolean | null | undefined): string {
  if (x === null || x === undefined || x === '') return '—';
  return String(x);
}

function yn(x: boolean | null | undefined): string {
  return x === null || x === undefined ? '未知' : x ? '是' : '否';
}

/** 纯文本摘要（curl 场景） */
export function toTextSummary(info: IpInfo): string {
  const L = info.location;
  const N = info.network;
  const lines: string[] = [];
  const place = [L.country, L.region, L.city, L.district].filter(Boolean).join(' ');
  lines.push(`IP:      ${info.ip} (IPv${info.version}${info.isPublic ? '' : `, ${info.class}`})`);
  lines.push(`位置:    ${place || '—'}`);
  if (L.postalCode) lines.push(`邮编:    ${L.postalCode}`);
  if (L.latitude != null && L.longitude != null) {
    lines.push(`坐标:    ${L.latitude}, ${L.longitude}${L.timezone ? ` (${L.timezone})` : ''}`);
  }
  if (N.asn || N.isp || N.org) {
    lines.push(`网络:    ${N.asnLabel ? N.asnLabel + ' ' : ''}${N.isp || N.org || ''}`);
  }
  if (N.range.cidr || N.rir) {
    lines.push(`网段:    ${v(N.range.cidr)}${N.rir ? ` (${N.rir})` : ''}`);
  }
  if (N.abuseEmail) lines.push(`滥用邮箱: ${N.abuseEmail}`);
  if (info.node.provider) lines.push(`运营商/节点: ${info.node.provider}`);
  lines.push(`托管:    ${yn(info.node.hosting?.value)}  移动网络: ${yn(info.node.isMobile?.value)}  Anycast: ${yn(info.node.anycast?.value)}`);
  if (info.node.rdns.length) lines.push(`反向解析: ${info.node.rdns.join(', ')}`);
  if (info.reputation.dnsbl.length) {
    lines.push(`黑名单:  ${info.reputation.dnsblListedCount}/${info.reputation.dnsbl.length} 个列表列名`);
  }
  const p = info.reputation.proxy;
  if (p.isProxy != null || p.isVpn != null || p.isTor != null) {
    lines.push(`代理/VPN/Tor: ${yn(p.isProxy)} / ${yn(p.isVpn)} / ${yn(p.isTor)}`);
  }
  if (info.connection) {
    const c = info.connection;
    lines.push(`连接:    ${v(c.httpProtocol)} ${v(c.tlsVersion)}${c.clientTcpRttMs != null ? ` RTT ${c.clientTcpRttMs}ms` : ''}${c.colo ? ` (${c.colo})` : ''}`);
  }
  const failed = info.meta.sources.filter((s) => !s.ok).map((s) => s.id);
  lines.push(`数据源:  ${info.meta.sources.filter((s) => s.ok).map((s) => s.id).join(', ') || '无'}${failed.length ? `（失败: ${failed.join(', ')}）` : ''}`);
  return lines.join('\n') + '\n';
}
