import { describe, expect, it } from 'vitest';
import { defaultSettings } from '../db';
import type { MarathonCard, WordEntry } from '../types';
import {
  buildMarathonCards,
  buildMarathonChoices,
  getMarathonDifficultyAvailability,
  getMarathonPoolMetrics,
} from './marathon';

function makeWord(index: number, overrides: Partial<WordEntry> = {}): WordEntry {
  return {
    id: `word-${index}`,
    englishText: `word-${index}`,
    translations: [`translation-${index}`, `meaning-${index}`],
    translationLanguage: 'Hebrew',
    groups: index % 2 === 0 ? ['travel'] : ['food'],
    createdAt: `2026-04-${String(index).padStart(2, '0')}T10:00:00.000Z`,
    reviewCount: 0,
    correctCount: 0,
    consecutiveCorrect: 0,
    ...overrides,
  };
}

describe('marathon helpers', () => {
  const words = [
    makeWord(1),
    makeWord(2, { translations: ['alpha', 'beta', 'gamma'] }),
    makeWord(3, { translations: ['delta'] }),
  ];

  it('builds one card per translation variant', () => {
    const cards = buildMarathonCards(words, defaultSettings, { mode: 'all' }, 100);

    expect(cards).toHaveLength(6);
    expect(cards.every((card) => card.promptSide === 'english')).toBe(true);
  });

  it('measures the pool by word count, card count, and smallest real choice pool', () => {
    expect(getMarathonPoolMetrics(words, defaultSettings, { mode: 'all' })).toEqual({
      wordCount: 3,
      cardCount: 6,
      minEnglishChoicesPerCard: 3,
      minTranslationChoicesPerCard: 4,
    });
  });

  it('disables harder levels when there are not enough unique answer labels', () => {
    const availability = getMarathonDifficultyAvailability(
      getMarathonPoolMetrics(words, defaultSettings, { mode: 'all' }),
      0,
    );

    expect(availability.find((item) => item.difficulty === 'study')?.supported).toBe(true);
    expect(availability.find((item) => item.difficulty === 'easy')?.supported).toBe(false);
    expect(availability.find((item) => item.difficulty === 'easy')?.missingSide).toBe('english');
  });

  it('does not use another translation from the same word as a wrong option', () => {
    const card: MarathonCard = {
      id: 'card-1',
      wordId: 'word-1',
      englishText: 'apple',
      translationText: 'תפוח',
      translationLanguage: 'Hebrew',
      promptSide: 'english',
    };
    const cards: MarathonCard[] = [
      card,
      {
        id: 'card-1b',
        wordId: 'word-1',
        englishText: 'apple',
        translationText: 'פרי',
        translationLanguage: 'Hebrew',
        promptSide: 'english',
      },
      {
        id: 'card-2',
        wordId: 'word-2',
        englishText: 'book',
        translationText: 'ספר',
        translationLanguage: 'Hebrew',
        promptSide: 'english',
      },
      {
        id: 'card-3',
        wordId: 'word-3',
        englishText: 'garden',
        translationText: 'גן',
        translationLanguage: 'Hebrew',
        promptSide: 'translation',
      },
    ];

    const choiceState = buildMarathonChoices(card, cards, 'study');

    expect(choiceState.correctOption).toBe('תפוח');
    expect(choiceState.options).toContain('תפוח');
    expect(choiceState.options).not.toContain('פרי');
    expect(choiceState.options).toHaveLength(3);
  });

  it('does not mark a level as supported when some cards cannot fill enough translation choices', () => {
    const unevenWords = [
      makeWord(1, { translations: ['one', 'two', 'three', 'four'] }),
      makeWord(2, { translations: ['five'] }),
      makeWord(3, { translations: ['six'] }),
    ];

    expect(getMarathonPoolMetrics(unevenWords, defaultSettings, { mode: 'all' })).toEqual({
      wordCount: 3,
      cardCount: 6,
      minEnglishChoicesPerCard: 3,
      minTranslationChoicesPerCard: 3,
    });

    const availability = getMarathonDifficultyAvailability(
      getMarathonPoolMetrics(unevenWords, defaultSettings, { mode: 'all' }),
      100,
    );

    expect(availability.find((item) => item.difficulty === 'study')?.supported).toBe(true);
    expect(availability.find((item) => item.difficulty === 'easy')?.supported).toBe(false);
    expect(availability.find((item) => item.difficulty === 'easy')?.missingSide).toBe(
      'translation',
    );
  });
});
