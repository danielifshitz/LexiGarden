import type {
  AppSettings,
  PromptSide,
  StudyCard,
  StudyMode,
  StudySelection,
  WordEntry,
} from '../types';
import {
  createId,
  formatTranslationsForDisplay,
  getTodayDateKey,
  getWordStatus,
  mergeUniqueValues,
  normalizeForComparison,
} from './text';
import { tRuntime } from './i18n';

export function shuffleArray<T>(items: T[]): T[] {
  const copy = [...items];

  for (let index = copy.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[randomIndex]] = [copy[randomIndex], copy[index]];
  }

  return copy;
}

export function getUniqueGroups(words: WordEntry[]): string[] {
  return [
    ...new Set(
      words.flatMap((word) => word.groups).filter((group): group is string => Boolean(group)),
    ),
  ].sort((left, right) => left.localeCompare(right));
}

export function getUniqueTranslationLanguages(words: WordEntry[]): string[] {
  return [...new Set(words.map((word) => word.translationLanguage).filter(Boolean))].sort((left, right) =>
    left.localeCompare(right),
  );
}

export function getAvailableTranslationLanguages(
  words: WordEntry[],
  savedLanguages: string[] = [],
): string[] {
  return mergeUniqueValues(savedLanguages, getUniqueTranslationLanguages(words)).sort((left, right) =>
    left.localeCompare(right),
  );
}

export function filterWordsByTranslationLanguage(
  words: WordEntry[],
  translationLanguage?: string,
): WordEntry[] {
  if (!translationLanguage?.trim()) {
    return [...words];
  }

  const normalizedLanguage = normalizeForComparison(translationLanguage);
  return words.filter(
    (word) => normalizeForComparison(word.translationLanguage) === normalizedLanguage,
  );
}

export function resolveActiveTranslationLanguage(
  words: WordEntry[],
  preferredLanguage?: string,
  savedLanguages: string[] = [],
): string {
  const languages = getAvailableTranslationLanguages(words, savedLanguages);
  const normalizedPreferred = normalizeForComparison(preferredLanguage ?? '');

  if (normalizedPreferred) {
    const exactMatch = languages.find(
      (language) => normalizeForComparison(language) === normalizedPreferred,
    );

    if (exactMatch) {
      return exactMatch;
    }
  }

  if (languages.length === 0) {
    return '';
  }

  const primaryWordLanguage = getPrimaryTranslationLanguage(words);

  if (primaryWordLanguage) {
    const matchingPrimary = languages.find(
      (language) => normalizeForComparison(language) === normalizeForComparison(primaryWordLanguage),
    );

    if (matchingPrimary) {
      return matchingPrimary;
    }
  }

  return languages[0] ?? '';
}

export function getPrimaryTranslationLanguage(words: WordEntry[]): string | undefined {
  const counts = new Map<string, number>();

  for (const word of words) {
    const current = counts.get(word.translationLanguage) ?? 0;
    counts.set(word.translationLanguage, current + 1);
  }

  let winner: string | undefined;
  let highestCount = 0;

  for (const [language, count] of counts.entries()) {
    if (count > highestCount) {
      highestCount = count;
      winner = language;
    }
  }

  return winner;
}

