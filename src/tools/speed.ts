/**
 * 测速端点（/api/speed）：自建，不依赖第三方测速服务。
 *   GET  ?bytes=N  → 返回 N 字节（默认 1 MiB，上限 10 MiB），前端测下载
 *   POST           → 读取并丢弃请求体，返回收到的字节数，前端测上传
 *
 * 说明：零填充字节不消耗 CPU（分配即可），Worker 只需保证 Content-Length 与 no-store，
 * 让浏览器/CDN 不做任何缓存，测的才是真实链路。
 */

export const SPEED_MIN_BYTES = 1024;
export const SPEED_MAX_BYTES = 10 * 1024 * 1024;
export const SPEED_DEFAULT_BYTES = 1024 * 1024;

/** 解析并夹取 bytes 参数（非法 → 默认值） */
export function speedBytesOf(raw: string | null | undefined): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return SPEED_DEFAULT_BYTES;
  return Math.min(Math.max(Math.floor(n), SPEED_MIN_BYTES), SPEED_MAX_BYTES);
}

/** 测速响应头：强制不缓存，并暴露字节数 / 边缘节点给前端 */
export function speedHeaders(bytes: number, colo: string | null): Record<string, string> {
  return {
    'Content-Type': 'application/octet-stream',
    'Content-Length': String(bytes),
    'Cache-Control': 'no-store, no-transform',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Expose-Headers': 'X-Cfip-Bytes, X-Cfip-Colo',
    'X-Cfip-Bytes': String(bytes),
    ...(colo ? { 'X-Cfip-Colo': colo } : {}),
  };
}

/** 下载响应：零填充字节 + 强制不缓存 */
export function downloadResponse(bytes: number, colo: string | null): Response {
  return new Response(new Uint8Array(bytes), { headers: speedHeaders(bytes, colo) });
}

export interface UploadResult {
  received: number;
  ms: number;
}

/** 读取并丢弃上传体（流式计数，不整块进内存） */
export async function consumeUpload(request: Request): Promise<UploadResult> {
  const t0 = Date.now();
  let received = 0;
  const body = request.body;
  if (body) {
    const reader = body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value?.byteLength ?? 0;
    }
  } else {
    // 无 body 流时退回 arrayBuffer（小请求）
    const buf = await request.arrayBuffer().catch(() => new ArrayBuffer(0));
    received = buf.byteLength;
  }
  return { received, ms: Date.now() - t0 };
}
