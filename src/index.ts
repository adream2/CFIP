/**
 * CFIP Worker 入口：路由、IP 解析、并行适配、合并、缓存、响应协商。
 *
 * 路由：
 *   /api[?ip=]   统一 JSON（CORS 开放）
 *   /ip[?ip=]    纯文本 IP 地址（脚本友好）
 *   /  + curl UA 纯文本摘要
 *   /  + 浏览器  HTML 单页（委托 Workers Assets）
 *   其他          静态资源（委托 Workers Assets）
 */

import { emptyIpInfo } from './types';
import type { Env } from './env';
import type { IpInfo, IpClass } from './types';
import type { IncomingRequestCfProperties } from '@cloudflare/workers-types';
import { parseIp, classifyIp, ipVersion, isChinaMainland } from './ip';
import { buildAdapters, runAdapters } from './adapters';
import { bgptoolsAdapter } from './adapters/bgptools';
import { asnAnycast, asnProvider } from './adapters/provider-map';
import type { AdapterCtx } from './adapters/types';
import { mergeResults } from './merge';
import { loadConfig } from './config';
import { cacheAgeMs, readCache, writeCache } from './cache';
import { corsHeaders, errorJson, jsonResponse, toTextSummary, wantsText } from './respond';
import { withCache } from './tools/cache';
import { runProbes } from './tools/probe';
import { runDomainReport, isValidDomain } from './tools/domain';
import { runStatusReport } from './tools/status';
import { runPing, PING_TYPES } from './tools/ping';
import type { PingType } from './tools/ping';

const CLASS_LABELS: Record<IpClass, string> = {
  public: '公网',
  private: '私有',
  loopback: '环回',
  'link-local': '链路本地',
  cgnat: '运营商级 NAT',
  bogon: '虚假/保留',
  reserved: '保留',
  documentation: '文档示例',
  multicast: '组播',
};

