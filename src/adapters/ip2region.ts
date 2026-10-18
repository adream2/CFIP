/**
 * ip2region 离线库适配器。
 * xdb 存放于 KV（xdb:ip2region_v4 / xdb:ip2region_v6），运行时拉取，
 * 模块级 Promise 记忆化（每个 isolate 只拉一次）。
 * 国内 IP 提供中文省/市/运营商，是本工具中文归属数据的第一来源。
 */

import { XdbSearcher } from '../xdb/searcher';
import { ipVersion } from '../ip';
import type { Adapter, AdapterResult } from './types';
import type { DeepPartial, IpInfo } from '../types';
import type { Env } from '../env';

const KV_KEY_V4 = 'xdb:ip2region_v4';
const KV_KEY_V6 = 'xdb:ip2region_v6';

let v4Promise: Promise<XdbSearcher | null> | null = null;
let v6Promise: Promise<XdbSearcher | null> | null = null;

async function loadSearcher(env: Env, version: 4 | 6): Promise<XdbSearcher | null> {
  if (version === 4) {
    if (!v4Promise) {
      v4Promise = (async () => {
        const buf = await env.CFIP_KV.get(KV_KEY_V4, 'arrayBuffer');
        return buf ? new XdbSearcher(buf) : null;
      })();
    }
    return v4Promise;
  }
  if (!v6Promise) {
    v6Promise = (async () => {
      const buf = await env.CFIP_KV.get(KV_KEY_V6, 'arrayBuffer');
      return buf ? new XdbSearcher(buf) : null;
    })();
  }
  return v6Promise;
}

/** 测试用：清除记忆化缓存 */
export function resetSearcherCache(): void {
  v4Promise = null;
  v6Promise = null;
}

function nz(s: string): string | null {
  return s && s !== '0' ? s : null;
}

export const ip2regionAdapter: Adapter = {
  id: 'ip2region',
  timeoutMs: 15000, // 冷启动含 10MB KV 拉取
  cacheTtlSec: 0, // 数据静态，模块级缓存
  async run(ctx): Promise<AdapterResult> {
    const version = ipVersion(ctx.ip);
    let searcher: XdbSearcher | null;
    try {
      searcher = await loadSearcher(ctx.env, version);
    } catch (e) {
      return { data: {}, warnings: [`ip2region 加载失败: ${e instanceof Error ? e.message : String(e)}`] };
    }
    if (!searcher) {
      // v6 离线数据体积过大（超出 CDN/KV 限制）未内置，属可选增强
      const hint = version === 6
        ? 'ip2region IPv6 离线数据未配置（可选），IPv6 归属以在线数据源为准'
        : `ip2region xdb 未配置（KV 缺少 ${KV_KEY_V4}），国内中文归属将依赖在线数据源`;
      return { data: {}, warnings: [hint] };
    }
    let raw: string;
    try {
      raw = searcher.search(ctx.ip);
    } catch (e) {
      return { data: {}, warnings: [`ip2region 查询失败: ${e instanceof Error ? e.message : String(e)}`] };
    }
    if (!raw) return { data: {} };

    const f = raw.split('|').map((s) => s.trim());
    const data: DeepPartial<IpInfo> = {
      location: {
        country: nz(f[0] ?? ''),
        // 新旧格式自适应：5 字段且末位为 ISO 则取 [1]/[2]，否则取 [2]/[3]
        region: nz(/^[A-Za-z]{2}$/.test(f[4] ?? '') ? (f[1] ?? '') : (f[2] ?? '')),
        city: nz(/^[A-Za-z]{2}$/.test(f[4] ?? '') ? (f[2] ?? '') : (f[3] ?? '')),
      },
      node: {
        provider: nz(/^[A-Za-z]{2}$/.test(f[4] ?? '') ? (f[3] ?? '') : (f[4] ?? '')),
      },
    };
    return { data };
  },
};
