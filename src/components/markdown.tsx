'use client';

import ReactMarkdown from 'react-markdown';
import { safeHref } from './markdown-utils';

const ALLOWED = ['p', 'ul', 'ol', 'li', 'strong', 'em', 'a', 'code', 'br', 'blockquote'];

/** Basic Markdown (paragraphs, lists, bold, links); raw HTML is never rendered. */
export function Markdown({ text }: { text: string }) {
  if (!text.trim()) return <p className="muted">（沒有描述）</p>;
  return (
    <div className="markdown">
      <ReactMarkdown
        skipHtml
        allowedElements={ALLOWED}
        unwrapDisallowed
        urlTransform={(url) => safeHref(url)}
        components={{
          a: ({ href, children }) => (href ? <a href={href} target="_blank" rel="noopener noreferrer nofollow">{children}</a> : <span>{children}</span>),
        }}
      >{text}</ReactMarkdown>
    </div>
  );
}
