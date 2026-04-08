import { Fragment } from 'react';
import type { ReactNode } from 'react';
import { parseInlineMarkdown, parseMarkdownBlocks, type MarkdownInlineToken } from '../lib/markdown';

interface MarkdownTextProps {
  content: string;
  className?: string;
}

function renderInlineTokens(tokens: MarkdownInlineToken[], keyPrefix: string): ReactNode[] {
  return tokens.map((token, index) => {
    const key = `${keyPrefix}-${index}`;

    if (token.type === 'text') {
      return <Fragment key={key}>{token.text}</Fragment>;
    }

    if (token.type === 'strong') {
      return <strong key={key}>{renderInlineTokens(token.children, `${key}-strong`)}</strong>;
    }

    if (token.type === 'emphasis') {
      return <em key={key}>{renderInlineTokens(token.children, `${key}-em`)}</em>;
    }

    if (token.type === 'code') {
      return <code key={key}>{token.text}</code>;
    }

    return (
      <a key={key} href={token.href} target="_blank" rel="noreferrer">
        {renderInlineTokens(token.children, `${key}-link`)}
      </a>
    );
  });
}

export function MarkdownText({ content, className = '' }: MarkdownTextProps) {
  const blocks = parseMarkdownBlocks(content);

  return (
    <div className={`markdown-copy ${className}`.trim()}>
      {blocks.map((block, index) => {
        const key = `block-${index}`;

        if (block.type === 'heading') {
          const headingContent = renderInlineTokens(parseInlineMarkdown(block.text), `${key}-heading`);

          if (block.level === 1) {
            return <h1 key={key}>{headingContent}</h1>;
          }

          if (block.level === 2) {
            return <h2 key={key}>{headingContent}</h2>;
          }

          return <h3 key={key}>{headingContent}</h3>;
        }

        if (block.type === 'unordered-list') {
          return (
            <ul key={key}>
              {block.items.map((item, itemIndex) => (
                <li key={`${key}-${itemIndex}`}>
                  {renderInlineTokens(parseInlineMarkdown(item), `${key}-item-${itemIndex}`)}
                </li>
              ))}
            </ul>
          );
        }

        if (block.type === 'ordered-list') {
          return (
            <ol key={key}>
              {block.items.map((item, itemIndex) => (
                <li key={`${key}-${itemIndex}`}>
                  {renderInlineTokens(parseInlineMarkdown(item), `${key}-item-${itemIndex}`)}
                </li>
              ))}
            </ol>
          );
        }

        if (block.type === 'blockquote') {
          return (
            <blockquote key={key}>
              {block.lines.map((line, lineIndex) => (
                <Fragment key={`${key}-${lineIndex}`}>
                  {lineIndex > 0 ? <br /> : null}
                  {renderInlineTokens(parseInlineMarkdown(line), `${key}-line-${lineIndex}`)}
                </Fragment>
              ))}
            </blockquote>
          );
        }

        if (block.type === 'code') {
          return (
            <pre key={key}>
              <code>{block.content}</code>
            </pre>
          );
        }

        return (
          <p key={key}>
            {block.lines.map((line, lineIndex) => (
              <Fragment key={`${key}-${lineIndex}`}>
                {lineIndex > 0 ? <br /> : null}
                {renderInlineTokens(parseInlineMarkdown(line), `${key}-line-${lineIndex}`)}
              </Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}
