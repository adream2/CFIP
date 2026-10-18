/**
 * ipwho.is 适配器（主数据源，免费无 Key，1000 次/天/客户端 IP）。
 * 注意：从 Worker 出站时对方看到的是 Cloudflare 共享出口 IP，
 * 配额可能被共用耗尽 —— 依赖缓存 + 降级链 + 熔断兜底。
 */

import type { Adapter, AdapterResult } from './types';
import type { DeepPartial, IpInfo, SourceId } from '../types';

interface IpWhoisResponse {
  success?: boolean;
  message?: string;
  ip?: string;
  type?: string;
  continent?: string;
  continent_code?: string;
  country?: string;
  country_code?: string;
  region?: string;
  region_code?: string;
  city?: string;
  latitude?: number;
  longitude?: number;
  postal?: string;
  calling_code?: string;
  capital?: string;
  native?: { country?: string; city?: string; region?: string; capital?: string; continent?: string };
  connection?: { asn?: number; org?: string; isp?: string; domain?: string };
  timezone?: { id?: string; offset?: number };
  security?: { anonymous?: boolean; proxy?: boolean; vpn?: boolean; tor?: boolean; hosting?: boolean };
}

export const ipwhoisAdapter: Adapter = {
  id: 'ipwhois',
  timeoutMs: 5000,
  cacheTtlSec: 6 * 60 * 60,
  async run(ctx, signal): Promise<AdapterResult> {
    const url = `https://ipwho.is/${encodeURIComponent(ctx.ip)}`;
    const res = await ctx.fetchFn(url, { signal, headers: { 'Accept': 'application/json' } });
    if (!res.ok) throw new Error(`ipwho.is HTTP ${res.status}`);
    const j = (await res.json()) as IpWhoisResponse;
    if (j.success === false) throw new Error(`ipwho.is: ${j.message ?? 'unknown error'}`);

    const data: DeepPartial<IpInfo> = {
      location: {
        continent: j.continent ?? null,
        continentCode: j.continent_code ?? null,
        country: j.country ?? null,
        countryCode: j.country_code ?? null,
        countryNative: j.native?.country ?? null,
        capital: j.capital ?? null,
        region: j.region ?? null,
        regionCode: j.region_code ?? null,
        city: j.city ?? null,
        postalCode: j.postal ?? null,
        latitude: j.latitude ?? null,
        longitude: j.longitude ?? null,
        timezone: j.timezone?.id ?? null,
        utcOffsetSeconds: j.timezone?.offset ?? null,
        callingCode: j.calling_code != null ? String(j.calling_code) : null,
      },
      network: {
        asn: j.connection?.asn ?? null,
        isp: j.connection?.isp ?? null,
        org: j.connection?.org ?? null,
        asDomain: j.connection?.domain ?? null,
      },
    };

    if (j.security) {
      const s = j.security;
      const hasAny = s.proxy != null || s.vpn != null || s.tor != null || s.anonymous != null;
      if (hasAny) {
        data.reputation = {
          proxy: {
            isProxy: s.proxy ?? null,
            isVpn: s.vpn ?? null,
            isTor: s.tor ?? null,
            isAnonymous: s.anonymous ?? null,
            sources: ['ipwhois' as SourceId],
          },
        };
      }
      if (s.hosting != null) {
        data.node = {
          hosting: { value: !!s.hosting, confidence: 'medium', source: 'ipwhois' },
        };
      }
    }
    return { data };
  },
};
