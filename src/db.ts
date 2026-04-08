import Dexie, { type Table } from 'dexie';
import type {
  AiFeature,
  AiUsageLog,
  AppSettings,
  BackupPayload,
  ChatSession,
  PageLayoutMode,
  PersistedState,
  PromptSide,
  ReviewAction,
  ReviewAttempt,
  WordEntry,
  WordStatusTransition,
} from './types';
import {
  createId,
  findWordByIdentity,
  getTodayDateKey,
  getWordIdentityKey,
  getWordStatus,
  mergeUniqueValues,
  normalizeForComparison,
  parseSlashSeparatedValues,
  trimToUndefined,
  WORD_IDENTITY_CONFLICT_ERROR_PREFIX,
} from './lib/text';
import {
  buildBaseLanguageProfile,
  getLanguageProfile,
  normalizeLanguageProfile,
  reconcileLanguageProfiles,
  synchronizeBaseLanguageFields,
} from './lib/language-settings';
import { resolveInitialAppLanguage, resolveSupportedAppLanguage, tRuntime } from './lib/i18n';
import {
  getAvailableTranslationLanguages,
  resolveActiveTranslationLanguage,
} from './lib/study';

export const defaultSettings: AppSettings = {
  id: 'app',
  appLanguage: resolveInitialAppLanguage(),
  learnerName: '',
  tutorName: 'Tutor',
  masteryThreshold: 3,
  lastAddedPercent: 25,
  lessSeenPercent: 25,
  activeTranslationLanguage: '',
  translationLanguages: [],
  languageProfiles: {},
  englishFontFamily: 'serif',
  translationFontFamily: 'sans',
  textFontScale: 100,
  studyLayoutMode: 'split',
  vocabularyLayoutMode: 'split',
  chatLayoutMode: 'split',
  progressLayoutMode: 'stacked',
  settingsLayoutMode: 'split',
  openRouterApiKey: '',
  openRouterModel: '',
  openRouterMaxTokens: 0,
};

export interface WordDraft {
  englishText: string;
  translationText: string;
  translationLanguage: string;
  group?: string;
  textHint?: string;
  imageHint?: WordEntry['imageHint'];
}

export interface WordMutationResult {
  word: WordEntry;
  change: 'created' | 'merged' | 'updated' | 'noop';
  addedTranslations: string[];
  addedGroups: string[];
  filledFields: Array<'textHint' | 'imageHint'>;
}

export interface ImportWordsResult {
  results: WordMutationResult[];
  createdCount: number;
  mergedCount: number;
  noopCount: number;
  words: WordEntry[];
}

export type WordDeleteScope =
  | { mode: 'all' }
  | { mode: 'group'; value: string }
  | { mode: 'language'; value: string };

export interface DeleteWordsResult {
  deletedCount: number;
}

export interface DeleteLanguageResult {
  deletedWordCount: number;
  deletedChatCount: number;
}

export interface MergeWordsResult {
  mergedWordCount: number;
  removedWordCount: number;
}

type LegacyWordRecord = Omit<WordEntry, 'translations' | 'groups'> & {
  translationText?: string;
  group?: string;
  translations?: string[];
  groups?: string[];
};

type LegacyBackupPayload = Omit<BackupPayload, 'version' | 'words'> & {
  version: 1 | 2 | 3 | 4 | 5 | 6;
  words: LegacyWordRecord[];
  statusTransitions?: WordStatusTransition[];
};

function normalizeTranslationLanguageList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return mergeUniqueValues(
      [],
      value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()),
    );
  }

  if (typeof value === 'string') {
    return parseSlashSeparatedValues(value);
  }

  return [];
}

function normalizeLayoutMode(value: unknown, fallback: PageLayoutMode): PageLayoutMode {
  return value === 'split' || value === 'stacked' ? value : fallback;
}

function normalizeSettings(input?: Record<string, unknown> | null): AppSettings {
  const source = input ?? {};
  const legacyEnglishScale =
    typeof source.englishFontScale === 'number' ? source.englishFontScale : undefined;
  const legacyTranslationScale =
    typeof source.translationFontScale === 'number' ? source.translationFontScale : undefined;
  const textFontScale =
    typeof source.textFontScale === 'number'
      ? source.textFontScale
      : legacyEnglishScale ?? legacyTranslationScale ?? defaultSettings.textFontScale;
  const activeTranslationLanguage =
    typeof source.activeTranslationLanguage === 'string'
      ? source.activeTranslationLanguage
      : typeof source.defaultTranslationLanguage === 'string'
        ? source.defaultTranslationLanguage
        : defaultSettings.activeTranslationLanguage;
  const translationLanguages = mergeUniqueValues(
    normalizeTranslationLanguageList(source.translationLanguages),
    activeTranslationLanguage ? [activeTranslationLanguage] : [],
  );
  const baseLanguageProfile = buildBaseLanguageProfile({
    learnerName: typeof source.learnerName === 'string' ? source.learnerName : undefined,
    tutorName: typeof source.tutorName === 'string' ? source.tutorName : undefined,
    masteryThreshold: typeof source.masteryThreshold === 'number' ? source.masteryThreshold : undefined,
    translationFontFamily:
      typeof source.translationFontFamily === 'string' ? source.translationFontFamily : undefined,
  });
  const rawLanguageProfiles =
    source.languageProfiles && typeof source.languageProfiles === 'object'
      ? (source.languageProfiles as Record<string, unknown>)
      : {};
  const languageProfiles = Object.fromEntries(
    Object.entries(rawLanguageProfiles).map(([language, profile]) => [
      language,
      normalizeLanguageProfile(profile, baseLanguageProfile),
    ]),
  );

  const normalizedSettings: AppSettings = {
    ...defaultSettings,
    ...(source as Partial<AppSettings>),
    appLanguage: resolveSupportedAppLanguage(
      typeof source.appLanguage === 'string' ? source.appLanguage : undefined,
    ),
    activeTranslationLanguage,
    translationLanguages,
    languageProfiles: reconcileLanguageProfiles(translationLanguages, {
      ...defaultSettings,
      ...(source as Partial<AppSettings>),
      ...baseLanguageProfile,
      languageProfiles,
    }),
    textFontScale,
    studyLayoutMode: normalizeLayoutMode(source.studyLayoutMode, defaultSettings.studyLayoutMode),
    vocabularyLayoutMode: normalizeLayoutMode(
      source.vocabularyLayoutMode,
      defaultSettings.vocabularyLayoutMode,
    ),
    chatLayoutMode: normalizeLayoutMode(source.chatLayoutMode, defaultSettings.chatLayoutMode),
    progressLayoutMode: normalizeLayoutMode(
      source.progressLayoutMode,
      defaultSettings.progressLayoutMode,
    ),
    settingsLayoutMode: normalizeLayoutMode(
      source.settingsLayoutMode,
      defaultSettings.settingsLayoutMode,
    ),
    id: 'app',
  };

  return synchronizeBaseLanguageFields(
    normalizedSettings,
    normalizedSettings.activeTranslationLanguage,
  );
}

