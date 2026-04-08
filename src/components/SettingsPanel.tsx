import { useEffect, useRef, useState } from 'react';
import type {
  DeleteLanguageResult,
  DeleteWordsResult,
  MergeWordsResult,
  WordDeleteScope,
} from '../db';
import { APP_LANGUAGE_META, createTranslator } from '../lib/i18n';
import {
  deriveModelCapabilities,
  getVocabularyPlaceholders,
  normalizeForComparison,
} from '../lib/text';
import { getLanguageProfile } from '../lib/language-settings';
import { getAvailableTranslationLanguages } from '../lib/study';
import type {
  AiModelCapabilities,
  AppSettings,
  OpenRouterModel,
  PageLayoutMode,
  SupportedAppLanguage,
  TranslationLanguageProfile,
  WordEntry,
} from '../types';

interface SettingsPanelProps {
  settings: AppSettings;
  words: WordEntry[];
  appLanguage: SupportedAppLanguage;
  layoutMode: PageLayoutMode;
  models: OpenRouterModel[];
  modelsLoading: boolean;
  modelsError: string;
  modelCapabilities: AiModelCapabilities;
  aiBusyFeature: string;
  onSaveSettings: (settings: AppSettings) => Promise<void>;
  onLoadModels: (apiKey?: string) => Promise<void>;
  onTestConnection: (settings: AppSettings) => Promise<void>;
  onExportBackup: () => Promise<void>;
  onImportBackup: (file: File) => Promise<void>;
  onMergeWords: () => Promise<MergeWordsResult>;
  onDeleteWords: (scope: WordDeleteScope) => Promise<DeleteWordsResult>;
  onDeleteLanguage: (language: string) => Promise<DeleteLanguageResult>;
}

const fontOptions = [
  { value: 'serif', label: 'Serif' },
  { value: 'sans', label: 'Sans' },
  { value: 'rounded', label: 'Rounded' },
  { value: 'mono', label: 'Monospace' },
];

const fontFamilyPreviewMap: Record<string, string> = {
  sans: '"Avenir Next", "Segoe UI", "Trebuchet MS", sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  rounded: '"Arial Rounded MT Bold", "Trebuchet MS", "Avenir Next", sans-serif',
  mono: '"SFMono-Regular", "Consolas", monospace',
};

const layoutFields: Array<{
  key:
    | 'studyLayoutMode'
    | 'vocabularyLayoutMode'
    | 'chatLayoutMode'
    | 'progressLayoutMode'
    | 'settingsLayoutMode';
  label: string;
}> = [
  { key: 'studyLayoutMode', label: 'settingsStudyPage' },
  { key: 'vocabularyLayoutMode', label: 'settingsVocabularyPage' },
  { key: 'chatLayoutMode', label: 'settingsChatPage' },
  { key: 'progressLayoutMode', label: 'settingsProgressPage' },
  { key: 'settingsLayoutMode', label: 'settingsSettingsPage' },
];

const DEFAULT_MAX_TOKEN_LIMIT = 250;

