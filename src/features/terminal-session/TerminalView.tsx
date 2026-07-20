import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import './TerminalView.css';

interface TerminalViewProps {
  onTerminalReady?: (terminal: Terminal) => void;
  readOnly?: boolean;
}

export default function TerminalView({ onTerminalReady, readOnly = false }: TerminalViewProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const onTerminalReadyRef = useRef(onTerminalReady);
  onTerminalReadyRef.current = onTerminalReady;
  const readOnlyRef = useRef(readOnly);
  readOnlyRef.current = readOnly;

  useEffect(() => {
    const element = terminalRef.current;
    if (!element) return;
    const computedStyle = getComputedStyle(document.documentElement);
    const background = computedStyle.getPropertyValue('--xterm-bg').trim() || '#000000';
    const foreground = computedStyle.getPropertyValue('--xterm-fg').trim() || '#ffffff';
    const terminal = new Terminal({
      cursorBlink: true,
      disableStdin: readOnlyRef.current,
      theme: { background, foreground, cursor: foreground },
      fontSize: 14,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(element);
    onTerminalReadyRef.current?.(terminal);

    const fitVisibleTerminal = () => {
      if (element.clientWidth > 0 && element.clientHeight > 0) fitAddon.fit();
    };
    fitVisibleTerminal();
    const resizeObserver = new ResizeObserver(fitVisibleTerminal);
    resizeObserver.observe(element);
    return () => {
      resizeObserver.disconnect();
      terminal.dispose();
    };
  }, []);

  return <div className="terminal-view"><div ref={terminalRef} className="terminal-view-screen" /></div>;
}