function inferChatSessionTranslationLanguage(
  session: Pick<ChatSession, 'selectedWordIds' | 'translationLanguage'>,
  wordMap: Map<string, WordEntry>,
): string | undefined {
  const languages = [
    ...new Set(
      session.selectedWordIds
        .map((wordId) => wordMap.get(wordId)?.translationLanguage?.trim())
        .filter((language): language is string => Boolean(language)),
    ),
  ];

  if (languages.length === 1) {
    return languages[0];
  }

  if (languages.length > 1) {
    return undefined;
  }

  return trimToUndefined(session.translationLanguage ?? '');
}

function normalizeChatSession(
  session: ChatSession,
  wordMap: Map<string, WordEntry>,
): ChatSession {
  return {
    ...session,
    label: trimToUndefined(session.label ?? ''),
    tutorPrompt: trimToUndefined(session.tutorPrompt ?? ''),
    translationLanguage: inferChatSessionTranslationLanguage(session, wordMap),
  };
}

function normalizeWordRecord(input: LegacyWordRecord): WordEntry {
  const translationsSource = Array.isArray(input.translations)
    ? input.translations.join(' / ')
    : input.translationText ?? '';
  const groupsSource = Array.isArray(input.groups)
    ? input.groups.join(' / ')
    : input.group ?? '';

  return {
    id: input.id,
    englishText: input.englishText.trim(),
    translations: parseSlashSeparatedValues(translationsSource),
    translationLanguage: input.translationLanguage.trim(),
    groups: parseSlashSeparatedValues(groupsSource),
    textHint: trimToUndefined(input.textHint ?? ''),
    imageHint: input.imageHint,
    createdAt: input.createdAt,
    reviewCount: input.reviewCount,
    correctCount: input.correctCount,
    consecutiveCorrect: input.consecutiveCorrect,
    lastSeenAt: input.lastSeenAt,
    lastResult: input.lastResult,
    snoozedUntilDate: input.snoozedUntilDate,
    knownAt: input.knownAt,
  };
}

function normalizeWordDraft(draft: WordDraft): {
  englishText: string;
  translations: string[];
  translationLanguage: string;
  groups: string[];
  textHint?: string;
  imageHint?: WordEntry['imageHint'];
} {
  const englishText = draft.englishText.trim();
  const translationLanguage = draft.translationLanguage.trim();
  const translations = parseSlashSeparatedValues(draft.translationText);
  const groups = parseSlashSeparatedValues(draft.group ?? '');
  const textHint = trimToUndefined(draft.textHint ?? '');

  if (!englishText) {
    throw new Error(tRuntime('dbNeedEnglishWord'));
  }

  if (!translationLanguage) {
    throw new Error(tRuntime('dbNeedTranslationLanguage'));
  }

  if (translations.length === 0) {
    throw new Error(tRuntime('dbNeedTranslation'));
  }

  return {
    englishText,
    translations,
    translationLanguage,
    groups,
    textHint,
    imageHint: draft.imageHint,
  };
}

function normalizeWordForSave(word: WordEntry): WordEntry {
  const normalized = normalizeWordRecord(word as LegacyWordRecord);

  if (!normalized.englishText) {
    throw new Error(tRuntime('dbNeedEnglishWord'));
  }

  if (!normalized.translationLanguage) {
    throw new Error(tRuntime('dbNeedTranslationLanguage'));
  }

  if (normalized.translations.length === 0) {
    throw new Error(tRuntime('dbNeedTranslation'));
  }

  return normalized;
}

function buildCreatedWord(
  draft: ReturnType<typeof normalizeWordDraft>,
  createdAt = new Date().toISOString(),
): WordEntry {
  return {
    id: createId(),
    englishText: draft.englishText,
    translations: draft.translations,
    translationLanguage: draft.translationLanguage,
    groups: draft.groups,
    textHint: draft.textHint,
    imageHint: draft.imageHint,
    createdAt,
    reviewCount: 0,
    correctCount: 0,
    consecutiveCorrect: 0,
  };
}

