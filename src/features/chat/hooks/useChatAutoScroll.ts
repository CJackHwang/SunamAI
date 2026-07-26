import { useCallback, useLayoutEffect, useRef, useState } from 'react';

const BOTTOM_THRESHOLD_PX = 100;

export function useChatAutoScroll(dependencies: unknown[]) {
  const containerRef = useRef<HTMLDivElement>(null);
  const followsBottomRef = useRef(true);
  const [isAtBottom, setIsAtBottom] = useState(true);

  const scrollToBottom = useCallback(() => {
    containerRef.current?.scrollTo({ top: containerRef.current.scrollHeight, behavior: 'smooth' });
  }, []);
  const onScroll = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const nextIsAtBottom = container.scrollHeight - container.scrollTop - container.clientHeight < BOTTOM_THRESHOLD_PX;
    followsBottomRef.current = nextIsAtBottom;
    setIsAtBottom((current) => current === nextIsAtBottom ? current : nextIsAtBottom);
  }, []);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (container && followsBottomRef.current) container.scrollTop = container.scrollHeight;
  // `dependencies` represents message/agent updates and intentionally accepts a caller-owned array.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...dependencies]);

  return { containerRef, isAtBottom, onScroll, scrollToBottom };
}
