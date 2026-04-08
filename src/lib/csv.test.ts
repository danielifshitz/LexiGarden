import { describe, expect, it } from 'vitest';
import { buildWordsCsv, parseWordsCsv } from './csv';
import type { WordEntry } from '../types';

function makeWord(overrides: Partial<WordEntry> = {}): WordEntry {
  return {
    id: 'word-1',
    englishText: 'apple',
    translations: ['תפוח'],
    translationLanguage: 'Hebrew',
    groups: [],
    createdAt: '2026-04-05T10:00:00.000Z',
    reviewCount: 0,
    correctCount: 0,
    consecutiveCorrect: 0,
    ...overrides,
  };
}

describe('csv helpers', () => {
  it('exports the requested word columns', () => {
    const csv = buildWordsCsv([
      makeWord({
        englishText: 'say "hello"',
        translations: ['שלום, עולם', 'היי'],
        groups: ['greetings', 'daily life'],
        textHint: 'Line one\nLine two',
      }),
    ]);

    expect(csv).toContain('English,Translation,Group,Text hint,Translation language');
    expect(csv).toContain('"say ""hello"""');
    expect(csv).toContain('"שלום, עולם / היי"');
    expect(csv).toContain('greetings / daily life');
    expect(csv).toContain('"Line one\nLine two"');
    expect(csv).not.toContain('imageHint');
  });

  it('parses exported csv rows back into word drafts', () => {
    const csv = buildWordsCsv([
      makeWord({
        englishText: 'say "hello"',
        translations: ['שלום, עולם', 'היי'],
        translationLanguage: 'Hebrew',
        groups: ['greetings', 'daily life'],
        textHint: 'Line one\nLine two',
      }),
    ]);

    const parsed = parseWordsCsv(csv);

    expect(parsed.skippedRowNumbers).toEqual([]);
    expect(parsed.draftRowNumbers).toEqual([2]);
    expect(parsed.drafts).toEqual([
      {
        englishText: 'say "hello"',
        translationText: 'שלום, עולם / היי',
        translationLanguage: 'Hebrew',
        group: 'greetings / daily life',
        textHint: 'Line one\nLine two',
        imageHint: undefined,
      },
    ]);
  });

  it('skips incomplete rows and accepts header spacing', () => {
    const parsed = parseWordsCsv(
      '\uFEFFEnglish, Translation, Group, Text hint, Translation language\n' +
        'apple,תפוח / פרי,food / basics,,Hebrew\n' +
        'banana,,food,,Hebrew\n' +
        ',,,,\n',
    );

    expect(parsed.drafts).toHaveLength(1);
    expect(parsed.drafts[0].englishText).toBe('apple');
    expect(parsed.drafts[0].translationText).toBe('תפוח / פרי');
    expect(parsed.drafts[0].group).toBe('food / basics');
    expect(parsed.draftRowNumbers).toEqual([2]);
    expect(parsed.skippedRowNumbers).toEqual([3]);
  });

  it('requires the expected headers', () => {
    expect(() => parseWordsCsv('English,Translation\napple,תפוח')).toThrow(
      'CSV must have exactly 5 columns: English, Translation, Group, Text hint, Translation language.',
    );
  });

  it('rejects semicolon-delimited files', () => {
    expect(() =>
      parseWordsCsv(
        'English;Translation;Group;Text hint;Translation language\napple;תפוח;food;;Hebrew',
      ),
    ).toThrow('CSV must use commas between columns, not semicolons.');
  });

  it('rejects rows with too many columns', () => {
    expect(() =>
      parseWordsCsv(
        'English,Translation,Group,Text hint,Translation language\napple,תפוח,food,,Hebrew,extra',
      ),
    ).toThrow(
      'Row 2 has too many columns. Keep exactly these columns: English, Translation, Group, Text hint, Translation language.',
    );
  });
});
