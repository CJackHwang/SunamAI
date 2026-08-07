import type { ProcessStatus } from '@/shared/contracts/agentRuntime';
import type { SuccinixProcessEntry } from './succinixClient';

/**
 * 隔离边界（M6 R3，如实标注）：Succinix host 的进程表是**宿主 OS 视角的全局表**——ps() 返回
 * 所有容器的真实子进程，kill(pid) 可跨容器终止。SunamAI 的"虚拟容器"隔离是**文件系统级**：
 * 各容器是 /home/workspace/c-<id> 下互不可见的独立目录（agent 命令经 `cd <root> && <cmd>`
 * 前缀 / setCwd 在各自根目录执行，文件 RPC 会话 cwd 由 M6 原子链保证不被并发容器插队）。
 * 进程级隔离（每容器独立 PID 命名空间 / 独立进程树）在 Succinix 执行模型下不成立，也不硬造：
 * 进程表全局可见即 Succinix 语义，UI 以 containerId 归属标注而非过滤。
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
 * V1 H1-2：pid 改为可选 —— 前台 run 语义（Lifo 混合链）无 host pid，进程行仍要可见；
 * killable:false 如实标注（无 host pid，运行中不可中途终止，仅展示不管理）。
 * 注意：ps() 是 host 进程表（宿主 OS 全局），run 执行期间被 FIFO 链阻塞，前台 run 的
 * 可见性由 ProcessRegistry 的 run shim 补足（WebContainerAgentRuntime.getSuccinixProcesses）。
 */
export interface SuccinixProcessView extends ProcessStatus {
  /** host 进程表真实 pid；run 语义（Lifo 链）进程缺省（无 host pid，不可 kill）。 */
  pid?: number;
  /** 系统进程标记（UI 禁 stop + 后端拒绝 kill）。 */
  protected: boolean;
  /** V1 H1-2：是否可终止（缺省 true）。run 语义无 host pid → false（仅展示不管理）。 */
  killable?: boolean;
  /** ProcessRegistry 注册 id（agent 启动的进程）；系统/未拥有进程缺省。 */
  processId?: string;
  /** host 进程表状态（'running' | 'exited'）。 */
  hostStatus: string;
  /** host 启动时刻（epoch ms）。 */
  startTime: number;
}
