import { STORAGE_KEYS, readText, writeText } from '@/shared/lib/storage';

/**
 * Pi 引擎功能开关（R3 全面切换）。
 *
 * 该开关控制消息提交走哪条通道：
 * - 开（默认）：走 pi 通道（PiSession），事件流桥接到现有 UI 状态层；
 * - 关：回退现有 Succinix 引擎（engine.ts），作为逃生门（localStorage 显式 '0'）。
 *
 * 开关只读 localStorage，不引入 pi 运行时依赖，因此可被
 * useAgentV2 静态导入而不影响初始 bundle。
 */
export function isPiEngineEnabled(): boolean {
  // R3：pi 引擎默认开启；仅当用户显式关闭（localStorage = '0'）时回退旧引擎。
  return readText(STORAGE_KEYS.piEngine, '1') !== '0';
}

export function setPiEngineEnabled(enabled: boolean): void {
  writeText(STORAGE_KEYS.piEngine, enabled ? '1' : '0');
}
