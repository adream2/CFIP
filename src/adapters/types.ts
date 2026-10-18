/** 适配器框架：接口与上下文 */

import type { IncomingRequestCfProperties } from '@cloudflare/workers-types';
import type { DeepPartial, IpInfo, SourceId } from '../types';
import type { Env } from '../env';

export interface AdapterCtx {
  /** 规范化后的目标 IP */
  ip: string;
  /** 目标 IP 是否就是访客自身 IP */
  isSelf: boolean;
  clientIp: string | null;
  cf: IncomingRequestCfProperties | undefined;
  userAgent: string | null;
  env: Env;
  fetchFn: typeof fetch;
  /** 条件触发型适配器可见的初步合并结果 */
  merged?: IpInfo;
}

export interface AdapterResult {
  data: DeepPartial<IpInfo>;
  /** 适配器主动上报的提示（进入 meta.warnings） */
  warnings?: string[];
}

export interface Adapter {
  id: SourceId;
  timeoutMs: number;
  /** 该源数据的建议缓存时长（记录到 meta，供文档/调试） */
  cacheTtlSec: number;
  /** 缺失该 secret 时适配器不注册 */
  requiresSecret?: keyof Env;
  run(ctx: AdapterCtx, signal?: AbortSignal): Promise<AdapterResult>;
}

export interface AdapterOutcome {
  id: SourceId;
  ok: boolean;
  ms: number;
  cached: boolean;
  data: DeepPartial<IpInfo> | null;
  error: string | null;
  warnings?: string[];
}
