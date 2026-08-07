import { describe, expect, it, vi } from 'vitest';
import { UserTerminalSession, SUCCINIX_BANNER, type UserTerminalOutput, type UserTerminalRpc } from '@/features/runtime/userTerminalSession';
import type { SuccinixRunResult } from '@/features/runtime/succinixClient';

// V2TERM：用户终端 = Succinix 整行命令模式会话。单测覆盖：整行命令路由（cd 前缀）、提示符生成、
// cwd 跟随（host 返回 cwd）、Ctrl+C/L 处理、空命令换行、busy 排队、本地命令（help/clear/pwd）、boot。

const ROOT = '/workspace/c-1';

interface Harness {
  written: string[];
  cleared: { count: number };
  rpc: UserTerminalRpc & {
    run: ReturnType<typeof vi.fn>;
    ping: ReturnType<typeof vi.fn>;
    cwd: ReturnType<typeof vi.fn>;
    ps: ReturnType<typeof vi.fn>;
  };
  session: UserTerminalSession;
}

function createHarness(options?: {
  cwd?: string;
  runImpl?: (command: string) => Partial<SuccinixRunResult>;
}): Harness {
  const written: string[] = [];
  const cleared = { count: 0 };
  const output: UserTerminalOutput = {
    write: (data) => { written.push(data); },
    clear: () => { cleared.count += 1; },
  };
  const rpc: Harness['rpc'] = {
    run: vi.fn(async (command: string) => {
      // boot 自检的 echo 探路命令：真实 host 会把文本回显出来，mock 也要模拟该语义。
      if (command.includes('echo succinix-self-test-ok')) {
        return { ok: true, exitCode: 0, stdout: 'succinix-self-test-ok', stderr: '', timedOut: false };
      }
      return {
        ok: true,
        exitCode: 0,
        stdout: 'out',
        stderr: '',
        timedOut: false,
        ...(options?.runImpl ? options.runImpl(command) : {}),
      };
    }),
    ping: vi.fn(async () => true),
    cwd: vi.fn(async () => ROOT),
    ps: vi.fn(async () => []),
  };
  const session = new UserTerminalSession(rpc, 'c-1', { cwd: options?.cwd ?? ROOT });
  session.attach(output);
  return { written, cleared, rpc, session };
}

describe('UserTerminalSession prompt generation (V2TERM R1/R4)', () => {
  it('shows ~ at the container root', () => {
    const { session } = createHarness();
    expect(session.getPrompt()).toBe('guest@succinix:~$ ');
  });
});

describe('UserTerminalSession handleData interaction (V2TERM R2)', () => {
  it('echoes printable input and runs a full line on Enter via cd-prefixed run', async () => {
    const { written, rpc, session } = createHarness();
    session.handleData('echo');
    session.handleData(' ');
    session.handleData('hi\r');
    expect(rpc.run).toHaveBeenCalledTimes(1);
    expect(rpc.run).toHaveBeenCalledWith(`cd ${ROOT} && echo hi`, expect.objectContaining({ cwd: ROOT }));
    await vi.waitFor(() => {
      const text = written.join('');
      expect(text).toContain('echo hi');
      expect(text).toContain('out'); // stdout 回显
      expect(text).toMatch(/guest@succinix:~\$ $/); // 命令后提示符
    });
  });

  it('does not call the host for an empty command — just prints the next prompt', () => {
    const { written, rpc, session } = createHarness();
    session.handleData('\r');
    expect(rpc.run).not.toHaveBeenCalled();
    expect(written.join('')).toContain('guest@succinix:~$ ');
  });

  it('backs space removes the last character', async () => {
    const { written, rpc, session } = createHarness();
    session.handleData('abcd');
    session.handleData('\u007f');
    session.handleData('\u007f');
    session.handleData('\r');
    expect(rpc.run).toHaveBeenCalledWith(`cd ${ROOT} && ab`, expect.anything());
    await vi.waitFor(() => {
      const text = written.join('');
      expect(text).toContain('abcd');
      expect(text).toContain('\b \b\b \b');
      expect(text).toMatch(/guest@succinix:~\$ $/);
    });
  });

  it('Ctrl+C while idle clears the line; while busy marks running not interrupted', async () => {
    const { written, rpc, session } = createHarness();
    session.handleData('partial');
    session.handleData('\u0003');
    expect(written.join('')).toContain('^C');
    // 空闲 Ctrl+C 后 line 已清空：再 Enter 是空命令，不发 host。
    session.handleData('\r');
    expect(rpc.run).not.toHaveBeenCalled();

    // busy 时 Ctrl+C 只标注"运行中不中断"，不清行。
    const pending = createDeferred<SuccinixRunResult>();
    rpc.run.mockReturnValueOnce(pending.promise);
    session.handleData('sleep 1\r');
    session.handleData('\u0003');
    expect(written.join('')).toContain('running, not interrupted');
    pending.resolve({ ok: true, exitCode: 0, stdout: '', stderr: '', timedOut: false });
    await vi.waitFor(() => expect(written.join('')).toMatch(/guest@succinix:~\$ $/));
  });

  it('Ctrl+L clears the screen and reprints the current line', () => {
    const { written, cleared, session } = createHarness();
    session.handleData('abc');
    session.handleData('\u000c');
    expect(cleared.count).toBe(1);
    expect(written.join('')).toContain('guest@succinix:~$ abc');
  });

  it('ignores Tab (no completion)', async () => {
    const { rpc, session } = createHarness();
    session.handleData('ec');
    session.handleData('\t');
    session.handleData('ho\r');
    await vi.waitFor(() => expect(rpc.run).toHaveBeenCalledWith(`cd ${ROOT} && echo`, expect.anything()));
  });
});

