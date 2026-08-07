import { STORAGE_KEYS, readText, writeText } from '@/shared/lib/storage';

/**
 * Pi 引擎功能开关（R3 全面切换；R4 旧引擎删除后语义收敛）。
 *
 * R4 之后旧引擎（engine.ts/AgentEngine）已删除，pi 通道是唯一实现——本开关不再
 * 选择引擎，localStorage 关闭 pi 只意味着「无 Agent 运行」（聊天-only），不再有旧引擎
 * 回退路径。默认开启；显式 '0' 时 useAgentV2 不启动 Agent 运行。
 *
 * 开关只读 localStorage，不引入 pi 运行时依赖，因此可被静态导入。
 */
export function isPiEngineEnabled(): boolean {
  // R3：pi 引擎默认开启；R4：旧引擎已删，关闭仅保留「无 Agent 运行」语义。
  return readText(STORAGE_KEYS.piEngine, '1') !== '0';
}

export function setPiEngineEnabled(enabled: boolean): void {
  writeText(STORAGE_KEYS.piEngine, enabled ? '1' : '0');
}
