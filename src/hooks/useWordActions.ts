import {
  createWord,
  createWords,
  deleteWord,
  deleteWordsByScope,
  mergeMatchingWords,
  recordReviewAttempt,
  snoozeWordForToday,
  updateWord,
  type DeleteWordsResult,
  type MergeWordsResult,
  type WordDeleteScope,
  type WordDraft,
} from '../db';
import { getLanguageProfile } from '../lib/language-settings';
import { isWordIdentityConflictError } from '../lib/text';
import { describeImportResult, describeWordMutation } from '../lib/word-messages';
import type { createTranslator } from '../lib/i18n';
import type { AppSettings, PersistedState, WordEntry } from '../types';
import type { FlashMessage } from './useAppState';

interface UseWordActionsProps {
  settings: AppSettings | null;
  words: WordEntry[];
  currentActiveTranslationLanguage: string;
  refreshState: (keys?: Array<keyof PersistedState>) => Promise<void>;
  setFlashMessage: (message: FlashMessage) => void;
  t: ReturnType<typeof createTranslator>;
}

export function useWordActions({
  settings,
  words,
  currentActiveTranslationLanguage,
  refreshState,
  setFlashMessage,
  t,
}: UseWordActionsProps) {
  async function handleCreateWord(draft: WordDraft) {
    try {
      const result = await createWord(draft);
      await refreshState(['words', 'settings']);
      setFlashMessage({
        kind: 'success',
        text: describeWordMutation(result, {
          activeTranslationLanguage: currentActiveTranslationLanguage,
        }),
      });
      return result;
    } catch (error) {
      setFlashMessage({
        kind: 'error',
        text: isWordIdentityConflictError(error)
          ? t('wordIdentityConflict')
          : error instanceof Error
            ? error.message
            : t('appLoadFailed'),
      });
      throw error;
    }
  }

  async function handleImportWords(drafts: WordDraft[]) {
    const result = await createWords(drafts);
    await refreshState(['words', 'settings']);
    setFlashMessage({
      kind: 'success',
      text: describeImportResult(result),
    });
    return result;
  }

  async function handleUpdateWord(nextWord: WordEntry) {
    try {
      const result = await updateWord(nextWord);
      await refreshState(['words', 'settings']);
      setFlashMessage({
        kind: 'success',
        text: describeWordMutation(result, {
          activeTranslationLanguage: currentActiveTranslationLanguage,
        }),
      });
      return result;
    } catch (error) {
      setFlashMessage({
        kind: 'error',
        text: isWordIdentityConflictError(error)
          ? t('wordIdentityConflict')
          : error instanceof Error
            ? error.message
            : t('commonTryAgain'),
      });
      throw error;
    }
  }

  async function handleDeleteWord(wordId: string) {
    const word = words.find((item) => item.id === wordId);
    await deleteWord(wordId);
    await refreshState(['words', 'settings', 'chatSessions', 'reviewAttempts', 'statusTransitions']);
    setFlashMessage({
      kind: 'success',
      text: word ? t('appWordDeleted', { word: word.englishText }) : t('appWordDeletedGeneric'),
    });
  }

  async function handleMergeWords(): Promise<MergeWordsResult> {
    if (!settings) {
      throw new Error(t('appSettingsNotReady'));
    }

    const result = await mergeMatchingWords(settings);
    await refreshState(['words', 'settings', 'chatSessions', 'reviewAttempts', 'statusTransitions']);
    setFlashMessage({
      kind: 'success',
      text:
        result.removedWordCount > 0
          ? t('appMergedWords', {
              merged: result.mergedWordCount,
              removed: result.removedWordCount,
            })
          : t('appNoMergeNeeded'),
    });
    return result;
  }

  async function handleDeleteWords(scope: WordDeleteScope): Promise<DeleteWordsResult> {
    const result = await deleteWordsByScope(scope);
    await refreshState(['words', 'settings', 'chatSessions', 'reviewAttempts', 'statusTransitions']);
    setFlashMessage({
      kind: 'success',
      text:
        result.deletedCount > 0
          ? t('appDeletedWords', { count: result.deletedCount })
          : t('appNoWordsDeleted'),
    });
    return result;
  }

  async function handleRecordReview(params: {
    wordId: string;
    promptSide: 'english' | 'translation';
    userAnswer: string;
    wasCorrect: boolean;
    usedHint: boolean;
    action: 'check' | 'dontKnow';
  }) {
    if (!settings) {
      return;
    }

    const activeLanguageProfile = getLanguageProfile(settings, currentActiveTranslationLanguage);
    await recordReviewAttempt({
      ...params,
      masteryThreshold: activeLanguageProfile.masteryThreshold,
    });
    await refreshState(['words', 'reviewAttempts', 'statusTransitions']);
  }

  async function handleSnoozeWord(wordId: string, promptSide: 'english' | 'translation') {
    await snoozeWordForToday(wordId, promptSide);
    await refreshState(['words', 'reviewAttempts']);
  }

  return {
    actions: {
      handleCreateWord,
      handleImportWords,
      handleUpdateWord,
      handleDeleteWord,
      handleMergeWords,
      handleDeleteWords,
      handleRecordReview,
      handleSnoozeWord,
    },
  };
}
