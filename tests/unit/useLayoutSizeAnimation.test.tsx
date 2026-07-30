import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useLayoutSizeAnimation } from '@/shared/ui/useLayoutSizeAnimation';

function fakeAnimation() {
  return {
    addEventListener: vi.fn(),
    cancel: vi.fn(),
  } as unknown as Animation;
}

describe('useLayoutSizeAnimation', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('animates a layout boundary from its previous intrinsic size', () => {
    const animation = fakeAnimation();
    const element = document.createElement('div');
    const animate = vi.fn(() => animation);
    element.animate = animate;
    element.getBoundingClientRect = vi.fn()
      .mockReturnValueOnce({ width: 80, height: 48 })
      .mockReturnValueOnce({ width: 180, height: 72 });
    const rendered = renderHook(({ layoutSignature }) => useLayoutSizeAnimation({ active: true, layoutSignature }), { initialProps: { layoutSignature: 'a' } });
    rendered.result.current.current = element;

    rendered.rerender({ layoutSignature: 'a longer answer' });
    rendered.rerender({ layoutSignature: 'a longer answer on another line' });

    expect(animate).toHaveBeenCalledWith([
      { width: '80px', height: '48px' },
      { width: '180px', height: '72px' },
    ], expect.objectContaining({ duration: 360, easing: 'cubic-bezier(0.32, 0.72, 0, 1)', fill: 'both' }));
    expect(element).toHaveAttribute('data-size-animating', 'true');
  });

  it('retargets an in-flight animation from its current visible size', () => {
    const firstAnimation = fakeAnimation();
    const secondAnimation = fakeAnimation();
    const element = document.createElement('div');
    const animate = vi.fn()
      .mockReturnValueOnce(firstAnimation)
      .mockReturnValueOnce(secondAnimation);
    element.animate = animate;
    element.getBoundingClientRect = vi.fn()
      .mockReturnValueOnce({ width: 80, height: 48 })
      .mockReturnValueOnce({ width: 180, height: 72 })
      .mockReturnValueOnce({ width: 132, height: 58 })
      .mockReturnValueOnce({ width: 260, height: 96 });
    const rendered = renderHook(({ layoutSignature }) => useLayoutSizeAnimation({ active: true, layoutSignature }), { initialProps: { layoutSignature: 'a' } });
    rendered.result.current.current = element;

    rendered.rerender({ layoutSignature: 'answer-1' });
    rendered.rerender({ layoutSignature: 'answer-2' });
    rendered.rerender({ layoutSignature: 'answer-3' });

    expect(firstAnimation.cancel).toHaveBeenCalledTimes(1);
    expect(animate).toHaveBeenLastCalledWith([
      { width: '132px', height: '58px' },
      { width: '260px', height: '96px' },
    ], expect.objectContaining({ duration: 360, fill: 'both' }));
  });

  it('consumes the global spatial motion tokens', () => {
    const element = document.createElement('div');
    const animate = vi.fn(() => fakeAnimation());
    element.animate = animate;
    element.style.setProperty('--motion-slow', '480ms');
    element.style.setProperty('--motion-sheet', 'cubic-bezier(0.1, 0.9, 0.2, 1)');
    element.getBoundingClientRect = vi.fn()
      .mockReturnValueOnce({ width: 100, height: 60 })
      .mockReturnValueOnce({ width: 200, height: 90 });
    const rendered = renderHook(({ layoutSignature }) => useLayoutSizeAnimation({ active: true, layoutSignature }), { initialProps: { layoutSignature: 'initial' } });
    rendered.result.current.current = element;

    rendered.rerender({ layoutSignature: 'target-1' });
    rendered.rerender({ layoutSignature: 'target-2' });

    expect(animate).toHaveBeenCalledWith(expect.any(Array), expect.objectContaining({
      duration: 480,
      easing: 'cubic-bezier(0.1, 0.9, 0.2, 1)',
    }));
  });

  it('limits the average width expansion speed for large layout changes', () => {
    const element = document.createElement('div');
    const animate = vi.fn(() => fakeAnimation());
    element.animate = animate;
    element.getBoundingClientRect = vi.fn()
      .mockReturnValueOnce({ width: 100, height: 60 })
      .mockReturnValueOnce({ width: 900, height: 90 });
    const rendered = renderHook(({ layoutSignature }) => useLayoutSizeAnimation({ active: true, layoutSignature }), { initialProps: { layoutSignature: 'initial' } });
    rendered.result.current.current = element;

    rendered.rerender({ layoutSignature: 'target-1' });
    rendered.rerender({ layoutSignature: 'target-2' });

    expect(animate).toHaveBeenCalledWith(expect.any(Array), expect.objectContaining({ duration: 800 }));
  });

  it('updates immediately when reduced motion is requested', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));
    const element = document.createElement('div');
    const animate = vi.fn(() => fakeAnimation());
    element.animate = animate;
    element.getBoundingClientRect = vi.fn()
      .mockReturnValueOnce({ width: 80, height: 48 })
      .mockReturnValueOnce({ width: 180, height: 72 });
    const rendered = renderHook(({ layoutSignature }) => useLayoutSizeAnimation({ active: true, layoutSignature }), { initialProps: { layoutSignature: 'a' } });
    rendered.result.current.current = element;

    act(() => rendered.rerender({ layoutSignature: 'answer-1' }));
    act(() => rendered.rerender({ layoutSignature: 'answer-2' }));

    expect(animate).not.toHaveBeenCalled();
    expect(element).not.toHaveAttribute('data-size-animating');
  });
});
