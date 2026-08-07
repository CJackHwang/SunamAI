import { STORAGE_KEYS, readText, writeText } from '@/shared/lib/storage';
import type { AgentDriverId } from './types';

/**
 * AGENT_DRIVER 配置开关（TASK-P6 R3/R4）。
 *
 * 浏览器壳内没有运行时 env 注入，因此沿用现有 feature flag 模式（见 pi/featureFlag）：
 * - 运行时配置：localStorage（sunam_v2_agent_driver），测试可注入；
 * - 构建期 env 兜底：VITE_AGENT_DRIVER 在编译时注入；
 * - 未配置默认 'pi'（内置 PiDriver，现有行为不变）。
 */
const AGENT_DRIVER_IDS: readonly AgentDriverId[] = ['pi', 'claude-code', 'codex'];
const DEFAULT_AGENT_DRIVER: AgentDriverId = 'pi';

export function isAgentDriverId(value: string | undefined): value is AgentDriverId {
  return value !== undefined && (AGENT_DRIVER_IDS as readonly string[]).includes(value);
}

export function resolveAgentDriverId(): AgentDriverId {
  const stored = readText(STORAGE_KEYS.agentDriver);
  if (isAgentDriverId(stored)) return stored;
  const env = import.meta.env.VITE_AGENT_DRIVER as string | undefined;
  if (isAgentDriverId(env)) return env;
  return DEFAULT_AGENT_DRIVER;
}

export function setAgentDriverId(id: AgentDriverId): void {
  writeText(STORAGE_KEYS.agentDriver, id);
}
