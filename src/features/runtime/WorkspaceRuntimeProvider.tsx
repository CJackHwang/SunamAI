import { useCallback, useEffect, useMemo, useRef, useState, type PropsWithChildren } from 'react';
import type { WebContainer } from '@webcontainer/api';
import type { AgentWorkspaceRuntime } from '@/shared/contracts/agentRuntime';
import type { CapabilityAvailability } from '@/shared/contracts/capability';
import { readCapabilityConfig, saveCapabilityConfig, setCapabilityModule } from '@/shared/lib/capabilityConfig';
import { getContainerRoot } from '@/shared/lib/containerPaths';
import { WebContainerAgentRuntime } from '@/features/runtime/WebContainerAgentRuntime';
import { ContainerBootNotice } from '@/shared/ui/ContainerBootNotice';
import { toErrorMessage } from '@/shared/lib/errors';
import { WorkspaceRuntimeContext, type EffectiveContainerState, type WorkspaceRuntimeContextValue } from './WorkspaceRuntimeContext';
import { createChatOnlyAgentRuntime, disposeWorkspaceRuntime, forceRestartWorkspaceRuntime, getWorkspaceRuntime, type WorkspaceRuntimeInstance } from './runtimeSingleton';
import { ContainerAvailabilityController } from './containerAvailability';

