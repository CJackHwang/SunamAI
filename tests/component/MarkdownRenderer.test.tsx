import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import MarkdownRenderer from '@/shared/ui/MarkdownRenderer';

describe('MarkdownRenderer', () => {
  it('keeps language-less fenced code in an internally scrollable block', () => {
    const { container } = render(<MarkdownRenderer content={'```\n├── a/very/long/path/to/README.md\n```'} />);
    const block = container.querySelector('.markdown-pre');
    expect(block).toBeInTheDocument();
    expect(block).toHaveTextContent('a/very/long/path/to/README.md');
  });

  it('keeps inline code inline', () => {
    const { container } = render(<MarkdownRenderer content={'Use `README.md` here.'} />);
    expect(container.querySelector('.markdown-code-block')).not.toBeInTheDocument();
    expect(container.querySelector('.markdown-inline-code')).toHaveTextContent('README.md');
  });
});
