export type MotionRole = 'spatial' | 'content' | 'exit';

interface ElementSize {
  width: number;
  height: number;
}

interface MotionPreset {
  duration: number;
  easing: string;
}

const FALLBACK_PRESETS: Record<MotionRole, MotionPreset> = {
  spatial: { duration: 360, easing: 'cubic-bezier(0.32, 0.72, 0, 1)' },
  content: { duration: 220, easing: 'cubic-bezier(0.25, 1, 0.5, 1)' },
  exit: { duration: 180, easing: 'cubic-bezier(0.4, 0, 1, 1)' },
};

const PRESET_PROPERTIES: Record<MotionRole, { duration: string; easing: string }> = {
  spatial: { duration: '--motion-slow', easing: '--motion-sheet' },
  content: { duration: '--motion-base', easing: '--motion-ease' },
  exit: { duration: '--motion-exit-duration', easing: '--motion-exit' },
};

const SIZE_EPSILON_PX = 0.5;
const MAX_SPATIAL_WIDTH_SPEED_PX_PER_MS = 1;

function parseDuration(value: string, fallback: number): number {
  const normalized = value.trim();
  if (normalized.endsWith('ms')) {
    const milliseconds = Number.parseFloat(normalized);
    return Number.isFinite(milliseconds) ? milliseconds : fallback;
  }
  if (normalized.endsWith('s')) {
    const seconds = Number.parseFloat(normalized);
    return Number.isFinite(seconds) ? seconds * 1000 : fallback;
  }
  return fallback;
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

export function readElementSize(element: HTMLElement): ElementSize {
  const { width, height } = element.getBoundingClientRect();
  return { width, height };
}

export function elementSizesMatch(first: ElementSize, second: ElementSize): boolean {
  return Math.abs(first.width - second.width) < SIZE_EPSILON_PX
    && Math.abs(first.height - second.height) < SIZE_EPSILON_PX;
}

export function readMotionPreset(element: Element, role: MotionRole): MotionPreset {
  const fallback = FALLBACK_PRESETS[role];
  const properties = PRESET_PROPERTIES[role];
  const styles = getComputedStyle(element);
  return {
    duration: parseDuration(styles.getPropertyValue(properties.duration), fallback.duration),
    easing: styles.getPropertyValue(properties.easing).trim() || fallback.easing,
  };
}

export function animateWithMotionPreset(
  element: HTMLElement,
  keyframes: Keyframe[],
  role: MotionRole,
  fill: FillMode = 'none',
  minimumDuration = 0,
): Animation | null {
  if (typeof element.animate !== 'function' || prefersReducedMotion()) return null;
  const preset = readMotionPreset(element, role);
  return element.animate(keyframes, { ...preset, duration: Math.max(preset.duration, minimumDuration), fill });
}

export function animateElementSize(element: HTMLElement, start: ElementSize, target: ElementSize): Animation | null {
  if (elementSizesMatch(start, target)) return null;
  const minimumDuration = Math.abs(target.width - start.width) / MAX_SPATIAL_WIDTH_SPEED_PX_PER_MS;
  return animateWithMotionPreset(element, [
    { width: `${start.width}px`, height: `${start.height}px` },
    { width: `${target.width}px`, height: `${target.height}px` },
  ], 'spatial', 'both', minimumDuration);
}
