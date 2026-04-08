import type {
  AppSettings,
  MarathonCard,
  MarathonDifficulty,
  PromptSide,
  StudySelection,
  WordEntry,
} from '../types';
import { createId, normalizeForComparison } from './text';
import { selectWordsByMode, shuffleArray } from './study';

export interface MarathonDifficultyConfig {
  difficulty: MarathonDifficulty;
  optionCount: number;
  seconds: number;
}

export interface MarathonPoolMetrics {
  wordCount: number;
  cardCount: number;
  uniqueEnglishOptions: number;
  uniqueTranslationOptions: number;
}

export interface MarathonDifficultyAvailability extends MarathonDifficultyConfig {
  supported: boolean;
  missingSide?: 'english' | 'translation' | 'both';
}

export const MARATHON_DIFFICULTY_CONFIG: Record<MarathonDifficulty, MarathonDifficultyConfig> = {
  study: { difficulty: 'study', optionCount: 3, seconds: 10 },
  easy: { difficulty: 'easy', optionCount: 4, seconds: 8 },
  warm: { difficulty: 'warm', optionCount: 4, seconds: 6 },
  medium: { difficulty: 'medium', optionCount: 5, seconds: 5 },
  hard: { difficulty: 'hard', optionCount: 6, seconds: 4 },
  expert: { difficulty: 'expert', optionCount: 6, seconds: 3 },
};

export const MARATHON_DIFFICULTY_ORDER: MarathonDifficulty[] = [
  'study',
  'easy',
  'warm',
  'medium',
  'hard',
  'expert',
];

function choosePromptSide(englishPromptPercentage: number): PromptSide {
  const safeEnglishPercentage = Math.max(0, Math.min(100, Math.round(englishPromptPercentage)));
  return Math.random() * 100 < safeEnglishPercentage ? 'english' : 'translation';
}

function dedupeLabels(values: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];

  for (const value of values) {
    const key = normalizeForComparison(value);

    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    unique.push(value);
  }

  return unique;
}

export function getMarathonPoolMetrics(
  words: WordEntry[],
  settings: AppSettings,
  selection: StudySelection,
): MarathonPoolMetrics {
  const selectedWords = selectWordsByMode(words, settings, selection);
  const uniqueEnglishOptions = dedupeLabels(selectedWords.map((word) => word.englishText)).length;
  const uniqueTranslationOptions = dedupeLabels(
    selectedWords.flatMap((word) => word.translations),
  ).length;

  return {
    wordCount: selectedWords.length,
    cardCount: selectedWords.reduce((sum, word) => sum + word.translations.length, 0),
    uniqueEnglishOptions,
    uniqueTranslationOptions,
  };
}

export function getMarathonDifficultyAvailability(
  metrics: MarathonPoolMetrics,
  englishPromptPercentage: number,
): MarathonDifficultyAvailability[] {
  const needsEnglishOptions = englishPromptPercentage < 100;
  const needsTranslationOptions = englishPromptPercentage > 0;

  return MARATHON_DIFFICULTY_ORDER.map((difficulty) => {
    const config = MARATHON_DIFFICULTY_CONFIG[difficulty];
    const missingEnglish = needsEnglishOptions && metrics.uniqueEnglishOptions < config.optionCount;
    const missingTranslation =
      needsTranslationOptions && metrics.uniqueTranslationOptions < config.optionCount;

    return {
      ...config,
      supported: !missingEnglish && !missingTranslation,
      missingSide:
        missingEnglish && missingTranslation
          ? 'both'
          : missingEnglish
            ? 'english'
            : missingTranslation
              ? 'translation'
              : undefined,
    };
  });
}

export function buildMarathonCards(
  words: WordEntry[],
  settings: AppSettings,
  selection: StudySelection,
  englishPromptPercentage: number,
): MarathonCard[] {
  const selectedWords = selectWordsByMode(words, settings, selection);
  const cards: MarathonCard[] = [];

  for (const word of shuffleArray(selectedWords)) {
    for (const translationText of word.translations) {
      cards.push({
        id: createId(),
        wordId: word.id,
        englishText: word.englishText,
        translationText,
        translationLanguage: word.translationLanguage,
        promptSide: choosePromptSide(englishPromptPercentage),
      });
    }
  }

  return shuffleArray(cards);
}

export function buildMarathonChoices(
  card: MarathonCard,
  cards: MarathonCard[],
  difficulty: MarathonDifficulty,
): { options: string[]; correctOption: string } {
  const { optionCount } = MARATHON_DIFFICULTY_CONFIG[difficulty];
  const correctOption = card.promptSide === 'english' ? card.translationText : card.englishText;
  const pool =
    card.promptSide === 'english'
      ? dedupeLabels(cards.map((item) => item.translationText))
      : dedupeLabels(cards.map((item) => item.englishText));
  const wrongOptions = shuffleArray(
    pool.filter((value) => normalizeForComparison(value) !== normalizeForComparison(correctOption)),
  ).slice(0, Math.max(0, optionCount - 1));

  return {
    options: shuffleArray([correctOption, ...wrongOptions]),
    correctOption,
  };
}
