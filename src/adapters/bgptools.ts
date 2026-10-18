/**
 * bgp.tools 适配器：ASN 权威详情（名称、描述、注册国家）。
 * 条件触发型：仅在已知 ASN 时运行（由入口在首轮合并后调用）。
 */

import type { Adapter, AdapterResult } from './types';
import type { DeepPartial, IpInfo } from '../types';

interface BgpToolsResponse {
  asn?: number;
  name?: string;
  descr?: string;
  country?: string;
  org?: string;
}

export const bgptoolsAdapter: Adapter = {
  id: 'bgptools',
  timeoutMs: 4000,
  cacheTtlSec: 24 * 60 * 60,
  async run(ctx, signal): Promise<AdapterResult> {
    const asn = ctx.merged?.network.asn;
    if (!asn) return { data: {} };
    const url = `https://bgp.tools/api/v1/as/${asn}`;
    const res = await ctx.fetchFn(url, { signal, headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`bgp.tools HTTP ${res.status}`);
    const j = (await res.json()) as BgpToolsResponse;
    const data: DeepPartial<IpInfo> = {
      network: {
        asName: j.name ?? null,
        org: j.descr ?? null,
        asCountry: j.country ?? null,
      },
    };
    return { data };
  },
};
