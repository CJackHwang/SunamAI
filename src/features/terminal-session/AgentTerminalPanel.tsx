import { useEffect, useState, type MutableRefObject } from 'react';
import type { Terminal } from '@xterm/xterm';
import { toErrorMessage } from '@/shared/lib/errors';
import { getAgentTerminalBuffer, restoreAgentTerminalBuffer } from './agentTerminalBuffer';
import TerminalView from './TerminalView';

interface AgentTerminalPanelProps {
  sessionId: string | null;
  terminalRef: MutableRefObject<Terminal | null>;
}

export function AgentTerminalPanel({ sessionId, terminalRef }: AgentTerminalPanelProps) {
  const [terminal, setTerminal] = useState<Terminal | null>(null);

  useEffect(() => {
    if (!terminal) return;
    terminal.clear();
    const buffered = getAgentTerminalBuffer(sessionId);
    if (buffered) terminal.write(buffered);
    void restoreAgentTerminalBuffer(sessionId).then((restored) => {
      if (!restored) return;
      terminal.clear();
      terminal.write(restored);
    }).catch((error) => terminal.write(`\r\n[Terminal history error: ${toErrorMessage(error)}]\r\n`));
  }, [sessionId, terminal]);

  return <TerminalView readOnly onTerminalReady={(instance) => { terminalRef.current = instance; setTerminal(instance); }} />;
}
