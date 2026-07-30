import { useCallback, useEffect, useRef, type MouseEvent, type RefObject } from 'react';
import { animateElementSize, animateWithMotionPreset, prefersReducedMotion, readElementSize } from './motion';

interface IntrinsicDisclosureOptions {
  contentSelector: string;
  scrollContainerSelector?: string;
  onOpen?: () => void;
}

interface DisclosureUpdateOptions {
  animate?: boolean;
  followScroll?: boolean;
}

export function useIntrinsicDisclosure(options: IntrinsicDisclosureOptions): {
  disclosureRef: RefObject<HTMLDetailsElement | null>;
  setDisclosureExpanded: (expanded: boolean, updateOptions?: DisclosureUpdateOptions) => void;
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

  const setDisclosureExpanded = useCallback((shouldOpen: boolean, updateOptions: DisclosureUpdateOptions = {}) => {
    const disclosure = disclosureRef.current;
    if (!disclosure) return;
    if ((disclosure.dataset.expanded === 'true') === shouldOpen) return;

    const shouldAnimate = updateOptions.animate ?? true;
    const shouldFollowScroll = updateOptions.followScroll ?? shouldAnimate;
    const startBox = shouldAnimate ? readElementSize(disclosure) : null;
    const scrollContainer = optionsRef.current.scrollContainerSelector
      ? disclosure.closest<HTMLElement>(optionsRef.current.scrollContainerSelector)
      : null;
    const shouldFollowBottom = Boolean(scrollContainer && scrollContainer.scrollHeight - scrollContainer.scrollTop - scrollContainer.clientHeight <= 48);

    boxAnimationRef.current?.cancel();
    contentAnimationRef.current?.cancel();
    stopBottomFollowRef.current?.();
    boxAnimationRef.current = null;
    contentAnimationRef.current = null;
    stopBottomFollowRef.current = null;
    delete disclosure.dataset.animating;
    disclosure.dataset.expanded = String(shouldOpen);
    disclosure.open = shouldOpen;
    if (shouldOpen) optionsRef.current.onOpen?.();
    const endBox = shouldAnimate ? readElementSize(disclosure) : null;

    if (!startBox || !endBox || prefersReducedMotion()) return;

    if (!shouldOpen) disclosure.open = true;
    const boxAnimation = animateElementSize(disclosure, startBox, endBox);
    if (!boxAnimation) {
      disclosure.open = shouldOpen;
      return;
    }
    disclosure.dataset.animating = 'true';
    const content = disclosure.querySelector<HTMLElement>(optionsRef.current.contentSelector);
    const contentAnimation = content ? animateWithMotionPreset(content, shouldOpen ? [
      { opacity: 0, transform: 'translateY(-6px) scale(0.985)' },
      { opacity: 1, transform: 'translateY(0) scale(1)' },
    ] : [
      { opacity: 1, transform: 'translateY(0) scale(1)' },
      { opacity: 0, transform: 'translateY(-4px) scale(0.99)' },
    ], shouldOpen ? 'content' : 'exit', 'both') : null;

    boxAnimationRef.current = boxAnimation;
    contentAnimationRef.current = contentAnimation;
    if (scrollContainer && shouldFollowBottom && shouldFollowScroll) {
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
      if (boxAnimationRef.current !== boxAnimation) return;
      if (!shouldOpen) disclosure.open = false;
      delete disclosure.dataset.animating;
      boxAnimation.cancel();
      contentAnimation?.cancel();
      stopBottomFollowRef.current?.();
      stopBottomFollowRef.current = null;
      boxAnimationRef.current = null;
      contentAnimationRef.current = null;
    }, { once: true });
  }, []);

  const toggleDisclosure = useCallback((event: MouseEvent<HTMLElement>) => {
    event.preventDefault();
    const disclosure = disclosureRef.current;
    if (disclosure) setDisclosureExpanded(disclosure.dataset.expanded !== 'true');
  }, [setDisclosureExpanded]);

  return { disclosureRef, setDisclosureExpanded, toggleDisclosure };
}
