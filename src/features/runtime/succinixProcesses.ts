import type { ProcessStatus } from '@/shared/contracts/agentRuntime';
import type { SuccinixProcessEntry } from './succinixClient';

/**
 * 隔离边界（M6 R3 → TASK-CISOL R2/R3）：Succinix host 的进程表是**宿主 OS 视角的全局表**——
 * ps() 返回所有容器的真实子进程，kill(pid) 可跨容器终止。TASK-CISOL 引入 host 侧归属标注
 * （scope/containerId，协议兼容扩展）：SunamAI 据此做**查询过滤**（容器 A 看不到容器 B 的进程）
 * 与 **kill 拦截**（跨容器 / unknown 拒绝，仅本容器进程可 kill）。进程表本身仍全局可见是
 * Succinix 宿主 OS 语义，不硬造每容器独立 PID 命名空间。
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

/** 进程归属（与 host ps() 的 scope 字段对齐，TASK-CISOL R1）。 */
export type ProcessScope = 'system' | 'container' | 'unknown';

/**
 * 归一审定：host 已带 scope 字段则直接用；旧 host（未带）回落本地判定 —— 系统模式 → system，
 * 否则 unknown（宁严勿松：无归属信息的进程不可 kill）。
 */
export function resolveProcessScope(entry: SuccinixProcessEntry): ProcessScope {
  if (entry.scope === 'system' || entry.scope === 'container' || entry.scope === 'unknown') return entry.scope;
  return isSystemProcess(entry.cmd) ? 'system' : 'unknown';
}

/**
 * 后端 kill 守卫（TASK-CISOL R3）：给定进程表快照与当前容器 id，pid 命中不可 kill 类别时
 * 返回拒绝说明；否则返回 null（调用方继续 succinixClient.kill）：
 *  - scope=system → 拒绝（受保护系统进程，UI 禁 stop 之外的第二道防线）
 *  - scope=container && containerId !== 当前容器 → 拒绝（进程属于其他容器）
 *  - scope=container && containerId === 当前容器 → 放行（本容器进程可 kill）
 *  - scope=unknown（或旧 host 无 scope 且非系统）→ 拒绝（宁严勿松）
 */
export function killRefusal(entries: SuccinixProcessEntry[], pid: number, containerId?: string): string | null {
  const entry = entries.find((candidate) => candidate.pid === pid);
  if (!entry) return null;
  const scope = resolveProcessScope(entry);
  if (scope === 'system') {
    return `Process ${pid} is a protected system process and cannot be stopped.`;
  }
  if (scope === 'container') {
    // 本容器进程才可 kill；containerId 缺失或归属不符一律拒绝（无法证实属于当前容器）。
    if (containerId && entry.containerId === containerId) return null;
    return `Process ${pid} belongs to another container${entry.containerId ? ` (${entry.containerId})` : ''} and cannot be stopped from this container.`;
  }
  return `Process ${pid} has unknown ownership and cannot be stopped.`;
}

/**
 * 后端 kill 守卫（M5，系统进程子集）：pid 命中系统进程时返回拒绝说明；否则返回 null。
 * 保留供测试与窄场景使用；完整归属校验用 killRefusal。
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
  /** TASK-CISOL R4：进程归属（system / container / unknown），UI 按此分组显示。 */
  scope?: ProcessScope;
  /** V1 H1-2：是否可终止（缺省 true）。run 语义无 host pid → false（仅展示不管理）。 */
  killable?: boolean;
  /** ProcessRegistry 注册 id（agent 启动的进程）；系统/未拥有进程缺省。 */
  processId?: string;
  /** host 进程表状态（'running' | 'exited'）。 */
  hostStatus: string;
  /** host 启动时刻（epoch ms）。 */
  startTime: number;
}
