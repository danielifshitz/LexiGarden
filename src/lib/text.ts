import type { AiModelCapabilities, OpenRouterModel, WordEntry, WordStatus } from '../types';
import { getRuntimeIntlLocale, tRuntime } from './i18n';

export const WORD_IDENTITY_CONFLICT_ERROR_PREFIX = 'WORD_IDENTITY_CONFLICT';

export function createId(): string {
  return crypto.randomUUID();
}

export interface WordIdentityLike {
  id?: string;
  englishText: string;
  translationLanguage: string;
}

export function trimToUndefined(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function getVocabularyPlaceholders(translationLanguage?: string): {
  english: string;
  translation: string;
} {
  const language = translationLanguage?.trim().toLocaleLowerCase() ?? '';

  const translationExamples: Array<[string, string]> = [
    ['russian', 'привет / здравствуйте'],
    ['hebrew', 'שלום / היי'],
    ['spanish', 'hola / buenas'],
    ['arabic', 'مرحبا / أهلا'],
    ['french', 'bonjour / salut'],
    ['german', 'hallo / guten tag'],
    ['italian', 'ciao / salve'],
    ['portuguese', 'olá / oi'],
    ['japanese', 'こんにちは / やあ'],
    ['korean', '안녕하세요 / 안녕'],
  ];

  const matched = translationExamples.find(([name]) => language.includes(name));

  return {
    english: 'hello',
    translation: matched?.[1] ?? 'bonjour / salut',
  };
}

export function normalizeForComparison(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseSlashSeparatedValues(value: string): string[] {
  const seen = new Set<string>();
  const values: string[] = [];

  for (const part of value.split('/')) {
    const trimmed = part.trim();

    if (!trimmed) {
      continue;
    }

    const key = normalizeForComparison(trimmed);

    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    values.push(trimmed);
  }

  return values;
}

export function formatSlashSeparatedValues(values: string[]): string {
  return values.join(' / ');
}

export function getPrimaryTranslation(word: Pick<WordEntry, 'translations'>): string {
  return word.translations[0] ?? '';
}

export function formatTranslationsForDisplay(word: Pick<WordEntry, 'translations'>): string {
  return formatSlashSeparatedValues(word.translations);
}

export function formatGroupsForDisplay(word: Pick<WordEntry, 'groups'>): string {
  return formatSlashSeparatedValues(word.groups);
}

export function mergeUniqueValues(existing: string[], incoming: string[]): string[] {
  const merged = [...existing];
  const seen = new Set(existing.map((value) => normalizeForComparison(value)));

  for (const value of incoming) {
    const key = normalizeForComparison(value);

    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    merged.push(value.trim());
  }

  return merged;
}

export function getWordIdentityKey(
  word: Pick<WordIdentityLike, 'englishText' | 'translationLanguage'>,
): string {
  return `${normalizeForComparison(word.englishText)}::${normalizeForComparison(word.translationLanguage)}`;
}

export function findWordByIdentity<T extends WordIdentityLike>(
  words: T[],
  candidate: Pick<WordIdentityLike, 'englishText' | 'translationLanguage'>,
  excludeId?: string,
): T | undefined {
  const candidateKey = getWordIdentityKey(candidate);

  return words.find((word) => word.id !== excludeId && getWordIdentityKey(word) === candidateKey);
}

export function isWordIdentityConflictError(error: unknown): error is Error {
  return error instanceof Error && error.message.startsWith(WORD_IDENTITY_CONFLICT_ERROR_PREFIX);
}

export function areAnswersEquivalent(expected: string, actual: string): boolean {
  return normalizeForComparison(expected) === normalizeForComparison(actual);
}

export function findMatchingAnswerOption(expectedOptions: string[], actual: string): string | undefined {
  return expectedOptions.find((option) => areAnswersEquivalent(option, actual));
}

export function levenshteinDistance(left: string, right: string): number {
  if (left === right) {
    return 0;
  }

  if (left.length === 0) {
    return right.length;
  }

  if (right.length === 0) {
    return left.length;
  }

  const previous = new Array<number>(right.length + 1);
  const current = new Array<number>(right.length + 1);

  for (let index = 0; index <= right.length; index += 1) {
    previous[index] = index;
  }

  for (let row = 1; row <= left.length; row += 1) {
    current[0] = row;

    for (let column = 1; column <= right.length; column += 1) {
      const substitutionCost = left[row - 1] === right[column - 1] ? 0 : 1;

      current[column] = Math.min(
        current[column - 1] + 1,
        previous[column] + 1,
        previous[column - 1] + substitutionCost,
      );
    }

    for (let column = 0; column <= right.length; column += 1) {
      previous[column] = current[column];
    }
  }

  return previous[right.length];
}

export function isNearMiss(expected: string, actual: string): boolean {
  const normalizedExpected = normalizeForComparison(expected);
  const normalizedActual = normalizeForComparison(actual);

  if (!normalizedExpected || !normalizedActual) {
    return false;
  }

  const distance = levenshteinDistance(normalizedExpected, normalizedActual);
  return distance > 0 && distance <= Math.max(1, Math.floor(normalizedExpected.length * 0.2));
}

export function isNearMissForOptions(expectedOptions: string[], actual: string): boolean {
  return expectedOptions.some((option) => isNearMiss(option, actual));
}

export function getWordStatus(word: WordEntry, masteryThreshold: number): WordStatus {
  if (word.consecutiveCorrect >= masteryThreshold) {
    return 'known';
  }

  if (word.reviewCount === 0) {
    return 'new';
  }

  return 'learning';
}

export function formatDateTime(isoString?: string): string {
  if (!isoString) {
    return tRuntime('textNotYet');
  }

  return new Intl.DateTimeFormat(getRuntimeIntlLocale(), {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(isoString));
}

export function formatDateOnly(dateKey?: string): string {
  if (!dateKey) {
    return tRuntime('textNotSet');
  }

  const date = new Date(`${dateKey}T00:00:00`);
  return new Intl.DateTimeFormat(getRuntimeIntlLocale(), {
    dateStyle: 'medium',
  }).format(date);
}

export function getTodayDateKey(now = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
        return;
      }

      reject(new Error(tRuntime('textReadFileFailed')));
    };

    reader.onerror = () => {
      reject(reader.error ?? new Error(tRuntime('textReadFileFailed')));
    };

    reader.readAsDataURL(file);
  });
}

export function downloadTextFile(
  filename: string,
  content: string,
  mimeType = 'application/json',
): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function deriveModelCapabilities(model?: OpenRouterModel): AiModelCapabilities {
  const supportedParameters = model?.supported_parameters ?? [];

  const hasParameter = (target: string) =>
    supportedParameters.some((parameter) => parameter.toLowerCase() === target.toLowerCase());

  return {
    supportsStructuredOutputs: hasParameter('structured_outputs') || hasParameter('response_format'),
    supportsResponseFormat: hasParameter('response_format') || hasParameter('structured_outputs'),
    supportsMaxTokens: hasParameter('max_tokens') || hasParameter('max_completion_tokens'),
  };
}
