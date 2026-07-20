import { useEffect, useState } from 'react';

function shouldReduceMotion() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function usePresence<T>(value: T | null, exitDuration = 160) {
  const [presentValue, setPresentValue] = useState<T | null>(value);
  const [isExiting, setIsExiting] = useState(false);

  useEffect(() => {
    if (value !== null) {
      setPresentValue(value);
      setIsExiting(false);
      return;
    }
    if (presentValue === null) return;
    if (shouldReduceMotion()) {
      setPresentValue(null);
      setIsExiting(false);
      return;
    }
    setIsExiting(true);
    const timer = window.setTimeout(() => {
      setPresentValue(null);
      setIsExiting(false);
    }, exitDuration);
    return () => window.clearTimeout(timer);
  }, [exitDuration, presentValue, value]);

  return { presentValue, isExiting };
}