function buildMergedWord(
  existingWord: WordEntry,
  draft: ReturnType<typeof normalizeWordDraft>,
): WordMutationResult {
  const mergedTranslations = mergeUniqueValues(existingWord.translations, draft.translations);
  const mergedGroups = mergeUniqueValues(existingWord.groups, draft.groups);
  const addedTranslations = mergedTranslations.slice(existingWord.translations.length);
  const addedGroups = mergedGroups.slice(existingWord.groups.length);
  const filledFields: Array<'textHint' | 'imageHint'> = [];

  const textHint = existingWord.textHint || draft.textHint;
  if (!existingWord.textHint && draft.textHint) {
    filledFields.push('textHint');
  }

  const imageHint = existingWord.imageHint || draft.imageHint;
  if (!existingWord.imageHint && draft.imageHint) {
    filledFields.push('imageHint');
  }

  if (addedTranslations.length === 0 && addedGroups.length === 0 && filledFields.length === 0) {
    return {
      word: existingWord,
      change: 'noop',
      addedTranslations: [],
      addedGroups: [],
      filledFields: [],
    };
  }

  return {
    word: {
      ...existingWord,
      translations: mergedTranslations,
      groups: mergedGroups,
      textHint,
      imageHint,
    },
    change: 'merged',
    addedTranslations,
    addedGroups,
    filledFields,
  };
}

function buildDraftFromWord(word: WordEntry): ReturnType<typeof normalizeWordDraft> {
  return {
    englishText: word.englishText,
    translations: [...word.translations],
    translationLanguage: word.translationLanguage,
    groups: [...word.groups],
    textHint: word.textHint,
    imageHint: word.imageHint,
  };
}

function rebuildWordAggregates(
  word: WordEntry,
  attempts: ReviewAttempt[],
  masteryThreshold: number,
): WordEntry {
  const scoredAttempts = attempts
    .filter((attempt) => attempt.action !== 'dontShowToday')
    .sort((left, right) => new Date(left.shownAt).getTime() - new Date(right.shownAt).getTime());

  let reviewCount = 0;
  let correctCount = 0;
  let consecutiveCorrect = 0;
  let lastSeenAt: string | undefined;
  let lastResult: WordEntry['lastResult'];
  let knownAt: string | undefined;

  for (const attempt of scoredAttempts) {
    reviewCount += 1;
    lastSeenAt = attempt.shownAt;
    lastResult = attempt.wasCorrect ? 'correct' : 'incorrect';

    if (attempt.wasCorrect) {
      correctCount += 1;
      consecutiveCorrect += 1;

      if (consecutiveCorrect >= masteryThreshold) {
        knownAt = attempt.shownAt;
      }
    } else {
      consecutiveCorrect = 0;
      knownAt = undefined;
    }
  }

  return {
    ...word,
    reviewCount,
    correctCount,
    consecutiveCorrect,
    lastSeenAt,
    lastResult,
    knownAt,
  };
}

function updateSessionWordIds(
  session: ChatSession,
  remappedWordIds: Map<string, string>,
  removedWordIds: Set<string>,
): ChatSession | null {
  let changed = false;
  const seen = new Set<string>();
  const nextSelectedWordIds: string[] = [];

  for (const wordId of session.selectedWordIds) {
    const remappedId = remappedWordIds.get(wordId);

    if (removedWordIds.has(wordId) && !remappedId) {
      changed = true;
      continue;
    }

    const nextId = remappedId ?? wordId;

    if (nextId !== wordId) {
      changed = true;
    }

    if (seen.has(nextId)) {
      changed = true;
      continue;
    }

    seen.add(nextId);
    nextSelectedWordIds.push(nextId);
  }

  if (!changed) {
    return null;
  }

  return {
    ...session,
    selectedWordIds: nextSelectedWordIds,
    updatedAt: new Date().toISOString(),
  };
}

class EnglishCoachDatabase extends Dexie {
  words!: Table<WordEntry, string>;
  reviewAttempts!: Table<ReviewAttempt, string>;
  chatSessions!: Table<ChatSession, string>;
  aiUsageLogs!: Table<AiUsageLog, string>;
  statusTransitions!: Table<WordStatusTransition, string>;
  settings!: Table<AppSettings, 'app'>;