export function WorkspaceRuntimeProvider({ children }: PropsWithChildren) {
  const controllerRef = useRef<ContainerAvailabilityController | null>(null);
  if (!controllerRef.current) controllerRef.current = new ContainerAvailabilityController();
  const controller = controllerRef.current;

  const [webcontainer, setWebcontainer] = useState<WebContainer | null>(null);
  const [runtime, setRuntime] = useState<WebContainerAgentRuntime | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRestarting, setIsRestarting] = useState(false);
  const [bootFailure, setBootFailure] = useState<string | null>(null);
  const [availability, setAvailability] = useState<CapabilityAvailability>(() => controller.get());
  const [containerStarting, setContainerStarting] = useState(() => controller.isStarting());
  const [containerEnabled, setContainerEnabledState] = useState(() => readCapabilityConfig().modules['virtual-container']?.enabled ?? true);
  const [containerSwitchLocked, setContainerSwitchLocked] = useState(false);
  const errorSubscriptionRef = useRef<(() => void) | null>(null);

  const attachFullRuntime = useCallback((instance: WorkspaceRuntimeInstance) => {
    errorSubscriptionRef.current?.();
    errorSubscriptionRef.current = instance.runtime.subscribeErrors(setError);
    setWebcontainer(instance.webcontainer);
    setRuntime(instance.runtime);
    // Runtime 测试钩子（?sunam_test=1，仅查询参数触发，生产无影响）：暴露运行时单例供
    // Playwright page.evaluate 直接调用 getSuccinixProcesses / stopProcessByPid —— 真实 WC 的
    // 跨容器进程隔离断言（两容器互不可见 + 跨容器 kill 拒绝）需直达 app 后端守卫而非 UI。
    if (new URLSearchParams(window.location.search).has('sunam_test')) {
      (window as unknown as { __sunamRuntime?: WorkspaceRuntimeInstance }).__sunamRuntime = instance;
    }
  }, []);

  const attachChatOnly = useCallback(() => {
    errorSubscriptionRef.current?.();
    errorSubscriptionRef.current = null;
    setWebcontainer(null);
    setRuntime(null);
  }, []);

  useEffect(() => {
    let active = true;
    controller.setOnFailure((message) => { if (active) setBootFailure(message); });
    const unsubscribe = controller.subscribe(() => {
      if (!active) return;
      setAvailability(controller.get());
      setContainerStarting(controller.isStarting());
    });
    const forceFail = import.meta.env.DEV && new URLSearchParams(window.location.search).has('test-container-fail');
    if (forceFail) {
      // Test injection (mirrors ?test-update): simulate a container boot failure.
      setAvailability('restricted');
      setBootFailure('Simulated container boot failure');
      attachChatOnly();
      return () => { active = false; unsubscribe(); controller.setOnFailure(null); };
    }
    if (!containerEnabled) {
      // User preference is off — do not boot the container at all (F3).
      attachChatOnly();
      return () => { active = false; unsubscribe(); controller.setOnFailure(null); };
    }
    void controller.initialize().then((outcome) => {
      if (!active) return;
      if (outcome === 'enabled') {
        void getWorkspaceRuntime().then((instance) => { if (active) attachFullRuntime(instance); })
          .catch((caught) => { if (!active) return; setAvailability('restricted'); setBootFailure(toErrorMessage(caught)); attachChatOnly(); });
      } else {
        attachChatOnly();
      }
    });
    return () => {
      active = false;
      unsubscribe();
      controller.setOnFailure(null);
    };
  }, [attachChatOnly, attachFullRuntime, containerEnabled, controller]);

  const retryContainer = useCallback(async (): Promise<boolean> => {
    setBootFailure(null);
    setError(null);
    const outcome = await controller.retry();
    if (outcome === 'enabled') {
      const instance = await getWorkspaceRuntime();
      attachFullRuntime(instance);
    } else {
      attachChatOnly();
    }
    return outcome === 'enabled';
  }, [attachChatOnly, attachFullRuntime, controller]);

  const setContainerEnabled = useCallback(async (enabled: boolean) => {
    // Flip the preference immediately so the switch reacts without waiting for teardown;
    // a slow flush no longer blocks the UI.
    setContainerEnabledState(enabled);
    saveCapabilityConfig(setCapabilityModule(readCapabilityConfig(), 'virtual-container', enabled));
    if (!enabled) {
      // 关闭即释放（F3.3/F4.4）：flush 快照落盘 → teardown → 清空单例。错误冒泡到 error，
      // 不留下"界面已关但运行时未释放"的半开状态。run 活跃时开关已被锁定，不会打断任务。
      try {
        await disposeWorkspaceRuntime();
        controller.resetForReboot();
      } catch (caught) {
        setError(toErrorMessage(caught));
      }
      errorSubscriptionRef.current?.();
      errorSubscriptionRef.current = null;
    }
    // The mount effect re-runs on `containerEnabled` and boots/attaches accordingly:
    // a later enable boots lazily (fresh, thanks to the reset above); a disable has
    // already released the singleton.
  }, [controller]);

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
      attachFullRuntime(instance);
    } catch (caught) {
      setError(toErrorMessage(caught));
      throw caught;
    } finally {
      setIsRestarting(false);
    }
  }, [attachFullRuntime, isRestarting]);

  const effectiveContainerState: EffectiveContainerState = containerEnabled
    ? (availability === 'restricted' ? 'restricted' : 'enabled')
    : 'disabled';

  // Chat-only runtime is always available; it backs the agent whenever the container is
  // disabled/restricted so the sentinel container id never touches a real snapshot.
  const chatOnlyRuntime = useMemo(() => createChatOnlyAgentRuntime(), []);
  const agentRuntime: AgentWorkspaceRuntime | null = useMemo(
    () => (effectiveContainerState === 'enabled' && runtime ? runtime : chatOnlyRuntime),
    [chatOnlyRuntime, effectiveContainerState, runtime],
  );

  useEffect(() => {
    const flush = () => { void agentRuntime?.flushSnapshots().catch((caught) => setError(toErrorMessage(caught))); };
    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
  }, [agentRuntime]);

  const value = useMemo<WorkspaceRuntimeContextValue>(() => ({
    webcontainer,
    runtime,
    agentRuntime,
    error,
    isReady: Boolean(agentRuntime) && !isRestarting,
    isRestarting,
    containerAvailability: availability,
    containerStarting,
    effectiveContainerState,
    retryContainer,
    setContainerEnabled,
    containerSwitchLocked,
    setContainerSwitchLocked,
    forceRestart,
    getContainerRoot,
  }), [agentRuntime, availability, containerStarting, containerSwitchLocked, effectiveContainerState, error, forceRestart, isRestarting, retryContainer, runtime, setContainerEnabled, webcontainer]);

  return (
    <WorkspaceRuntimeContext.Provider value={value}>
      {children}
      {bootFailure && <ContainerBootNotice message={bootFailure} onDismiss={() => setBootFailure(null)} onRetry={() => { void retryContainer(); }} />}
    </WorkspaceRuntimeContext.Provider>
  );
}
