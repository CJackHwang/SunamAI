import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import './TerminalView.css';

interface TerminalViewProps {
  onTerminalReady?: (terminal: Terminal) => void;
  readOnly?: boolean;
}

export default function TerminalView({ onTerminalReady, readOnly = false }: TerminalViewProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const onTerminalReadyRef = useRef(onTerminalReady);
  onTerminalReadyRef.current = onTerminalReady;
  const readOnlyRef = useRef(readOnly);
  readOnlyRef.current = readOnly;

  useEffect(() => {
    const element = terminalRef.current;
    if (!element) return;
    const computedStyle = getComputedStyle(document.documentElement);
    const background = computedStyle.getPropertyValue('--xterm-bg').trim() || '#000000';
    const foreground = computedStyle.getPropertyValue('--xterm-fg').trim() || '#ffffff';
    const terminal = new Terminal({
      cursorBlink: true,
      disableStdin: readOnlyRef.current,
      theme: { background, foreground, cursor: foreground },
      fontSize: 14,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(element);
    onTerminalReadyRef.current?.(terminal);

    const fitVisibleTerminal = () => {
      if (element.clientWidth > 0 && element.clientHeight > 0) fitAddon.fit();
    };
    fitVisibleTerminal();
    const resizeObserver = new ResizeObserver(fitVisibleTerminal);
    resizeObserver.observe(element);

    // Touch scrolling. xterm v6 scrolls its buffer through a custom Scrollable that
    // only listens to `wheel` events — there is no native overflow container, so a
    // touch drag does nothing on its own. Translate vertical finger drags into
    // synthetic wheel events on the scrollable element so xterm's own wheel path
    // (1:1 pixel, smooth) drives the scroll. Horizontal-dominant drags are left alone
    // to bubble up to the segment-swipe handler; taps keep generating click events.
    let touchY = 0;
    let touchX = 0;
    let touchArmed = false;
    const onTouchStart = (event: TouchEvent) => {
      touchArmed = event.touches.length === 1;
      if (!touchArmed) return;
      touchY = event.touches[0]!.clientY;
      touchX = event.touches[0]!.clientX;
    };
    const onTouchMove = (event: TouchEvent) => {
      if (!touchArmed || event.touches.length !== 1) return;
      const currentY = event.touches[0]!.clientY;
      const currentX = event.touches[0]!.clientX;
      const deltaY = touchY - currentY;
      const deltaX = touchX - currentX;
      touchY = currentY;
      touchX = currentX;
      if (deltaY === 0) return;
      // Only claim vertical drags; a predominantly horizontal move must reach the
      // capsule swipe handler instead of being swallowed as terminal scroll.
      if (Math.abs(deltaY) < Math.abs(deltaX)) return;
      const scrollable = element.querySelector<HTMLElement>('.xterm-scrollable-element');
      if (!scrollable) return;
      scrollable.dispatchEvent(new WheelEvent('wheel', { deltaY, bubbles: true, cancelable: true }));
      event.preventDefault();
    };
    const onTouchEnd = () => { touchArmed = false; };
    const onTouchCancel = () => { touchArmed = false; };
    element.addEventListener('touchstart', onTouchStart, { passive: true });
    element.addEventListener('touchmove', onTouchMove, { passive: false });
    element.addEventListener('touchend', onTouchEnd, { passive: true });
    element.addEventListener('touchcancel', onTouchCancel, { passive: true });

    return () => {
      resizeObserver.disconnect();
      element.removeEventListener('touchstart', onTouchStart);
      element.removeEventListener('touchmove', onTouchMove);
      element.removeEventListener('touchend', onTouchEnd);
      element.removeEventListener('touchcancel', onTouchCancel);
      terminal.dispose();
    };
  }, []);

  return <div className="terminal-view"><div ref={terminalRef} className="terminal-view-screen" /></div>;
}
