import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useIntrinsicDisclosure } from '@/shared/ui/useIntrinsicDisclosure';

describe('useIntrinsicDisclosure', () => {
  it('opens programmatically once and keeps the native details state', () => {
    const onOpen = vi.fn();
    const details = document.createElement('details');
    details.dataset.expanded = 'false';
    const rendered = renderHook(() => {
      const hook = useIntrinsicDisclosure({ contentSelector: '.body', onOpen });
      hook.disclosureRef.current = details;
      return hook;
    });

    act(() => rendered.result.current.setDisclosureExpanded(true));
    act(() => rendered.result.current.setDisclosureExpanded(true));

    expect(details).toHaveAttribute('open');
    expect(details).toHaveAttribute('data-expanded', 'true');
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('closes immediately when reduced motion is requested', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));
    const details = document.createElement('details');
    details.open = true;
    details.dataset.expanded = 'true';
    const rendered = renderHook(() => {
      const hook = useIntrinsicDisclosure({ contentSelector: '.body' });
      hook.disclosureRef.current = details;
      return hook;
    });

    act(() => rendered.result.current.setDisclosureExpanded(false));

    expect(details).not.toHaveAttribute('open');
    expect(details).toHaveAttribute('data-expanded', 'false');
    vi.unstubAllGlobals();
  });
});
