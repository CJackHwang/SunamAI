import { Folder, Monitor, Server, Terminal } from 'lucide-react';
import { useCallback, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { ContainerSegment } from '@/shared/contracts/terminal';
import { useI18n } from '@/shared/i18n';
import { useLayoutSizeAnimation } from '@/shared/ui/useLayoutSizeAnimation';
import './ContainerCapsule.css';

const SEGMENTS = [
  ['ai', Monitor, 'terminal.computer'],
  ['user', Terminal, 'terminal.shell'],
  ['services', Server, 'terminal.services'],
  ['files', Folder, 'terminal.files'],
] as const;

/** Hysteresis for the icon-only collapse: once labels drop out, only re-show them
 *  when they fit with this much space to spare (avoids flip-flopping at the edge). */
const ICON_REVEAL_MARGIN = 16;

interface ContainerCapsuleProps {
  active: ContainerSegment;
  onChange: (segment: ContainerSegment) => void;
}

/**
 * Floating "dynamic island" switching the 电脑 / 终端 / 服务 / 文件 sub-views inside the
 * merged Sunam computer tab: a light-gray track (same gray as the chat background) with
 * a white thumb following the active segment. Thumb left/width are measured from the
 * active button — labels vary in width across locales, and on mobile the island mounts
 * inside a hidden section where offsets are 0 until it becomes visible, so the alignment
 * is re-measured on every size change rather than only at mount. Labels never ellipsize:
 * without room they collapse to a pure icon row, and the island stretches/shrinks to fit
 * with the same spatial size animation the task list uses.
 */
export function ContainerCapsule({ active, onChange }: ContainerCapsuleProps) {
  const { t } = useI18n();
  const [iconsOnly, setIconsOnly] = useState(false);
  const capsuleRef = useLayoutSizeAnimation({ active: true, layoutSignature: iconsOnly ? 'icons' : 'labels' });
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const activeIndex = SEGMENTS.findIndex(([segment]) => segment === active);
  const [thumb, setThumb] = useState({ left: 0, width: 0 });
  const iconsOnlyRef = useRef(iconsOnly);
  iconsOnlyRef.current = iconsOnly;
  const activeIndexRef = useRef(activeIndex);
  activeIndexRef.current = activeIndex;

  const measure = useCallback(() => {
    const capsule = capsuleRef.current;
    const parent = capsule?.parentElement;
    if (!capsule || !parent) return;
    const available = parent.clientWidth - 24;
    // Fit: collapse labels to icons when they would overflow (never ellipsize). Compare
    // against the available space rather than the capsule's own width, and skip while a
    // size animation is in flight — the animated width is smaller than the labels and
    // would otherwise read as "still overflowing" and flip right back (an infinite loop).
    if (!capsule.dataset.sizeAnimating) {
      if (iconsOnlyRef.current) {
        // Reveal the labels for one synchronous measurement to test whether they now fit.
        capsule.classList.add('terminal-capsule--measuring');
        const textWidth = capsule.scrollWidth;
        capsule.classList.remove('terminal-capsule--measuring');
        if (textWidth <= available - ICON_REVEAL_MARGIN) setIconsOnly(false);
      } else if (capsule.scrollWidth > available + 1) {
        setIconsOnly(true);
      }
    }
    // Re-align the thumb to the active button. Runs on every (re)measure because the
    // island can mount inside a display:none section on mobile, where the mount-time
    // offsets are 0 until the section becomes visible.
    const button = buttonRefs.current[activeIndexRef.current];
    if (button) {
      const next = { left: button.offsetLeft, width: button.offsetWidth };
      setThumb((current) => (current.left === next.left && current.width === next.width ? current : next));
    }
  }, [capsuleRef]);

  useLayoutEffect(() => {
    measure();
  }, [measure, activeIndex, iconsOnly]);

  useLayoutEffect(() => {
    const capsule = capsuleRef.current;
    const parent = capsule?.parentElement;
    if (!capsule || !parent) return;
    const observer = new ResizeObserver(measure);
    observer.observe(capsule);
    observer.observe(parent);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [measure, capsuleRef]);

  const select = (index: number) => {
    const segment = SEGMENTS[index]?.[0];
    if (segment && segment !== active) onChange(segment);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    let next = activeIndex;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = Math.min(activeIndex + 1, SEGMENTS.length - 1);
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = Math.max(activeIndex - 1, 0);
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = SEGMENTS.length - 1;
    else return;
    event.preventDefault();
    if (next !== activeIndex) {
      select(next);
      buttonRefs.current[next]?.focus();
    }
  };

  return (
    <div ref={capsuleRef} className={`terminal-capsule motion-fade-in ${iconsOnly ? 'terminal-capsule--icons' : ''}`} role="tablist" aria-label={t('terminal.segmentSwitcher')} onKeyDown={onKeyDown}>
      <span className="terminal-capsule-thumb" aria-hidden="true" style={{ left: thumb.left, width: thumb.width }} />
      {SEGMENTS.map(([segment, Icon, label], index) => (
        <button
          key={segment}
          ref={(node) => { buttonRefs.current[index] = node; }}
          type="button"
          role="tab"
          id={`terminal-segment-${segment}`}
          aria-selected={active === segment}
          aria-controls={`terminal-segment-panel-${segment}`}
          tabIndex={active === segment ? 0 : -1}
          className={`terminal-capsule-btn ${active === segment ? 'active' : ''}`}
          onClick={() => select(index)}
        >
          <Icon size={14} />
          <span>{t(label)}</span>
        </button>
      ))}
    </div>
  );
}
