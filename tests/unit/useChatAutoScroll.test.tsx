import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useChatAutoScroll } from '@/features/chat/hooks/useChatAutoScroll';

function scrollContainer() {
  const container = document.createElement('div');
  Object.defineProperties(container, {
    clientHeight: { configurable: true, value: 200 },
    scrollHeight: { configurable: true, value: 1_000 },
    scrollTop: { configurable: true, writable: true, value: 800 },
  });
  return container;
}

function renderScrollHook(container: HTMLDivElement, revision = 0) {
  return renderHook(({ nextRevision }) => {
    const hook = useChatAutoScroll([nextRevision]);
    hook.containerRef.current = container;
    return hook;
  }, { initialProps: { nextRevision: revision } });
}

describe('useChatAutoScroll', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('keeps an already-following viewport pinned without starting animations', () => {
    const container = scrollContainer();
    const rendered = renderScrollHook(container);
    Object.defineProperty(container, 'scrollHeight', { configurable: true, value: 1_200 });

    rendered.rerender({ nextRevision: 1 });

    expect(container.scrollTop).toBe(1_000);
  });

  it('detaches on upward movement even inside the old near-bottom threshold', () => {
    const container = scrollContainer();
    const rendered = renderScrollHook(container);
    act(() => rendered.result.current.onScroll());
    container.scrollTop = 749;
    act(() => rendered.result.current.onScroll());
    Object.defineProperty(container, 'scrollHeight', { configurable: true, value: 1_200 });

    rendered.rerender({ nextRevision: 1 });

    expect(rendered.result.current.isAtBottom).toBe(false);
    expect(container.scrollTop).toBe(749);
  });

  it('keeps the shortcut hidden within one quarter viewport while remaining detached', () => {
    const container = scrollContainer();
    const rendered = renderScrollHook(container);
    act(() => rendered.result.current.onScroll());
    container.scrollTop = 770;
    act(() => rendered.result.current.onScroll());

    expect(rendered.result.current.isAtBottom).toBe(true);
    Object.defineProperty(container, 'scrollHeight', { configurable: true, value: 1_200 });
    rendered.rerender({ nextRevision: 1 });

    expect(container.scrollTop).toBe(770);
    expect(rendered.result.current.isAtBottom).toBe(false);
  });

  it('dynamically extends an explicit return target as streaming content grows', () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => { frames.push(callback); return frames.length; }));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const container = scrollContainer();
    const rendered = renderScrollHook(container);
    container.scrollTop = 200;
    act(() => rendered.result.current.onScroll());

    act(() => rendered.result.current.scrollToBottom());
    for (let frame = 0; frame < 100 && frames.length > 0; frame += 1) {
      if (frame === 3) Object.defineProperty(container, 'scrollHeight', { configurable: true, value: 1_400 });
      act(() => frames.shift()?.(frame * 16));
    }

    expect(container.scrollTop).toBe(1_200);
    expect(rendered.result.current.isAtBottom).toBe(true);
  });

  it('cancels a return animation on direct pointer input and stays detached', () => {
    const frames: FrameRequestCallback[] = [];
    const cancelAnimationFrame = vi.fn();
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => { frames.push(callback); return 17; }));
    vi.stubGlobal('cancelAnimationFrame', cancelAnimationFrame);
    const container = scrollContainer();
    const rendered = renderScrollHook(container);
    container.scrollTop = 200;
    act(() => rendered.result.current.onScroll());

    act(() => rendered.result.current.scrollToBottom());
    act(() => container.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
    Object.defineProperty(container, 'scrollHeight', { configurable: true, value: 1_200 });
    rendered.rerender({ nextRevision: 1 });

    expect(cancelAnimationFrame).toHaveBeenCalledWith(17);
    expect(rendered.result.current.isAtBottom).toBe(false);
    expect(container.scrollTop).toBe(200);
  });

  it('hides the shortcut after return motion crosses the quarter-viewport threshold', () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => { frames.push(callback); return frames.length; }));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const container = scrollContainer();
    const rendered = renderScrollHook(container);
    container.scrollTop = 200;
    act(() => rendered.result.current.onScroll());
    act(() => rendered.result.current.scrollToBottom());

    for (let frame = 0; frame < 100 && !rendered.result.current.isAtBottom; frame += 1) {
      act(() => frames.shift()?.(frame * 16));
    }

    expect(rendered.result.current.isAtBottom).toBe(true);
    expect(container.scrollTop).toBeLessThan(800);
    expect(frames.length).toBeGreaterThan(0);
  });

  it('reattaches immediately for a submitted message', () => {
    const container = scrollContainer();
    container.scrollTop = 300;
    const rendered = renderScrollHook(container);
    act(() => rendered.result.current.onScroll());

    act(() => rendered.result.current.followLatest());
    Object.defineProperty(container, 'scrollHeight', { configurable: true, value: 1_300 });
    rendered.rerender({ nextRevision: 1 });

    expect(rendered.result.current.isAtBottom).toBe(true);
    expect(container.scrollTop).toBe(1_100);
  });

  it('returns immediately when reduced motion is requested', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));
    const requestAnimationFrame = vi.fn();
    vi.stubGlobal('requestAnimationFrame', requestAnimationFrame);
    const container = scrollContainer();
    container.scrollTop = 100;
    const rendered = renderScrollHook(container);

    act(() => rendered.result.current.scrollToBottom());

    expect(container.scrollTop).toBe(800);
    expect(requestAnimationFrame).not.toHaveBeenCalled();
  });
});
