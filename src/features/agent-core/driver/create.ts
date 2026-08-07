import { resolveAgentDriverId } from './config';
import type { AgentDriver, AgentDriverFactoryInput } from './types';
import { createPiDriver } from './piDriver';
import { createClaudeCodeDriver } from './claudeCodeDriver';
import { createCodexDriver } from './codexDriver';

/**
 * 驱动工厂（TASK-P6 R4）：按 AGENT_DRIVER 配置选择驱动实现。
 *
 * - 未配置默认 'pi'（内置 PiDriver，现有 pi 通道行为不变）；
 * - 'claude-code' / 'codex'：外部 CLI 桥（可选实验，浏览器壳内优雅拒绝）；
 * - 返回 Promise：PiDriver 需懒加载 pi 运行时（动态 import PiSession）。
 */
export async function createAgentDriver(input: AgentDriverFactoryInput): Promise<AgentDriver> {
  const id = resolveAgentDriverId();
  switch (id) {
    case 'claude-code':
      return createClaudeCodeDriver(input);
    case 'codex':
      return createCodexDriver(input);
    default:
      return createPiDriver(input);
  }
}
