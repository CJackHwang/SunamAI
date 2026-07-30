import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

const LIVE_EDGE_PX = 8;
const SCROLL_SHORTCUT_DISTANCE_RATIO = 0.25;
const RETURN_TIME_CONSTANT_MS = 90;
const RETURN_SETTLE_PX = 0.75;

type FollowMode = 'following' | 'detached' | 'returning';

function distanceFromBottom(container: HTMLElement): number {
  return Math.max(0, container.scrollHeight - container.scrollTop - container.clientHeight);
}

function isWithinScrollShortcutThreshold(container: HTMLElement): boolean {
  return distanceFromBottom(container) <= Math.max(LIVE_EDGE_PX, container.clientHeight * SCROLL_SHORTCUT_DISTANCE_RATIO);
}

export function useChatAutoScroll(dependencies: unknown[]) {
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const modeRef = useRef<FollowMode>('following');
  const returnFrameRef = useRef<number | null>(null);
  const lastScrollTopRef = useRef(0);
  const touchYRef = useRef<number | null>(null);
  const shortcutHiddenRef = useRef(true);
  const pointerActiveRef = useRef(false);
  const [isAtBottom, setIsAtBottom] = useState(true);

  const setShortcutHidden = useCallback((hidden: boolean) => {
    if (shortcutHiddenRef.current === hidden) return;
    shortcutHiddenRef.current = hidden;
    setIsAtBottom(hidden);
  }, []);

  const updateShortcutVisibility = useCallback((container: HTMLElement) => {
    setShortcutHidden(isWithinScrollShortcutThreshold(container));
  }, [setShortcutHidden]);

  const cancelReturn = useCallback(() => {
    if (returnFrameRef.current !== null) cancelAnimationFrame(returnFrameRef.current);
    returnFrameRef.current = null;
  }, []);

  const detach = useCallback(() => {
    cancelReturn();
    modeRef.current = 'detached';
    const container = containerRef.current;
    if (container) updateShortcutVisibility(container);
  }, [cancelReturn, updateShortcutVisibility]);

  const followLatest = useCallback(() => {
    cancelReturn();
    modeRef.current = 'following';
    const container = containerRef.current;
    if (container) {
      container.scrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
      lastScrollTopRef.current = container.scrollTop;
    }
    setShortcutHidden(true);
  }, [cancelReturn, setShortcutHidden]);

  const correctFollowingPosition = useCallback(() => {
    const container = containerRef.current;
    if (container && modeRef.current === 'following') {
      container.scrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
      lastScrollTopRef.current = container.scrollTop;
      setShortcutHidden(true);
    }
  }, [setShortcutHidden]);

  const restorePosition = useCallback((scrollTop?: number) => {
    const container = containerRef.current;
    if (!container) return;
    cancelReturn();
    container.scrollTop = scrollTop ?? Math.max(0, container.scrollHeight - container.clientHeight);
    lastScrollTopRef.current = container.scrollTop;
    if (distanceFromBottom(container) <= LIVE_EDGE_PX) {
      modeRef.current = 'following';
      setShortcutHidden(true);
    } else {
      modeRef.current = 'detached';
      updateShortcutVisibility(container);
    }
  }, [cancelReturn, setShortcutHidden, updateShortcutVisibility]);

  const scrollToBottom = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    cancelReturn();
    const startTop = container.scrollTop;
    const initialTarget = Math.max(0, container.scrollHeight - container.clientHeight);
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    if (reduceMotion || Math.abs(initialTarget - startTop) < 1) {
      followLatest();
      return;
    }

    modeRef.current = 'returning';
    updateShortcutVisibility(container);
    let previousTimestamp: number | null = null;
    const step = (timestamp: number) => {
      if (modeRef.current !== 'returning') return;
      const liveTarget = Math.max(0, container.scrollHeight - container.clientHeight);
      const deltaMs = previousTimestamp === null ? 16 : Math.min(32, Math.max(1, timestamp - previousTimestamp));
      previousTimestamp = timestamp;
      const easedStep = 1 - Math.exp(-deltaMs / RETURN_TIME_CONSTANT_MS);
      container.scrollTop += (liveTarget - container.scrollTop) * easedStep;
      lastScrollTopRef.current = container.scrollTop;
      updateShortcutVisibility(container);
      if (Math.abs(liveTarget - container.scrollTop) > RETURN_SETTLE_PX) {
        returnFrameRef.current = requestAnimationFrame(step);
        return;
      }
      returnFrameRef.current = null;
      modeRef.current = 'following';
      container.scrollTop = liveTarget;
      lastScrollTopRef.current = container.scrollTop;
      setShortcutHidden(true);
    };
    returnFrameRef.current = requestAnimationFrame(step);
  }, [cancelReturn, followLatest, setShortcutHidden, updateShortcutVisibility]);

  const onScroll = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const currentTop = container.scrollTop;
    const movedUp = currentTop < lastScrollTopRef.current - 0.5;
    lastScrollTopRef.current = currentTop;
    const liveEdgeDistance = distanceFromBottom(container);
    if (modeRef.current === 'returning') return;
    if (movedUp && pointerActiveRef.current) {
      detach();
      return;
    }
    if (movedUp && modeRef.current === 'following') {
      correctFollowingPosition();
      return;
    }
    if (liveEdgeDistance <= LIVE_EDGE_PX) {
      modeRef.current = 'following';
      setShortcutHidden(true);
      return;
    }
    if (modeRef.current === 'following') {
      correctFollowingPosition();
      return;
    }
    updateShortcutVisibility(container);
  }, [correctFollowingPosition, detach, setShortcutHidden, updateShortcutVisibility]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    lastScrollTopRef.current = container.scrollTop;
    const cancelForDirectInput = () => { if (modeRef.current === 'returning') detach(); };
    const onWheel = (event: WheelEvent) => {
      if (modeRef.current === 'returning' || event.deltaY < 0) detach();
    };
    const onTouchStart = (event: TouchEvent) => {
      touchYRef.current = event.touches[0]?.clientY ?? null;
      cancelForDirectInput();
    };
    const onTouchMove = (event: TouchEvent) => {
      const nextY = event.touches[0]?.clientY ?? null;
      if (nextY !== null && touchYRef.current !== null && nextY > touchYRef.current) detach();
      touchYRef.current = nextY;
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (['ArrowUp', 'PageUp', 'Home'].includes(event.key) || (event.key === ' ' && event.shiftKey)) detach();
      else if (modeRef.current === 'returning' && ['ArrowDown', 'PageDown', 'End', ' '].includes(event.key)) detach();
    };
    container.addEventListener('wheel', onWheel, { passive: true });
    container.addEventListener('touchstart', onTouchStart, { passive: true });
    container.addEventListener('touchmove', onTouchMove, { passive: true });
    container.addEventListener('touchend', cancelForDirectInput, { passive: true });
    const onPointerDown = () => {
      pointerActiveRef.current = true;
      cancelForDirectInput();
    };
    const onPointerEnd = () => { pointerActiveRef.current = false; };
    container.addEventListener('pointerdown', onPointerDown, { passive: true });
    window.addEventListener('pointerup', onPointerEnd, { passive: true });
    window.addEventListener('pointercancel', onPointerEnd, { passive: true });
    container.addEventListener('keydown', onKeyDown);
    return () => {
      cancelReturn();
      container.removeEventListener('wheel', onWheel);
      container.removeEventListener('touchstart', onTouchStart);
      container.removeEventListener('touchmove', onTouchMove);
      container.removeEventListener('touchend', cancelForDirectInput);
      container.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointerup', onPointerEnd);
      window.removeEventListener('pointercancel', onPointerEnd);
      container.removeEventListener('keydown', onKeyDown);
    };
  }, [cancelReturn, detach]);

  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      const container = containerRef.current;
      if (!container) return;
      if (modeRef.current === 'following') correctFollowingPosition();
      else if (modeRef.current === 'detached') updateShortcutVisibility(container);
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, [correctFollowingPosition, updateShortcutVisibility]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (container && modeRef.current === 'following') {
      container.scrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
      lastScrollTopRef.current = container.scrollTop;
      setShortcutHidden(true);
    } else if (container && modeRef.current === 'detached') updateShortcutVisibility(container);
  // `dependencies` represents message/agent updates and intentionally accepts a caller-owned array.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...dependencies]);

  return { containerRef, contentRef, isAtBottom, onScroll, scrollToBottom, followLatest, restorePosition };
}
