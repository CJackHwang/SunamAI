import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';

interface MarkdownRendererProps {
  content: string;
}

const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content }) => {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        code({ node, inline, className, children, ...props }: any) {
          const match = /language-(\w+)/.exec(className || '');
          return !inline && match ? (
            <div style={{ borderRadius: '8px', overflow: 'hidden', margin: '8px 0', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
              <SyntaxHighlighter
                {...props}
                style={vscDarkPlus}
                language={match[1]}
                PreTag="div"
                customStyle={{ margin: 0, padding: '16px', fontSize: '13px', lineHeight: '1.5' }}
              >
                {String(children).replace(/\n$/, '')}
              </SyntaxHighlighter>
            </div>
          ) : (
            <code {...props} className={className} style={{
              backgroundColor: 'rgba(0,0,0,0.06)',
              padding: '2px 6px',
              borderRadius: '4px',
              fontFamily: 'var(--font-mono)',
              fontSize: '0.9em',
              color: '#d63384'
            }}>
              {children}
            </code>
          );
        },
        table: ({ node, ...props }) => (
          <div style={{ overflowX: 'auto', margin: '12px 0', borderRadius: '8px', border: '1px solid var(--color-border)' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '13px' }} {...props} />
          </div>
        ),
        th: ({ node, ...props }) => <th style={{ borderBottom: '1px solid var(--color-border)', padding: '10px 12px', backgroundColor: 'var(--color-bg)', textAlign: 'left', fontWeight: 600 }} {...props} />,
        td: ({ node, ...props }) => <td style={{ borderBottom: '1px solid var(--color-border)', padding: '10px 12px' }} {...props} />,
        a: ({ node, ...props }) => <a style={{ color: '#0969da', textDecoration: 'none' }} target="_blank" rel="noopener noreferrer" {...props} />,
        p: ({ node, ...props }) => <p style={{ margin: '0 0 12px 0' }} {...props} />,
        ul: ({ node, ...props }) => <ul style={{ margin: '0 0 12px 0', paddingLeft: '24px' }} {...props} />,
        ol: ({ node, ...props }) => <ol style={{ margin: '0 0 12px 0', paddingLeft: '24px' }} {...props} />,
        blockquote: ({ node, ...props }) => <blockquote style={{ borderLeft: '4px solid var(--color-border)', margin: '0 0 12px 0', paddingLeft: '12px', color: 'var(--color-text-secondary)', fontStyle: 'italic' }} {...props} />
      }}
    >
      {content}
    </ReactMarkdown>
  );
};

export default MarkdownRenderer;
