import { useLayoutEffect, useRef, type RefObject } from 'react';
import { animateElementSize, readElementSize } from './motion';

interface LayoutSizeAnimationOptions {
  active: boolean;
  layoutSignature: string;
}

export function useLayoutSizeAnimation({ active, layoutSignature }: LayoutSizeAnimationOptions): RefObject<HTMLDivElement | null> {
  const elementRef = useRef<HTMLDivElement>(null);
  const animationRef = useRef<Animation | null>(null);
  const targetSizeRef = useRef<ReturnType<typeof readElementSize> | null>(null);

  useLayoutEffect(() => {
    const element = elementRef.current;
    if (!element) return;

    const runningAnimation = animationRef.current;
    const startSize = runningAnimation ? readElementSize(element) : targetSizeRef.current;
    runningAnimation?.cancel();
    animationRef.current = null;
    delete element.dataset.sizeAnimating;

    const targetSize = readElementSize(element);
    targetSizeRef.current = targetSize;
    if (!active || !startSize) return;

    const animation = animateElementSize(element, startSize, targetSize);
    if (!animation) return;
    element.dataset.sizeAnimating = 'true';
    animationRef.current = animation;
    animation.addEventListener('finish', () => {
      if (animationRef.current !== animation) return;
      animation.cancel();
      animationRef.current = null;
      delete element.dataset.sizeAnimating;
    }, { once: true });
  }, [active, layoutSignature]);

  useLayoutEffect(() => () => {
    animationRef.current?.cancel();
    animationRef.current = null;
    const element = elementRef.current;
    if (element) delete element.dataset.sizeAnimating;
  }, []);

  return elementRef;
}
