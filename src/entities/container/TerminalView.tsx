import React, { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

interface TerminalViewProps {
  onTerminalReady?: (terminal: Terminal) => void;
  readOnly?: boolean;
}

const TerminalView: React.FC<TerminalViewProps> = ({ onTerminalReady, readOnly = false }) => {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);

  useEffect(() => {
    if (!terminalRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      disableStdin: readOnly,
      theme: {
        background: 'var(--xterm-bg)',
        foreground: 'var(--xterm-fg)',
        cursor: 'var(--xterm-fg)',
      },
      fontSize: 14,
      fontFamily: 'var(--font-mono)'
    });
    
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    
    term.open(terminalRef.current);
    fitAddon.fit();
    
    xtermRef.current = term;

    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
    });
    resizeObserver.observe(terminalRef.current);

    if (onTerminalReady) {
      onTerminalReady(term);
    }

    return () => {
      resizeObserver.disconnect();
      term.dispose();
    };
  }, [readOnly, onTerminalReady]);

  return (
    <div 
      ref={terminalRef} 
      style={{ 
        width: '100%', 
        height: '100%',
        backgroundColor: 'var(--xterm-bg)',
        padding: '16px',
        borderRadius: 'var(--radius-large)',
        overflow: 'hidden'
      }} 
    />
  );
};

export default TerminalView;
