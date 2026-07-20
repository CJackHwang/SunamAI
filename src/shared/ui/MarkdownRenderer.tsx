import { lazy, Suspense } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import './MarkdownRenderer.css';

const SyntaxCodeBlock = lazy(() => import('./SyntaxCodeBlock'));

interface MarkdownRendererProps {
  content: string;
}

export default function MarkdownRenderer({ content }: MarkdownRendererProps) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        code({ className, children, ...props }) {
          const match = /language-(\w+)/.exec(className || '');
          const source = String(children).replace(/\n$/, '');
          return match ? (
            <div className="markdown-code-block">
              <Suspense fallback={<pre className="markdown-code-fallback"><code>{source}</code></pre>}>
                <SyntaxCodeBlock language={match[1]}>{source}</SyntaxCodeBlock>
              </Suspense>
            </div>
          ) : (
            <code {...props} className={`${className ?? ''} markdown-inline-code`}>
              {children}
            </code>
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
