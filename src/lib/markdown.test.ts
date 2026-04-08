import { describe, expect, it } from 'vitest';
import { parseInlineMarkdown, parseMarkdownBlocks } from './markdown';

describe('markdown helpers', () => {
  it('parses common inline markdown tokens', () => {
    expect(parseInlineMarkdown('Use **bold**, *soft*, and `code`.')).toEqual([
      { type: 'text', text: 'Use ' },
      {
        type: 'strong',
        children: [{ type: 'text', text: 'bold' }],
      },
      { type: 'text', text: ', ' },
      {
        type: 'emphasis',
        children: [{ type: 'text', text: 'soft' }],
      },
      { type: 'text', text: ', and ' },
      { type: 'code', text: 'code' },
      { type: 'text', text: '.' },
    ]);
  });

  it('parses paragraphs, lists, headings, and code fences', () => {
    expect(
      parseMarkdownBlocks(`# Title

Intro line
Second line

- first
- second

\`\`\`ts
const value = 1;
\`\`\``),
    ).toEqual([
      { type: 'heading', level: 1, text: 'Title' },
      { type: 'paragraph', lines: ['Intro line', 'Second line'] },
      { type: 'unordered-list', items: ['first', 'second'] },
      { type: 'code', language: 'ts', content: 'const value = 1;' },
    ]);
  });
});
