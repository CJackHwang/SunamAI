import type { ProcessStatus } from '@/shared/contracts/agentRuntime';
import type { SuccinixProcessEntry } from './succinixClient';

/**
 * Succinix 系统进程判定（M5）。host 进程表中 cmd 匹配系统资产/内置进程的标记 protected：
 *  - node host.js（TerminalExecutor 守护进程）
 *  - node python-daemon.js（Pyodide 常驻 daemon）
 *  - 任何 /usr/lib/succinix/ 路径启动的进程（系统资产目录）
 * lifo-core 内核在 host.js 进程内动态 import，不单独成进程，无需匹配。
 * 诚实边界：宁少标不误标——host.js / python-daemon.js 仅按路径 basename 匹配
 * （`my-host.js` 等无关脚本不命中）；无法可靠判定的进程保持可 stop。
 */
export const SYSTEM_CMD_PATTERNS: ReadonlyArray<RegExp> = [
  // TerminalExecutor 守护进程（node host.js / node /path/to/host.js）
  /(?:^|\s)(?:node|npm|npx)\s+(?:\S*\/)?host\.js(?:\s|$)/,
  // Pyodide 常驻 daemon（node python-daemon.js / node /path/to/python-daemon.js）
  /(?:^|\s)(?:node|npm|npx)\s+(?:\S*\/)?python-daemon\.js(?:\s|$)/,
  // 任何 /usr/lib/succinix/ 路径启动的进程（系统资产目录）
  /\/usr\/lib\/succinix\//,
];

export function isSystemProcess(cmd: string): boolean {
  return SYSTEM_CMD_PATTERNS.some((pattern) => pattern.test(cmd));
}

/**
 * 后端 kill 守卫：给定进程表快照，pid 命中系统进程时返回拒绝说明；否则返回 null。
 * 可 kill 时由调用方继续 succinixClient.kill；系统进程一律拒绝（UI 禁 stop 之外的第二道防线）。
 */
export function systemKillRefusal(entries: SuccinixProcessEntry[], pid: number): string | null {
  const entry = entries.find((candidate) => candidate.pid === pid);
  if (!entry) return null;
  return isSystemProcess(entry.cmd)
    ? `Process ${pid} is a protected system process and cannot be stopped.`
    : null;
}

/**
 * 展示层进程视图：Succinix 进程表条目 + SunamAI 所有权标注。
 * 与 ProcessStatus 结构兼容（ServicesPanel 渲染不变），额外携带真实 pid、
 * 系统进程标记与所有权 processId（agent 启动的进程可关联回 session/run）。
 */
export interface SuccinixProcessView extends ProcessStatus {
  /** host 进程表真实 pid。 */
  pid: number;
  /** 系统进程标记（UI 禁 stop + 后端拒绝 kill）。 */
  protected: boolean;
  /** ProcessRegistry 注册 id（agent 启动的进程）；系统/未拥有进程缺省。 */
  processId?: string;
  /** host 进程表状态（'running' | 'exited'）。 */
  hostStatus: string;
  /** host 启动时刻（epoch ms）。 */
  startTime: number;
}
