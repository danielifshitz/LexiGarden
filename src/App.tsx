import {
  Suspense,
  lazy,
  useEffect,
  useState,
  type CSSProperties,
} from 'react';
import { fetchOpenRouterModels } from './ai';
import {
  clearAiUsageLogs,
  saveMarathonRun,
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
import { deriveModelCapabilities } from './lib/text';
import { getLanguageProfile } from './lib/language-settings';
import {
  getAvailableTranslationLanguages,
  resolveActiveTranslationLanguage,
} from './lib/study';
import { useAppState } from './hooks/useAppState';
import { useAiActions } from './hooks/useAiActions';
import { useChatActions } from './hooks/useChatActions';
import { useWordActions } from './hooks/useWordActions';
import { useSettingsActions } from './hooks/useSettingsActions';
import type {
  AiSuggestion,
  AppSettings,
  OpenRouterModel,
  Screen,
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

export default function App() {
  const [screen, setScreen] = useState<Screen>('study');
  const { state, setters, refreshState } = useAppState();
  const {
    loading,
    words,
    reviewAttempts,
    chatSessions,
    aiUsageLogs,
    statusTransitions,
    marathonRuns,
    marathonAnswers,
    settings,
    activeChatSessionId,
    flashMessage,
  } = state;
  const { setLoading, setSettings, setActiveChatSessionId, setFlashMessage } = setters;

  const [models, setModels] = useState<OpenRouterModel[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState('');
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

  const { state: aiState, setters: aiSetters, actions: aiActions } = useAiActions({
    settings,
    words,
    refreshState,
    setFlashMessage,
    t,
  });
  const { aiBusyFeature, sentenceHints } = aiState;
  const { setAiBusyFeature } = aiSetters;
  const {
    handleTestConnection,
    handleGenerateSentence,
    handleExplainMistake,
    handleSuggestRelatedWords,
    handleSuggestNextWords,
    handlePrepareSelection,
  } = aiActions;

  const { actions: chatActions } = useChatActions({
    settings,
    words,
    currentActiveTranslationLanguage,
    refreshState,
    setActiveChatSessionId,
    setAiBusyFeature,
    setFlashMessage,
    t,
  });
  const {
    handleStartChat,
    handleSendChatMessage,
    handleEditChatMessage,
    handleStopChatGeneration,
    handleRenameChat,
    handleDeleteChat,
  } = chatActions;

  const { actions: wordActions } = useWordActions({
    settings,
    words,
    currentActiveTranslationLanguage,
    refreshState,
    setFlashMessage,
    t,
  });
  const {
    handleCreateWord,
    handleImportWords,
    handleUpdateWord,
    handleDeleteWord,
    handleMergeWords,
    handleDeleteWords,
    handleRecordReview,
    handleSnoozeWord,
  } = wordActions;

  const { actions: settingsActions } = useSettingsActions({
    settings,
    refreshState,
    setSettings,
    setFlashMessage,
    setModelsError,
    t,
  });
  const {
    handleDeleteLanguage,
    handleSaveSettings,
    handleSetActiveTranslationLanguage,
    handleExportBackup,
    handleImportBackup,
  } = settingsActions;

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

  async function handleClearAiUsageLogs() {
    await clearAiUsageLogs();
    await refreshState(['aiUsageLogs']);
    setFlashMessage({
      kind: 'success',
      text: t('appAiHistoryCleared'),
    });
  }

  async function handleSaveMarathonRun(run: MarathonRun, answers: MarathonAnswer[]) {
    await saveMarathonRun(run, answers);
    await refreshState(['marathonRuns', 'marathonAnswers']);
  }

  useEffect(() => {
    if (!settings) return;
    
    const applyTheme = () => {
      const theme = settings.theme;
      if (theme === 'system') {
        const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
        document.documentElement.dataset.theme = prefersDark ? 'dark' : 'light';
      } else {
        document.documentElement.dataset.theme = theme;
      }
    };

    applyTheme();

    const mediaQuery = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (mediaQuery) {
      mediaQuery.addEventListener('change', applyTheme);
      return () => mediaQuery.removeEventListener('change', applyTheme);
    }
  }, [settings?.theme]);

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
        <section className={`screen-panel ${screen === 'study' ? 'active' : ''}`} style={{ display: screen === 'study' ? 'block' : 'none' }}>
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
            onExplainMistake={handleExplainMistake}
          />
        </section>

        <section className={`screen-panel ${screen === 'marathon' ? 'active' : ''}`} style={{ display: screen === 'marathon' ? 'block' : 'none' }}>
          <MarathonPanel
            words={words}
            settings={scopedSettings}
            appLanguage={appLanguage}
            activeTranslationLanguage={activeTranslationLanguage}
            layoutMode={settings.marathonLayoutMode}
            onSaveRun={handleSaveMarathonRun}
            onExplainMistake={handleExplainMistake}
            aiReady={!!settings.openRouterApiKey}
          />
        </section>

        <section className={`screen-panel ${screen === 'vocabulary' ? 'active' : ''}`} style={{ display: screen === 'vocabulary' ? 'block' : 'none' }}>
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

        <section className={`screen-panel ${screen === 'chat' ? 'active' : ''}`} style={{ display: screen === 'chat' ? 'block' : 'none' }}>
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

        <section className={`screen-panel ${screen === 'progress' ? 'active' : ''}`} style={{ display: screen === 'progress' ? 'block' : 'none' }}>
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
              dailyCardsGoal={settings.dailyCardsGoal}
              dailyMarathonGoal={settings.dailyMarathonGoal}
              onClearAiUsageLogs={handleClearAiUsageLogs}
            />
          </Suspense>
        </section>

        <section className={`screen-panel ${screen === 'settings' ? 'active' : ''}`} style={{ display: screen === 'settings' ? 'block' : 'none' }}>
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
