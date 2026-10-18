/**
 * ip-api.com 适配器（二级降级源，免费无 Key，45 次/分钟）。
 * 免费档禁止商业用途 —— ENABLE_IPAPI=false 可一键关闭，README 有明示。
 */

import type { Adapter, AdapterResult } from './types';
import type { DeepPartial, IpInfo, SourceId } from '../types';

interface IpApiResponse {
  status?: 'success' | 'fail';
  message?: string;
  continent?: string;
  continentCode?: string;
  country?: string;
  countryCode?: string;
  region?: string;
  regionName?: string;
  city?: string;
  district?: string;
  zip?: string;
  lat?: number;
  lon?: number;
  timezone?: string;
  offset?: number;
  isp?: string;
  org?: string;
  as?: string; // "AS15169 Google LLC"
  asname?: string;
  reverse?: string;
  mobile?: boolean;
  proxy?: boolean;
  hosting?: boolean;
}

export const FIELDS = [
  'status', 'message', 'continent', 'continentCode', 'country', 'countryCode',
  'region', 'regionName', 'city', 'district', 'zip', 'lat', 'lon', 'timezone',
  'offset', 'isp', 'org', 'as', 'asname', 'reverse', 'mobile', 'proxy', 'hosting',
].join(',');

/** "AS15169 Google LLC" → 15169 */
export function parseAsnField(as: string | undefined): number | null {
  if (!as) return null;
  const m = /^AS(\d+)/i.exec(as.trim());
  return m ? Number(m[1]) : null;
}

export const ipapiAdapter: Adapter = {
  id: 'ipapi',
  timeoutMs: 5000,
  cacheTtlSec: 6 * 60 * 60,
  async run(ctx, signal): Promise<AdapterResult> {
    const url = `http://ip-api.com/json/${encodeURIComponent(ctx.ip)}?fields=${FIELDS}&lang=zh-CN`;
    const res = await ctx.fetchFn(url, { signal, headers: { 'Accept': 'application/json' } });
    if (!res.ok) throw new Error(`ip-api HTTP ${res.status}`);
    const j = (await res.json()) as IpApiResponse;
    if (j.status === 'fail') throw new Error(`ip-api: ${j.message ?? 'fail'}`);

    const data: DeepPartial<IpInfo> = {
      location: {
        continent: j.continent ?? null,
        continentCode: j.continentCode ?? null,
        country: j.country ?? null,
        countryCode: j.countryCode ?? null,
        region: j.regionName ?? null,
        regionCode: j.region ?? null,
        city: j.city ?? null,
        district: j.district ?? null,
        postalCode: j.zip ?? null,
        latitude: j.lat ?? null,
        longitude: j.lon ?? null,
        timezone: j.timezone ?? null,
        utcOffsetSeconds: j.offset ?? null,
      },
      network: {
        asn: parseAsnField(j.as),
        isp: j.isp ?? null,
        org: j.org ?? null,
        asName: j.asname ?? null,
      },
      node: {
        rdns: j.reverse ? [j.reverse] : [],
        isMobile: j.mobile != null
          ? { value: !!j.mobile, confidence: 'medium', source: 'ipapi' }
          : null,
        hosting: j.hosting != null
          ? { value: !!j.hosting, confidence: 'medium', source: 'ipapi' }
          : null,
      },
      reputation: {
        proxy: {
          isProxy: j.proxy ?? null,
          isVpn: null,
          isTor: null,
          isAnonymous: null,
          sources: ['ipapi' as SourceId],
        },
      },
    };
    return { data };
  },
};