describe('UserTerminalSession cwd tracking (V2TERM R4)', () => {
  it('follows cwd from the host result after a successful cd', async () => {
    const { rpc, session } = createHarness({
      runImpl: (command) => command.startsWith(`cd ${ROOT} && cd `)
        ? { ok: true, exitCode: 0, stdout: '', stderr: '', cwd: `${ROOT}/sub`, timedOut: false }
        : {},
    });
    session.handleData('cd sub\r');
    await vi.waitFor(() => expect(rpc.run).toHaveBeenCalled());
    expect(session.getCwd()).toBe(`${ROOT}/sub`);
    expect(session.getPrompt()).toBe('guest@succinix:~/sub$ ');
    // 后续命令 cd 前缀跟随新目录。
    session.handleData('ls\r');
    await vi.waitFor(() => expect(rpc.run).toHaveBeenLastCalledWith(`cd ${ROOT}/sub && ls`, expect.anything()));
  });

  it('keeps the previous cwd when a cd fails (host returns no cwd)', async () => {
    const { rpc, session } = createHarness({
      runImpl: () => ({ ok: false, exitCode: 1, stdout: '', stderr: 'cd: no such directory', timedOut: false }),
    });
    session.handleData('cd nope\r');
    await vi.waitFor(() => expect(rpc.run).toHaveBeenCalled());
    expect(session.getCwd()).toBe(ROOT);
    expect(session.getPrompt()).toBe('guest@succinix:~$ ');
  });
});

describe('UserTerminalSession busy queue (V2TERM R2)', () => {
  it('queues commands entered while a command is running and runs them after', async () => {
    const { written, rpc, session } = createHarness();
    const pending = createDeferred<SuccinixRunResult>();
    rpc.run.mockReturnValueOnce(pending.promise).mockResolvedValue({ ok: true, exitCode: 0, stdout: 'done', stderr: '', timedOut: false });

    session.handleData('one\r');
    session.handleData('two\r');
    expect(written.join('')).toContain('queued: will run after the current command finishes');

    pending.resolve({ ok: true, exitCode: 0, stdout: 'one-out', stderr: '', timedOut: false });
    await vi.waitFor(() => {
      expect(rpc.run).toHaveBeenCalledTimes(2);
      expect(rpc.run).toHaveBeenLastCalledWith(`cd ${ROOT} && two`, expect.anything());
    });
    expect(written.join('')).toContain('done');
    expect(written.join('')).toMatch(/guest@succinix:~\$ $/);
  });
});

describe('UserTerminalSession local commands (V2TERM R3/R5)', () => {
  it('handles help / clear / pwd in the browser without calling the host', async () => {
    const { written, cleared, rpc, session } = createHarness();
    session.handleData('help\r');
    await vi.waitFor(() => expect(written.join('')).toContain('Succinix built-in commands'));
    expect(written.join('')).toContain('interactive REPL (python / node) is not supported');

    session.handleData('clear\r');
    await vi.waitFor(() => expect(cleared.count).toBe(1));

    session.handleData('pwd\r');
    await vi.waitFor(() => expect(written.join('')).toContain(`${ROOT}\r\n`));
    expect(rpc.run).not.toHaveBeenCalled();
  });

  it('echoes stderr in red and appends a gray exit-code annotation on failure', async () => {
    const { written, session } = createHarness({
      runImpl: () => ({ ok: false, exitCode: 2, stdout: '', stderr: 'boom', timedOut: false }),
    });
    session.handleData('false\r');
    await vi.waitFor(() => expect(written.join('')).toContain('boom'));
    const text = written.join('');
    expect(text).toContain('\x1b[31mboom\x1b[0m');
    expect(text).toContain('\x1b[90m[exit 2]\x1b[0m');
  });
});

