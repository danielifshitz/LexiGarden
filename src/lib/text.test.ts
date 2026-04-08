import { describe, expect, it } from 'vitest';
import {
  areAnswersEquivalent,
  findMatchingAnswerOption,
  findWordByIdentity,
  getWordStatus,
  isNearMiss,
  isNearMissForOptions,
  normalizeForComparison,
  parseSlashSeparatedValues,
} from './text';
import type { WordEntry } from '../types';

function createWord(overrides: Partial<WordEntry> = {}): WordEntry {
  return {
    id: 'word-1',
    englishText: 'apple',
    translations: ['תפוח'],
    translationLanguage: 'Hebrew',
    groups: [],
    createdAt: '2026-04-04T10:00:00.000Z',
    reviewCount: 0,
    correctCount: 0,
    consecutiveCorrect: 0,
    ...overrides,
  };
}

describe('text helpers', () => {
  it('normalizes punctuation, spacing, and case', () => {
    expect(normalizeForComparison('  Hello,   World! ')).toBe('hello world');
    expect(areAnswersEquivalent('Hello, World!', 'hello world')).toBe(true);
  });

  it('parses slash-separated values with trimming and dedupe', () => {
    expect(parseSlashSeparatedValues('apple / fruit / Apple / / fruit')).toEqual([
      'apple',
      'fruit',
    ]);
  });

  it('detects near misses for small typos', () => {
    expect(isNearMiss('translation', 'translatoin')).toBe(true);
    expect(isNearMiss('translation', 'banana')).toBe(false);
    expect(isNearMissForOptions(['translation', 'meaning'], 'translatoin')).toBe(true);
  });

  it('derives word status from review progress', () => {
    expect(getWordStatus(createWord(), 3)).toBe('new');
    expect(getWordStatus(createWord({ reviewCount: 2, consecutiveCorrect: 1 }), 3)).toBe('learning');
    expect(getWordStatus(createWord({ reviewCount: 5, consecutiveCorrect: 3 }), 3)).toBe('known');
    expect(getWordStatus(createWord({ reviewCount: 0, consecutiveCorrect: 3 }), 3)).toBe('known');
  });

  it('finds words by english text and translation language', () => {
    const duplicate = findWordByIdentity(
      [
        createWord({
          id: 'word-a',
          englishText: 'Apple',
          translations: ['תפוח'],
          translationLanguage: 'Hebrew',
        }),
        createWord({
          id: 'word-b',
          englishText: 'Apple',
          translations: ['яблоко'],
          translationLanguage: 'Russian',
        }),
      ],
      {
        englishText: ' apple ',
        translationLanguage: 'Hebrew',
      },
    );

    expect(duplicate?.id).toBe('word-a');
    expect(
      findWordByIdentity(
        [
          createWord({
            id: 'word-a',
            englishText: 'Apple',
            translations: ['תפוח'],
            translationLanguage: 'Hebrew',
          }),
        ],
        {
          englishText: 'Apple',
          translationLanguage: 'Russian',
        },
      ),
    ).toBeUndefined();
  });

  it('matches answers against any accepted translation', () => {
    expect(findMatchingAnswerOption(['תפוח', 'פרי'], ' פרי ')).toBe('פרי');
    expect(findMatchingAnswerOption(['תפוח', 'פרי'], 'banana')).toBeUndefined();
  });
});
