import { describe, expect, it } from 'vitest';
import { defaultSettings } from '../db';
import type { WordEntry } from '../types';
import {
  buildStudyCards,
  filterWordsByTranslationLanguage,
  getAvailableTranslationLanguages,
  getOverviewStats,
  getUniqueGroups,
  getUniqueTranslationLanguages,
  percentageToCount,
  resolveActiveTranslationLanguage,
  selectWordsByMode,
  sortByLessSeen,
} from './study';

function makeWord(index: number, overrides: Partial<WordEntry> = {}): WordEntry {
  return {
    id: `word-${index}`,
    englishText: `word-${index}`,
    translations: [`translation-${index}`, `meaning-${index}`],
    translationLanguage: 'Hebrew',
    groups: index % 2 === 0 ? ['travel', 'friends'] : ['food'],
    createdAt: `2026-04-${String(index).padStart(2, '0')}T10:00:00.000Z`,
    reviewCount: index,
    correctCount: Math.max(index - 1, 0),
    consecutiveCorrect: index > 3 ? 3 : 0,
    ...overrides,
  };
}

describe('study selection helpers', () => {
  const words = [
    makeWord(1, { reviewCount: 0, consecutiveCorrect: 0 }),
    makeWord(2, { reviewCount: 1, consecutiveCorrect: 0 }),
    makeWord(3, { reviewCount: 2, consecutiveCorrect: 1, groups: ['travel'] }),
    makeWord(4, { reviewCount: 4, consecutiveCorrect: 3, groups: ['work'] }),
  ];

  it('converts percentage settings into a safe item count', () => {
    expect(percentageToCount(0, 25)).toBe(0);
    expect(percentageToCount(10, 25)).toBe(3);
    expect(percentageToCount(3, 1)).toBe(1);
    expect(percentageToCount(3, 0)).toBe(0);
  });

  it('collects distinct groups from multi-group words', () => {
    expect(getUniqueGroups(words)).toEqual(['food', 'friends', 'travel', 'work']);
  });

  it('collects distinct translation languages', () => {
    expect(
      getUniqueTranslationLanguages([
        makeWord(1, { translationLanguage: 'Hebrew' }),
        makeWord(2, { translationLanguage: 'Russian' }),
        makeWord(3, { translationLanguage: 'Hebrew' }),
      ]),
    ).toEqual(['Hebrew', 'Russian']);
  });

  it('combines saved languages with languages that already exist on words', () => {
    expect(
      getAvailableTranslationLanguages(
        [
          makeWord(1, { translationLanguage: 'Hebrew' }),
          makeWord(2, { translationLanguage: 'Russian' }),
        ],
        ['Spanish', 'Hebrew'],
      ),
    ).toEqual(['Hebrew', 'Russian', 'Spanish']);
  });

  it('selects less-known words by status', () => {
    const result = selectWordsByMode(words, defaultSettings, { mode: 'lessKnown' });
    expect(result.map((word) => word.id)).toEqual(['word-1', 'word-2', 'word-3']);
  });

  it('matches group filters against any saved group', () => {
    const result = selectWordsByMode(words, defaultSettings, { mode: 'group', group: 'friends' });
    expect(result.map((word) => word.id)).toEqual(['word-2']);
  });

  it('filters the selected study pool by translation language', () => {
    const result = filterWordsByTranslationLanguage(
      [
        makeWord(1, { translationLanguage: 'Hebrew' }),
        makeWord(2, { translationLanguage: 'Russian' }),
        makeWord(3, { translationLanguage: 'Hebrew', groups: ['travel'] }),
      ],
      'Russian',
    );

    expect(result.map((word) => word.id)).toEqual(['word-2']);
  });

  it('resolves the active language from the saved language list first, then falls back safely', () => {
    const mixedWords = [
      makeWord(1, { translationLanguage: 'Hebrew' }),
      makeWord(2, { translationLanguage: 'Russian' }),
      makeWord(3, { translationLanguage: 'Hebrew' }),
    ];

    expect(resolveActiveTranslationLanguage(mixedWords, 'Russian')).toBe('Russian');
    expect(resolveActiveTranslationLanguage(mixedWords, 'Spanish', ['Spanish'])).toBe('Spanish');
    expect(resolveActiveTranslationLanguage([], 'Spanish', ['Spanish'])).toBe('Spanish');
    expect(resolveActiveTranslationLanguage([], 'Spanish')).toBe('');
  });

  it('selects the newest words for lastAdded', () => {
    const result = selectWordsByMode(words, { ...defaultSettings, lastAddedPercent: 50 }, { mode: 'lastAdded' });
    expect(result.map((word) => word.id)).toEqual(['word-4', 'word-3']);
  });

  it('sorts less-seen words by review count and last seen date', () => {
    const result = sortByLessSeen([
      makeWord(7, { reviewCount: 2, lastSeenAt: '2026-04-07T09:00:00.000Z' }),
      makeWord(8, { reviewCount: 0 }),
      makeWord(9, { reviewCount: 2, lastSeenAt: '2026-04-06T09:00:00.000Z' }),
    ]);

    expect(result.map((word) => word.id)).toEqual(['word-8', 'word-9', 'word-7']);
  });

  it('builds study cards for the selected session language balance', () => {
    const englishOnlyCards = buildStudyCards(words, defaultSettings, { mode: 'all' }, 100, '2026-04-30');
    const translationOnlyCards = buildStudyCards(words, defaultSettings, { mode: 'all' }, 0, '2026-04-30');

    expect(englishOnlyCards.every((card) => card.promptSide === 'english')).toBe(true);
    expect(translationOnlyCards.every((card) => card.promptSide === 'translation')).toBe(true);
  });

  it('builds cards only for the chosen translation language', () => {
    const filteredCards = buildStudyCards(
      filterWordsByTranslationLanguage(
        [
          makeWord(1, { translationLanguage: 'Hebrew' }),
          makeWord(2, { translationLanguage: 'Russian' }),
        ],
        'Russian',
      ),
      defaultSettings,
      { mode: 'all' },
      100,
      '2026-04-30',
    );

    expect(filteredCards).toHaveLength(1);
    expect(filteredCards[0]?.word.translationLanguage).toBe('Russian');
  });

  it('caps overview accuracy when saved counters become inconsistent', () => {
    const stats = getOverviewStats(
      [
        makeWord(10, {
          reviewCount: 1,
          correctCount: 3,
          consecutiveCorrect: 3,
        }),
      ],
      defaultSettings,
    );

    expect(stats.averageAccuracy).toBe(100);
  });
});