  constructor() {
    super('lexigarden-db');

    this.version(2).stores({
      words: 'id, createdAt, group, translationLanguage, reviewCount, lastSeenAt, snoozedUntilDate, knownAt',
      reviewAttempts: 'id, wordId, shownAt, wasCorrect, action',
      chatSessions: 'id, updatedAt, scope',
      aiUsageLogs: 'id, requestedAt, feature, success',
      statusTransitions: 'id, wordId, changedAt, fromStatus, toStatus',
      settings: 'id',
    });

    this.version(3)
      .stores({
        words: 'id, createdAt, *groups, translationLanguage, reviewCount, lastSeenAt, snoozedUntilDate, knownAt',
        reviewAttempts: 'id, wordId, shownAt, wasCorrect, action',
        chatSessions: 'id, updatedAt, scope',
        aiUsageLogs: 'id, requestedAt, feature, success',
        statusTransitions: 'id, wordId, changedAt, fromStatus, toStatus',
        settings: 'id',
      })
      .upgrade(async (tx) => {
        const legacyWords = (await tx.table('words').toArray()) as LegacyWordRecord[];

        await Promise.all(
          legacyWords.map((word) => tx.table('words').put(normalizeWordRecord(word))),
        );
      });

    this.version(4)
      .stores({
        words: 'id, createdAt, *groups, translationLanguage, reviewCount, lastSeenAt, snoozedUntilDate, knownAt',
        reviewAttempts: 'id, wordId, shownAt, wasCorrect, action',
        chatSessions: 'id, updatedAt, scope, translationLanguage',
        aiUsageLogs: 'id, requestedAt, feature, success',
        statusTransitions: 'id, wordId, changedAt, fromStatus, toStatus',
        settings: 'id',
      })
      .upgrade(async (tx) => {
        const [storedWords, storedSessions] = await Promise.all([
          tx.table('words').toArray() as Promise<LegacyWordRecord[]>,
          tx.table('chatSessions').toArray() as Promise<ChatSession[]>,
        ]);
        const normalizedWords = storedWords.map(normalizeWordRecord);
        const wordMap = new Map(normalizedWords.map((word) => [word.id, word]));

        await Promise.all([
          ...normalizedWords.map((word) => tx.table('words').put(word)),
          ...storedSessions.map((session) =>
            tx.table('chatSessions').put(normalizeChatSession(session, wordMap)),
          ),
        ]);
      });
  }
}

export const db = new EnglishCoachDatabase();

export async function ensureSettings(): Promise<AppSettings> {
  const existing = await db.settings.get('app');

  if (existing) {
    const normalized = normalizeSettings(existing as unknown as Record<string, unknown>);

    if (JSON.stringify(existing) !== JSON.stringify(normalized)) {
      await db.settings.put(normalized);
    }

    return normalized;
  }

  await db.settings.put(defaultSettings);
  return defaultSettings;
}

export async function getPersistedState(): Promise<PersistedState> {
  const settings = await ensureSettings();

  const [storedWords, reviewAttempts, storedChatSessions, aiUsageLogs, statusTransitions] =
    await Promise.all([
      db.words.orderBy('createdAt').reverse().toArray(),
      db.reviewAttempts.orderBy('shownAt').reverse().toArray(),
      db.chatSessions.orderBy('updatedAt').reverse().toArray(),
      db.aiUsageLogs.orderBy('requestedAt').reverse().toArray(),
      db.statusTransitions.orderBy('changedAt').reverse().toArray(),
    ]);
  const words = storedWords.map(normalizeWordRecord);
  const wordMap = new Map(words.map((word) => [word.id, word]));
  const chatSessions = storedChatSessions.map((session) => normalizeChatSession(session, wordMap));
  const reconciledTranslationLanguages = getAvailableTranslationLanguages(
    words,
    settings.translationLanguages,
  );
  const reconciledLanguageProfiles = reconcileLanguageProfiles(reconciledTranslationLanguages, settings);
  const reconciledSettingsBase =
    settings.activeTranslationLanguage ===
      resolveActiveTranslationLanguage(
        words,
        settings.activeTranslationLanguage,
        reconciledTranslationLanguages,
      ) &&
    JSON.stringify(settings.translationLanguages) === JSON.stringify(reconciledTranslationLanguages) &&
    JSON.stringify(settings.languageProfiles) === JSON.stringify(reconciledLanguageProfiles)
      ? settings
      : {
          ...settings,
          activeTranslationLanguage: resolveActiveTranslationLanguage(
            words,
            settings.activeTranslationLanguage,
            reconciledTranslationLanguages,
          ),
          translationLanguages: reconciledTranslationLanguages,
          languageProfiles: reconciledLanguageProfiles,
        };
  const reconciledSettings = synchronizeBaseLanguageFields(
    reconciledSettingsBase,
    reconciledSettingsBase.activeTranslationLanguage,
  );

  const settingsChanged = JSON.stringify(settings) !== JSON.stringify(reconciledSettings);
  const sessionsChanged = storedChatSessions.some(
    (session, index) => JSON.stringify(session) !== JSON.stringify(chatSessions[index]),
  );

  if (settingsChanged || sessionsChanged) {
    await db.transaction('rw', db.settings, db.chatSessions, async () => {
      await Promise.all([
        settingsChanged ? db.settings.put(reconciledSettings) : Promise.resolve(),
        sessionsChanged ? db.chatSessions.bulkPut(chatSessions) : Promise.resolve(),
      ]);
    });
  }

  return {
    words,
    reviewAttempts,
    chatSessions,
    aiUsageLogs,
    statusTransitions,
    settings: reconciledSettings,
  };
}

export async function createWord(draft: WordDraft): Promise<WordMutationResult> {
  const normalizedDraft = normalizeWordDraft(draft);

  return db.transaction('rw', db.words, async () => {
    const words = (await db.words.toArray()).map(normalizeWordRecord);
    const existingWord = findWordByIdentity(words, normalizedDraft);

    if (!existingWord) {
      const word = buildCreatedWord(normalizedDraft);
      await db.words.put(word);
      return {
        word,
        change: 'created',
        addedTranslations: [...word.translations],
        addedGroups: [...word.groups],
        filledFields: [
          ...(word.textHint ? (['textHint'] as Array<'textHint'>) : []),
          ...(word.imageHint ? (['imageHint'] as Array<'imageHint'>) : []),
        ],
      };
    }

    const mergeResult = buildMergedWord(existingWord, normalizedDraft);

    if (mergeResult.change !== 'noop') {
      await db.words.put(mergeResult.word);
    }

    return mergeResult;
  });
}

