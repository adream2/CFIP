/**
 * cf 适配器：直接读取 request.cf，零网络开销。
 * 仅自身查询时有数据；外部 IP 查询时 request.cf 反映的是访客而非目标。
 */

import type { Adapter, AdapterResult } from './types';
import type { DeepPartial, IpInfo } from '../types';

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}
function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export const cfAdapter: Adapter = {
  id: 'cf',
  timeoutMs: 0,
  cacheTtlSec: 0,
  async run(ctx): Promise<AdapterResult> {
    const data: DeepPartial<IpInfo> = {};
    if (!ctx.isSelf) return { data };
    const cf = ctx.cf;
    // cf 字段逐字段防御读取；本地/预览环境下 cf 可能为空对象
    data.connection = {
      httpProtocol: str(cf?.httpProtocol),
      tlsVersion: str(cf?.tlsVersion),
      tlsCipher: str(cf?.tlsCipher),
      clientTcpRttMs: num(cf?.clientTcpRtt) ?? num(cf?.clientQuicRtt),
      colo: str(cf?.colo),
      asOrganization: str(cf?.asOrganization),
      userAgent: ctx.userAgent,
    };
    const asn = num(cf?.asn);
    if (asn != null) data.network = { asn };
    return { data };
  },
};
