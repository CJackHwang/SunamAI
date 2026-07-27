import { useEffect } from 'react';

export function BeforeUnloadGuard() {
  useEffect(() => {
    const confirmExit = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = true;
    };
    window.addEventListener('beforeunload', confirmExit);
    return () => window.removeEventListener('beforeunload', confirmExit);
  }, []);

  return null;
}
