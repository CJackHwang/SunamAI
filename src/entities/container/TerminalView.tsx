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
  // Store props in refs so useEffect can access latest values without re-triggering
  const onTerminalReadyRef = useRef(onTerminalReady);
  onTerminalReadyRef.current = onTerminalReady;
  const readOnlyRef = useRef(readOnly);
  readOnlyRef.current = readOnly;

  // Mount-only effect: create the terminal once and never recreate it.
  // Using refs for props ensures we don't re-run when parent re-renders with new inline callbacks.
  useEffect(() => {
    if (!terminalRef.current) return;

    // Read CSS custom properties at runtime — xterm.js theme needs real color values, not var() strings
    const computedStyle = getComputedStyle(document.documentElement);
    const xtermBg = computedStyle.getPropertyValue('--xterm-bg').trim() || '#000000';
    const xtermFg = computedStyle.getPropertyValue('--xterm-fg').trim() || '#ffffff';

    const term = new Terminal({
      cursorBlink: true,
      disableStdin: readOnlyRef.current,
      theme: {
        background: xtermBg,
        foreground: xtermFg,
        cursor: xtermFg,
      },
      fontSize: 14,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace'
    });
    
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    
    term.open(terminalRef.current);
    
    xtermRef.current = term;
    
    // Call onTerminalReady before fit() so that even if fit() throws due to display:none, 
    // the terminal is still successfully registered.
    onTerminalReadyRef.current?.(term);

    try {
      fitAddon.fit();
    } catch (e) {
      // Ignore fit errors when container is hidden
    }

    const resizeObserver = new ResizeObserver(() => {
      try {
        fitAddon.fit();
      } catch (e) {
        // Ignore
      }
    });
    resizeObserver.observe(terminalRef.current);

    return () => {
      resizeObserver.disconnect();
      term.dispose();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div 
      style={{ 
        width: '100%', 
        height: '100%',
        backgroundColor: 'var(--xterm-bg)',
        padding: '16px',
        paddingBottom: '24px', /* Add extra safe area at the bottom for the prompt */
        borderRadius: 'var(--radius-large)',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column'
      }}
    >
      <div 
        ref={terminalRef} 
        style={{ 
          flex: 1,
          width: '100%',
          overflow: 'hidden'
        }} 
      />
    </div>
  );
};

export default TerminalView;