describe('UserTerminalSession boot (V2TERM R3)', () => {
  it('writes the Succinix banner, a real self-check summary and the guest prompt', async () => {
    const { written, rpc, session } = createHarness();
    await session.boot();
    const text = written.join('');
    expect(text).toContain('Succinix 0.2.0 — kernel:');
    expect(text).toContain("Type 'help' to see available commands.");
    expect(text).toContain('[  OK  ] 4 checks passed');
    expect(text).toContain('interactive REPL (python / node) is not supported');
    expect(text).toContain('guest@succinix:~$ ');
    expect(rpc.ping).toHaveBeenCalled();
    expect(rpc.cwd).toHaveBeenCalled();
    expect(rpc.ps).toHaveBeenCalled();
    expect(rpc.run).toHaveBeenCalledWith(expect.stringContaining('echo succinix-self-test-ok'), expect.anything());
  });

  it('reports a FAIL summary when the host is ready but a self-check probe fails', async () => {
    const { written, rpc, session } = createHarness();
    rpc.ps.mockRejectedValueOnce(new Error('ps boom'));
    await session.boot();
    expect(written.join('')).toContain('[ FAIL ] 3/4 checks passed');
  });

  it('reports a FAIL summary when the host never becomes ready', async () => {
    const { written, rpc, session } = createHarness();
    rpc.ping.mockResolvedValue(false);
    await session.boot({ hostReadyDeadlineMs: 20 });
    const text = written.join('');
    // 横幅仍立即可见（终端未等 host 就显示），随后如实报告 host 未就绪。
    expect(text).toContain('Succinix 0.2.0 — kernel:');
    expect(text).toContain('[ FAIL ] Succinix host did not become ready');
    expect(text).toContain('guest@succinix:~$ ');
  });

  it('waits for the Succinix host before running the self-check (R1 timing)', async () => {
    const { written, rpc, session } = createHarness();
    const pending = createDeferred<boolean>();
    rpc.ping.mockReturnValueOnce(pending.promise);
    const bootPromise = session.boot();
    // host 未就绪：横幅已写，自检尚未开始（echo 探路未发）。
    expect(written.join('')).toContain('Succinix 0.2.0 — kernel:');
    expect(rpc.run).not.toHaveBeenCalled();
    pending.resolve(true);
    await bootPromise;
    expect(written.join('')).toContain('[  OK  ] 4 checks passed');
    expect(written.join('')).toContain('guest@succinix:~$ ');
  });

  it('queues input typed during boot and runs it after the prompt', async () => {
    const { written, rpc, session } = createHarness();
    const pending = createDeferred<boolean>();
    rpc.ping.mockReturnValueOnce(pending.promise);
    const bootPromise = session.boot();
    session.handleData('echo during-boot\r');
    pending.resolve(true);
    await bootPromise;
    await vi.waitFor(() => expect(rpc.run).toHaveBeenCalledWith(expect.stringContaining('echo during-boot'), expect.anything()));
    expect(written.join('')).toMatch(/guest@succinix:~\$ $/);
  });
});

describe('UserTerminalSession lifecycle', () => {
  it('suppresses output and discards queued commands after dispose', async () => {
    const { written, rpc, session } = createHarness();
    const pending = createDeferred<SuccinixRunResult>();
    rpc.run.mockReturnValueOnce(pending.promise);
    session.handleData('one\r');
    session.handleData('two\r');
    session.dispose();
    const before = written.length;
    pending.resolve({ ok: true, exitCode: 0, stdout: 'late', stderr: '', timedOut: false });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(written.length).toBe(before); // 在途结果与排队命令不再回显
  });

  it('exports the Succinix banner constant for the host boot flow', () => {
    expect(SUCCINIX_BANNER).toMatch(/^Succinix 0\.2\.0/);
  });
});

function createDeferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}
