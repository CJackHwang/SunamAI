import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useChatAutoScroll } from '@/features/chat/hooks/useChatAutoScroll';

function attachScrollContainer(result: { current: ReturnType<typeof useChatAutoScroll> }) {
  const container = document.createElement('div');
  Object.defineProperties(container, {
    clientHeight: { configurable: true, value: 200 },
    scrollHeight: { configurable: true, value: 1_000 },
    scrollTop: { configurable: true, writable: true, value: 800 },
  });
  container.scrollTo = vi.fn();
  result.current.containerRef.current = container;
  return container;
}

describe('useChatAutoScroll', () => {
  it('keeps an already-following viewport pinned without starting smooth animations', () => {
    const rendered = renderHook(({ revision }) => useChatAutoScroll([revision]), { initialProps: { revision: 0 } });
    const container = attachScrollContainer(rendered.result);
    Object.defineProperty(container, 'scrollHeight', { configurable: true, value: 1_200 });

    rendered.rerender({ revision: 1 });

    expect(container.scrollTop).toBe(1_200);
    expect(container.scrollTo).not.toHaveBeenCalled();
  });

  it('does not steal the viewport after the user scrolls away from the bottom', () => {
    const rendered = renderHook(({ revision }) => useChatAutoScroll([revision]), { initialProps: { revision: 0 } });
    const container = attachScrollContainer(rendered.result);
    container.scrollTop = 300;
    act(() => rendered.result.current.onScroll());
    Object.defineProperty(container, 'scrollHeight', { configurable: true, value: 1_200 });

    rendered.rerender({ revision: 1 });

    expect(rendered.result.current.isAtBottom).toBe(false);
    expect(container.scrollTop).toBe(300);
  });

  it('uses smooth scrolling only for an explicit return-to-bottom action', () => {
    const rendered = renderHook(() => useChatAutoScroll([]));
    const container = attachScrollContainer(rendered.result);

    act(() => rendered.result.current.scrollToBottom());

    expect(container.scrollTo).toHaveBeenCalledWith({ top: 1_000, behavior: 'smooth' });
  });
});
