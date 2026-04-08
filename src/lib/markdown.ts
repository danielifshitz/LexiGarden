export type MarkdownInlineToken =
  | { type: 'text'; text: string }
  | { type: 'strong'; children: MarkdownInlineToken[] }
  | { type: 'emphasis'; children: MarkdownInlineToken[] }
  | { type: 'code'; text: string }
  | { type: 'link'; href: string; children: MarkdownInlineToken[] };

export type MarkdownBlock =
  | { type: 'paragraph'; lines: string[] }
  | { type: 'heading'; level: 1 | 2 | 3; text: string }
  | { type: 'unordered-list'; items: string[] }
  | { type: 'ordered-list'; items: string[] }
  | { type: 'blockquote'; lines: string[] }
  | { type: 'code'; language: string; content: string };

function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n?/g, '\n');
}

function sanitizeMarkdownLink(value: string): string | null {
  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  if (/^(https?:\/\/|mailto:)/i.test(trimmed)) {
    return trimmed;
  }

  return null;
}

export function parseInlineMarkdown(text: string): MarkdownInlineToken[] {
  const tokens: MarkdownInlineToken[] = [];
  const pattern =
    /(\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+)\*\*|__([^_]+)__|\*([^*\n]+)\*|_([^_\n]+)_|`([^`\n]+)`)/;
  let remaining = text;

  while (remaining.length > 0) {
    const match = remaining.match(pattern);

    if (!match || match.index === undefined) {
      tokens.push({ type: 'text', text: remaining });
      break;
    }

    if (match.index > 0) {
      tokens.push({ type: 'text', text: remaining.slice(0, match.index) });
    }

    const [fullMatch] = match;
    const linkText = match[2];
    const linkHref = match[3];
    const strongA = match[4];
    const strongB = match[5];
    const emphasisA = match[6];
    const emphasisB = match[7];
    const code = match[8];

    if (linkText && linkHref) {
      const sanitizedHref = sanitizeMarkdownLink(linkHref);

      if (sanitizedHref) {
        tokens.push({
          type: 'link',
          href: sanitizedHref,
          children: parseInlineMarkdown(linkText),
        });
      } else {
        tokens.push({ type: 'text', text: fullMatch });
      }
    } else if (strongA || strongB) {
      tokens.push({
        type: 'strong',
        children: parseInlineMarkdown(strongA ?? strongB ?? ''),
      });
    } else if (emphasisA || emphasisB) {
      tokens.push({
        type: 'emphasis',
        children: parseInlineMarkdown(emphasisA ?? emphasisB ?? ''),
      });
    } else if (code) {
      tokens.push({ type: 'code', text: code });
    } else {
      tokens.push({ type: 'text', text: fullMatch });
    }

    remaining = remaining.slice(match.index + fullMatch.length);
  }

  return tokens;
}

function isBlankLine(line: string): boolean {
  return line.trim().length === 0;
}

function isMarkdownBoundary(line: string): boolean {
  return (
    /^```/.test(line) ||
    /^#{1,3}\s+/.test(line) ||
    /^\s*[-*]\s+/.test(line) ||
    /^\s*\d+\.\s+/.test(line) ||
    /^\s*>\s?/.test(line)
  );
}

export function parseMarkdownBlocks(markdown: string): MarkdownBlock[] {
  const lines = normalizeLineEndings(markdown).split('\n');
  const blocks: MarkdownBlock[] = [];

  for (let index = 0; index < lines.length; ) {
    const line = lines[index];

    if (isBlankLine(line)) {
      index += 1;
      continue;
    }

    const codeFenceMatch = line.match(/^```([\w-]*)\s*$/);

    if (codeFenceMatch) {
      const codeLines: string[] = [];
      const language = codeFenceMatch[1] ?? '';
      index += 1;

      while (index < lines.length && !/^```/.test(lines[index])) {
        codeLines.push(lines[index]);
        index += 1;
      }

      if (index < lines.length && /^```/.test(lines[index])) {
        index += 1;
      }

      blocks.push({
        type: 'code',
        language,
        content: codeLines.join('\n'),
      });
      continue;
    }

    const headingMatch = line.match(/^(#{1,3})\s+(.+)$/);

    if (headingMatch) {
      blocks.push({
        type: 'heading',
        level: headingMatch[1].length as 1 | 2 | 3,
        text: headingMatch[2].trim(),
      });
      index += 1;
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];

      while (index < lines.length && /^\s*[-*]\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\s*[-*]\s+/, '').trim());
        index += 1;
      }

      blocks.push({ type: 'unordered-list', items });
      continue;
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];

      while (index < lines.length && /^\s*\d+\.\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\s*\d+\.\s+/, '').trim());
        index += 1;
      }

      blocks.push({ type: 'ordered-list', items });
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      const quoteLines: string[] = [];

      while (index < lines.length && /^\s*>\s?/.test(lines[index])) {
        quoteLines.push(lines[index].replace(/^\s*>\s?/, ''));
        index += 1;
      }

      blocks.push({ type: 'blockquote', lines: quoteLines });
      continue;
    }

    const paragraphLines: string[] = [];

    while (index < lines.length && !isBlankLine(lines[index]) && !isMarkdownBoundary(lines[index])) {
      paragraphLines.push(lines[index]);
      index += 1;
    }

    blocks.push({ type: 'paragraph', lines: paragraphLines });
  }

  return blocks;
}
