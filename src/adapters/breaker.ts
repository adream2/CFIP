/**
 * 单隔离实例级熔断器：某数据源连续失败后临时跳过，避免拖慢每个请求。
 * 状态仅存在模块作用域（每个 isolate 独立），Worker 重启即重置。
 */

import type { SourceId } from '../types';

interface BreakerState {
  fails: number;
  skipUntil: number; // epoch ms
}

const FAIL_THRESHOLD = 3;
const SKIP_MS = 60_000;

const states = new Map<SourceId, BreakerState>();

export const breaker = {
  shouldSkip(id: SourceId, now: number = Date.now()): boolean {
    const s = states.get(id);
    if (!s) return false;
    if (s.skipUntil > now) return true;
    if (s.fails >= FAIL_THRESHOLD) {
      // 跳过窗口已过，重置计数重新试探
      s.fails = 0;
      s.skipUntil = 0;
    }
    return false;
  },

  onSuccess(id: SourceId): void {
    states.delete(id);
  },

  onFailure(id: SourceId, now: number = Date.now()): void {
    const s = states.get(id) ?? { fails: 0, skipUntil: 0 };
    s.fails += 1;
    if (s.fails >= FAIL_THRESHOLD) s.skipUntil = now + SKIP_MS;
    states.set(id, s);
  },

  /** 测试用：清空全部状态 */
  reset(): void {
    states.clear();
  },
};
