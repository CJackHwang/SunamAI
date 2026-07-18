import React, { useState, useEffect, useRef } from 'react';
import { WebContainer } from '@webcontainer/api';
import { Terminal } from '@xterm/xterm';
import TerminalView from '../../entities/container/TerminalView.tsx';
import { getWebContainer } from '../../shared/lib/webcontainer.ts';

export interface DualTerminalRef {
  runAiCommand: (command: string) => Promise<string>;
}

interface DualTerminalProps {
  onReady?: () => void;
}

const DualTerminal = React.forwardRef<DualTerminalRef, DualTerminalProps>(({ onReady }, ref) => {
  const [activeTab, setActiveTab] = useState<'ai' | 'user'>('ai');
  const aiTermRef = useRef<Terminal | null>(null);
  const userTermRef = useRef<Terminal | null>(null);
  const [isUserTermReady, setIsUserTermReady] = useState(false);
  const [wc, setWc] = useState<WebContainer | null>(null);

  useEffect(() => {
    let mounted = true;
    getWebContainer().then(instance => {
      if (mounted) {
        setWc(instance);
        onReady?.();
      }
    });
    return () => { mounted = false; };
  }, [onReady]);

  // Boot user terminal shell when WC and user term are ready
  useEffect(() => {
    if (!wc || !isUserTermReady || !userTermRef.current) return;
    
    let process: any;
    const bootShell = async () => {
      process = await wc.spawn('jsh');
      
      process.output.pipeTo(new WritableStream({
        write(data) {
          userTermRef.current?.write(data);
        }
      }));

      const shellWriter = process.input.getWriter();
      
      userTermRef.current?.onData((data) => {
        shellWriter.write(data);
      });
    };
    bootShell();

    return () => {
      if (process) process.kill();
    };
  }, [wc, isUserTermReady]);

  React.useImperativeHandle(ref, () => ({
    runAiCommand: async (command: string): Promise<string> => {
      if (!wc || !aiTermRef.current) return 'Error: WebContainer not ready';
      
      const term = aiTermRef.current;
      term.writeln(`\r\nAdmin@SunamAI ~ # ${command}`);
      
      try {
        const process = await wc.spawn('jsh', ['-c', command]);
        let output = '';
        
        process.output.pipeTo(new WritableStream({
          write(data) {
            term.write(data);
            output += data;
          }
        }));

        const exitCode = await process.exit;
        term.writeln(`\r\n[Process exited with code ${exitCode}]`);
        return output || '[No Output]';
      } catch (err) {
        term.writeln(`\r\n[Execution Error]: ${err}`);
        return `Error: ${err}`;
      }
    }
  }));

  const tabStyle = (isActive: boolean): React.CSSProperties => ({
    padding: '8px 16px',
    borderBottom: isActive ? '2px solid var(--color-black)' : '2px solid transparent',
    color: isActive ? 'var(--color-black)' : 'var(--color-text-secondary)',
    fontWeight: isActive ? 600 : 400,
    fontSize: '14px'
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', gap: '16px', padding: '8px 16px', borderBottom: '1px solid var(--color-border)' }}>
        <button style={tabStyle(activeTab === 'ai')} onClick={() => setActiveTab('ai')}>
          Sunam的电脑
        </button>
        <button style={tabStyle(activeTab === 'user')} onClick={() => setActiveTab('user')}>
          User Terminal
        </button>
      </div>
      <div style={{ flex: 1, padding: '16px', position: 'relative', overflow: 'hidden' }}>
        <div style={{ display: activeTab === 'ai' ? 'block' : 'none', height: '100%' }}>
          <TerminalView readOnly={true} onTerminalReady={(term) => { aiTermRef.current = term; }} />
        </div>
        <div style={{ display: activeTab === 'user' ? 'block' : 'none', height: '100%' }}>
          <TerminalView readOnly={false} onTerminalReady={(term) => { userTermRef.current = term; setIsUserTermReady(true); }} />
        </div>
      </div>
    </div>
  );
});

export default DualTerminal;
