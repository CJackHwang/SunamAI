import { useEffect, useRef, type MouseEvent, type RefObject } from 'react';

interface IntrinsicDisclosureOptions {
  contentSelector: string;
  scrollContainerSelector?: string;
  onOpen?: () => void;
}

const BOX_EASING = 'cubic-bezier(0.32, 0.72, 0, 1)';
const CONTENT_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)';

export function useIntrinsicDisclosure(options: IntrinsicDisclosureOptions): {
  disclosureRef: RefObject<HTMLDetailsElement | null>;
  toggleDisclosure: (event: MouseEvent<HTMLElement>) => void;
} {
  const disclosureRef = useRef<HTMLDetailsElement>(null);
  const boxAnimationRef = useRef<Animation | null>(null);
  const contentAnimationRef = useRef<Animation | null>(null);
  const stopBottomFollowRef = useRef<(() => void) | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => () => {
    boxAnimationRef.current?.cancel();
    contentAnimationRef.current?.cancel();
    stopBottomFollowRef.current?.();
  }, []);

  const toggleDisclosure = (event: MouseEvent<HTMLElement>) => {
    event.preventDefault();
    const disclosure = disclosureRef.current;
    if (!disclosure) return;

    const startBox = disclosure.getBoundingClientRect();
    const shouldOpen = disclosure.dataset.expanded !== 'true';
    const scrollContainer = optionsRef.current.scrollContainerSelector
      ? disclosure.closest<HTMLElement>(optionsRef.current.scrollContainerSelector)
      : null;
    const shouldFollowBottom = Boolean(scrollContainer && scrollContainer.scrollHeight - scrollContainer.scrollTop - scrollContainer.clientHeight <= 48);

    boxAnimationRef.current?.cancel();
    contentAnimationRef.current?.cancel();
    stopBottomFollowRef.current?.();
    disclosure.dataset.expanded = String(shouldOpen);
    disclosure.open = shouldOpen;
    if (shouldOpen) optionsRef.current.onOpen?.();
    const endBox = disclosure.getBoundingClientRect();

    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    if (typeof disclosure.animate !== 'function' || reduceMotion) return;

    if (!shouldOpen) disclosure.open = true;
    disclosure.dataset.animating = 'true';
    const boxAnimation = disclosure.animate([
      { width: `${startBox.width}px`, height: `${startBox.height}px` },
      { width: `${endBox.width}px`, height: `${endBox.height}px` },
    ], { duration: shouldOpen ? 420 : 320, easing: BOX_EASING, fill: 'both' });
    const content = disclosure.querySelector<HTMLElement>(optionsRef.current.contentSelector);
    const contentAnimation = content?.animate(shouldOpen ? [
      { opacity: 0, transform: 'translateY(-6px) scale(0.985)' },
      { opacity: 1, transform: 'translateY(0) scale(1)' },
    ] : [
      { opacity: 1, transform: 'translateY(0) scale(1)' },
      { opacity: 0, transform: 'translateY(-4px) scale(0.99)' },
    ], { duration: shouldOpen ? 340 : 220, easing: CONTENT_EASING, fill: 'both' }) ?? null;

    boxAnimationRef.current = boxAnimation;
    contentAnimationRef.current = contentAnimation;
    if (scrollContainer && shouldFollowBottom) {
      let frame = 0;
      let following = true;
      const stopFollowing = () => {
        following = false;
        cancelAnimationFrame(frame);
        scrollContainer.removeEventListener('wheel', stopFollowing);
        scrollContainer.removeEventListener('touchstart', stopFollowing);
      };
      const followBottom = () => {
        if (!following) return;
        scrollContainer.scrollTop = scrollContainer.scrollHeight;
        frame = requestAnimationFrame(followBottom);
      };
      scrollContainer.addEventListener('wheel', stopFollowing, { passive: true });
      scrollContainer.addEventListener('touchstart', stopFollowing, { passive: true });
      frame = requestAnimationFrame(followBottom);
      stopBottomFollowRef.current = stopFollowing;
    }

    boxAnimation.addEventListener('finish', () => {
      if (!shouldOpen) disclosure.open = false;
      delete disclosure.dataset.animating;
      boxAnimation.cancel();
      contentAnimation?.cancel();
      stopBottomFollowRef.current?.();
      stopBottomFollowRef.current = null;
      boxAnimationRef.current = null;
      contentAnimationRef.current = null;
    }, { once: true });
  };

  return { disclosureRef, toggleDisclosure };
}
