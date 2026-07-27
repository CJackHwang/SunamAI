import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Pencil, Trash2 } from 'lucide-react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ActionMenu } from '@/shared/ui/ActionMenu';

afterEach(() => cleanup());

describe('ActionMenu', () => {
  it('portals typed actions, closes after selection, and supports Escape', () => {
    const onClose = vi.fn();
    const onRename = vi.fn();
    const rendered = render(<div style={{ transform: 'translateX(1px)' }}><ActionMenu menu={{ x: 20, y: 30 }} ariaLabel="Actions" onClose={onClose} items={() => [
      { id: 'rename', label: 'Rename', icon: Pencil, onSelect: onRename },
      { id: 'delete', label: 'Delete', icon: Trash2, onSelect: vi.fn(), danger: true, separatorBefore: true },
    ]} /></div>);

    const menu = screen.getByRole('menu', { name: 'Actions' });
    expect(menu.parentElement).toBe(document.body);
    expect(screen.getByRole('separator')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
    expect(onRename).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
    rendered.unmount();
  });

  it('closes from the overlay and does not invoke disabled actions', () => {
    const onClose = vi.fn();
    const onDisabled = vi.fn();
    render(<ActionMenu menu={{ x: 20, y: 30 }} ariaLabel="Actions" onClose={onClose} items={() => [
      { id: 'disabled', label: 'Disabled', icon: Pencil, onSelect: onDisabled, disabled: true },
    ]} />);

    fireEvent.click(screen.getByRole('menuitem', { name: 'Disabled' }));
    expect(onDisabled).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();

    const overlay = document.body.querySelector('.action-menu-overlay');
    expect(overlay).toBeInTheDocument();
    fireEvent.click(overlay!);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('retains menu payload for the full responsive exit duration', async () => {
    vi.useFakeTimers();
    try {
      const props = { ariaLabel: 'Actions', onClose: vi.fn(), items: (menu: { x: number; y: number; label: string }) => [{ id: 'item', label: menu.label, icon: Pencil, onSelect: vi.fn() }] };
      const rendered = render(<ActionMenu menu={{ x: 20, y: 30, label: 'Retained' }} {...props} />);
      rendered.rerender(<ActionMenu menu={null} {...props} />);
      expect(screen.getByRole('menu', { name: 'Actions' })).toHaveClass('is-exiting');
      expect(screen.getByText('Retained')).toBeInTheDocument();
      await act(() => vi.advanceTimersByTimeAsync(239));
      expect(screen.getByText('Retained')).toBeInTheDocument();
      await act(() => vi.advanceTimersByTimeAsync(1));
      expect(screen.queryByText('Retained')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
