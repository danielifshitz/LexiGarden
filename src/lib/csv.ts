import type { WordDraft } from '../db';
import type { WordEntry } from '../types';
import { tRuntime } from './i18n';
import { formatSlashSeparatedValues, trimToUndefined } from './text';

const CSV_HEADERS = [
  'English',
  'Translation',
  'Group',
  'Text hint',
  'Translation language',
] as const;

type CsvHeader = (typeof CSV_HEADERS)[number];

export interface ParsedWordsCsvResult {
  drafts: WordDraft[];
  draftRowNumbers: number[];
  skippedRowNumbers: number[];
}

function escapeCsvValue(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replaceAll('"', '""')}"`;
  }

  return value;
}

function normalizeHeader(value: string): string {
  return value.replace(/^\uFEFF/, '').trim().toLocaleLowerCase();
}

function parseCsvRows(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];

    if (inQuotes) {
      if (character === '"') {
        if (content[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += character;
      }

      continue;
    }

    if (character === '"') {
      inQuotes = true;
      continue;
    }

    if (character === ',') {
      row.push(field);
      field = '';
      continue;
    }

    if (character === '\n' || character === '\r') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';

      if (character === '\r' && content[index + 1] === '\n') {
        index += 1;
      }

      continue;
    }

    field += character;
  }

  if (inQuotes) {
    throw new Error(tRuntime('csvUnclosedQuote'));
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter(
    (currentRow) => !(currentRow.length === 1 && currentRow[0].trim() === ''),
  );
}

function validateHeaderRow(headerRow: string[]): void {
  if (headerRow.length === 1 && headerRow[0].includes(';') && !headerRow[0].includes(',')) {
    throw new Error(tRuntime('csvUseCommas'));
  }

  if (headerRow.length !== CSV_HEADERS.length) {
    throw new Error(
      tRuntime('csvColumnCount', {
        count: CSV_HEADERS.length,
        headers: CSV_HEADERS.join(', '),
      }),
    );
  }

  const normalizedHeaders = headerRow.map((value) => normalizeHeader(value));
  const expectedHeaders = CSV_HEADERS.map((value) => normalizeHeader(value));

  const headersMatch = normalizedHeaders.every((header, index) => header === expectedHeaders[index]);

  if (!headersMatch) {
    throw new Error(
      tRuntime('csvHeadersExact', {
        headers: CSV_HEADERS.join(', '),
      }),
    );
  }
}

export function buildWordsCsv(words: WordEntry[]): string {
  const rows = words.map((word) =>
    [
      word.englishText,
      formatSlashSeparatedValues(word.translations),
      formatSlashSeparatedValues(word.groups),
      word.textHint ?? '',
      word.translationLanguage,
    ]
      .map(escapeCsvValue)
      .join(','),
  );

  return [CSV_HEADERS.join(','), ...rows].join('\n');
}

export function parseWordsCsv(content: string): ParsedWordsCsvResult {
  const rows = parseCsvRows(content);

  if (rows.length === 0) {
    throw new Error(tRuntime('csvEmpty'));
  }

  validateHeaderRow(rows[0]);
  const headerRow = rows[0].map((value) => normalizeHeader(value));
  const headerIndex = new Map<string, number>();
  headerRow.forEach((header, index) => {
    if (!headerIndex.has(header)) {
      headerIndex.set(header, index);
    }
  });

  const drafts: WordDraft[] = [];
  const draftRowNumbers: number[] = [];
  const skippedRowNumbers: number[] = [];
  const getValue = (row: string[], header: CsvHeader) =>
    (row[headerIndex.get(normalizeHeader(header)) ?? -1] ?? '').trim();

  rows.slice(1).forEach((row, rowIndex) => {
    if (row.length > CSV_HEADERS.length) {
      throw new Error(
        tRuntime('csvRowTooManyColumns', {
          row: rowIndex + 2,
          headers: CSV_HEADERS.join(', '),
        }),
      );
    }

    const englishText = getValue(row, 'English');
    const translationText = getValue(row, 'Translation');
    const translationLanguage = getValue(row, 'Translation language');
    const group = trimToUndefined(getValue(row, 'Group'));
    const textHint = trimToUndefined(getValue(row, 'Text hint'));

    if (!englishText && !translationText && !translationLanguage && !group && !textHint) {
      return;
    }

    if (!englishText || !translationText || !translationLanguage) {
      skippedRowNumbers.push(rowIndex + 2);
      return;
    }

    drafts.push({
      englishText,
      translationText,
      translationLanguage,
      group,
      textHint,
      imageHint: undefined,
    });
    draftRowNumbers.push(rowIndex + 2);
  });

  return {
    drafts,
    draftRowNumbers,
    skippedRowNumbers,
  };
}
