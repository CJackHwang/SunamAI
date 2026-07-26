import { useCallback, useEffect, useMemo, useRef, useState, type PropsWithChildren } from 'react';
import type { WebContainer } from '@webcontainer/api';
import { WebContainerAgentRuntime } from '@/features/runtime/WebContainerAgentRuntime';
import { getContainerRoot } from '@/shared/lib/containerPaths';
import { WorkspaceRuntimeContext, type WorkspaceRuntimeContextValue } from './WorkspaceRuntimeContext';
import { forceRestartWorkspaceRuntime, getWorkspaceRuntime, type WorkspaceRuntimeInstance } from './runtimeSingleton';
import { toErrorMessage } from '@/shared/lib/errors';

export function WorkspaceRuntimeProvider({ children }: PropsWithChildren) {
  const [webcontainer, setWebcontainer] = useState<WebContainer | null>(null);
  const [runtime, setRuntime] = useState<WebContainerAgentRuntime | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRestarting, setIsRestarting] = useState(false);
  const errorSubscriptionRef = useRef<(() => void) | null>(null);

  const attachRuntime = useCallback((instance: WorkspaceRuntimeInstance) => {
    errorSubscriptionRef.current?.();
    errorSubscriptionRef.current = instance.runtime.subscribeErrors(setError);
    setWebcontainer(instance.webcontainer);
    setRuntime(instance.runtime);
  }, []);

  useEffect(() => {
    let active = true;
    void getWorkspaceRuntime().then((instance) => {
      if (active) attachRuntime(instance);
    }).catch((caught) => {
      if (active) setError(toErrorMessage(caught));
    });
    return () => {
      active = false;
      errorSubscriptionRef.current?.();
      errorSubscriptionRef.current = null;
    };
  }, [attachRuntime]);

  useEffect(() => {
    const flush = () => { void runtime?.flushSnapshots().catch((caught) => setError(toErrorMessage(caught))); };
    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
  }, [runtime]);

  const forceRestart = useCallback(async () => {
    if (isRestarting) return;
    setIsRestarting(true);
    setError(null);
    try {
      const instance = await forceRestartWorkspaceRuntime(() => {
        errorSubscriptionRef.current?.();
        errorSubscriptionRef.current = null;
        setRuntime(null);
        setWebcontainer(null);
      });
      attachRuntime(instance);
    } catch (caught) {
      const message = toErrorMessage(caught);
      setError(message);
      throw caught;
    } finally {
      setIsRestarting(false);
    }
  }, [attachRuntime, isRestarting]);

  const value = useMemo<WorkspaceRuntimeContextValue>(() => ({ webcontainer, runtime, error, isReady: Boolean(webcontainer && runtime) && !isRestarting, isRestarting, forceRestart, getContainerRoot }), [error, forceRestart, isRestarting, runtime, webcontainer]);
  return <WorkspaceRuntimeContext.Provider value={value}>{children}</WorkspaceRuntimeContext.Provider>;
}
