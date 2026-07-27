import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BeforeUnloadGuard } from '@/shared/ui/BeforeUnloadGuard';

describe('BeforeUnloadGuard', () => {
  it('requests confirmation while mounted and releases the listener on unmount', () => {
    const view = render(<BeforeUnloadGuard />);
    const guardedEvent = new Event('beforeunload', { cancelable: true });

    expect(window.dispatchEvent(guardedEvent)).toBe(false);
    expect(guardedEvent.defaultPrevented).toBe(true);

    view.unmount();
    const releasedEvent = new Event('beforeunload', { cancelable: true });
    expect(window.dispatchEvent(releasedEvent)).toBe(true);
    expect(releasedEvent.defaultPrevented).toBe(false);
  });
});
