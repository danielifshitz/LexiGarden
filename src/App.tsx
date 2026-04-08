import {
  Suspense,
  lazy,
  startTransition,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import {
  continueVocabularyChat,
  fetchOpenRouterModels,
  generateSentenceHint,
  prepareWordFromSelection,
  suggestNextWords,
  suggestRelatedWords,
  testOpenRouterConnection,
} from './ai';
import {
  buildAiUsageLogEntry,
  clearAiUsageLogs,
  createChatSession,
  createWord,
  createWords,
  deleteTranslationLanguage,
  deleteWordsByScope,
  deleteChatSession,
  deleteWord,
  exportBackup,
  getPersistedState,
  importBackup,
  logAiUsage,
  mergeMatchingWords,
  recordReviewAttempt,
  saveMarathonRun,
  saveSettings,
  snoozeWordForToday,
  updateWord,
  upsertChatSession,
  type DeleteWordsResult,
  type DeleteLanguageResult,
  type MergeWordsResult,
  type WordDeleteScope,
  type WordDraft,
} from './db';
import { ChatPanel } from './components/ChatPanel';
import { MarathonPanel } from './components/MarathonPanel';
import { SettingsPanel } from './components/SettingsPanel';
import { StudyPanel } from './components/StudyPanel';
import { VocabularyPanel } from './components/VocabularyPanel';
import {
  createTranslator,
  getLanguageMeta,
  resolveInitialAppLanguage,
  setRuntimeAppLanguage,
} from './lib/i18n';
import {
  deriveModelCapabilities,
  downloadTextFile,
  isWordIdentityConflictError,
} from './lib/text';
import { getLanguageProfile } from './lib/language-settings';
import { describeImportResult, describeWordMutation } from './lib/word-messages';
import {
  filterWordsByTranslationLanguage,
  getAvailableTranslationLanguages,
  getPrimaryTranslationLanguage,
  getSelectionLabel,
  resolveActiveTranslationLanguage,
  selectWordsByMode,
} from './lib/study';
import type {
  AiSuggestion,
  AppSettings,
  ChatMessage,
  ChatSession,
  OpenRouterModel,
  PersistedState,
  ReviewAttempt,
  Screen,
  StudySelection,
  WordEntry,
  WordStatusTransition,
  MarathonRun,
  MarathonAnswer,
} from './types';

const ProgressPanel = lazy(async () => {
  const module = await import('./components/ProgressPanel');
  return { default: module.ProgressPanel };
});

const fontFamilyOptions: Record<string, string> = {
  sans: '"Avenir Next", "Segoe UI", "Trebuchet MS", sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  rounded: '"Arial Rounded MT Bold", "Trebuchet MS", "Avenir Next", sans-serif',
  mono: '"SFMono-Regular", "Consolas", monospace',
};

type FlashMessage =
  | {
      kind: 'success' | 'error';
      text: string;
    }
  | undefined;

export default function App() {
  const [screen, setScreen] = useState<Screen>('study');
  const [loading, setLoading] = useState(true);
  const [words, setWords] = useState<WordEntry[]>([]);
  const [reviewAttempts, setReviewAttempts] = useState<ReviewAttempt[]>([]);
  const [chatSessions, setChatSessions] = useState<ChatSession[]>([]);
  const [aiUsageLogs, setAiUsageLogs] = useState<PersistedState['aiUsageLogs']>([]);
  const [statusTransitions, setStatusTransitions] = useState<WordStatusTransition[]>([]);
  const [marathonRuns, setMarathonRuns] = useState<MarathonRun[]>([]);
  const [marathonAnswers, setMarathonAnswers] = useState<MarathonAnswer[]>([]);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [models, setModels] = useState<OpenRouterModel[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState('');
  const [flashMessage, setFlashMessage] = useState<FlashMessage>();
  const [sentenceHints, setSentenceHints] = useState<Record<string, string>>({});
  const [aiBusyFeature, setAiBusyFeature] = useState<string>('');
  const [activeChatSessionId, setActiveChatSessionId] = useState<string | null>(null);
  const pendingAppLanguage = settings?.appLanguage ?? resolveInitialAppLanguage();
  const pendingAppLanguageMeta = getLanguageMeta(pendingAppLanguage);
  const t = createTranslator(pendingAppLanguage);
  const currentActiveTranslationLanguage = settings
    ? resolveActiveTranslationLanguage(
        words,
        settings.activeTranslationLanguage,
        settings.translationLanguages,
      )
    : '';
  const availableTranslationLanguages = settings
    ? getAvailableTranslationLanguages(words, settings.translationLanguages)
    : [];
  const chatRequestRef = useRef<{
    controller: AbortController;
    sessionId: string;
    rollbackSession: ChatSession;
  } | null>(null);

  async function refreshState() {
    const nextState = await getPersistedState();

    startTransition(() => {
      setWords(nextState.words);
      setReviewAttempts(nextState.reviewAttempts);
      setChatSessions(nextState.chatSessions);
      setAiUsageLogs(nextState.aiUsageLogs);
      setStatusTransitions(nextState.statusTransitions);
      setMarathonRuns(nextState.marathonRuns);
      setMarathonAnswers(nextState.marathonAnswers);
      setSettings(nextState.settings);

      if (nextState.chatSessions.length === 0) {
        setActiveChatSessionId(null);
      } else if (
        !activeChatSessionId ||
        !nextState.chatSessions.some((session) => session.id === activeChatSessionId)
      ) {
        setActiveChatSessionId(nextState.chatSessions[0].id);
      }
    });
  }

  useEffect(() => {
    setRuntimeAppLanguage(pendingAppLanguage);
    const languageMeta = getLanguageMeta(pendingAppLanguage);
    document.documentElement.lang = languageMeta.locale;
    document.documentElement.dir = languageMeta.dir;
  }, [pendingAppLanguage]);

  useEffect(() => {
    void (async () => {
      try {
        await refreshState();
      } catch (error) {
        setFlashMessage({
          kind: 'error',
          text: error instanceof Error ? error.message : t('appLoadFailed'),
        });
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!flashMessage) {
      return undefined;
    }

    const timeout = window.setTimeout(() => {
      setFlashMessage(undefined);
    }, 4200);

    return () => window.clearTimeout(timeout);
  }, [flashMessage]);

  useEffect(() => {
    if (!settings?.openRouterApiKey.trim() || models.length > 0 || modelsLoading) {
      return;
    }

    void handleLoadModels(false);
  }, [settings?.openRouterApiKey]);

  useEffect(() => {
    if (settings?.openRouterApiKey.trim()) {
      setModelsError('');
    }
  }, [settings?.openRouterApiKey, settings?.openRouterModel]);

  async function handleLoadModels(showSuccessMessage = true, apiKeyOverride?: string) {
    if (!settings) {
      return;
    }

    setModelsLoading(true);
    setModelsError('');

    try {
      const nextModels = await fetchOpenRouterModels(apiKeyOverride ?? settings.openRouterApiKey);
      setModels(nextModels);

      if (showSuccessMessage) {
        setFlashMessage({
          kind: 'success',
          text: t('appLoadedModels', { count: nextModels.length }),
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : t('appCouldNotLoadModels');
      setModelsError(message);
      setFlashMessage({
        kind: 'error',
        text: message,
      });
    } finally {
      setModelsLoading(false);
    }
  }

  async function handleCreateWord(draft: WordDraft) {
    try {
      const result = await createWord(draft);
      await refreshState();
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
    await refreshState();
    setFlashMessage({
      kind: 'success',
      text: describeImportResult(result),
    });
    return result;
  }

  async function handleUpdateWord(nextWord: WordEntry) {
    try {
      const result = await updateWord(nextWord);
      await refreshState();
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
    await refreshState();
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
    await refreshState();
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
    await refreshState();
    setFlashMessage({
      kind: 'success',
      text:
        result.deletedCount > 0
          ? t('appDeletedWords', { count: result.deletedCount })
          : t('appNoWordsDeleted'),
    });
    return result;
  }

  async function handleDeleteLanguage(language: string): Promise<DeleteLanguageResult> {
    const result = await deleteTranslationLanguage(language);
    await refreshState();
    setFlashMessage({
      kind: 'success',
      text:
        result.deletedWordCount > 0 ||
        result.deletedChatCount > 0 ||
        result.deletedMarathonRunCount > 0
          ? t('appDeletedLanguageDetailed', {
              language,
              words: result.deletedWordCount,
              chats: result.deletedChatCount,
              runs: result.deletedMarathonRunCount,
            })
          : t('appDeletedLanguageSimple', { language }),
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
    await refreshState();
  }

  async function handleSnoozeWord(wordId: string, promptSide: 'english' | 'translation') {
    await snoozeWordForToday(wordId, promptSide);
    await refreshState();
  }

  async function handleSaveMarathonRun(run: MarathonRun, answers: MarathonAnswer[]) {
    await saveMarathonRun(run, answers);
    await refreshState();
  }

  async function handleSaveSettings(nextSettings: AppSettings) {
    const savedSettings = await saveSettings(nextSettings);
    setSettings(savedSettings);
    setModelsError('');
    setFlashMessage({
      kind: 'success',
      text: t('appSettingsSaved'),
    });
  }

  async function handleSetActiveTranslationLanguage(nextLanguage: string) {
    if (!settings) {
      return;
    }

    try {
      const savedSettings = await saveSettings({
        ...settings,
        activeTranslationLanguage: nextLanguage,
      });
      setSettings(savedSettings);
    } catch (error) {
      setFlashMessage({
        kind: 'error',
        text: error instanceof Error ? error.message : t('appCouldNotChangeLanguage'),
      });
    }
  }

  async function handleExportBackup() {
    const backup = await exportBackup(false);
    const timestamp = new Date().toISOString().replaceAll(':', '-');
    downloadTextFile(`lexigarden-backup-${timestamp}.json`, JSON.stringify(backup, null, 2));
    setFlashMessage({
      kind: 'success',
      text: t('appBackupDownloaded'),
    });
  }

  async function handleImportBackup(file: File) {
    const text = await file.text();
    const parsed = JSON.parse(text) as ReturnType<typeof JSON.parse>;
    await importBackup(parsed as Awaited<ReturnType<typeof exportBackup>>);
    await refreshState();
    setFlashMessage({
      kind: 'success',
      text: t('appBackupImported'),
    });
  }

  async function handleTestConnection(nextSettings: AppSettings) {
    setAiBusyFeature('testConnection');

    try {
      const response = await testOpenRouterConnection(nextSettings);
      await logAiUsage(buildAiUsageLogEntry('chat', response.model, response.usage, true));
      await refreshState();
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
      await refreshState();
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
      await refreshState();
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
      await refreshState();
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
      await refreshState();
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
      await refreshState();
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
      await refreshState();
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
      await refreshState();
      throw error;
    } finally {
      setAiBusyFeature('');
    }
  }

  async function handleQuickAddSuggestion(suggestion: AiSuggestion) {
    try {
      await handleCreateWord({
        englishText: suggestion.englishText.trim(),
        translationText: suggestion.translationText.trim(),
        translationLanguage: suggestion.translationLanguage.trim(),
        group: suggestion.group?.trim() || undefined,
        textHint: suggestion.reason?.trim() || undefined,
        imageHint: undefined,
      });
    } catch {
      // The flash message already explains why the quick add failed.
    }
  }

  async function handleStartChat(selection: StudySelection, tutorPrompt?: string) {
    if (!settings) {
      throw new Error(t('appSettingsNotReady'));
    }

    const scopedChatSettings = {
      ...settings,
      ...getLanguageProfile(settings, currentActiveTranslationLanguage),
    };
    const selectedWords = selectWordsByMode(
      filterWordsByTranslationLanguage(words, currentActiveTranslationLanguage),
      scopedChatSettings,
      selection,
    );
    const selectedWordIds = selectedWords.map((word) => word.id);

    const sessionLabel =
      selection.mode === 'group' && selection.group
        ? `Group: ${selection.group}`
        : getSelectionLabel(selection.mode);
    const session = await createChatSession(
      selection.mode,
      selectedWordIds,
      sessionLabel,
      tutorPrompt,
      currentActiveTranslationLanguage,
    );
    await refreshState();
    setActiveChatSessionId(session.id);
    return session;
  }

  function isAbortError(error: unknown): boolean {
    return error instanceof DOMException && error.name === 'AbortError';
  }

  async function requestAssistantReply(
    pendingSession: ChatSession,
    selectedWords: WordEntry[],
    rollbackSession: ChatSession,
  ): Promise<ChatSession | null> {
    if (!settings) {
      return pendingSession;
    }

    setAiBusyFeature(`chat:${pendingSession.id}`);
    const controller = new AbortController();
    chatRequestRef.current = {
      controller,
      sessionId: pendingSession.id,
      rollbackSession,
    };

    try {
      const activeLanguageProfile = getLanguageProfile(
        settings,
        pendingSession.translationLanguage ?? currentActiveTranslationLanguage,
      );
      const response = await continueVocabularyChat(
        settings,
        pendingSession.messages,
        selectedWords,
        pendingSession.translationLanguage ??
          getPrimaryTranslationLanguage(selectedWords) ??
          currentActiveTranslationLanguage,
        activeLanguageProfile.learnerName,
        activeLanguageProfile.tutorName,
        pendingSession.tutorPrompt,
        controller.signal,
      );

      const assistantMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: response.assistantMessage,
        createdAt: new Date().toISOString(),
      };

      const completedSession: ChatSession = {
        ...pendingSession,
        messages: [...pendingSession.messages, assistantMessage],
        updatedAt: assistantMessage.createdAt,
      };

      await upsertChatSession(completedSession);
      await logAiUsage(buildAiUsageLogEntry('chat', response.model, response.usage, true));
      await refreshState();
      return completedSession;
    } catch (error) {
      if (isAbortError(error)) {
        await upsertChatSession(rollbackSession);
        await logAiUsage(
          buildAiUsageLogEntry('chat', settings.openRouterModel, undefined, false, t('aiLogCanceled')),
        );
        await refreshState();
        return null;
      }

      await upsertChatSession(rollbackSession);
      await logAiUsage(
        buildAiUsageLogEntry(
          'chat',
          settings.openRouterModel,
          undefined,
          false,
          error instanceof Error ? error.message : t('aiLogChatFailed'),
        ),
      );
      await refreshState();
      setFlashMessage({
        kind: 'error',
        text:
          error instanceof Error
            ? error.message
            : t('chatReplyFailed'),
      });
      throw error;
    } finally {
      if (chatRequestRef.current?.sessionId === pendingSession.id) {
        chatRequestRef.current = null;
      }

      setAiBusyFeature((current) => (current === `chat:${pendingSession.id}` ? '' : current));
    }
  }

  async function handleSendChatMessage(session: ChatSession, messageText: string, selectedWords: WordEntry[]) {
    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: messageText,
      createdAt: new Date().toISOString(),
    };

    const pendingSession: ChatSession = {
      ...session,
      messages: [...session.messages, userMessage],
      updatedAt: userMessage.createdAt,
    };

    await upsertChatSession(pendingSession);
    await refreshState();

    return requestAssistantReply(pendingSession, selectedWords, session);
  }

  async function handleEditChatMessage(
    session: ChatSession,
    messageId: string,
    messageText: string,
    selectedWords: WordEntry[],
  ) {
    const messageIndex = session.messages.findIndex(
      (message) => message.id === messageId && message.role === 'user',
    );

    if (messageIndex === -1) {
      throw new Error(t('appUserMessageNotFound'));
    }

    const editedAt = new Date().toISOString();
    const trimmedText = messageText.trim();

    const updatedMessages = session.messages.slice(0, messageIndex + 1).map((message) =>
      message.id === messageId ? { ...message, content: trimmedText, createdAt: editedAt } : message,
    );

    const pendingSession: ChatSession = {
      ...session,
      messages: updatedMessages,
      updatedAt: editedAt,
    };

    await upsertChatSession(pendingSession);
    await refreshState();

    return requestAssistantReply(pendingSession, selectedWords, session);
  }

  function handleStopChatGeneration() {
    chatRequestRef.current?.controller.abort();
  }

  async function handleRenameChat(session: ChatSession, nextLabel?: string) {
    const updatedSession: ChatSession = {
      ...session,
      label: nextLabel,
      updatedAt: new Date().toISOString(),
    };

    await upsertChatSession(updatedSession);
    await refreshState();
    setFlashMessage({
      kind: 'success',
      text: t('appChatRenamed'),
    });
  }

  async function handleDeleteChat(sessionId: string) {
    await deleteChatSession(sessionId);
    await refreshState();
    setFlashMessage({
      kind: 'success',
      text: t('appChatDeleted'),
    });
  }

  async function handleClearAiUsageLogs() {
    await clearAiUsageLogs();
    await refreshState();
    setFlashMessage({
      kind: 'success',
      text: t('appAiHistoryCleared'),
    });
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
      await refreshState();
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
      await refreshState();
      throw error;
    } finally {
      setAiBusyFeature('');
    }
  }

  if (loading || !settings) {
    return (
      <div
        className="app-shell"
        lang={pendingAppLanguageMeta.locale}
        dir={pendingAppLanguageMeta.dir}
      >
        <div className="loading-state">
          <p>{t('loadingApp')}</p>
        </div>
      </div>
    );
  }

  const appLanguage = settings.appLanguage;
  const appLanguageMeta = getLanguageMeta(appLanguage);
  setRuntimeAppLanguage(appLanguage);
  const liveT = createTranslator(appLanguage);
  const selectedModel = models.find((model) => model.id === settings.openRouterModel);
  const modelCapabilities = deriveModelCapabilities(selectedModel);
  const activeTranslationLanguage = currentActiveTranslationLanguage;
  const activeLanguageProfile = getLanguageProfile(settings, activeTranslationLanguage);
  const scopedSettings: AppSettings = {
    ...settings,
    ...activeLanguageProfile,
  };
  const aiReady = Boolean(settings.openRouterApiKey.trim() && settings.openRouterModel.trim());
  const visibleChatSessions = chatSessions.filter(
    (session) => session.translationLanguage === activeTranslationLanguage,
  );
  const legacyChatSessions = chatSessions.filter((session) => !session.translationLanguage);
  const selectableChatSessions = [...visibleChatSessions, ...legacyChatSessions];
  const activeChatSession =
    selectableChatSessions.find((session) => session.id === activeChatSessionId) ??
    selectableChatSessions[0] ??
    null;
  const shellStyle = {
    '--english-font': fontFamilyOptions[settings.englishFontFamily] ?? fontFamilyOptions.serif,
    '--translation-font':
      fontFamilyOptions[activeLanguageProfile.translationFontFamily] ?? fontFamilyOptions.sans,
    '--text-scale': String(settings.textFontScale / 100),
  } as CSSProperties;
  const screenLabels: Record<Screen, string> = {
    study: liveT('navStudy'),
    marathon: liveT('navMarathon'),
    vocabulary: liveT('navVocabulary'),
    chat: liveT('navChat'),
    progress: liveT('navProgress'),
    settings: liveT('navSettings'),
  };

  return (
    <div className="app-shell" style={shellStyle} lang={appLanguageMeta.locale} dir={appLanguageMeta.dir}>
      <div className="aurora aurora-left" />
      <div className="aurora aurora-right" />

      <header className="hero-card">
        <div className="hero-main">
          <p className="eyebrow">{liveT('heroEyebrow')}</p>
          <h1>
            {activeLanguageProfile.learnerName.trim()
              ? liveT('heroTitleForName', {
                  name: activeLanguageProfile.learnerName.trim(),
                })
              : liveT('heroTitle')}
          </h1>
          <p className="hero-copy">{liveT('heroCopy')}</p>
        </div>

        <div className="hero-side">
          <div className="hero-language-card">
            <p className="eyebrow">{liveT('heroVocabularyLanguage')}</p>
            {availableTranslationLanguages.length > 1 ? (
              <label className="hero-language-label">
                <span className="helper-text">{liveT('heroVocabularyChoose')}</span>
                <select
                  value={activeTranslationLanguage}
                  onChange={(event) => void handleSetActiveTranslationLanguage(event.target.value)}
                >
                  {availableTranslationLanguages.map((language) => (
                    <option key={language} value={language}>
                      {language}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <label className="hero-language-label">
                <span className="helper-text">
                  {availableTranslationLanguages.length === 1
                    ? liveT('heroVocabularyOne')
                    : liveT('heroVocabularyNone')}
                </span>
                <input
                  value={activeTranslationLanguage}
                  disabled
                  placeholder={liveT('heroNoSavedLanguages')}
                />
              </label>
            )}
          </div>
        </div>
      </header>

      <nav className="top-nav">
        {Object.entries(screenLabels).map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={screen === value ? 'nav-pill active' : 'nav-pill'}
            onClick={() => setScreen(value as Screen)}
          >
            {label}
          </button>
        ))}
      </nav>

      {flashMessage ? (
        <div className={flashMessage.kind === 'success' ? 'flash success' : 'flash error'}>
          {flashMessage.text}
        </div>
      ) : null}

      <main className="screen-grid">
        <section className={screen === 'study' ? 'screen-panel active' : 'screen-panel hidden'}>
          <StudyPanel
            words={words}
            settings={scopedSettings}
            appLanguage={appLanguage}
            activeTranslationLanguage={activeTranslationLanguage}
            layoutMode={settings.studyLayoutMode}
            aiReady={aiReady}
            sentenceHints={sentenceHints}
            aiBusyFeature={aiBusyFeature}
            onRecordReview={handleRecordReview}
            onSnoozeWord={handleSnoozeWord}
            onGenerateSentence={handleGenerateSentence}
          />
        </section>

        <section className={screen === 'marathon' ? 'screen-panel active' : 'screen-panel hidden'}>
          <MarathonPanel
            words={words}
            settings={scopedSettings}
            appLanguage={appLanguage}
            activeTranslationLanguage={activeTranslationLanguage}
            layoutMode={settings.marathonLayoutMode}
            onSaveRun={handleSaveMarathonRun}
          />
        </section>

        <section className={screen === 'vocabulary' ? 'screen-panel active' : 'screen-panel hidden'}>
          <VocabularyPanel
            words={words}
            reviewAttempts={reviewAttempts}
            settings={scopedSettings}
            appLanguage={appLanguage}
            activeTranslationLanguage={activeTranslationLanguage}
            availableTranslationLanguages={availableTranslationLanguages}
            layoutMode={settings.vocabularyLayoutMode}
            aiReady={aiReady}
            structuredAiReady={modelCapabilities.supportsStructuredOutputs}
            aiBusyFeature={aiBusyFeature}
            onCreateWord={handleCreateWord}
            onImportWords={handleImportWords}
            onUpdateWord={handleUpdateWord}
            onDeleteWord={handleDeleteWord}
            onSuggestNextWords={handleSuggestNextWords}
            onSuggestRelatedWords={handleSuggestRelatedWords}
            onQuickAddSuggestion={handleQuickAddSuggestion}
          />
        </section>

        <section className={screen === 'chat' ? 'screen-panel active' : 'screen-panel hidden'}>
          <ChatPanel
            words={words}
            settings={scopedSettings}
            appLanguage={appLanguage}
            activeTranslationLanguage={activeTranslationLanguage}
            availableTranslationLanguages={availableTranslationLanguages}
            layoutMode={settings.chatLayoutMode}
            chatSessions={visibleChatSessions}
            legacyChatSessions={legacyChatSessions}
            activeChatSession={activeChatSession}
            aiReady={aiReady}
            structuredAiReady={modelCapabilities.supportsStructuredOutputs}
            aiBusyFeature={aiBusyFeature}
            onStartChat={handleStartChat}
            onSendChatMessage={handleSendChatMessage}
            onEditChatMessage={handleEditChatMessage}
            onStopChatGeneration={handleStopChatGeneration}
            onRenameChat={handleRenameChat}
            onDeleteChat={handleDeleteChat}
            onPrepareSelection={handlePrepareSelection}
            onCreateWord={handleCreateWord}
            onSelectSession={setActiveChatSessionId}
          />
        </section>

        <section className={screen === 'progress' ? 'screen-panel active' : 'screen-panel hidden'}>
          <Suspense
            fallback={
              <div className="loading-state">
                <p>{liveT('loadingProgress')}</p>
              </div>
            }
          >
            <ProgressPanel
              words={words}
              reviewAttempts={reviewAttempts}
              aiUsageLogs={aiUsageLogs}
              statusTransitions={statusTransitions}
              marathonRuns={marathonRuns}
              marathonAnswers={marathonAnswers}
              appLanguage={appLanguage}
              activeTranslationLanguage={activeTranslationLanguage}
              availableTranslationLanguages={availableTranslationLanguages}
              layoutMode={settings.progressLayoutMode}
              onClearAiUsageLogs={handleClearAiUsageLogs}
            />
          </Suspense>
        </section>

        <section className={screen === 'settings' ? 'screen-panel active' : 'screen-panel hidden'}>
          <SettingsPanel
            settings={settings}
            words={words}
            appLanguage={appLanguage}
            layoutMode={settings.settingsLayoutMode}
            models={models}
            modelsLoading={modelsLoading}
            modelsError={modelsError}
            modelCapabilities={modelCapabilities}
            aiBusyFeature={aiBusyFeature}
            onSaveSettings={handleSaveSettings}
            onLoadModels={(apiKey) => handleLoadModels(true, apiKey)}
            onTestConnection={handleTestConnection}
            onExportBackup={handleExportBackup}
            onImportBackup={handleImportBackup}
            onMergeWords={handleMergeWords}
            onDeleteWords={handleDeleteWords}
            onDeleteLanguage={handleDeleteLanguage}
          />
        </section>
      </main>
    </div>
  );
}