export async function createWords(drafts: WordDraft[]): Promise<ImportWordsResult> {
  const results: WordMutationResult[] = [];

  await db.transaction('rw', db.words, async () => {
    const existingWords = (await db.words.toArray()).map(normalizeWordRecord);
    const identityMap = new Map(existingWords.map((word) => [getWordIdentityKey(word), word]));
    const pendingWrites = new Map<string, WordEntry>();

    for (const draft of drafts) {
      const normalizedDraft = normalizeWordDraft(draft);
      const identityKey = getWordIdentityKey(normalizedDraft);
      const existingWord = identityMap.get(identityKey);

      if (!existingWord) {
        const word = buildCreatedWord(normalizedDraft);
        identityMap.set(identityKey, word);
        pendingWrites.set(word.id, word);
        results.push({
          word,
          change: 'created',
          addedTranslations: [...word.translations],
          addedGroups: [...word.groups],
          filledFields: [
            ...(word.textHint ? (['textHint'] as Array<'textHint'>) : []),
            ...(word.imageHint ? (['imageHint'] as Array<'imageHint'>) : []),
          ],
        });
        continue;
      }

      const mergeResult = buildMergedWord(existingWord, normalizedDraft);
      results.push(mergeResult);

      if (mergeResult.change !== 'noop') {
        identityMap.set(identityKey, mergeResult.word);
        pendingWrites.set(mergeResult.word.id, mergeResult.word);
      }
    }

    if (pendingWrites.size > 0) {
      await db.words.bulkPut([...pendingWrites.values()]);
    }
  });

  const createdCount = results.filter((result) => result.change === 'created').length;
  const mergedCount = results.filter((result) => result.change === 'merged').length;
  const noopCount = results.filter((result) => result.change === 'noop').length;

  return {
    results,
    createdCount,
    mergedCount,
    noopCount,
    words: results.map((result) => result.word),
  };
}

export async function updateWord(word: WordEntry): Promise<WordMutationResult> {
  const normalizedWord = normalizeWordForSave(word);

  return db.transaction('rw', db.words, async () => {
    const words = (await db.words.toArray()).map(normalizeWordRecord);
    const collision = findWordByIdentity(words, normalizedWord, normalizedWord.id);

    if (collision) {
      throw new Error(
        `${WORD_IDENTITY_CONFLICT_ERROR_PREFIX}: "${collision.englishText}" (${collision.translationLanguage}).`,
      );
    }

    const currentWord = words.find((item) => item.id === normalizedWord.id);

    if (!currentWord) {
      throw new Error(tRuntime('dbWordNotFound'));
    }

    const nextWord: WordEntry = {
      ...word,
      ...normalizedWord,
      textHint: normalizedWord.textHint,
      imageHint: normalizedWord.imageHint,
    };

    await db.words.put(nextWord);

    return {
      word: nextWord,
      change: 'updated',
      addedTranslations: nextWord.translations.filter(
        (value) =>
          !currentWord.translations.some(
            (existingValue) => normalizeForComparison(existingValue) === normalizeForComparison(value),
          ),
      ),
      addedGroups: nextWord.groups.filter(
        (value) =>
          !currentWord.groups.some(
            (existingValue) => normalizeForComparison(existingValue) === normalizeForComparison(value),
          ),
      ),
      filledFields: [
        ...(!currentWord.textHint && nextWord.textHint ? (['textHint'] as Array<'textHint'>) : []),
        ...(!currentWord.imageHint && nextWord.imageHint ? (['imageHint'] as Array<'imageHint'>) : []),
      ],
    };
  });
}

export async function deleteWord(wordId: string): Promise<void> {
  await db.transaction('rw', db.words, db.reviewAttempts, db.statusTransitions, db.chatSessions, async () => {
    await db.words.delete(wordId);
    await Promise.all([
      db.reviewAttempts.where('wordId').equals(wordId).delete(),
      db.statusTransitions.where('wordId').equals(wordId).delete(),
    ]);

    const sessions = await db.chatSessions.toArray();
    const removedWordIds = new Set([wordId]);
    const updatedSessions = sessions
      .map((session) => updateSessionWordIds(session, new Map(), removedWordIds))
      .filter((session): session is ChatSession => Boolean(session));

    if (updatedSessions.length > 0) {
      await db.chatSessions.bulkPut(updatedSessions);
    }
  });
}

