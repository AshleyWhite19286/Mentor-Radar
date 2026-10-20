import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export function MarkdownContent({children,className=''}:{children:string;className?:string}) {
  return <div className={`markdown-content ${className}`}>
    <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml disallowedElements={['img']}
      components={{
        a:({href,children})=>href?<a href={href} target="_blank" rel="noopener noreferrer">{children}</a>:<span>{children}</span>,
        table:({children})=><div className="markdown-table-scroll" role="region" aria-label="回答中的表格" tabIndex={0}><table>{children}</table></div>,
      }}>
      {children}
    </ReactMarkdown>
  </div>;
}
