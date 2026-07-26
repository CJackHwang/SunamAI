import { useEffect, useRef } from 'react';
import type { MouseEvent } from 'react';
import { ChevronDown, Terminal } from 'lucide-react';
import type { Message } from '@/entities/message/types';

interface ToolDisclosureProps {
  name: string;
  argumentsText: string;
  output?: Message;
  runningLabel: string;
  completedLabel: string;
  resultLabel: string;
}

const TOOL_OPEN_EASING = 'cubic-bezier(0.32, 0.72, 0, 1)';
const TOOL_CONTENT_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)';

export function ToolDisclosure({ name, argumentsText, output, runningLabel, completedLabel, resultLabel }: ToolDisclosureProps) {
  const disclosureRef = useRef<HTMLDetailsElement>(null);
  const boxAnimationRef = useRef<Animation | null>(null);
  const contentAnimationRef = useRef<Animation | null>(null);
  const stopBottomFollowRef = useRef<(() => void) | null>(null);

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
    const scrollContainer = disclosure.closest<HTMLElement>('.chat-message-list');
    const shouldFollowBottom = Boolean(scrollContainer && scrollContainer.scrollHeight - scrollContainer.scrollTop - scrollContainer.clientHeight <= 48);

    boxAnimationRef.current?.cancel();
    contentAnimationRef.current?.cancel();
    stopBottomFollowRef.current?.();
    disclosure.dataset.expanded = String(shouldOpen);
    disclosure.open = shouldOpen;
    const endBox = disclosure.getBoundingClientRect();

    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    if (typeof disclosure.animate !== 'function' || reduceMotion) return;

    // Keep closing content present until its exit animation finishes.
    if (!shouldOpen) disclosure.open = true;
    disclosure.dataset.animating = 'true';

    const boxAnimation = disclosure.animate([
      { width: `${startBox.width}px`, height: `${startBox.height}px` },
      { width: `${endBox.width}px`, height: `${endBox.height}px` },
    ], {
      duration: shouldOpen ? 420 : 320,
      easing: TOOL_OPEN_EASING,
      fill: 'both',
    });
    const content = disclosure.querySelector<HTMLElement>('.chat-tool-body');
    const contentAnimation = content?.animate(shouldOpen ? [
      { opacity: 0, transform: 'translateY(-6px) scale(0.985)' },
      { opacity: 1, transform: 'translateY(0) scale(1)' },
    ] : [
      { opacity: 1, transform: 'translateY(0) scale(1)' },
      { opacity: 0, transform: 'translateY(-4px) scale(0.99)' },
    ], {
      duration: shouldOpen ? 340 : 220,
      easing: TOOL_CONTENT_EASING,
      fill: 'both',
    }) ?? null;

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

  return <details ref={disclosureRef} className="chat-tool" data-expanded="false">
    <summary className="chat-tool-heading" onClick={toggleDisclosure}><Terminal size={14} /><span>{output ? completedLabel : runningLabel} {name}</span><ChevronDown size={15} className="chat-tool-chevron" /></summary>
    <div className="chat-tool-body">
      {argumentsText && <pre className="chat-tool-arguments">{argumentsText}</pre>}
      {output && <div className="chat-tool-result"><div className="chat-tool-result-label">{resultLabel}</div><div className="chat-tool-result-content">{output.content}</div></div>}
    </div>
  </details>;
}
