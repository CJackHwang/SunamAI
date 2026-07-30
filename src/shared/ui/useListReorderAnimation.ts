import { useLayoutEffect, useRef, type RefObject } from 'react';
import { animateWithMotionPreset, prefersReducedMotion } from './motion';

const REORDER_SELECTOR = '[data-reorder-key]';

export function useListReorderAnimation(orderSignature: string): RefObject<HTMLDivElement | null> {
  const listRef = useRef<HTMLDivElement>(null);
  const previousRectsRef = useRef(new Map<string, DOMRect>());
  const animationsRef = useRef(new Map<string, Animation>());

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const elements = Array.from(list.querySelectorAll<HTMLElement>(REORDER_SELECTOR));
    const measure = () => {
      const rects = new Map<string, DOMRect>();
      for (const element of elements) {
        const key = element.dataset.reorderKey;
        if (key) rects.set(key, element.getBoundingClientRect());
      }
      return rects;
    };

    const visualRects = animationsRef.current.size > 0 ? measure() : previousRectsRef.current;
    for (const animation of animationsRef.current.values()) animation.cancel();
    animationsRef.current.clear();
    const nextRects = measure();
    if (!prefersReducedMotion()) {
      for (const element of elements) {
        const key = element.dataset.reorderKey;
        if (!key) continue;
        const previous = visualRects.get(key);
        const next = nextRects.get(key);
        if (!previous || !next) continue;
        const deltaY = previous.top - next.top;
        if (Math.abs(deltaY) < 0.5) continue;
        const animation = animateWithMotionPreset(element, [
          { transform: `translateY(${deltaY}px)` },
          { transform: 'translateY(0)' },
        ], 'spatial');
        if (!animation) continue;
        animationsRef.current.set(key, animation);
        animation.addEventListener('finish', () => {
          if (animationsRef.current.get(key) === animation) animationsRef.current.delete(key);
        }, { once: true });
      }
    }
    previousRectsRef.current = nextRects;
  }, [orderSignature]);

  useLayoutEffect(() => () => {
    for (const animation of animationsRef.current.values()) animation.cancel();
    animationsRef.current.clear();
  }, []);

  return listRef;
}