/** cf RTT 字段类型在不同 workers-types 版本间不稳定，统一收敛为 number|null */
function rttOf(cf: IncomingRequestCfProperties): number | null {
  const a = cf.clientTcpRtt as unknown;
  const b = cf.clientQuicRtt as unknown;
  for (const v of [a, b]) {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  return null;
}

function clientIpOf(request: Request): string | null {
  return (
    request.headers.get('CF-Connecting-IP') ??
    request.headers.get('X-Real-IP') ??
    request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ??
    null
  );
}

/** 完整查询流程：并行适配 → 合并 → 静态兜底 → meta */
async function lookup(
  ip: string,
  isSelf: boolean,
  request: Request,
  env: Env,
): Promise<IpInfo> {
  const cfg = loadConfig(env);
  const base = emptyIpInfo(ip, ipVersion(ip), classifyIp(ip), cfg.cacheTtlSec);
  const ctxA: AdapterCtx = {
    ip,
    isSelf,
    clientIp: clientIpOf(request),
    cf: request.cf as IncomingRequestCfProperties | undefined,
    userAgent: request.headers.get('user-agent'),
    env,
    // 注意：不能直接传裸 fetch 引用——workerd 中会丢 this 报 Illegal invocation；
    // 用箭头包装保留全局 fetch 的正确调用方式（测试里 stubGlobal 依然生效）
    fetchFn: (input, init) => fetch(input, init),
  };

  // 第一轮：除 bgptools 外的全部适配器并行
  const adapters = buildAdapters(env).filter((a) => a.id !== 'bgptools');
  const outcomes = await runAdapters(adapters, ctxA);
  const parts = outcomes
    .filter((o) => o.ok && o.data)
    .map((o) => ({ id: o.id, data: o.data! }));

  let { merged } = mergeResults(parts, base);

  // 第二轮：bgptools 条件触发（已知 ASN 时补充 AS 名称/描述/国家）
  if (merged.network.asn) {
    const bgpOutcomes = await runAdapters([bgptoolsAdapter], { ...ctxA, merged });
    for (const o of bgpOutcomes) {
      outcomes.push(o);
      if (o.ok && o.data) parts.push({ id: o.id, data: o.data });
    }
    ({ merged } = mergeResults(parts, base));
  }

  // 静态 ASN 映射兜底：云厂商/CDN 识别 + anycast 推断
  if (merged.network.asn) {
    if (!merged.node.provider) {
      const p = asnProvider(merged.network.asn);
      if (p) {
        merged.node.provider = p.provider;
        merged.node.providerType = p.providerType;
      }
    }
    if (!merged.node.anycast) {
      const a = asnAnycast(merged.network.asn);
      if (a) merged.node.anycast = a;
    }
  }

  // 多源位置对比：每个提供过地理数据的源各自的原值（透明度）
  merged.comparison.locations = parts
    .filter((p) => p.data.location)
    .map((p) => {
      const L = p.data.location!;
      return {
        id: p.id,
        country: L.country ?? null,
        region: L.region ?? null,
        city: L.city ?? null,
        latitude: L.latitude ?? null,
        longitude: L.longitude ?? null,
      };
    });

  // 派生字段
  merged.location.isChinaMainland = isChinaMainland(merged.location.countryCode);

  // meta
  merged.meta.sources = outcomes.map((o) => ({
    id: o.id,
    ok: o.ok,
    ms: o.ms,
    cached: false,
    error: o.error,
  }));
  for (const o of outcomes) {
    if (o.warnings) merged.meta.warnings.push(...o.warnings);
  }
  merged.meta.generatedAt = new Date().toISOString();
  merged.meta.cacheTtlSec = cfg.cacheTtlSec;
  return merged;
}

/** 非公网 IP 短路：零外部请求 */
function shortCircuit(ip: string, isSelf: boolean, request: Request, env: Env): IpInfo {
  const cls = classifyIp(ip);
  const info = emptyIpInfo(ip, ipVersion(ip), cls, 60 * 60);
  info.meta.warnings.push(`目标为${CLASS_LABELS[cls]}地址，已跳过全部外部查询`);
  const cf = request.cf as IncomingRequestCfProperties | undefined;
  if (isSelf && cf) {
    info.connection = {
      httpProtocol: cf.httpProtocol ?? null,
      tlsVersion: cf.tlsVersion ?? null,
      tlsCipher: cf.tlsCipher ?? null,
      clientTcpRttMs: rttOf(cf),
      colo: cf.colo ?? null,
      asOrganization: cf.asOrganization ?? null,
      userAgent: request.headers.get('user-agent'),
    };
    if (cf.asn) info.network.asn = cf.asn;
  }
  return info;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const t0 = Date.now();
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return errorJson('仅支持 GET', 405);
    }

    const cfg = loadConfig(env);
    const clientIp = clientIpOf(request);
    const rawIp = url.searchParams.get('ip');
    const hasIpParam = rawIp !== null;

    // —— /ip：只返回 IP 文本 ——
    if (url.pathname === '/ip') {
      const target = rawIp ?? clientIp;
      if (!target) return errorJson('无法确定客户端 IP', 400);
      const ip = parseIp(target);
      if (!ip) return errorJson(`无效的 IP: ${target}`, 400);
      return new Response(ip + '\n', {
        headers: { 'Content-Type': 'text/plain; charset=utf-8', ...corsHeaders() },
      });
    }

    const isApi = url.pathname === '/api';
    const isRoot = url.pathname === '/';

    // —— 工具端点（先于 ASSETS 委托匹配）——
    if (url.pathname === '/api/probe') {
      const { data, hit } = await withCache('probe', 300, () => runProbes(fetch));
      return jsonTool(data, hit, t0);
    }
    if (url.pathname === '/api/domain') {
      const domain = (url.searchParams.get('domain') ?? '')
        .trim().toLowerCase()
        .replace(/^https?:\/\//, '')
        .replace(/[/?#].*$/, '');
      if (!isValidDomain(domain)) return errorJson('无效的域名（示例：example.com）', 400);
      const { data, hit } = await withCache(`domain:${domain}`, 3600, () => runDomainReport(fetch, domain));
      return jsonTool(data, hit, t0);
    }
    if (url.pathname === '/api/ping') {
      const target = (url.searchParams.get('target') ?? '').trim();
      if (!target || target.length > 253) return errorJson('缺少 target 参数（IP 或域名）', 400);
      const typeRaw = (url.searchParams.get('type') ?? 'ping') as PingType;
      if (!PING_TYPES.includes(typeRaw)) return errorJson(`type 仅支持: ${PING_TYPES.join(' / ')}`, 400);
      const limit = Number(url.searchParams.get('limit') ?? '3');
      const { data, hit } = await withCache(
        `ping:${typeRaw}:${target}:${limit}`,
        300,
        () => runPing(fetch, typeRaw, target, limit),
      );
      return jsonTool(data, hit, t0);
    }
    if (url.pathname === '/api/status') {
      const { data, hit } = await withCache('status', 60, () => runStatusReport(fetch));
      return jsonTool(data, hit, t0);
    }

    if (!isApi && !isRoot) {
      // 静态资源委托（含 404）
      return env.ASSETS.fetch(request);
    }

    // —— 根路径：浏览器走 HTML（Assets），命令行走文本摘要 ——
    if (isRoot && !wantsText(request)) {
      return env.ASSETS.fetch(request);
    }

    // —— 解析目标 IP ——
    const target = rawIp ?? clientIp;
    if (!target) {
      return errorJson('未提供 IP 且无法获取客户端 IP（请通过 ?ip= 参数查询）', 400);
    }
    const ip = parseIp(target);
    if (!ip) {
      return errorJson(`无效的 IP 地址: ${target}`, 400);
    }
    const isSelf = clientIp !== null && parseIp(clientIp) === ip;

    const extraHeaders: Record<string, string> = {};

    // —— 非公网短路 ——
    if (classifyIp(ip) !== 'public') {
      const info = shortCircuit(ip, isSelf, request, env);
      if (hasIpParam) ctx.waitUntil(writeCache(env, ip, info, 60 * 60));
      return respond(request, info, isApi, extraHeaders, t0);
    }

    // —— 缓存（仅显式 ?ip=） ——
    if (hasIpParam) {
      const cached = await readCache(env, ip);
      if (cached) {
        extraHeaders['X-Cache'] = 'HIT';
        const age = cacheAgeMs(cached);
        if (age > cfg.cacheTtlSec * 500) {
          // 超过半衰期：后台刷新，本次仍返回旧值
          ctx.waitUntil(
            lookup(ip, false, request, env).then((fresh) => writeCache(env, ip, fresh, cfg.cacheTtlSec)),
          );
        }
        return respond(request, cached, isApi, extraHeaders, t0);
      }
    }

    // —— 完整查询 ——
    let info: IpInfo;
    try {
      info = await lookup(ip, isSelf, request, env);
    } catch (e) {
      return errorJson(`查询失败: ${e instanceof Error ? e.message : String(e)}`, 502, extraHeaders);
    }
    if (hasIpParam) ctx.waitUntil(writeCache(env, ip, info, cfg.cacheTtlSec));
    extraHeaders['X-Cache'] = 'MISS';
    return respond(request, info, isApi, extraHeaders, t0);
  },
};

function respond(
  request: Request,
  info: IpInfo,
  isApi: boolean,
  extraHeaders: Record<string, string>,
  t0: number,
): Response {
  extraHeaders['X-Response-Time'] = `${Date.now() - t0}ms`;
  if (isApi) return jsonResponse(info, extraHeaders);
  return new Response(toTextSummary(info), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', ...corsHeaders(), ...extraHeaders },
  });
}

/** 工具端点 JSON 响应（带缓存标记） */
function jsonTool(data: unknown, hit: boolean, t0: number): Response {
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...corsHeaders(),
      'X-Cache': hit ? 'HIT' : 'MISS',
      'X-Response-Time': `${Date.now() - t0}ms`,
    },
  });
}