export function SettingsPanel({
  settings,
  words,
  appLanguage,
  layoutMode,
  models,
  modelsLoading,
  modelsError,
  modelCapabilities,
  aiBusyFeature,
  onSaveSettings,
  onLoadModels,
  onTestConnection,
  onExportBackup,
  onImportBackup,
  onMergeWords,
  onDeleteWords,
  onDeleteLanguage,
}: SettingsPanelProps) {
  const t = createTranslator(appLanguage);
  const savedSignature = JSON.stringify(settings);
  const [draft, setDraft] = useState(settings);
  const [lastAppliedSignature, setLastAppliedSignature] = useState(savedSignature);
  const [saving, setSaving] = useState(false);
  const [translationPreviewTextByLanguage, setTranslationPreviewTextByLanguage] = useState<
    Record<string, string>
  >({});
  const [selectedSettingsLanguage, setSelectedSettingsLanguage] = useState(
    settings.activeTranslationLanguage,
  );
  const [wordToolsBusy, setWordToolsBusy] = useState<'' | 'merge' | 'delete'>('');
  const [wordToolsMessage, setWordToolsMessage] = useState('');
  const [wordToolsMessageIsError, setWordToolsMessageIsError] = useState(false);
  const [newLanguageName, setNewLanguageName] = useState('');
  const [languageMessage, setLanguageMessage] = useState('');
  const [languageMessageIsError, setLanguageMessageIsError] = useState(false);
  const [deleteScopeMode, setDeleteScopeMode] = useState<WordDeleteScope['mode']>('group');
  const [deleteScopeValue, setDeleteScopeValue] = useState('');
  const importRef = useRef<HTMLInputElement | null>(null);
  const selectedModel = models.find((model) => model.id === draft.openRouterModel);
  const draftCapabilities = selectedModel ? deriveModelCapabilities(selectedModel) : modelCapabilities;
  const isDirty = JSON.stringify(draft) !== savedSignature;
  const tokenLimitEnabled = draft.openRouterMaxTokens > 0;
  const showModelsError =
    Boolean(modelsError) &&
    draft.openRouterApiKey.trim() === settings.openRouterApiKey.trim() &&
    draft.openRouterModel.trim() === settings.openRouterModel.trim();
  const uniqueGroups = [...new Set(words.flatMap((word) => word.groups))].sort((left, right) =>
    left.localeCompare(right),
  );
  const draftAvailableLanguages = getAvailableTranslationLanguages(words, draft.translationLanguages);
  const languageUsageCounts = new Map(
    draftAvailableLanguages.map((language) => [
      language,
      words.filter(
        (word) =>
          normalizeForComparison(word.translationLanguage) === normalizeForComparison(language),
      ).length,
    ]),
  );
  const matchingDeleteCount = words.filter((word) => {
    if (deleteScopeMode === 'all') {
      return true;
    }

    if (!deleteScopeValue) {
      return false;
    }

    if (deleteScopeMode === 'group') {
      return word.groups.includes(deleteScopeValue);
    }

    return (
      normalizeForComparison(word.translationLanguage) === normalizeForComparison(deleteScopeValue)
    );
  }).length;

  useEffect(() => {
    if (savedSignature !== lastAppliedSignature) {
      setDraft((current) => {
        const draftWasDirty = JSON.stringify(current) !== lastAppliedSignature;

        if (!draftWasDirty) {
          return settings;
        }

        return {
          ...current,
          activeTranslationLanguage: settings.activeTranslationLanguage,
          translationLanguages: settings.translationLanguages,
          languageProfiles: settings.languageProfiles,
        };
      });
      setLastAppliedSignature(savedSignature);
      setNewLanguageName('');
      setLanguageMessage('');
      setLanguageMessageIsError(false);
    }
  }, [lastAppliedSignature, savedSignature, settings]);

  useEffect(() => {
    if (draftAvailableLanguages.length === 0) {
      if (selectedSettingsLanguage) {
        setSelectedSettingsLanguage('');
      }
      return;
    }

    if (
      selectedSettingsLanguage &&
      draftAvailableLanguages.some(
        (language) =>
          normalizeForComparison(language) === normalizeForComparison(selectedSettingsLanguage),
      )
    ) {
      return;
    }

    setSelectedSettingsLanguage(draft.activeTranslationLanguage || draftAvailableLanguages[0] || '');
  }, [draft.activeTranslationLanguage, draftAvailableLanguages, selectedSettingsLanguage]);

  useEffect(() => {
    if (deleteScopeMode === 'group') {
      if (deleteScopeValue && !uniqueGroups.includes(deleteScopeValue)) {
        setDeleteScopeValue('');
      }
      return;
    }

    if (deleteScopeMode === 'language') {
      if (deleteScopeValue && !draftAvailableLanguages.includes(deleteScopeValue)) {
        setDeleteScopeValue('');
      }
      return;
    }

    if (deleteScopeValue) {
      setDeleteScopeValue('');
    }
  }, [deleteScopeMode, deleteScopeValue, draftAvailableLanguages, uniqueGroups]);

  function handleAddLanguage() {
    const trimmedLanguage = newLanguageName.trim();

    if (!trimmedLanguage) {
      setLanguageMessage(t('settingsLanguageTypeFirst'));
      setLanguageMessageIsError(true);
      return;
    }

    const alreadyExists = draftAvailableLanguages.some(
      (language) => normalizeForComparison(language) === normalizeForComparison(trimmedLanguage),
    );

    if (alreadyExists) {
      setLanguageMessage(t('settingsLanguageExists'));
      setLanguageMessageIsError(true);
      return;
    }

    setDraft((current) => {
      const nextLanguages = getAvailableTranslationLanguages(words, [
        ...current.translationLanguages,
        trimmedLanguage,
      ]);
      const nextProfile = getLanguageProfile(current, current.activeTranslationLanguage || trimmedLanguage);

      return {
        ...current,
        translationLanguages: nextLanguages,
        activeTranslationLanguage:
          current.activeTranslationLanguage || current.translationLanguages[0] || trimmedLanguage,
        languageProfiles: {
          ...current.languageProfiles,
          [trimmedLanguage]: nextProfile,
        },
      };
    });
    setSelectedSettingsLanguage(trimmedLanguage);
    setNewLanguageName('');
    setLanguageMessage(t('settingsLanguageAddedDraft', { language: trimmedLanguage }));
    setLanguageMessageIsError(false);
  }

  function handleRemoveLanguage(language: string) {
    if (
      !window.confirm(
        t('settingsLanguageDeleteConfirm', { language }),
      )
    ) {
      return;
    }

    const languageExistsInSavedSettings = getAvailableTranslationLanguages(
      words,
      settings.translationLanguages,
    ).some((existingLanguage) => normalizeForComparison(existingLanguage) === normalizeForComparison(language));
    const languageExistsInSavedWords = words.some(
      (word) => normalizeForComparison(word.translationLanguage) === normalizeForComparison(language),
    );

    if (!languageExistsInSavedSettings && !languageExistsInSavedWords) {
      setDraft((current) => {
        const nextTranslationLanguages = current.translationLanguages.filter(
          (existingLanguage) => normalizeForComparison(existingLanguage) !== normalizeForComparison(language),
        );
        const nextAvailableLanguages = getAvailableTranslationLanguages(words, nextTranslationLanguages);
        const nextLanguageProfiles = Object.fromEntries(
          Object.entries(current.languageProfiles).filter(
            ([existingLanguage]) =>
              normalizeForComparison(existingLanguage) !== normalizeForComparison(language),
          ),
        );
        const shouldResetActiveLanguage =
          normalizeForComparison(current.activeTranslationLanguage) === normalizeForComparison(language);

        return {
          ...current,
          translationLanguages: nextTranslationLanguages,
          activeTranslationLanguage: shouldResetActiveLanguage
            ? nextAvailableLanguages[0] ?? ''
            : current.activeTranslationLanguage,
          languageProfiles: nextLanguageProfiles,
        };
      });
      setSelectedSettingsLanguage((current) => {
        if (normalizeForComparison(current) !== normalizeForComparison(language)) {
          return current;
        }

        const nextLanguages = getAvailableTranslationLanguages(
          words,
          draft.translationLanguages.filter(
            (existingLanguage) =>
              normalizeForComparison(existingLanguage) !== normalizeForComparison(language),
          ),
        );

        return nextLanguages[0] ?? '';
      });
      setTranslationPreviewTextByLanguage((current) =>
        Object.fromEntries(
          Object.entries(current).filter(
            ([existingLanguage]) =>
              normalizeForComparison(existingLanguage) !== normalizeForComparison(language),
          ),
        ),
      );
      setLanguageMessage(t('settingsLanguageRemovedDraft', { language }));
      setLanguageMessageIsError(false);
      return;
    }

    void (async () => {
      try {
        const result = await onDeleteLanguage(language);
        setLanguageMessage(
          result.deletedWordCount > 0 || result.deletedChatCount > 0
            ? t('settingsLanguageRemovedDetailed', {
                language,
                words: result.deletedWordCount,
                chats: result.deletedChatCount,
              })
            : t('settingsLanguageRemovedSimple', { language }),
        );
        setLanguageMessageIsError(false);
      } catch (error) {
        setLanguageMessage(
          error instanceof Error ? error.message : t('settingsCouldNotRemoveLanguage', { language }),
        );
        setLanguageMessageIsError(true);
      }
    })();
  }

  function getDraftLanguageProfile(language: string): TranslationLanguageProfile {
    return getLanguageProfile(draft, language);
  }

  function handleLanguageProfileChange(
    language: string,
    updates: Partial<TranslationLanguageProfile>,
  ) {
    setDraft((current) => ({
      ...current,
      languageProfiles: {
        ...current.languageProfiles,
        [language]: {
          ...getLanguageProfile(current, language),
          ...updates,
        },
      },
    }));
  }

  function handleTranslationPreviewChange(language: string, value: string) {
    setTranslationPreviewTextByLanguage((current) => ({
      ...current,
      [language]: value,
    }));
  }

  function getTranslationPreviewText(language: string) {
    return translationPreviewTextByLanguage[language] ?? getVocabularyPlaceholders(language).translation;
  }

  async function handleSave() {
    setSaving(true);

    try {
      await onSaveSettings(draft);
    } finally {
      setSaving(false);
    }
  }

  async function handleImport(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    if (window.confirm(t('settingsImportBackupConfirm'))) {
      await onImportBackup(file);
    }

    event.target.value = '';
  }

  async function handleMergeWordsRequest() {
    setWordToolsBusy('merge');
    setWordToolsMessage('');
    setWordToolsMessageIsError(false);

    try {
      const result = await onMergeWords();
      setWordToolsMessage(
        result.removedWordCount > 0
          ? t('appMergedWords', {
              merged: result.mergedWordCount,
              removed: result.removedWordCount,
            })
          : t('appNoMergeNeeded'),
      );
    } catch (error) {
      setWordToolsMessage(error instanceof Error ? error.message : t('settingsMergeFailed'));
      setWordToolsMessageIsError(true);
    } finally {
      setWordToolsBusy('');
    }
  }

  async function handleDeleteWordsRequest() {
    if (deleteScopeMode !== 'all' && !deleteScopeValue) {
      return;
    }

    const scope: WordDeleteScope =
      deleteScopeMode === 'all'
        ? { mode: 'all' }
        : { mode: deleteScopeMode, value: deleteScopeValue };

    const scopeLabel =
      deleteScopeMode === 'all'
        ? t('settingsDeleteScopeAll')
        : deleteScopeMode === 'group'
          ? t('settingsDeleteScopeGroup', { group: deleteScopeValue })
          : t('settingsDeleteScopeLanguage', { language: deleteScopeValue });

    if (
      !window.confirm(
        t('settingsDeleteWordsConfirm', {
          count: matchingDeleteCount,
          scope: scopeLabel,
        }),
      )
    ) {
      return;
    }

    setWordToolsBusy('delete');
    setWordToolsMessage('');
    setWordToolsMessageIsError(false);

    try {
      const result = await onDeleteWords(scope);
      setWordToolsMessage(
        result.deletedCount > 0
          ? t('appDeletedWords', { count: result.deletedCount })
          : t('appNoWordsDeleted'),
      );
    } catch (error) {
      setWordToolsMessage(error instanceof Error ? error.message : t('settingsDeleteWordsFailed'));
      setWordToolsMessageIsError(true);
    } finally {
      setWordToolsBusy('');
    }
  }

  return (
    <div className={`panel-grid settings-layout ${layoutMode === 'stacked' ? 'stacked-layout' : ''}`}>
      <section className="panel accent-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">{t('settingsGeneralEyebrow')}</p>
            <h2>{t('settingsGeneralTitle')}</h2>
          </div>
          <button
            type="button"
            className="primary-button"
            disabled={saving || !isDirty}
            onClick={() => void handleSave()}
          >
            {saving ? t('commonSaving') : isDirty ? t('commonSave') : t('commonSaved')}
          </button>
        </div>

        <div className="filter-grid">
          <label>
            {t('settingsAppLanguage')}
            <select
              value={draft.appLanguage}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  appLanguage: event.target.value as SupportedAppLanguage,
                }))
              }
            >
              {Object.values(APP_LANGUAGE_META).map((language) => (
                <option key={language.code} value={language.code}>
                  {`${language.label} · ${language.nativeLabel}`}
                </option>
              ))}
            </select>
          </label>

          <label className="slider-field">
            {t('settingsLastAddedPercent')}
            <div className="slider-row">
              <input
                type="range"
                min={0}
                max={100}
                value={draft.lastAddedPercent}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    lastAddedPercent: Number(event.target.value),
                  }))
                }
              />
              <strong className="range-output">{draft.lastAddedPercent}%</strong>
            </div>
          </label>

          <label className="slider-field">
            {t('settingsLessSeenPercent')}
            <div className="slider-row">
              <input
                type="range"
                min={0}
                max={100}
                value={draft.lessSeenPercent}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    lessSeenPercent: Number(event.target.value),
                  }))
                }
              />
              <strong className="range-output">{draft.lessSeenPercent}%</strong>
            </div>
          </label>

          <label>
            {t('settingsEnglishFont')}
            <select
              value={draft.englishFontFamily}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  englishFontFamily: event.target.value,
                }))
              }
            >
              {fontOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="slider-field">
            {t('settingsTextSize')}
            <div className="slider-row">
              <input
                type="range"
                min={80}
                max={150}
                value={draft.textFontScale}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    textFontScale: Number(event.target.value),
                  }))
                }
              />
              <strong className="range-output">{draft.textFontScale}%</strong>
            </div>
          </label>
        </div>

        <div className="detail-stack">
          <div className="panel-heading compact">
            <div>
              <p className="eyebrow">{t('settingsBackupEyebrow')}</p>
              <h3>{t('settingsBackupTitle')}</h3>
            </div>
          </div>
          <div className="backup-row">
            <button type="button" className="secondary-button" onClick={() => void onExportBackup()}>
              {t('settingsExportBackup')}
            </button>
            <button type="button" className="ghost-button" onClick={() => importRef.current?.click()}>
              {t('settingsImportBackup')}
            </button>
            <input
              ref={importRef}
              type="file"
              accept="application/json"
              hidden
              onChange={handleImport}
            />
          </div>
        </div>

        <p className="helper-text">{t('settingsCommonHelp')}</p>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">{t('settingsLanguagesEyebrow')}</p>
            <h2>{t('settingsLanguageTitle')}</h2>
          </div>
        </div>

        <label className="full-width">
          {t('settingsAddLanguage')}
          <div className="settings-inline-row">
            <input
              value={newLanguageName}
              onChange={(event) => setNewLanguageName(event.target.value)}
              placeholder={t('settingsAddLanguagePlaceholder')}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  handleAddLanguage();
                }
              }}
            />
            <button type="button" className="secondary-button" onClick={handleAddLanguage}>
              {t('settingsAddLanguageButton')}
            </button>
          </div>
        </label>

        {languageMessage ? (
          <p className={languageMessageIsError ? 'helper-text error-text' : 'helper-text'}>
            {languageMessage}
          </p>
        ) : null}

        <p className="helper-text">{t('settingsNeedLanguageFirst')}</p>

        <div className="language-settings-list">
          {draftAvailableLanguages.length === 0 ? (
            <div className="empty-state">
              <p>{t('settingsNeedLanguageFirst')}</p>
            </div>
          ) : (
            <>
              {draftAvailableLanguages.length > 1 ? (
                <label>
                  {t('settingsLanguagePicker')}
                  <select
                    value={selectedSettingsLanguage || draftAvailableLanguages[0]}
                    onChange={(event) => setSelectedSettingsLanguage(event.target.value)}
                  >
                    {draftAvailableLanguages.map((language) => (
                      <option key={language} value={language}>
                        {language}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <label>
                  {t('settingsLanguagePicker')}
                  <input value={draftAvailableLanguages[0] ?? ''} disabled />
                </label>
              )}

              {(() => {
                const language = selectedSettingsLanguage || draftAvailableLanguages[0] || '';
                const usageCount = languageUsageCounts.get(language) ?? 0;
                const languageProfile = getDraftLanguageProfile(language);
                const previewText = getTranslationPreviewText(language);
                const isActiveLanguage =
                  normalizeForComparison(draft.activeTranslationLanguage) ===
                  normalizeForComparison(language);

                return (
                  <article className="suggestion-panel language-settings-card">
                    <div className="panel-heading compact">
                      <div className="language-settings-copy">
                        <div className="value-chip-row">
                          <span className="value-chip">{language}</span>
                          {isActiveLanguage ? <span className="value-chip muted-chip">{t('commonActive')}</span> : null}
                        </div>
                        <small className="helper-text">
                          {usageCount > 0
                            ? t('settingsUsedByWordsChats', { words: usageCount })
                            : t('commonNoDataYet')}
                        </small>
                      </div>

                      <button
                        type="button"
                        className="ghost-button danger-button"
                        onClick={() => handleRemoveLanguage(language)}
                      >
                        {t('settingsDeleteLanguage')}
                      </button>
                    </div>

                    <div className="filter-grid">
                      <label>
                        {t('settingsYourName')}
                        <input
                          value={languageProfile.learnerName}
                          onChange={(event) =>
                            handleLanguageProfileChange(language, {
                              learnerName: event.target.value,
                            })
                          }
                          placeholder={t('settingsYourName')}
                        />
                      </label>

                      <label>
                        {t('settingsTutorName')}
                        <input
                          value={languageProfile.tutorName}
                          onChange={(event) =>
                            handleLanguageProfileChange(language, {
                              tutorName: event.target.value,
                            })
                          }
                          placeholder={t('settingsTutorName')}
                        />
                      </label>

                      <label>
                        {t('settingsMasteryThreshold')}
                        <input
                          type="number"
                          min={1}
                          max={12}
                          value={languageProfile.masteryThreshold}
                          onChange={(event) =>
                            handleLanguageProfileChange(language, {
                              masteryThreshold: Number(event.target.value),
                            })
                          }
                        />
                      </label>

                      <label>
                        {t('settingsTranslationFont')}
                        <select
                          value={languageProfile.translationFontFamily}
                          onChange={(event) =>
                            handleLanguageProfileChange(language, {
                              translationFontFamily: event.target.value,
                            })
                          }
                        >
                          {fontOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>

                    <label className="full-width preview-input-label">
                      <span className="helper-text">{t('settingsPreviewTextIn', { language })}</span>
                      <textarea
                        rows={3}
                        dir="auto"
                        className="translation-input preview-input"
                        value={previewText}
                        onChange={(event) => handleTranslationPreviewChange(language, event.target.value)}
                        style={{
                          fontFamily:
                            fontFamilyPreviewMap[languageProfile.translationFontFamily] ??
                            fontFamilyPreviewMap.sans,
                        }}
                        placeholder={t('settingsPreviewTextIn', { language })}
                      />
                    </label>
                  </article>
                );
              })()}
            </>
          )}
        </div>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">{t('settingsPageLayoutEyebrow')}</p>
            <h2>{t('settingsPageLayoutTitle')}</h2>
          </div>
        </div>

        <div className="filter-grid">
          {layoutFields.map((field) => (
            <label key={field.key} className="checkbox-row layout-checkbox-row">
              <input
                type="checkbox"
                checked={draft[field.key] === 'split'}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    [field.key]: (event.target.checked ? 'split' : 'stacked') as PageLayoutMode,
                  }))
                }
              />
              <span className="layout-checkbox-copy">
                <strong>{t(field.label as never)}</strong>
                <small>{t('settingsAllowSideBySide')}</small>
              </span>
            </label>
          ))}
        </div>

        <p className="helper-text">{t('settingsPageLayoutHelp')}</p>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">{t('settingsAiEyebrow')}</p>
            <h2>{t('settingsAiTitle')}</h2>
          </div>
          <div className="action-row narrow">
            <button
              type="button"
              className="primary-button"
              disabled={saving || !isDirty}
              onClick={() => void handleSave()}
            >
              {saving ? t('commonSaving') : isDirty ? t('commonSave') : t('commonSaved')}
            </button>
            <button
              type="button"
              className="ghost-button"
              disabled={modelsLoading}
              onClick={() => void onLoadModels(draft.openRouterApiKey)}
            >
              {modelsLoading ? t('settingsLoadingModels') : t('settingsLoadModels')}
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={aiBusyFeature === 'testConnection'}
              onClick={() => void onTestConnection(draft)}
            >
              {aiBusyFeature === 'testConnection' ? t('commonLoading') : t('settingsTestConnection')}
            </button>
          </div>
        </div>

        <label className="full-width">
          {t('settingsApiKey')}
          <input
            type="password"
            value={draft.openRouterApiKey}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                openRouterApiKey: event.target.value,
              }))
            }
            placeholder="sk-or-v1-..."
          />
        </label>

        <label className="full-width">
          {t('settingsModel')}
          <input
            list="openrouter-models"
            value={draft.openRouterModel}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                openRouterModel: event.target.value,
              }))
            }
            placeholder="openai/gpt-4.1-mini or another OpenRouter model id"
          />
          <datalist id="openrouter-models">
            {models.map((model) => (
              <option key={model.id} value={model.id}>
                {model.name}
              </option>
            ))}
          </datalist>
        </label>

        <p className="helper-text">{t('settingsFreeModelTip')}</p>

        <div className="detail-stack">
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={tokenLimitEnabled}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  openRouterMaxTokens: event.target.checked
                    ? current.openRouterMaxTokens > 0
                      ? current.openRouterMaxTokens
                      : DEFAULT_MAX_TOKEN_LIMIT
                    : 0,
                }))
              }
            />
            <span>{t('settingsLimitMaxTokens')}</span>
          </label>

          <label>
            {t('settingsMaxTokens')}
            <input
              type="number"
              min={50}
              max={4000}
              disabled={!tokenLimitEnabled}
              value={tokenLimitEnabled ? draft.openRouterMaxTokens : DEFAULT_MAX_TOKEN_LIMIT}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  openRouterMaxTokens: Number(event.target.value),
                }))
              }
            />
          </label>

          <p className="helper-text">
            {tokenLimitEnabled
              ? t('settingsReplyLimit')
              : t('settingsReplyLimit')}
          </p>
        </div>

        <div className="capability-grid">
          <article>
            <span>{t('settingsOneClickLists')}</span>
            <strong>{draftCapabilities.supportsStructuredOutputs ? 'Yes' : 'No'}</strong>
          </article>
          <article>
            <span>{t('settingsFormattedReplies')}</span>
            <strong>{draftCapabilities.supportsResponseFormat ? 'Yes' : 'No'}</strong>
          </article>
          <article>
            <span>{t('settingsReplyLimit')}</span>
            <strong>{draftCapabilities.supportsMaxTokens ? 'Yes' : 'No'}</strong>
          </article>
        </div>

        {showModelsError ? <p className="helper-text error-text">{modelsError}</p> : null}
        <p className="helper-text">{t('settingsModelHelp')}</p>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">{t('settingsWordToolsEyebrow')}</p>
            <h2>{t('settingsWordToolsTitle')}</h2>
          </div>
        </div>

        <div className="summary-strip">
          <article>
            <span>{words.length}</span>
            <p>{t('settingsWordToolsTotalWords')}</p>
          </article>
          <article>
            <span>{uniqueGroups.length}</span>
            <p>{t('settingsWordToolsGroups')}</p>
          </article>
          <article>
            <span>{draftAvailableLanguages.length}</span>
            <p>{t('settingsWordToolsLanguages')}</p>
          </article>
        </div>

        <div className="detail-stack">
          <div className="suggestion-panel settings-tool-card">
            <div className="panel-heading compact">
              <div>
                <h3>{t('settingsMergeTitle')}</h3>
                <p className="helper-text">{t('settingsMergeHelp')}</p>
              </div>
              <button
                type="button"
                className="secondary-button"
                disabled={wordToolsBusy !== ''}
                onClick={() => void handleMergeWordsRequest()}
              >
                {wordToolsBusy === 'merge' ? t('commonLoading') : t('settingsMergeNow')}
              </button>
            </div>
          </div>

          <div className="suggestion-panel settings-tool-card">
            <div className="panel-heading compact">
              <div>
                <h3>{t('settingsDeleteWordsTitle')}</h3>
                <p className="helper-text">{t('settingsDeleteWordsHelp')}</p>
              </div>
            </div>

            <div className="filter-grid">
              <label>
                {t('settingsDeleteScope')}
                <select
                  value={deleteScopeMode}
                  onChange={(event) => {
                    const nextMode = event.target.value as WordDeleteScope['mode'];
                    setDeleteScopeMode(nextMode);
                    if (nextMode !== 'all') {
                      setDeleteScopeValue('');
                    }
                  }}
                >
                  <option value="group">{t('settingsDeleteByGroup')}</option>
                  <option value="language">{t('settingsDeleteByLanguage')}</option>
                  <option value="all">{t('settingsDeleteAll')}</option>
                </select>
              </label>

              {deleteScopeMode === 'group' ? (
                <label>
                  {t('commonGroup')}
                  <select
                    value={deleteScopeValue}
                    onChange={(event) => setDeleteScopeValue(event.target.value)}
                    disabled={uniqueGroups.length === 0}
                  >
                    {uniqueGroups.length === 0 ? (
                      <option value="">{t('settingsNoGroupsYet')}</option>
                    ) : (
                      <>
                        <option value="">{t('settingsChooseGroup')}</option>
                        {uniqueGroups.map((group) => (
                          <option key={group} value={group}>
                            {group}
                          </option>
                        ))}
                      </>
                    )}
                  </select>
                </label>
              ) : null}

              {deleteScopeMode === 'language' ? (
                <label>
                  {t('commonLanguage')}
                  <select
                    value={deleteScopeValue}
                    onChange={(event) => setDeleteScopeValue(event.target.value)}
                    disabled={draftAvailableLanguages.length === 0}
                  >
                    {draftAvailableLanguages.length === 0 ? (
                      <option value="">{t('settingsNoLanguagesYet')}</option>
                    ) : (
                      <>
                        <option value="">{t('settingsChooseLanguage')}</option>
                        {draftAvailableLanguages.map((language) => (
                          <option key={language} value={language}>
                            {language}
                          </option>
                        ))}
                      </>
                    )}
                  </select>
                </label>
              ) : null}
            </div>

            <div className="action-row action-row-spacious">
              <span className="helper-text">
                {deleteScopeMode === 'all' || deleteScopeValue
                  ? t('settingsDeleteWordsButton', { count: matchingDeleteCount })
                  : t('settingsDeleteScope')}
              </span>
              <button
                type="button"
                className="ghost-button danger-button"
                disabled={
                  wordToolsBusy !== '' ||
                  matchingDeleteCount === 0 ||
                  (deleteScopeMode !== 'all' && !deleteScopeValue)
                }
                onClick={() => void handleDeleteWordsRequest()}
              >
                {wordToolsBusy === 'delete'
                  ? t('commonLoading')
                  : t('settingsDeleteWordsButton', { count: matchingDeleteCount })}
              </button>
            </div>
          </div>

          {wordToolsMessage ? (
            <p className={wordToolsMessageIsError ? 'helper-text error-text' : 'helper-text'}>
              {wordToolsMessage}
            </p>
          ) : null}
        </div>
      </section>
    </div>
  );
}
