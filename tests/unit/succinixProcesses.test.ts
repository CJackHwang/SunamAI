import { describe, expect, it } from 'vitest';
import { isSystemProcess, systemKillRefusal, resolveProcessScope, killRefusal } from '@/features/runtime/succinixProcesses';
import type { SuccinixProcessEntry } from '@/features/runtime/succinixClient';

describe('isSystemProcess (M5 protected 判定)', () => {
  it('marks Succinix system processes as protected', () => {
    expect(isSystemProcess('node host.js')).toBe(true);
    expect(isSystemProcess('node /home/workspace/usr/lib/succinix/host.js')).toBe(true);
    expect(isSystemProcess('node python-daemon.js')).toBe(true);
    expect(isSystemProcess('node /usr/lib/succinix/python/python-daemon.js')).toBe(true);
    expect(isSystemProcess('node /usr/lib/succinix/some-binary')).toBe(true);
  });

  it('leaves agent/user processes stoppable (宁少标不误标)', () => {
    expect(isSystemProcess('node server.js')).toBe(false);
    expect(isSystemProcess('npm run dev -- --port 1919')).toBe(false);
    expect(isSystemProcess('node -e "setInterval(()=>{},1e9)"')).toBe(false);
    expect(isSystemProcess('node my-host.js')).toBe(false);
    expect(isSystemProcess('cat /etc/host.js')).toBe(false);
    expect(isSystemProcess('')).toBe(false);
  });
});

describe('systemKillRefusal (M5 后端 kill 拦截)', () => {
  const table = [
    { pid: 1, cmd: 'node host.js', status: 'running', startTime: 10 },
    { pid: 2, cmd: 'node server.js', status: 'running', startTime: 20 },
  ];

  it('refuses to kill a protected system process', () => {
    expect(systemKillRefusal(table, 1)).toMatch(/protected system process/);
  });

  it('allows killing an agent process', () => {
    expect(systemKillRefusal(table, 2)).toBeNull();
  });

  it('returns null for pids absent from the process table', () => {
    expect(systemKillRefusal(table, 999)).toBeNull();
    expect(systemKillRefusal([], 1)).toBeNull();
  });
});

describe('resolveProcessScope (TASK-CISOL 归属审定)', () => {
  const entry = (partial: Partial<SuccinixProcessEntry>): SuccinixProcessEntry => ({ pid: 1, cmd: '', status: 'running', startTime: 0, ...partial });

  it('uses the host-provided scope field when present', () => {
    expect(resolveProcessScope(entry({ scope: 'system' }))).toBe('system');
    expect(resolveProcessScope(entry({ scope: 'container', containerId: 'c-1' }))).toBe('container');
    expect(resolveProcessScope(entry({ scope: 'unknown' }))).toBe('unknown');
  });

  it('falls back to local system detection for old hosts (no scope field)', () => {
    expect(resolveProcessScope(entry({ cmd: 'node host.js' }))).toBe('system');
    expect(resolveProcessScope(entry({ cmd: 'node server.js' }))).toBe('unknown');
  });
});

describe('killRefusal (TASK-CISOL R3 跨容器 kill 拦截)', () => {
  const table: SuccinixProcessEntry[] = [
    { pid: 1, cmd: 'node host.js', status: 'running', startTime: 10 },                              // system（旧 host，无 scope）
    { pid: 2, cmd: 'node server.js', status: 'running', startTime: 20 },                            // unknown（旧 host，无 scope）
    { pid: 3, cmd: 'node server.js', status: 'running', startTime: 30, scope: 'container', containerId: 'c-1' }, // 本容器
    { pid: 4, cmd: 'node server.js', status: 'running', startTime: 40, scope: 'container', containerId: 'c-2' }, // 其他容器
    { pid: 5, cmd: 'node server.js', status: 'running', startTime: 50, scope: 'unknown' },          // 归属未知
    { pid: 6, cmd: 'node /usr/lib/succinix/python/python-daemon.js', status: 'running', startTime: 60, scope: 'system' }, // 系统
  ];

  it('refuses system processes (scope=system, host or local)', () => {
    expect(killRefusal(table, 1, 'c-1')).toMatch(/protected system process/);
    expect(killRefusal(table, 6, 'c-1')).toMatch(/protected system process/);
  });

  it('allows killing a process in the current container only', () => {
    expect(killRefusal(table, 3, 'c-1')).toBeNull();
    expect(killRefusal(table, 4, 'c-2')).toBeNull();
  });

  it('refuses killing another container’s process from the current container', () => {
    const refusal = killRefusal(table, 4, 'c-1');
    expect(refusal).toMatch(/another container/);
    expect(refusal).toContain('c-2');
  });

  it('refuses killing a process with unknown ownership (宁严勿松)', () => {
    expect(killRefusal(table, 5, 'c-1')).toMatch(/unknown ownership/);
    // 旧 host 无 scope 的非系统进程也按 unknown 拒绝（无法证实归属）。
    expect(killRefusal(table, 2, 'c-1')).toMatch(/unknown ownership/);
  });

  it('refuses a container-scoped process when the caller provides no container id', () => {
    expect(killRefusal(table, 3)).toMatch(/another container/);
  });

  it('returns null for pids absent from the process table', () => {
    expect(killRefusal(table, 999, 'c-1')).toBeNull();
    expect(killRefusal([], 1, 'c-1')).toBeNull();
  });
});
