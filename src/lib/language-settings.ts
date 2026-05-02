import type { AppSettings, TranslationLanguageProfile } from '../types';
import { normalizeForComparison } from './text';

export const defaultLanguageProfile: TranslationLanguageProfile = {
  learnerName: '',
  tutorName: 'Tutor',
  masteryThreshold: 3,
  translationFontFamily: 'sans',
  showAudioButtons: true,
};

export function clampMasteryThreshold(value: number, fallback = defaultLanguageProfile.masteryThreshold): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(12, Math.max(1, Math.round(value)));
}

export function buildBaseLanguageProfile(
  source?: Partial<TranslationLanguageProfile> & {
    learnerName?: string;
    tutorName?: string;
    masteryThreshold?: number;
    translationFontFamily?: string;
    showAudioButtons?: boolean;
  },
): TranslationLanguageProfile {
  return {
    learnerName: typeof source?.learnerName === 'string' ? source.learnerName : defaultLanguageProfile.learnerName,
    tutorName: typeof source?.tutorName === 'string' ? source.tutorName : defaultLanguageProfile.tutorName,
    masteryThreshold: clampMasteryThreshold(
      typeof source?.masteryThreshold === 'number'
        ? source.masteryThreshold
        : defaultLanguageProfile.masteryThreshold,
    ),
    translationFontFamily:
      typeof source?.translationFontFamily === 'string'
        ? source.translationFontFamily
        : defaultLanguageProfile.translationFontFamily,
    showAudioButtons:
      typeof source?.showAudioButtons === 'boolean'
        ? source.showAudioButtons
        : defaultLanguageProfile.showAudioButtons,
  };
}

export function normalizeLanguageProfile(
  input: unknown,
  fallback: TranslationLanguageProfile = defaultLanguageProfile,
): TranslationLanguageProfile {
  const source =
    input && typeof input === 'object' ? (input as Partial<TranslationLanguageProfile>) : undefined;

  return {
    learnerName:
      typeof source?.learnerName === 'string' ? source.learnerName : fallback.learnerName,
    tutorName: typeof source?.tutorName === 'string' ? source.tutorName : fallback.tutorName,
    masteryThreshold: clampMasteryThreshold(
      typeof source?.masteryThreshold === 'number'
        ? source.masteryThreshold
        : fallback.masteryThreshold,
      fallback.masteryThreshold,
    ),
    translationFontFamily:
      typeof source?.translationFontFamily === 'string'
        ? source.translationFontFamily
        : fallback.translationFontFamily,
    showAudioButtons:
      typeof source?.showAudioButtons === 'boolean'
        ? source.showAudioButtons
        : fallback.showAudioButtons,
  };
}

export function isEnglishLanguage(language?: string): boolean {
  const normalized = normalizeForComparison(language ?? '');

  return normalized === 'english' || normalized === 'en' || normalized.startsWith('en-');
}

export function getLanguageProfile(
  settings: Pick<
    AppSettings,
    | 'learnerName'
    | 'tutorName'
    | 'masteryThreshold'
    | 'translationFontFamily'
    | 'languageProfiles'
  >,
  language?: string,
): TranslationLanguageProfile {
  const fallback = buildBaseLanguageProfile(settings);

  if (!language?.trim()) {
    return fallback;
  }

  const entries = Object.entries(settings.languageProfiles ?? {});
  const exactEntry = entries.find(([key]) => key === language);
  const normalizedLanguage = normalizeForComparison(language);
  const normalizedEntry =
    exactEntry ??
    entries.find(([key]) => normalizeForComparison(key) === normalizedLanguage);

  if (!normalizedEntry) {
    return fallback;
  }

  return normalizeLanguageProfile(normalizedEntry[1], fallback);
}

export function shouldShowAudioForLanguage(
  settings: Pick<
    AppSettings,
    | 'learnerName'
    | 'tutorName'
    | 'masteryThreshold'
    | 'translationFontFamily'
    | 'languageProfiles'
  >,
  language?: string,
): boolean {
  if (!language?.trim() || isEnglishLanguage(language)) {
    return true;
  }

  return getLanguageProfile(settings, language).showAudioButtons;
}

export function reconcileLanguageProfiles(
  languages: string[],
  source: Pick<
    AppSettings,
    'learnerName' | 'tutorName' | 'masteryThreshold' | 'translationFontFamily' | 'languageProfiles'
  >,
): Record<string, TranslationLanguageProfile> {
  const nextProfiles: Record<string, TranslationLanguageProfile> = {};

  for (const language of languages) {
    nextProfiles[language] = getLanguageProfile(source, language);
  }

  return nextProfiles;
}

export function synchronizeBaseLanguageFields<
  T extends Pick<
    AppSettings,
    | 'learnerName'
    | 'tutorName'
    | 'masteryThreshold'
    | 'translationFontFamily'
    | 'languageProfiles'
  >,
>(settings: T, language?: string): T {
  const profile = getLanguageProfile(settings, language);

  return {
    ...settings,
    learnerName: profile.learnerName,
    tutorName: profile.tutorName,
    masteryThreshold: profile.masteryThreshold,
    translationFontFamily: profile.translationFontFamily,
  };
}
