import { describe, expect, it } from 'vitest';
import {
  buildAiModelUsagePoints,
  getCurrentTrainingStreak,
  getNeedsAttentionWords,
  getRecentlyMasteredWords,
  resolveProgressRange,
  summarizeAiUsage,
  summarizeProgress,
} from './progress';
import type { AiUsageLog, ReviewAttempt, WordEntry, WordStatusTransition } from '../types';

const words: WordEntry[] = [
  {
    id: 'w1',
    englishText: 'apple',
    translations: ['תפוח', 'פרי'],
    translationLanguage: 'Hebrew',
    groups: ['food'],
    createdAt: '2026-01-02T09:00:00.000Z',
    reviewCount: 3,
    correctCount: 2,
    consecutiveCorrect: 2,
  },
  {
    id: 'w2',
    englishText: 'book',
    translations: ['ספר'],
    translationLanguage: 'Hebrew',
    groups: ['school'],
    createdAt: '2026-01-03T09:00:00.000Z',
    reviewCount: 1,
    correctCount: 0,
    consecutiveCorrect: 0,
  },
  {
    id: 'w3',
    englishText: 'garden',
    translations: ['גן'],
    translationLanguage: 'Hebrew',
    groups: [],
    createdAt: '2026-02-01T09:00:00.000Z',
    reviewCount: 0,
    correctCount: 0,
    consecutiveCorrect: 0,
  },
];

const reviewAttempts: ReviewAttempt[] = [
  {
    id: 'a1',
    wordId: 'w1',
    shownAt: '2026-01-05T08:00:00.000Z',
    promptSide: 'english',
    userAnswer: 'תפוח',
    normalizedAnswer: 'תפוח',
    wasCorrect: true,
    usedHint: false,
    action: 'check',
  },
  {
    id: 'a2',
    wordId: 'w1',
    shownAt: '2026-01-05T08:05:00.000Z',
    promptSide: 'translation',
    userAnswer: 'apple',
    normalizedAnswer: 'apple',
    wasCorrect: true,
    usedHint: false,
    action: 'check',
  },
  {
    id: 'a3',
    wordId: 'w2',
    shownAt: '2026-01-06T10:00:00.000Z',
    promptSide: 'english',
    userAnswer: '',
    normalizedAnswer: '',
    wasCorrect: false,
    usedHint: false,
    action: 'dontKnow',
  },
  {
    id: 'a4',
    wordId: 'w2',
    shownAt: '2026-01-07T10:00:00.000Z',
    promptSide: 'english',
    userAnswer: '',
    normalizedAnswer: '',
    wasCorrect: false,
    usedHint: false,
    action: 'dontShowToday',
  },
];

const statusTransitions: WordStatusTransition[] = [
  {
    id: 't1',
    wordId: 'w1',
    changedAt: '2026-01-05T08:00:00.000Z',
    fromStatus: 'learning',
    toStatus: 'known',
    masteryThreshold: 3,
  },
  {
    id: 't2',
    wordId: 'w2',
    changedAt: '2026-01-06T10:00:00.000Z',
    fromStatus: 'new',
    toStatus: 'learning',
    masteryThreshold: 3,
  },
  {
    id: 't3',
    wordId: 'w1',
    changedAt: '2026-01-08T08:00:00.000Z',
    fromStatus: 'known',
    toStatus: 'learning',
    masteryThreshold: 3,
  },
];

const aiUsageLogs: AiUsageLog[] = [
  {
    id: 'log-1',
    feature: 'chat',
    model: 'openrouter/free',
    requestedAt: '2026-01-05T11:00:00.000Z',
    promptTokens: 20,
    completionTokens: 50,
    totalTokens: 70,
    success: true,
  },
  {
    id: 'log-2',
    feature: 'relatedWords',
    model: 'openrouter/free',
    requestedAt: '2026-01-06T11:00:00.000Z',
    promptTokens: 10,
    completionTokens: 20,
    totalTokens: 30,
    success: false,
    errorCode: 'rate_limited',
  },
  {
    id: 'log-3',
    feature: 'chat',
    model: 'qwen/qwen3.6-plus:free',
    requestedAt: '2026-02-03T11:00:00.000Z',
    promptTokens: 15,
    completionTokens: 25,
    totalTokens: 40,
    success: true,
  },
];

describe('progress helpers', () => {
  it('summarizes unique trained words, accuracy, and status changes for a period', () => {
    const range = resolveProgressRange({
      preset: 'custom',
      from: '2026-01-01',
      to: '2026-01-31',
    });

    expect(summarizeProgress(words, reviewAttempts, statusTransitions, range)).toEqual({
      newWords: 2,
      trainedWords: 2,
      accuracy: 67,
      changedWords: 2,
      correctAttempts: 2,
      totalAttempts: 3,
      promotions: 2,
      setbacks: 1,
    });
  });

  it('keeps a streak alive through yesterday but breaks it after a missed day', () => {
    expect(getCurrentTrainingStreak(reviewAttempts, new Date('2026-01-07T12:00:00'))).toBe(2);
    expect(getCurrentTrainingStreak(reviewAttempts, new Date('2026-01-09T12:00:00'))).toBe(0);
  });

  it('tracks mastered and needs-attention words inside the selected range', () => {
    const range = resolveProgressRange({
      preset: 'custom',
      from: '2026-01-01',
      to: '2026-01-31',
    });

    expect(getRecentlyMasteredWords(words, statusTransitions, range)).toEqual([
      {
        word: words[0],
        changedAt: '2026-01-05T08:00:00.000Z',
      },
    ]);

    expect(getNeedsAttentionWords(words, reviewAttempts, range)).toEqual([
      {
        word: words[1],
        misses: 1,
        lastMissedAt: '2026-01-06T10:00:00.000Z',
      },
    ]);
  });

  it('filters AI usage by range and aggregates model usage by request count', () => {
    const range = resolveProgressRange({
      preset: 'custom',
      from: '2026-01-01',
      to: '2026-01-31',
    });

    expect(summarizeAiUsage(aiUsageLogs, range)).toEqual({
      requests: 2,
      successful: 1,
      failed: 1,
      totalTokens: 100,
    });

    expect(buildAiModelUsagePoints(aiUsageLogs, range)).toEqual([
      {
        key: 'openrouter/free',
        label: 'openrouter/free',
        value: 2,
      },
    ]);
  });
});