export async function mergeMatchingWords(settings: AppSettings): Promise<MergeWordsResult> {
  return db.transaction(
    'rw',
    db.words,
    db.reviewAttempts,
    db.statusTransitions,
    db.chatSessions,
    async () => {
      const words = (await db.words.toArray())
        .map(normalizeWordRecord)
        .sort(
          (left, right) =>
            new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime(),
        );
      const reviewAttempts = await db.reviewAttempts.toArray();
      const statusTransitions = await db.statusTransitions.toArray();
      const chatSessions = await db.chatSessions.toArray();

      const groups = new Map<string, WordEntry[]>();

      for (const word of words) {
        const key = getWordIdentityKey(word);
        const current = groups.get(key) ?? [];
        current.push(word);
        groups.set(key, current);
      }

      const updatedWords: WordEntry[] = [];
      const updatedAttempts: ReviewAttempt[] = [];
      const updatedTransitions: WordStatusTransition[] = [];
      const removedWordIds = new Set<string>();
      const remappedWordIds = new Map<string, string>();
      let mergedWordCount = 0;

      for (const groupWords of groups.values()) {
        if (groupWords.length < 2) {
          continue;
        }

        const [primaryWord, ...duplicateWords] = groupWords;
        let mergedWord = { ...primaryWord };
        const masteryThreshold = getLanguageProfile(settings, primaryWord.translationLanguage).masteryThreshold;

        for (const duplicateWord of duplicateWords) {
          mergedWord = buildMergedWord(mergedWord, buildDraftFromWord(duplicateWord)).word;
          removedWordIds.add(duplicateWord.id);
          remappedWordIds.set(duplicateWord.id, primaryWord.id);
        }

        const candidateWordIds = new Set(groupWords.map((word) => word.id));
        const mergedAttempts = reviewAttempts
          .filter((attempt) => candidateWordIds.has(attempt.wordId))
          .map((attempt) => ({
            ...attempt,
            wordId: primaryWord.id,
          }));
        const mergedTransitions = statusTransitions
          .filter((transition) => candidateWordIds.has(transition.wordId))
          .map((transition) => ({
            ...transition,
            wordId: primaryWord.id,
          }));
        const snoozedUntilDate = groupWords
          .map((word) => word.snoozedUntilDate)
          .filter((value): value is string => Boolean(value))
          .sort()
          .at(-1);

        mergedWord = rebuildWordAggregates(
          {
            ...mergedWord,
            createdAt: groupWords
              .map((word) => word.createdAt)
              .sort()
              .at(0) ?? mergedWord.createdAt,
            snoozedUntilDate,
          },
          mergedAttempts,
          masteryThreshold,
        );

        updatedWords.push(mergedWord);
        updatedAttempts.push(
          ...mergedAttempts.filter((attempt) => candidateWordIds.has(attempt.wordId)),
        );
        updatedTransitions.push(
          ...mergedTransitions.filter((transition) => candidateWordIds.has(transition.wordId)),
        );
        mergedWordCount += 1;
      }

      if (removedWordIds.size === 0) {
        return {
          mergedWordCount: 0,
          removedWordCount: 0,
        };
      }

      const updatedSessions = chatSessions
        .map((session) => updateSessionWordIds(session, remappedWordIds, removedWordIds))
        .filter((session): session is ChatSession => Boolean(session));

      await Promise.all([
        db.words.bulkPut(updatedWords),
        db.words.bulkDelete([...removedWordIds]),
        updatedAttempts.length > 0 ? db.reviewAttempts.bulkPut(updatedAttempts) : Promise.resolve(),
        updatedTransitions.length > 0 ? db.statusTransitions.bulkPut(updatedTransitions) : Promise.resolve(),
        updatedSessions.length > 0 ? db.chatSessions.bulkPut(updatedSessions) : Promise.resolve(),
      ]);

      return {
        mergedWordCount,
        removedWordCount: removedWordIds.size,
      };
    },
  );
}

export async function deleteWordsByScope(scope: WordDeleteScope): Promise<DeleteWordsResult> {
  return db.transaction(
    'rw',
    db.words,
    db.reviewAttempts,
    db.statusTransitions,
    db.chatSessions,
    async () => {
      const words = (await db.words.toArray()).map(normalizeWordRecord);
      const normalizedValue = 'value' in scope ? normalizeForComparison(scope.value) : '';
      const matchingWords = words.filter((word) => {
        if (scope.mode === 'all') {
          return true;
        }

        if (scope.mode === 'group') {
          return word.groups.some(
            (group) => normalizeForComparison(group) === normalizedValue,
          );
        }

        return normalizeForComparison(word.translationLanguage) === normalizedValue;
      });

      if (matchingWords.length === 0) {
        return { deletedCount: 0 };
      }

      const wordIds = matchingWords.map((word) => word.id);
      const removedWordIds = new Set(wordIds);
      const sessions = await db.chatSessions.toArray();
      const updatedSessions = sessions
        .map((session) => updateSessionWordIds(session, new Map(), removedWordIds))
        .filter((session): session is ChatSession => Boolean(session));

      await Promise.all([
        db.words.bulkDelete(wordIds),
        db.reviewAttempts.where('wordId').anyOf(wordIds).delete(),
        db.statusTransitions.where('wordId').anyOf(wordIds).delete(),
        updatedSessions.length > 0 ? db.chatSessions.bulkPut(updatedSessions) : Promise.resolve(),
      ]);

      return {
        deletedCount: wordIds.length,
      };
    },
  );
}