export function sortByCreatedNewest(words: WordEntry[]): WordEntry[] {
  return [...words].sort(
    (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
  );
}

export function sortByLessSeen(words: WordEntry[]): WordEntry[] {
  return [...words].sort((left, right) => {
    if (left.reviewCount !== right.reviewCount) {
      return left.reviewCount - right.reviewCount;
    }

    if (left.lastSeenAt && right.lastSeenAt) {
      return new Date(left.lastSeenAt).getTime() - new Date(right.lastSeenAt).getTime();
    }

    if (left.lastSeenAt) {
      return 1;
    }

    if (right.lastSeenAt) {
      return -1;
    }

    return new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
  });
}

export function percentageToCount(total: number, percentage: number): number {
  if (total === 0) {
    return 0;
  }

  const safePercentage = Math.max(0, Math.min(100, Math.round(percentage)));
  return safePercentage === 0 ? 0 : Math.max(1, Math.ceil(total * (safePercentage / 100)));
}

export function selectWordsByMode(
  words: WordEntry[],
  settings: AppSettings,
  selection: StudySelection,
): WordEntry[] {
  let selectedWords: WordEntry[];

  switch (selection.mode) {
    case 'all':
      selectedWords = [...words];
      break;
    case 'group': {
      const normalizedGroup = normalizeForComparison(selection.group ?? '');
      selectedWords = words.filter((word) =>
        word.groups.some((group) => normalizeForComparison(group) === normalizedGroup),
      );
      break;
    }
    case 'lastAdded': {
      const count = percentageToCount(words.length, settings.lastAddedPercent);
      selectedWords = sortByCreatedNewest(words).slice(0, count);
      break;
    }
    case 'lessKnown':
      selectedWords = words.filter((word) => getWordStatus(word, settings.masteryThreshold) !== 'known');
      break;
    case 'lessSeen': {
      const count = percentageToCount(words.length, settings.lessSeenPercent);
      selectedWords = sortByLessSeen(words).slice(0, count);
      break;
    }
    default:
      selectedWords = [...words];
  }

  return selectedWords;
}

export function buildStudyCards(
  words: WordEntry[],
  settings: AppSettings,
  selection: StudySelection,
  englishPromptPercentage = 50,
  todayDateKey = getTodayDateKey(),
  cardLimit?: number,
): StudyCard[] {
  const eligibleWords = selectWordsByMode(words, settings, selection).filter(
    (word) => word.snoozedUntilDate !== todayDateKey,
  );
  const safeEnglishPercentage = Math.max(0, Math.min(100, Math.round(englishPromptPercentage)));
  const safeCardLimit =
    typeof cardLimit === 'number' && Number.isFinite(cardLimit)
      ? Math.max(1, Math.floor(cardLimit))
      : undefined;
  const selectedWords = safeCardLimit
    ? shuffleArray(eligibleWords).slice(0, safeCardLimit)
    : shuffleArray(eligibleWords);
  const cards: StudyCard[] = [];

  for (const word of selectedWords) {
    cards.push({
      word,
      promptSide: Math.random() * 100 < safeEnglishPercentage ? 'english' : 'translation',
      id: createId(),
    });
  }

  return shuffleArray(cards);
}

export function getSelectionLabel(mode: StudyMode, group?: string): string {
  switch (mode) {
    case 'all':
      return tRuntime('studyModeAll');
    case 'group':
      return group ? `${tRuntime('commonGroup')}: ${group}` : tRuntime('commonGroup');
    case 'lastAdded':
      return tRuntime('studyModeLastAdded');
    case 'lessKnown':
      return tRuntime('studyModeLessKnown');
    case 'lessSeen':
      return tRuntime('studyModeLessSeen');
    default:
      return tRuntime('navStudy');
  }
}

export function buildWordPrompt(word: WordEntry, promptSide: PromptSide): string {
  return promptSide === 'english' ? word.englishText : formatTranslationsForDisplay(word);
}

export function buildExpectedAnswers(word: WordEntry, promptSide: PromptSide): string[] {
  return promptSide === 'english' ? word.translations : [word.englishText];
}

export function getOverviewStats(words: WordEntry[], settings: AppSettings): {
  totalWords: number;
  newWords: number;
  learningWords: number;
  knownWords: number;
  totalReviews: number;
  averageAccuracy: number;
} {
  let newWords = 0;
  let learningWords = 0;
  let knownWords = 0;

  for (const word of words) {
    const status = getWordStatus(word, settings.masteryThreshold);

    if (status === 'new') {
      newWords += 1;
    } else if (status === 'known') {
      knownWords += 1;
    } else {
      learningWords += 1;
    }
  }

  const totalReviews = words.reduce((sum, word) => sum + word.reviewCount, 0);
  const totalCorrect = words.reduce(
    (sum, word) => sum + Math.min(word.correctCount, word.reviewCount),
    0,
  );

  return {
    totalWords: words.length,
    newWords,
    learningWords,
    knownWords,
    totalReviews,
    averageAccuracy:
      totalReviews === 0 ? 0 : Math.min(100, Math.round((totalCorrect / totalReviews) * 100)),
  };
}
