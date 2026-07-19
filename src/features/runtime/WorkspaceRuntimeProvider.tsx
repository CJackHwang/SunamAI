import { useEffect, useMemo, useState, type PropsWithChildren } from 'react';
import type { WebContainer } from '@webcontainer/api';
import { WebContainerAgentRuntime } from '@/features/terminal-session/WebContainerAgentRuntime';
import { getWebContainer } from '@/shared/lib/webcontainer';
import { getContainerRoot } from '@/shared/lib/containerPaths';
import { WorkspaceRuntimeContext, type WorkspaceRuntimeContextValue } from './WorkspaceRuntimeContext';

export function WorkspaceRuntimeProvider({ children }: PropsWithChildren) {
  const [webcontainer, setWebcontainer] = useState<WebContainer | null>(null);
  const [runtime, setRuntime] = useState<WebContainerAgentRuntime | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let currentRuntime: WebContainerAgentRuntime | null = null;
    void getWebContainer().then((instance) => {
      if (!active) return;
      currentRuntime = new WebContainerAgentRuntime(instance);
      setWebcontainer(instance);
      setRuntime(currentRuntime);
    }).catch((caught) => {
      if (active) setError(caught instanceof Error ? caught.message : String(caught));
    });
    const flush = () => { void currentRuntime?.flushSnapshots(); };
    window.addEventListener('pagehide', flush);
    return () => {
      active = false;
      window.removeEventListener('pagehide', flush);
      void currentRuntime?.flushSnapshots().finally(() => currentRuntime?.dispose());
    };
  }, []);

  const value = useMemo<WorkspaceRuntimeContextValue>(() => ({ webcontainer, runtime, error, isReady: Boolean(webcontainer && runtime), getContainerRoot }), [error, runtime, webcontainer]);
  return <WorkspaceRuntimeContext.Provider value={value}>{children}</WorkspaceRuntimeContext.Provider>;
}
