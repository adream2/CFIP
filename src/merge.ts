/**
 * 字段级优先级合并器。
 * - 每个适配器产出 DeepPartial<IpInfo>；按 FIELD_PRIORITIES 逐点分路径取第一个非空值
 * - 判定类对象（node.hosting 等）与 network.range / connection 作为原子叶子，不拆分
 * - reputation.proxy.* 允许跨源逐字段合并；proxy.sources 取并集
 * - meta.* 不由适配器提供，直接跳过
 */

import { getPriority } from './adapters/priorities';
import type { DeepPartial, IpInfo, SourceId } from './types';

/** 作为原子叶子、不递归拆分路径的对象 */
const LEAF_OBJECT_PATHS = new Set([
  'node.hosting',
  'node.anycast',
  'node.isMobile',
  'node.isBroadband',
  'network.range',
  'connection',
]);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function collectPaths(obj: Record<string, unknown>, prefix: string, out: Set<string>): void {
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (isPlainObject(v) && !LEAF_OBJECT_PATHS.has(path)) {
      collectPaths(v, path, out);
    } else {
      out.add(path);
    }
  }
}

function getPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const seg of path.split('.')) {
    if (!isPlainObject(cur)) return undefined;
    cur = cur[seg];
  }
  return cur;
}

function setPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const segs = path.split('.');
  let cur = obj;
  for (let i = 0; i < segs.length - 1; i++) {
    const s = segs[i];
    if (!isPlainObject(cur[s])) cur[s] = {};
    cur = cur[s] as Record<string, unknown>;
  }
  cur[segs[segs.length - 1]] = value;
}

function isEmptyValue(v: unknown): boolean {
  if (v === undefined || v === null) return true;
  if (Array.isArray(v) && v.length === 0) return true;
  return false;
}

export function mergeResults(
  parts: Array<{ id: SourceId; data: DeepPartial<IpInfo> }>,
  base: IpInfo,
): { merged: IpInfo; provenance: Record<string, SourceId> } {
  const byId = new Map<SourceId, DeepPartial<IpInfo>>();
  for (const p of parts) if (p.data) byId.set(p.id, p.data);

  const merged = structuredClone(base) as IpInfo;
  const provenance: Record<string, SourceId> = {};

  const paths = new Set<string>();
  for (const data of byId.values()) {
    collectPaths(data as Record<string, unknown>, '', paths);
  }

  for (const path of paths) {
    if (path.startsWith('meta.')) continue;
    if (path === 'reputation.proxy.sources') continue; // 并集特殊处理
    for (const id of getPriority(path)) {
      const data = byId.get(id);
      if (!data) continue;
      const v = getPath(data, path);
      if (!isEmptyValue(v)) {
        setPath(merged as unknown as Record<string, unknown>, path, v);
        provenance[path] = id;
        break;
      }
    }
  }

  // proxy.sources 并集：所有提供过任一 flag 的源
  const union = new Set<SourceId>();
  for (const data of byId.values()) {
    const s = getPath(data, 'reputation.proxy.sources');
    if (Array.isArray(s)) for (const x of s) union.add(x as SourceId);
  }
  if (union.size > 0) merged.reputation.proxy.sources = [...union];

  return { merged, provenance };
}
