import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ContainerCapsule } from '@/widgets/workspace/ContainerCapsule';
import { I18nProvider } from '@/shared/i18n';

afterEach(() => cleanup());

describe('ContainerCapsule', () => {
  it('renders the four computer sub-views and reports clicks', async () => {
    const onChange = vi.fn();
    render(<I18nProvider><ContainerCapsule active="ai" onChange={onChange} /></I18nProvider>);

    expect(screen.getByRole('tablist', { name: 'Sunam的电脑视图切换' })).toBeInTheDocument();
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(4);
    expect(tabs[0]).toHaveTextContent('电脑');
    expect(tabs[1]).toHaveTextContent('终端');
    expect(tabs[2]).toHaveTextContent('服务');
    expect(tabs[3]).toHaveTextContent('文件');
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    await userEvent.click(tabs[1]!);
    expect(onChange).toHaveBeenCalledWith('user');
    await userEvent.click(tabs[3]!);
    expect(onChange).toHaveBeenCalledWith('files');
  });

  it('keeps only the active segment in the tab order and supports arrow-key switching', async () => {
    const onChange = vi.fn();
    render(<I18nProvider><ContainerCapsule active="user" onChange={onChange} /></I18nProvider>);

    const tabs = screen.getAllByRole('tab');
    expect(tabs[1]).toHaveAttribute('tabindex', '0');
    expect(tabs[0]).toHaveAttribute('tabindex', '-1');
    tabs[1]!.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenCalledWith('services');
  });
});
