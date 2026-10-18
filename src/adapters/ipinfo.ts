/**
 * ipinfo.io 适配器（可选，需 IPINFO_TOKEN，免费 5 万次/月）。
 * 无 secret 时该适配器不注册。
 */

import type { Adapter, AdapterResult } from './types';
import type { DeepPartial, IpInfo, SourceId } from '../types';

interface IpinfoResponse {
  ip?: string;
  hostname?: string;
  city?: string;
  region?: string;
  country?: string;
  loc?: string;
  org?: string; // "AS15169 Google LLC"
  postal?: string;
  timezone?: string;
  anycast?: boolean;
  privacy?: { vpn?: boolean; proxy?: boolean; tor?: boolean; hosting?: boolean; relay?: boolean };
}

export const ipinfoAdapter: Adapter = {
  id: 'ipinfo',
  timeoutMs: 5000,
  cacheTtlSec: 6 * 60 * 60,
  requiresSecret: 'IPINFO_TOKEN',
  async run(ctx, signal): Promise<AdapterResult> {
    const url = `https://ipinfo.io/${encodeURIComponent(ctx.ip)}?token=${encodeURIComponent(ctx.env.IPINFO_TOKEN ?? '')}`;
    const res = await ctx.fetchFn(url, { signal, headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`ipinfo HTTP ${res.status}`);
    const j = (await res.json()) as IpinfoResponse;

    const [lat, lng] = (j.loc ?? '').split(',').map(Number);
    const data: DeepPartial<IpInfo> = {
      location: {
        city: j.city ?? null,
        region: j.region ?? null,
        countryCode: j.country ?? null,
        postalCode: j.postal ?? null,
        latitude: Number.isFinite(lat) ? lat : null,
        longitude: Number.isFinite(lng) ? lng : null,
        timezone: j.timezone ?? null,
      },
      network: {
        asn: j.org?.startsWith('AS') ? Number(j.org.slice(2).split(' ')[0]) || null : null,
        org: j.org?.replace(/^AS\d+\s+/, '') ?? null,
      },
      node: {
        rdns: j.hostname ? [j.hostname] : [],
        anycast: j.anycast != null
          ? { value: !!j.anycast, confidence: 'medium', source: 'ipinfo' }
          : null,
      },
    };

    if (j.privacy) {
      const p = j.privacy;
      data.node = {
        ...data.node,
        hosting: p.hosting != null
          ? { value: !!p.hosting, confidence: 'medium', source: 'ipinfo' }
          : null,
      };
      data.reputation = {
        proxy: {
          isProxy: p.proxy ?? null,
          isVpn: p.vpn ?? null,
          isTor: p.tor ?? null,
          isAnonymous: null,
          sources: ['ipinfo' as SourceId],
        },
      };
    }
    return { data };
  },
};
