import { useState } from 'react';
import {
  generateSentenceHint,
  prepareWordFromSelection,
  suggestNextWords,
  suggestRelatedWords,
  testOpenRouterConnection,
} from '../ai';
import { buildAiUsageLogEntry, logAiUsage } from '../db';
import { getLanguageProfile } from '../lib/language-settings';
import { filterWordsByTranslationLanguage } from '../lib/study';
import type { createTranslator } from '../lib/i18n';
import type { AiSuggestion, AppSettings, PersistedState, WordEntry } from '../types';
import type { FlashMessage } from './useAppState';

interface UseAiActionsProps {
  settings: AppSettings | null;
  words: WordEntry[];
  refreshState: (keys?: Array<keyof PersistedState>) => Promise<void>;
  setFlashMessage: (message: FlashMessage) => void;
  t: ReturnType<typeof createTranslator>;
}

export function useAiActions({ settings, words, refreshState, setFlashMessage, t }: UseAiActionsProps) {
  const [aiBusyFeature, setAiBusyFeature] = useState<string>('');
  const [sentenceHints, setSentenceHints] = useState<Record<string, string>>({});

  async function handleTestConnection(nextSettings: AppSettings) {
    setAiBusyFeature('testConnection');

    try {
      const response = await testOpenRouterConnection(nextSettings);
      await logAiUsage(buildAiUsageLogEntry('chat', response.model, response.usage, true));
      await refreshState(['aiUsageLogs']);
      setFlashMessage({
        kind: 'success',
        text:
          response.model === nextSettings.openRouterModel
            ? t('appConnectionWorked', { content: response.content })
            : t('appConnectionWorkedWithModel', {
                model: response.model,
                content: response.content,
              }),
      });
    } catch (error) {
      await logAiUsage(
        buildAiUsageLogEntry(
          'chat',
          nextSettings.openRouterModel,
          undefined,
          false,
          error instanceof Error ? error.message : t('aiLogConnectionFailed'),
        ),
      );
      await refreshState(['aiUsageLogs']);
      setFlashMessage({
        kind: 'error',
        text: error instanceof Error ? error.message : t('appCouldNotReachOpenRouter'),
      });
    } finally {
      setAiBusyFeature('');
    }
  }

  async function handleGenerateSentence(word: WordEntry) {
    if (!settings) {
      return '';
    }

    setAiBusyFeature(`sentence:${word.id}`);

    try {
      const response = await generateSentenceHint(
        {
          ...settings,
          ...getLanguageProfile(settings, word.translationLanguage),
        },
        word,
      );
      setSentenceHints((current) => ({
        ...current,
        [word.id]: response.sentence,
      }));
      await logAiUsage(buildAiUsageLogEntry('sentenceHint', response.model, response.usage, true));
      await refreshState(['aiUsageLogs']);
      return response.sentence;
    } catch (error) {
      await logAiUsage(
        buildAiUsageLogEntry(
          'sentenceHint',
          settings.openRouterModel,
          undefined,
          false,
          error instanceof Error ? error.message : t('aiLogSentenceFailed'),
        ),
      );
      await refreshState(['aiUsageLogs']);
      throw error;
    } finally {
      setAiBusyFeature('');
    }
  }

  async function handleSuggestRelatedWords(word: WordEntry): Promise<AiSuggestion[]> {
    if (!settings) {
      return [];
    }

    setAiBusyFeature(`related:${word.id}`);

    try {
      const response = await suggestRelatedWords(
        {
          ...settings,
          ...getLanguageProfile(settings, word.translationLanguage),
        },
        word,
      );
      await logAiUsage(buildAiUsageLogEntry('relatedWords', response.model, response.usage, true));
      await refreshState(['aiUsageLogs']);
      return response.suggestions;
    } catch (error) {
      await logAiUsage(
        buildAiUsageLogEntry(
          'relatedWords',
          settings.openRouterModel,
          undefined,
          false,
          error instanceof Error ? error.message : t('aiLogRelatedFailed'),
        ),
      );
      await refreshState(['aiUsageLogs']);
      throw error;
    } finally {
      setAiBusyFeature('');
    }
  }

  async function handleSuggestNextWords(context: {
    translationLanguage: string;
    group?: string;
    englishText?: string;
    translationText?: string;
    textHint?: string;
  }): Promise<AiSuggestion[]> {
    if (!settings) {
      return [];
    }

    setAiBusyFeature('nextWords');

    try {
      const profile = getLanguageProfile(settings, context.translationLanguage);
      const response = await suggestNextWords(settings, {
        ...context,
        recentWords: filterWordsByTranslationLanguage(words, context.translationLanguage),
        masteryThreshold: profile.masteryThreshold,
      });
      await logAiUsage(buildAiUsageLogEntry('nextWords', response.model, response.usage, true));
      await refreshState(['aiUsageLogs']);
      return response.suggestions;
    } catch (error) {
      await logAiUsage(
        buildAiUsageLogEntry(
          'nextWords',
          settings.openRouterModel,
          undefined,
          false,
          error instanceof Error ? error.message : t('aiLogNextFailed'),
        ),
      );
      await refreshState(['aiUsageLogs']);
      throw error;
    } finally {
      setAiBusyFeature('');
    }
  }

  async function handlePrepareSelection(
    selectedText: string,
    context: string,
    translationLanguage: string,
  ) {
    if (!settings) {
      throw new Error(t('appAiSettingsNotReady'));
    }

    setAiBusyFeature('addFromSelection');

    try {
      const response = await prepareWordFromSelection(settings, selectedText, translationLanguage, context);
      await logAiUsage(buildAiUsageLogEntry('addFromSelection', response.model, response.usage, true));
      await refreshState(['aiUsageLogs']);
      return response.suggestion;
    } catch (error) {
      await logAiUsage(
        buildAiUsageLogEntry(
          'addFromSelection',
          settings.openRouterModel,
          undefined,
          false,
          error instanceof Error ? error.message : t('aiLogPrepareFailed'),
        ),
      );
      await refreshState(['aiUsageLogs']);
      throw error;
    } finally {
      setAiBusyFeature('');
    }
  }

  return {
    state: {
      aiBusyFeature,
      sentenceHints,
    },
    setters: {
      setAiBusyFeature,
    },
    actions: {
      handleTestConnection,
      handleGenerateSentence,
      handleSuggestRelatedWords,
      handleSuggestNextWords,
      handlePrepareSelection,
    },
  };
}