export async function deleteTranslationLanguage(language: string): Promise<DeleteLanguageResult> {
  const normalizedLanguage = normalizeForComparison(language);

  return db.transaction(
    'rw',
    [db.words, db.reviewAttempts, db.statusTransitions, db.chatSessions, db.settings],
    async () => {
      const [storedWords, storedSessions, currentSettings] = await Promise.all([
        db.words.toArray(),
        db.chatSessions.toArray(),
        ensureSettings(),
      ]);
      const words = storedWords.map(normalizeWordRecord);
      const matchingWords = words.filter(
        (word) => normalizeForComparison(word.translationLanguage) === normalizedLanguage,
      );

      const wordIds = matchingWords.map((word) => word.id);
      const removedWordIds = new Set(wordIds);
      const deletedChatSessions = storedSessions.filter(
        (session) =>
          normalizeForComparison(session.translationLanguage ?? '') === normalizedLanguage,
      );
      const remainingSessions = storedSessions.filter(
        (session) =>
          normalizeForComparison(session.translationLanguage ?? '') !== normalizedLanguage,
      );
      const updatedSessions = remainingSessions
        .map((session) => updateSessionWordIds(session, new Map(), removedWordIds))
        .filter((session): session is ChatSession => Boolean(session));
      const remainingWords = words.filter(
        (word) => normalizeForComparison(word.translationLanguage) !== normalizedLanguage,
      );
      const remainingLanguages = currentSettings.translationLanguages.filter(
        (item) => normalizeForComparison(item) !== normalizedLanguage,
      );
      const availableRemainingLanguages = getAvailableTranslationLanguages(
        remainingWords,
        remainingLanguages,
      );
      const nextSettings = normalizeSettings({
        ...currentSettings,
        translationLanguages: availableRemainingLanguages,
        languageProfiles: Object.fromEntries(
          Object.entries(currentSettings.languageProfiles).filter(
            ([key]) => normalizeForComparison(key) !== normalizedLanguage,
          ),
        ),
        activeTranslationLanguage: resolveActiveTranslationLanguage(
          remainingWords,
          currentSettings.activeTranslationLanguage,
          availableRemainingLanguages,
        ),
      } as unknown as Record<string, unknown>);

      await Promise.all([
        wordIds.length > 0 ? db.words.bulkDelete(wordIds) : Promise.resolve(),
        wordIds.length > 0 ? db.reviewAttempts.where('wordId').anyOf(wordIds).delete() : Promise.resolve(),
        wordIds.length > 0 ? db.statusTransitions.where('wordId').anyOf(wordIds).delete() : Promise.resolve(),
        deletedChatSessions.length > 0
          ? db.chatSessions.bulkDelete(deletedChatSessions.map((session) => session.id))
          : Promise.resolve(),
        updatedSessions.length > 0 ? db.chatSessions.bulkPut(updatedSessions) : Promise.resolve(),
        db.settings.put(nextSettings),
      ]);

      return {
        deletedWordCount: wordIds.length,
        deletedChatCount: deletedChatSessions.length,
      };
    },
  );
}

interface RecordAttemptInput {
  wordId: string;
  promptSide: PromptSide;
  userAnswer: string;
  wasCorrect: boolean;
  usedHint: boolean;
  action: Extract<ReviewAction, 'check' | 'dontKnow'>;
  masteryThreshold: number;
}

export async function recordReviewAttempt(input: RecordAttemptInput): Promise<WordEntry> {
  const word = await db.words.get(input.wordId);

  if (!word) {
    throw new Error(tRuntime('dbWordNotFound'));
  }

  const shownAt = new Date().toISOString();
  const normalizedAnswer = normalizeForComparison(input.userAnswer);
  const previousStatus = getWordStatus(word, input.masteryThreshold);
  const nextConsecutiveCorrect = input.wasCorrect ? word.consecutiveCorrect + 1 : 0;

  const updatedWord: WordEntry = {
    ...word,
    reviewCount: word.reviewCount + 1,
    correctCount: word.correctCount + (input.wasCorrect ? 1 : 0),
    consecutiveCorrect: nextConsecutiveCorrect,
    lastSeenAt: shownAt,
    lastResult: input.wasCorrect ? 'correct' : 'incorrect',
    knownAt: nextConsecutiveCorrect >= input.masteryThreshold ? shownAt : undefined,
  };

  const nextStatus = getWordStatus(updatedWord, input.masteryThreshold);

  const attempt: ReviewAttempt = {
    id: createId(),
    wordId: input.wordId,
    shownAt,
    promptSide: input.promptSide,
    userAnswer: input.userAnswer,
    normalizedAnswer,
    wasCorrect: input.wasCorrect,
    usedHint: input.usedHint,
    action: input.action,
  };

  const transition: WordStatusTransition | undefined =
    previousStatus === nextStatus
      ? undefined
      : {
          id: createId(),
          wordId: input.wordId,
          changedAt: shownAt,
          fromStatus: previousStatus,
          toStatus: nextStatus,
          masteryThreshold: input.masteryThreshold,
        };

  await db.transaction('rw', db.words, db.reviewAttempts, db.statusTransitions, async () => {
    await db.words.put(updatedWord);
    await Promise.all([
      db.reviewAttempts.put(attempt),
      transition ? db.statusTransitions.put(transition) : Promise.resolve(),
    ]);
  });

  return updatedWord;
}

export async function snoozeWordForToday(wordId: string, promptSide: PromptSide): Promise<void> {
  const word = await db.words.get(wordId);

  if (!word) {
    throw new Error(tRuntime('dbWordNotFound'));
  }

  await db.transaction('rw', db.words, db.reviewAttempts, async () => {
    await db.words.put({
      ...word,
      snoozedUntilDate: getTodayDateKey(),
    });

    await db.reviewAttempts.put({
      id: createId(),
      wordId,
      shownAt: new Date().toISOString(),
      promptSide,
      userAnswer: '',
      normalizedAnswer: '',
      wasCorrect: false,
      usedHint: false,
      action: 'dontShowToday',
    });
  });
}

export async function saveSettings(settings: AppSettings): Promise<AppSettings> {
  const words = (await db.words.toArray()).map(normalizeWordRecord);
  const translationLanguages = getAvailableTranslationLanguages(words, settings.translationLanguages);
  const activeTranslationLanguage = resolveActiveTranslationLanguage(
    words,
    settings.activeTranslationLanguage,
    translationLanguages,
  );
  const synchronizedSettings = synchronizeBaseLanguageFields(
    {
      ...settings,
      translationLanguages,
      activeTranslationLanguage,
      languageProfiles: reconcileLanguageProfiles(translationLanguages, settings),
    },
    activeTranslationLanguage,
  );
  const normalized = normalizeSettings({
    ...synchronizedSettings,
  } as unknown as Record<string, unknown>);
  await db.settings.put(normalized);
  return normalized;
}

