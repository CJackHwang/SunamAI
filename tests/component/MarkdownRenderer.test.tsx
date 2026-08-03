import { fireEvent, render, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@/shared/i18n';
import MarkdownRenderer from '@/shared/ui/MarkdownRenderer';

describe('MarkdownRenderer', () => {
  it('keeps language-less fenced code in an internally scrollable block', () => {
    const { container } = render(<I18nProvider><MarkdownRenderer content={'```\n├── a/very/long/path/to/README.md\n```'} /></I18nProvider>);
    const block = container.querySelector('.markdown-pre');
    expect(block).toBeInTheDocument();
    expect(block).toHaveTextContent('a/very/long/path/to/README.md');
    // Language-less blocks render on the light fallback surface, not the dark highlighter.
    expect(container.querySelector('.markdown-pre-wrap')).not.toHaveAttribute('data-dark');
  });

  it('keeps inline code inline', () => {
    const { container } = render(<I18nProvider><MarkdownRenderer content={'Use `README.md` here.'} /></I18nProvider>);
    expect(container.querySelector('.markdown-code-block')).not.toBeInTheDocument();
    expect(container.querySelector('.markdown-inline-code')).toHaveTextContent('README.md');
  });

  it('adds a copy button to fenced code blocks that copies the exact source', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const { container } = render(<I18nProvider><MarkdownRenderer content={'```js\nconst answer = 42;\n```'} /></I18nProvider>);
    const button = container.querySelector('.code-copy-btn');
    expect(button).not.toBeNull();
    // Language-annotated blocks use the dark vscDarkPlus highlighter.
    expect(container.querySelector('.markdown-pre-wrap')).toHaveAttribute('data-dark', 'true');
    fireEvent.click(button!);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('const answer = 42;'));
  });
});
