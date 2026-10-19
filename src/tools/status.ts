/**
 * 服务状态聚合（/api/status）：并发拉取各家 Statuspage 的 summary JSON（无 Key），
 * 归一化为 indicator + 描述。60s 缓存（状态变化快）。
 */

export interface ServiceStatus {
  service: string;
  indicator: string | null; // none / minor / major / critical / maintenance
  description: string | null;
  updatedAt: string | null;
  error: string | null;
}

export interface StatusReport {
  services: ServiceStatus[];
  generatedAt: string;
}

const STATUS_SOURCES = [
  { service: 'cloudflare', url: 'https://www.cloudflarestatus.com/api/v2/status.json' },
  { service: 'github', url: 'https://www.githubstatus.com/api/v2/status.json' },
  { service: 'openai', url: 'https://status.openai.com/api/v2/status.json' },
  { service: 'anthropic', url: 'https://status.anthropic.com/api/v2/status.json' },
];

const INDICATOR_LABELS: Record<string, string> = {
  none: '正常',
  minor: '轻微故障',
  major: '严重故障',
  critical: '紧急故障',
  maintenance: '维护中',
};

export function indicatorLabel(indicator: string | null): string {
  if (!indicator) return '未知';
  return INDICATOR_LABELS[indicator] ?? indicator;
}

async function fetchOne(fetchFn: typeof fetch, service: string, url: string, signal?: AbortSignal): Promise<ServiceStatus> {
  const base: ServiceStatus = { service, indicator: null, description: null, updatedAt: null, error: null };
  try {
    const res = await fetchFn(url, { signal, headers: { Accept: 'application/json', 'User-Agent': 'cfip-status/1.0' } });
    if (!res.ok) {
      base.error = `HTTP ${res.status}`;
      return base;
    }
    const j = (await res.json()) as {
      status?: { indicator?: string; description?: string };
      page?: { updated_at?: string };
    };
    base.indicator = j.status?.indicator ?? null;
    base.description = j.status?.description ?? null;
    base.updatedAt = j.page?.updated_at ?? null;
    return base;
  } catch (e) {
    base.error = e instanceof Error ? e.message : String(e);
    return base;
  }
}

export async function runStatusReport(fetchFn: typeof fetch, signal?: AbortSignal): Promise<StatusReport> {
  const services = await Promise.all(STATUS_SOURCES.map((s) => fetchOne(fetchFn, s.service, s.url, signal)));
  return { services, generatedAt: new Date().toISOString() };
}