export async function upsertChatSession(session: ChatSession): Promise<ChatSession> {
  await db.chatSessions.put(session);
  return session;
}

export async function deleteChatSession(sessionId: string): Promise<void> {
  await db.chatSessions.delete(sessionId);
}

export async function createChatSession(
  scope: ChatSession['scope'],
  selectedWordIds: string[],
  label?: string,
  tutorPrompt?: string,
  translationLanguage?: string,
) {
  const now = new Date().toISOString();
  const session: ChatSession = {
    id: createId(),
    scope,
    selectedWordIds,
    translationLanguage: trimToUndefined(translationLanguage ?? ''),
    label,
    tutorPrompt,
    messages: [
      {
        id: createId(),
        role: 'assistant',
        content: tRuntime('dbStarterTutorMessage'),
        createdAt: now,
      },
    ],
    createdAt: now,
    updatedAt: now,
  };

  await db.chatSessions.put(session);
  return session;
}

export async function logAiUsage(entry: Omit<AiUsageLog, 'id' | 'requestedAt'>): Promise<AiUsageLog> {
  const log: AiUsageLog = {
    id: createId(),
    requestedAt: new Date().toISOString(),
    ...entry,
  };

  await db.aiUsageLogs.put(log);
  return log;
}

export async function clearAiUsageLogs(): Promise<void> {
  await db.aiUsageLogs.clear();
}

export async function exportBackup(includeApiKey = false): Promise<BackupPayload> {
  const state = await getPersistedState();
  const settings = includeApiKey
    ? state.settings
    : {
        ...state.settings,
        openRouterApiKey: undefined,
      };

  return {
    version: 7,
    exportedAt: new Date().toISOString(),
    words: state.words,
    reviewAttempts: state.reviewAttempts,
    chatSessions: state.chatSessions,
    aiUsageLogs: state.aiUsageLogs,
    statusTransitions: state.statusTransitions,
    settings,
  };
}

export async function importBackup(payload: BackupPayload | LegacyBackupPayload): Promise<void> {
  const currentSettings = await ensureSettings();
  const statusTransitions = payload.version === 1 ? [] : payload.statusTransitions ?? [];
  const normalizedWords = payload.words.map(normalizeWordRecord);
  const normalizedWordMap = new Map(normalizedWords.map((word) => [word.id, word]));
  const normalizedChatSessions = payload.chatSessions.map((session) =>
    normalizeChatSession(session, normalizedWordMap),
  );
  const importedSettings = normalizeSettings(payload.settings as unknown as Record<string, unknown>);
  const availableTranslationLanguages = getAvailableTranslationLanguages(
    normalizedWords,
    importedSettings.translationLanguages,
  );
  const resolvedImportedActiveTranslationLanguage = resolveActiveTranslationLanguage(
    normalizedWords,
    importedSettings.activeTranslationLanguage,
    availableTranslationLanguages,
  );
  const reconciledSettings = synchronizeBaseLanguageFields({
    ...importedSettings,
    activeTranslationLanguage: resolvedImportedActiveTranslationLanguage,
    translationLanguages: availableTranslationLanguages,
    languageProfiles: reconcileLanguageProfiles(availableTranslationLanguages, importedSettings),
    openRouterApiKey: payload.settings.openRouterApiKey ?? currentSettings.openRouterApiKey,
  }, resolvedImportedActiveTranslationLanguage);

  await db.transaction(
    'rw',
    [db.words, db.reviewAttempts, db.chatSessions, db.aiUsageLogs, db.statusTransitions, db.settings],
    async () => {
      await Promise.all([
        db.words.clear(),
        db.reviewAttempts.clear(),
        db.chatSessions.clear(),
        db.aiUsageLogs.clear(),
        db.statusTransitions.clear(),
      ]);

      await db.words.bulkPut(normalizedWords);
      await db.reviewAttempts.bulkPut(payload.reviewAttempts);
      await db.chatSessions.bulkPut(normalizedChatSessions);
      await db.aiUsageLogs.bulkPut(payload.aiUsageLogs);
      await db.statusTransitions.bulkPut(statusTransitions);
      await db.settings.put(reconciledSettings);
    },
  );
}

export async function clearAllData(): Promise<void> {
  await db.transaction(
    'rw',
    [db.words, db.reviewAttempts, db.chatSessions, db.aiUsageLogs, db.statusTransitions, db.settings],
    async () => {
      await Promise.all([
        db.words.clear(),
        db.reviewAttempts.clear(),
        db.chatSessions.clear(),
        db.aiUsageLogs.clear(),
        db.statusTransitions.clear(),
      ]);

      await db.settings.put(defaultSettings);
    },
  );
}

export function buildAiUsageLogEntry(
  feature: AiFeature,
  model: string,
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  },
  success = true,
  errorCode?: string,
): Omit<AiUsageLog, 'id' | 'requestedAt'> {
  return {
    feature,
    model,
    promptTokens: usage?.prompt_tokens ?? 0,
    completionTokens: usage?.completion_tokens ?? 0,
    totalTokens: usage?.total_tokens ?? 0,
    success,
    errorCode,
  };
}
