import { useCallback, useEffect, useRef, useState } from 'react';

export function useChatAutoScroll(dependencies: unknown[]) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);

  const scrollToBottom = useCallback(() => {
    containerRef.current?.scrollTo({ top: containerRef.current.scrollHeight, behavior: 'smooth' });
  }, []);
  const onScroll = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    setIsAtBottom(container.scrollHeight - container.scrollTop - container.clientHeight < 100);
  }, []);

  useEffect(() => {
    if (isAtBottom) scrollToBottom();
  // `dependencies` represents message/agent updates and intentionally accepts a caller-owned array.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAtBottom, scrollToBottom, ...dependencies]);

  return { containerRef, isAtBottom, onScroll, scrollToBottom };
}
