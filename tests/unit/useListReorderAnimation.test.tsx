import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useListReorderAnimation } from '@/shared/ui/useListReorderAnimation';

function ReorderList({ items }: { items: string[] }) {
  const ref = useListReorderAnimation(items.join('\u0000'));
  return <div ref={ref}>{items.map((item) => <div key={item} data-reorder-key={item}>{item}</div>)}</div>;
}

function fakeAnimation(): Animation {
  return { addEventListener: vi.fn(), cancel: vi.fn() } as unknown as Animation;
}

describe('useListReorderAnimation', () => {
  const animateDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'animate');
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    if (animateDescriptor) Object.defineProperty(Element.prototype, 'animate', animateDescriptor);
    else Reflect.deleteProperty(Element.prototype, 'animate');
  });

  it('animates keyed rows from their previous vertical positions', () => {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const index = this.parentElement ? [...this.parentElement.children].indexOf(this) : 0;
      return { x: 0, y: index * 40, top: index * 40, right: 100, bottom: index * 40 + 36, left: 0, width: 100, height: 36, toJSON: () => ({}) };
    });
    const animate = vi.fn(() => fakeAnimation());
    Object.defineProperty(Element.prototype, 'animate', { configurable: true, value: animate });
    const rendered = render(<ReorderList items={['one', 'two']} />);

    rendered.rerender(<ReorderList items={['two', 'one']} />);

    expect(animate).toHaveBeenCalledTimes(2);
    expect(animate).toHaveBeenCalledWith([{ transform: 'translateY(40px)' }, { transform: 'translateY(0)' }], expect.objectContaining({ duration: 360 }));
  });

  it('skips spatial motion when reduced motion is requested', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));
    const animate = vi.fn(() => fakeAnimation());
    Object.defineProperty(Element.prototype, 'animate', { configurable: true, value: animate });
    const rendered = render(<ReorderList items={['one', 'two']} />);

    rendered.rerender(<ReorderList items={['two', 'one']} />);

    expect(animate).not.toHaveBeenCalled();
  });

  it('cancels and replaces in-flight row animations during rapid reorders', () => {
    const visualOffsets = new Map<Element, number>();
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const index = this.parentElement ? [...this.parentElement.children].indexOf(this) : 0;
      const top = index * 40 + (visualOffsets.get(this) ?? 0);
      return { x: 0, y: top, top, right: 100, bottom: top + 36, left: 0, width: 100, height: 36, toJSON: () => ({}) };
    });
    const cancellations: ReturnType<typeof vi.fn>[] = [];
    const animate = vi.fn(function (this: Element, keyframes: Keyframe[]) {
      const transform = String(keyframes[0]?.transform ?? '');
      visualOffsets.set(this, Number.parseFloat(transform.match(/-?\d+(?:\.\d+)?/)?.[0] ?? '0'));
      const cancel = vi.fn(() => visualOffsets.delete(this));
      cancellations.push(cancel);
      return { addEventListener: vi.fn(), cancel } as unknown as Animation;
    });
    Object.defineProperty(Element.prototype, 'animate', { configurable: true, value: animate });
    const rendered = render(<ReorderList items={['one', 'two']} />);

    rendered.rerender(<ReorderList items={['two', 'one']} />);
    rendered.rerender(<ReorderList items={['one', 'two']} />);

    expect(cancellations.slice(0, 2).every((cancel) => cancel.mock.calls.length === 1)).toBe(true);
    expect(animate).toHaveBeenCalledTimes(4);
  });
});
