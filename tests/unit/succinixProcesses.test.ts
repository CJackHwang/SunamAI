import { describe, expect, it } from 'vitest';
import { isSystemProcess, systemKillRefusal } from '@/features/runtime/succinixProcesses';

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
