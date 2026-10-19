/**
 * 出口探测工具（/api/probe）：从 Worker 并发探测一批在线服务的可达性与出口身份。
 * Cloudflare 前端站点暴露 /cdn-cgi/trace（无 Key），返回服务视角的出口 IP、边缘
 * 节点 colo、协议等；非 CF 站点（Google/GitHub）仅探测可达性与耗时。
 *
 * 典型用途：自托管玩家确认 Cloudflare 共享出口在各 AI/云服务眼中是谁、是否被区别对待。
 */

export interface ExitProbe {
  service: string;
  url: string;
  reachable: boolean;
  ms: number;
  /** 服务视角的出口 IP（trace 的 ip=） */
  exitIp: string | null;
  /** 服务分配的边缘节点（trace 的 colo=） */
  colo: string | null;
  /** 服务推断的出口国家码（trace 的 loc=） */
  loc: string | null;
  http: string | null;
  tls: string | null;
  warp: string | null;
  error: string | null;
}

export interface ProbeReport {
  probes: ExitProbe[];
  generatedAt: string;
}

interface ProbeTarget {
  service: string;
  url: string;
  /** true = 返回 cdn-cgi/trace 文本，解析出口身份 */
  trace: boolean;
}

export const PROBE_TARGETS: ProbeTarget[] = [
  { service: 'cloudflare', url: 'https://www.cloudflare.com/cdn-cgi/trace', trace: true },
  { service: 'openai', url: 'https://chatgpt.com/cdn-cgi/trace', trace: true },
  { service: 'anthropic', url: 'https://claude.ai/cdn-cgi/trace', trace: true },
  { service: 'grok', url: 'https://grok.com/cdn-cgi/trace', trace: true },
  { service: 'google', url: 'https://www.google.com/generate_204', trace: false },
  { service: 'github', url: 'https://github.com/', trace: false },
];

/** 解析 cdn-cgi/trace 的 key=value 行格式 */
export function parseTrace(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const i = line.indexOf('=');
    if (i <= 0) continue;
    const k = line.slice(0, i).trim();
    const v = line.slice(i + 1).trim();
    if (k) out[k] = v;
  }
  return out;
}

async function probeOne(fetchFn: typeof fetch, target: ProbeTarget, signal?: AbortSignal): Promise<ExitProbe> {
  const t0 = Date.now();
  const base: ExitProbe = {
    service: target.service,
    url: target.url,
    reachable: false,
    ms: 0,
    exitIp: null,
    colo: null,
    loc: null,
    http: null,
    tls: null,
    warp: null,
    error: null,
  };
  try {
    const res = await fetchFn(target.url, {
      signal,
      headers: { Accept: '*/*', 'User-Agent': 'cfip-probe/1.0' },
    });
    base.ms = Date.now() - t0;
    base.reachable = res.ok;
    if (!res.ok) {
      base.error = `HTTP ${res.status}`;
      return base;
    }
    if (target.trace) {
      const trace = parseTrace(await res.text());
      base.exitIp = trace.ip ?? null;
      base.colo = trace.colo ?? null;
      base.loc = trace.loc ?? null;
      base.http = trace.http ?? null;
      base.tls = trace.tls ?? null;
      base.warp = trace.warp ?? null;
    }
    return base;
  } catch (e) {
    base.ms = Date.now() - t0;
    base.error = e instanceof Error ? e.message : String(e);
    return base;
  }
}

export async function runProbes(fetchFn: typeof fetch, signal?: AbortSignal): Promise<ProbeReport> {
  const probes = await Promise.all(PROBE_TARGETS.map((t) => probeOne(fetchFn, t, signal)));
  return { probes, generatedAt: new Date().toISOString() };
}
