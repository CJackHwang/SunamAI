import { lazy, Suspense, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import CodeCopyButton from './CodeCopyButton';
import './MarkdownRenderer.css';

const SyntaxCodeBlock = lazy(() => import('./SyntaxCodeBlock'));

interface MarkdownRendererProps {
  content: string;
}

const LANGUAGE_RE = /language-(\w+)/;

/** Reconstructs plain text from a rendered markdown element tree (for the copy button). */
function extractText(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(extractText).join('');
  if (typeof node === 'object') {
    const element = node as { props?: { children?: ReactNode } };
    return extractText(element.props?.children);
  }
  return '';
}

export default function MarkdownRenderer({ content }: MarkdownRendererProps) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        code({ className, children, ...props }) {
          const match = LANGUAGE_RE.exec(className || '');
          const source = String(children).replace(/\n$/, '');
          return match ? (
            <div className="markdown-code-block">
              <Suspense fallback={<pre className="markdown-code-fallback"><code>{source}</code></pre>}>
                <SyntaxCodeBlock language={match[1]!}>{source}</SyntaxCodeBlock>
              </Suspense>
            </div>
          ) : (
            <code {...props} className={`${className ?? ''} markdown-inline-code`}>
              {children}
            </code>
          );
        },
        pre: ({ node: _node, children, ...props }) => {
          // Fenced blocks render with a `language-*` class and use the dark
          // vscDarkPlus highlighter; flag that so the copy icon stays light there.
          const candidate = (Array.isArray(children) ? children[0] : children) as { props?: { className?: unknown } } | null | undefined;
          const isDark = typeof candidate?.props?.className === 'string' && LANGUAGE_RE.test(candidate.props.className);
          return (
            <div className="markdown-pre-wrap" data-dark={isDark ? 'true' : undefined}>
              <CodeCopyButton code={extractText(children).replace(/\n$/, '')} />
              <pre className="markdown-pre" {...props}>{children}</pre>
            </div>
          );
        },
        table: ({ node: _node, ...props }) => <div className="markdown-table-wrap"><table className="markdown-table" {...props} /></div>,
        th: ({ node: _node, ...props }) => <th className="markdown-th" {...props} />,
        td: ({ node: _node, ...props }) => <td className="markdown-td" {...props} />,
        a: ({ node: _node, ...props }) => <a className="markdown-link" target="_blank" rel="noopener noreferrer" {...props} />,
        p: ({ node: _node, ...props }) => <p className="markdown-paragraph" {...props} />,
        ul: ({ node: _node, ...props }) => <ul className="markdown-list" {...props} />,
        ol: ({ node: _node, ...props }) => <ol className="markdown-list" {...props} />,
        blockquote: ({ node: _node, ...props }) => <blockquote className="markdown-quote" {...props} />,
      }}
    >
      {content}
    </ReactMarkdown>
  );
}
