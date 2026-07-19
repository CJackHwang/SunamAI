import { lazy, Suspense } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const SyntaxCodeBlock = lazy(() => import('./SyntaxCodeBlock'));

interface MarkdownRendererProps {
  content: string;
}

export default function MarkdownRenderer({ content }: MarkdownRendererProps) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        code({ inline, className, children, ...props }: any) {
          const match = /language-(\w+)/.exec(className || '');
          const source = String(children).replace(/\n$/, '');
          return !inline && match ? (
            <div style={{ borderRadius: '8px', overflow: 'hidden', margin: '8px 0', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
              <Suspense fallback={<pre style={{ margin: 0, padding: '16px', overflowX: 'auto' }}><code>{source}</code></pre>}>
                <SyntaxCodeBlock language={match[1]}>{source}</SyntaxCodeBlock>
              </Suspense>
            </div>
          ) : (
            <code {...props} className={className} style={{ backgroundColor: 'rgba(0,0,0,0.06)', padding: '2px 6px', borderRadius: '4px', fontFamily: 'var(--font-mono)', fontSize: '0.9em', color: '#d63384' }}>
              {children}
            </code>
          );
        },
        table: ({ node: _node, ...props }) => <div style={{ overflowX: 'auto', margin: '12px 0', borderRadius: '8px', border: '1px solid var(--color-border)' }}><table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '13px' }} {...props} /></div>,
        th: ({ node: _node, ...props }) => <th style={{ borderBottom: '1px solid var(--color-border)', padding: '10px 12px', backgroundColor: 'var(--color-bg)', textAlign: 'left', fontWeight: 600 }} {...props} />,
        td: ({ node: _node, ...props }) => <td style={{ borderBottom: '1px solid var(--color-border)', padding: '10px 12px' }} {...props} />,
        a: ({ node: _node, ...props }) => <a style={{ color: '#0969da', textDecoration: 'none' }} target="_blank" rel="noopener noreferrer" {...props} />,
        p: ({ node: _node, ...props }) => <p style={{ margin: '0 0 12px 0' }} {...props} />,
        ul: ({ node: _node, ...props }) => <ul style={{ margin: '0 0 12px 0', paddingLeft: '24px' }} {...props} />,
        ol: ({ node: _node, ...props }) => <ol style={{ margin: '0 0 12px 0', paddingLeft: '24px' }} {...props} />,
        blockquote: ({ node: _node, ...props }) => <blockquote style={{ borderLeft: '4px solid var(--color-border)', margin: '0 0 12px 0', paddingLeft: '12px', color: 'var(--color-text-secondary)', fontStyle: 'italic' }} {...props} />,
      }}
    >
      {content}
    </ReactMarkdown>
  );
}
