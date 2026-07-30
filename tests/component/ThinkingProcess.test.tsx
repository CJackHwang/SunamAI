import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { ThinkingProcess } from '@/features/chat/ui/ThinkingProcess';
import { I18nProvider } from '@/shared/i18n';

describe('ThinkingProcess', () => {
  afterEach(cleanup);

  it('stays expanded while reasoning streams and automatically collapses when reasoning ends', () => {
    const rendered = render(<I18nProvider><ThinkingProcess content="正在分析" streaming /></I18nProvider>);
    const disclosure = screen.getByText('思考过程').closest('details')!;

    expect(disclosure).toHaveAttribute('open');
    expect(disclosure).toHaveAttribute('data-expanded', 'true');

    rendered.rerender(<I18nProvider><ThinkingProcess content="分析完成" /></I18nProvider>);

    expect(disclosure).not.toHaveAttribute('open');
    expect(disclosure).toHaveAttribute('data-expanded', 'false');
  });

  it('renders completed reasoning collapsed and lets the user expand it', async () => {
    const user = userEvent.setup();
    render(<I18nProvider><ThinkingProcess content="历史分析内容" /></I18nProvider>);
    const disclosure = screen.getByText('思考过程').closest('details')!;

    expect(disclosure).not.toHaveAttribute('open');

    await user.click(screen.getByText('思考过程'));

    expect(disclosure).toHaveAttribute('open');
    expect(screen.getByText('历史分析内容')).toBeVisible();
  });
});
