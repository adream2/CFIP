/**
 * AbuseIPDB 适配器（可选，需 ABUSEIPDB_KEY，免费 1000 次/天）。
 * 无 secret 时该适配器不注册。
 */

import type { Adapter, AdapterResult } from './types';
import type { DeepPartial, IpInfo } from '../types';

interface AbuseIpdbResponse {
  data?: {
    abuseConfidenceScore?: number;
    totalReports?: number;
    isWhitelisted?: boolean;
  };
}

export const abuseipdbAdapter: Adapter = {
  id: 'abuseipdb',
  timeoutMs: 5000,
  cacheTtlSec: 60 * 60,
  requiresSecret: 'ABUSEIPDB_KEY',
  async run(ctx, signal): Promise<AdapterResult> {
    const url = `https://api.abuseipdb.com/api/v2/check?ipAddress=${encodeURIComponent(ctx.ip)}&maxAgeInDays=90`;
    const res = await ctx.fetchFn(url, {
      signal,
      headers: { Accept: 'application/json', Key: ctx.env.ABUSEIPDB_KEY ?? '' },
    });
    if (!res.ok) throw new Error(`abuseipdb HTTP ${res.status}`);
    const j = (await res.json()) as AbuseIpdbResponse;
    const data: DeepPartial<IpInfo> = {
      reputation: {
        abuseScore: j.data?.abuseConfidenceScore ?? null,
        abuseReports: j.data?.totalReports ?? null,
      },
    };
    return { data };
  },
};
