import { useDeferredValue, useEffect, useRef, useState } from 'react';
import type { ImportWordsResult, WordDraft, WordMutationResult } from '../db';
import { buildWordsCsv, parseWordsCsv } from '../lib/csv';
import { createTranslator } from '../lib/i18n';
import {
  downloadTextFile,
  formatDateTime,
  formatSlashSeparatedValues,
  getWordStatus,
  isWordIdentityConflictError,
  normalizeForComparison,
  parseSlashSeparatedValues,
  trimToUndefined,
} from '../lib/text';
import { describeImportResult, describeWordMutation } from '../lib/word-messages';
import { filterWordsByTranslationLanguage } from '../lib/study';
import type {
  AiSuggestion,
  AppSettings,
  PageLayoutMode,
  ReviewAttempt,
  SupportedAppLanguage,
  WordEntry,
} from '../types';
import { WordEditorFields } from './WordEditorFields';
import { PlayButton } from './shared/PlayButton';

interface VocabularyPanelProps {
  words: WordEntry[];
  reviewAttempts: ReviewAttempt[];
  settings: AppSettings;
  appLanguage: SupportedAppLanguage;
  activeTranslationLanguage: string;
  availableTranslationLanguages: string[];
  layoutMode: PageLayoutMode;
  aiReady: boolean;
  structuredAiReady: boolean;
  aiBusyFeature: string;
  onCreateWord: (draft: WordDraft) => Promise<WordMutationResult>;
  onImportWords: (drafts: WordDraft[]) => Promise<ImportWordsResult>;
  onUpdateWord: (word: WordEntry) => Promise<WordMutationResult>;
  onDeleteWord: (wordId: string) => Promise<void>;
  onSuggestNextWords: (context: {
    translationLanguage: string;
    group?: string;
    englishText?: string;
    translationText?: string;
    textHint?: string;
  }) => Promise<AiSuggestion[]>;
  onSuggestRelatedWords: (word: WordEntry) => Promise<AiSuggestion[]>;
  onQuickAddSuggestion: (suggestion: AiSuggestion) => Promise<void>;
}

interface WordFormState {
  englishText: string;
  translationText: string;
  translationLanguage: string;
  group: string;
  textHint: string;
  imageHint?: WordEntry['imageHint'];
}

const emptyForm: WordFormState = {
  englishText: '',
  translationText: '',
  translationLanguage: '',
  group: '',
  textHint: '',
  imageHint: undefined,
};

function buildEmptyForm(defaultTranslationLanguage?: string): WordFormState {
  return {
    ...emptyForm,
    translationLanguage: defaultTranslationLanguage ?? '',
  };
}

function buildFormState(word?: WordEntry, defaultTranslationLanguage?: string): WordFormState {
  if (!word) {
    return buildEmptyForm(defaultTranslationLanguage);
  }

  return {
    englishText: word.englishText,
    translationText: formatSlashSeparatedValues(word.translations),
    translationLanguage: word.translationLanguage,
    group: formatSlashSeparatedValues(word.groups),
    textHint: word.textHint ?? '',
    imageHint: word.imageHint,
  };
}

function buildManualStatusWord(
  word: WordEntry,
  target: 'known' | 'unknown',
  masteryThreshold: number,
): WordEntry {
  if (target === 'known') {
    const now = new Date().toISOString();

    return {
      ...word,
      consecutiveCorrect: masteryThreshold,
      knownAt: now,
    };
  }

  return {
    ...word,
    consecutiveCorrect: 0,
    knownAt: undefined,
  };
}

export function VocabularyPanel({
  words,
  reviewAttempts,
  settings,
  appLanguage,
  activeTranslationLanguage,
  availableTranslationLanguages,
  layoutMode,
  aiReady,
  structuredAiReady,
  aiBusyFeature,
  onCreateWord,
  onImportWords,
  onUpdateWord,
  onDeleteWord,
  onSuggestNextWords,
  onSuggestRelatedWords,
  onQuickAddSuggestion,
}: VocabularyPanelProps) {
  const t = createTranslator(appLanguage);
  const [formMessageIsError, setFormMessageIsError] = useState(false);
  const [isFullFormOpen, setIsFullFormOpen] = useState(false);
  const editorSectionRef = useRef<HTMLDivElement | null>(null);
  const builderSuggestionPanelRef = useRef<HTMLDivElement | null>(null);
  const suggestionPanelRef = useRef<HTMLDivElement | null>(null);
  const detailsSectionRef = useRef<HTMLElement | null>(null);
  const csvImportRef = useRef<HTMLInputElement | null>(null);
  const [form, setForm] = useState<WordFormState>(buildEmptyForm(activeTranslationLanguage));
  const [editingWordId, setEditingWordId] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [quickSaving, setQuickSaving] = useState(false);
  const [quickFormMessage, setQuickFormMessage] = useState('');
  const [quickFormMessageIsError, setQuickFormMessageIsError] = useState(false);
  const [csvImporting, setCsvImporting] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedWordId, setSelectedWordId] = useState<string>('');
  const [lastSavedWord, setLastSavedWord] = useState<WordEntry | null>(null);
  const [builderSuggestions, setBuilderSuggestions] = useState<AiSuggestion[]>([]);
  const [builderSuggestionMessage, setBuilderSuggestionMessage] = useState('');
  const [builderSuggestionMessageIsError, setBuilderSuggestionMessageIsError] = useState(false);
  const [suggestions, setSuggestions] = useState<AiSuggestion[]>([]);
  const [formMessage, setFormMessage] = useState('');
  const [csvMessage, setCsvMessage] = useState('');
  const [csvMessageIsError, setCsvMessageIsError] = useState(false);
  const [suggestionMessage, setSuggestionMessage] = useState('');
  const [suggestionMessageIsError, setSuggestionMessageIsError] = useState(false);
  const previousActiveLanguageRef = useRef(activeTranslationLanguage);
  const deferredSearch = useDeferredValue(search);
  const visibleWords = filterWordsByTranslationLanguage(words, activeTranslationLanguage);

  const selectedWord = visibleWords.find((word) => word.id === selectedWordId) ?? null;
  const editingWord = visibleWords.find((word) => word.id === editingWordId) ?? null;
  const suggestionTargetWord = visibleWords.find((word) => word.id === lastSavedWord?.id) ?? null;

  useEffect(() => {
    if (editingWordId) {
      previousActiveLanguageRef.current = activeTranslationLanguage;
      return;
    }

    setForm((current) => {
      const previousActiveLanguage = previousActiveLanguageRef.current;
      const shouldFollowActiveLanguage =
        !current.translationLanguage.trim() ||
        normalizeForComparison(current.translationLanguage) ===
          normalizeForComparison(previousActiveLanguage);

      if (!shouldFollowActiveLanguage) {
        return current;
      }

      return {
        ...current,
        translationLanguage: activeTranslationLanguage,
      };
    });

    previousActiveLanguageRef.current = activeTranslationLanguage;
  }, [activeTranslationLanguage, editingWordId]);

  useEffect(() => {
    if (!lastSavedWord) {
      return;
    }

    requestAnimationFrame(() => {
      suggestionPanelRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
      });
    });
  }, [lastSavedWord?.id]);

  const filteredWords = visibleWords.filter((word) => {
    const haystack = [
      word.englishText,
      ...word.translations,
      word.translationLanguage,
      ...word.groups,
      word.textHint ?? '',
    ]
      .join(' ')
      .toLocaleLowerCase();

    return haystack.includes(deferredSearch.toLocaleLowerCase().trim());
  });

  function getStatusLabel(status: ReturnType<typeof getWordStatus>): string {
    switch (status) {
      case 'new':
        return t('vocabStatusNew');
      case 'learning':
        return t('vocabStatusLearning');
      case 'known':
        return t('vocabStatusKnown');
      default:
        return status;
    }
  }

  function resetForm() {
    setForm(buildEmptyForm(activeTranslationLanguage));
    setEditingWordId('');
  }

  function handleExportCsv() {
    const timestamp = new Date()
      .toISOString()
      .replaceAll(':', '-')
      .replaceAll('.', '-');
    const csv = buildWordsCsv(words);
    downloadTextFile(`lexigarden-words-${timestamp}.csv`, `\uFEFF${csv}`, 'text/csv;charset=utf-8');
    setCsvMessageIsError(false);
    setCsvMessage(
      t('vocabCsvExported', { count: words.length }),
    );
  }

  async function handleImportCsv(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    const normalizedName = file.name.trim().toLocaleLowerCase();

    if (!normalizedName.endsWith('.csv')) {
      setCsvMessageIsError(true);
      setCsvMessage(t('vocabCsvNeedCsv'));
      event.target.value = '';
      return;
    }

    setCsvImporting(true);
    setCsvMessageIsError(false);
    setCsvMessage(t('vocabCsvImporting'));

    try {
      const parsed = parseWordsCsv(await file.text());

      if (parsed.drafts.length === 0) {
        throw new Error(t('csvNoValidRows'));
      }

      const result = await onImportWords(parsed.drafts);
      const skippedRowNumbers = [...parsed.skippedRowNumbers].sort((left, right) => left - right);
      setCsvMessageIsError(false);
      setCsvMessage(
        describeImportResult(result, {
          skippedRowNumbers,
          includeImageHintNote: true,
        }),
      );
    } catch (error) {
      setCsvMessageIsError(true);
      setCsvMessage(error instanceof Error ? error.message : t('vocabCsvImportFailed'));
    } finally {
      setCsvImporting(false);
      event.target.value = '';
    }
  }

  async function handleSuggestNextWordsFromDraft() {
    const translationLanguage =
      form.translationLanguage.trim() ||
      activeTranslationLanguage.trim() ||
      visibleWords[0]?.translationLanguage ||
      '';

    if (!translationLanguage) {
      setBuilderSuggestions([]);
      setBuilderSuggestionMessage(t('vocabNextWordsNeedLanguage'));
      setBuilderSuggestionMessageIsError(true);
      return;
    }

    setFormMessage('');
    setBuilderSuggestions([]);
    setBuilderSuggestionMessage(t('vocabNextWordsLoading'));
    setBuilderSuggestionMessageIsError(false);
    requestAnimationFrame(() => {
      builderSuggestionPanelRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
      });
    });

    try {
      const nextSuggestions = await onSuggestNextWords({
        translationLanguage,
        group: trimToUndefined(form.group),
        englishText: trimToUndefined(form.englishText),
        translationText: trimToUndefined(form.translationText),
        textHint: trimToUndefined(form.textHint),
      });
      setBuilderSuggestions(nextSuggestions);
      setBuilderSuggestionMessage(
        nextSuggestions.length > 0
          ? t('vocabNextSuggestionsFound', { count: nextSuggestions.length })
          : t('vocabNoNextSuggestions'),
      );
      setBuilderSuggestionMessageIsError(false);
    } catch (error) {
      setBuilderSuggestionMessage(
        error instanceof Error ? error.message : t('vocabNextWordsFailed'),
      );
      setBuilderSuggestionMessageIsError(true);
    }
  }

  async function handleQuickSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setQuickSaving(true);
    setQuickFormMessage('');
    setQuickFormMessageIsError(false);

    const draft: WordDraft = {
      englishText: form.englishText.trim(),
      translationText: form.translationText.trim(),
      translationLanguage: form.translationLanguage.trim() || activeTranslationLanguage,
      group: 'General',
    };

    try {
      const result = await onCreateWord(draft);
      setLastSavedWord(result.word);
      setSelectedWordId(result.word.id);
      setBuilderSuggestions([]);
      setBuilderSuggestionMessage('');
      setBuilderSuggestionMessageIsError(false);
      setSuggestions([]);
      setSuggestionMessage('');
      setSuggestionMessageIsError(false);
      setQuickFormMessage(describeWordMutation(result, { activeTranslationLanguage }));
      setQuickFormMessageIsError(false);
      setForm(buildEmptyForm(activeTranslationLanguage));
    } catch (error) {
      setQuickFormMessage(
        isWordIdentityConflictError(error)
          ? t('wordIdentityConflict')
          : error instanceof Error
            ? error.message
            : t('commonTryAgain'),
      );
      setQuickFormMessageIsError(true);
    } finally {
      setQuickSaving(false);
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setFormMessage('');
    setFormMessageIsError(false);

    const draft: WordDraft = {
      englishText: form.englishText.trim(),
      translationText: form.translationText.trim(),
      translationLanguage: form.translationLanguage.trim(),
      group: trimToUndefined(form.group),
      textHint: trimToUndefined(form.textHint),
      imageHint: form.imageHint,
    };

    try {
      if (editingWord) {
        const result = await onUpdateWord({
          ...editingWord,
          translations: parseSlashSeparatedValues(draft.translationText),
          ...draft,
          groups: parseSlashSeparatedValues(draft.group ?? ''),
        });
        setSelectedWordId(result.word.id);
        setFormMessage(describeWordMutation(result, { activeTranslationLanguage }));
        setFormMessageIsError(false);
      } else {
        const result = await onCreateWord(draft);
        setLastSavedWord(result.word);
        setSelectedWordId(result.word.id);
        setBuilderSuggestions([]);
        setBuilderSuggestionMessage('');
        setBuilderSuggestionMessageIsError(false);
        setSuggestions([]);
        setSuggestionMessage('');
        setSuggestionMessageIsError(false);
        setFormMessage(describeWordMutation(result, { activeTranslationLanguage }));
        setFormMessageIsError(false);
      }

      resetForm();
    } catch (error) {
      setFormMessage(
        isWordIdentityConflictError(error)
          ? t('wordIdentityConflict')
          : error instanceof Error
            ? error.message
            : t('commonTryAgain'),
      );
      setFormMessageIsError(true);
    } finally {
      setSaving(false);
    }
  }

  async function handleSuggest(word: WordEntry) {
    setFormMessage('');
    setLastSavedWord(word);
    setSelectedWordId(word.id);
    setSuggestions([]);
    setSuggestionMessage(t('vocabSuggestRelatedLoading', { word: word.englishText }));
    setSuggestionMessageIsError(false);
    requestAnimationFrame(() => {
      suggestionPanelRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
      });
    });

    try {
      const nextSuggestions = await onSuggestRelatedWords(word);
      setSuggestions(nextSuggestions);
      setSuggestionMessage(
        nextSuggestions.length > 0
          ? t('vocabSuggestRelatedFound', {
              count: nextSuggestions.length,
              word: word.englishText,
            })
          : t('vocabSuggestRelatedNone', { word: word.englishText }),
      );
      setSuggestionMessageIsError(false);
    } catch (error) {
      setSuggestionMessage(
        error instanceof Error ? error.message : t('vocabSuggestRelatedFailed'),
      );
      setSuggestionMessageIsError(true);
    }
  }

  function beginEdit(word: WordEntry) {
    setEditingWordId(word.id);
    setSelectedWordId(word.id);
    setForm(buildFormState(word, activeTranslationLanguage));
    setBuilderSuggestions([]);
    setBuilderSuggestionMessage('');
    setBuilderSuggestionMessageIsError(false);
    setSuggestions([]);
    setLastSavedWord(null);
    setSuggestionMessage('');
    setSuggestionMessageIsError(false);
    setFormMessage(t('vocabEditingWord', { word: word.englishText }));
    requestAnimationFrame(() => {
      editorSectionRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
    });
  }

  function showDetails(word: WordEntry) {
    setSelectedWordId(word.id);
    requestAnimationFrame(() => {
      detailsSectionRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
    });
  }

  function closeSuggestions() {
    setSuggestions([]);
    setSuggestionMessage('');
    setSuggestionMessageIsError(false);
    setLastSavedWord(null);
  }

  function closeBuilderSuggestions() {
    setBuilderSuggestions([]);
    setBuilderSuggestionMessage('');
    setBuilderSuggestionMessageIsError(false);
  }

  const selectedAttempts = selectedWord
    ? reviewAttempts.filter((attempt) => attempt.wordId === selectedWord.id)
    : [];

  return (
    <div className={`panel-grid ${layoutMode === 'stacked' ? 'stacked-layout' : ''}`}>
      <section className="panel accent-panel">
        <div ref={builderSuggestionPanelRef} className="suggestion-panel builder-suggestion-panel">
          <div className="panel-heading compact">
            <div>
              <p className="eyebrow">{t('vocabAiEyebrow')}</p>
              <h3>{t('vocabNextTitle')}</h3>
            </div>
            <div className="action-row narrow">
              <button
                type="button"
                className="secondary-button"
                disabled={!aiReady || !structuredAiReady || aiBusyFeature === 'nextWords'}
                onClick={() => void handleSuggestNextWordsFromDraft()}
              >
                {aiBusyFeature === 'nextWords'
                  ? t('commonThinking')
                  : builderSuggestions.length > 0 || builderSuggestionMessage
                    ? t('vocabFindMore')
                    : t('vocabSuggestNextWords')}
              </button>
              <button
                type="button"
                className="ghost-button"
                disabled={aiBusyFeature === 'nextWords'}
                onClick={closeBuilderSuggestions}
              >
                {t('commonClose')}
              </button>
            </div>
          </div>

          {structuredAiReady ? (
          <p className="helper-text">
              {t('vocabNextHelpReady', {
                language: activeTranslationLanguage || t('commonLanguage'),
              })}
            </p>
          ) : aiReady ? (
            <p className="helper-text">
              {t('vocabNextHelpStructured')}
            </p>
          ) : (
            <p className="helper-text">{t('vocabNextHelpSetup')}</p>
          )}

          {builderSuggestionMessage ? (
            <p className={builderSuggestionMessageIsError ? 'helper-text error-text' : 'helper-text'}>
              {builderSuggestionMessage}
            </p>
          ) : null}

          <div className="suggestion-list">
            {builderSuggestions.length === 0 &&
            !builderSuggestionMessageIsError &&
            aiBusyFeature !== 'nextWords' ? (
              <p className="helper-text">
                {t('vocabNextEmpty')}
              </p>
            ) : (
              builderSuggestions.map((suggestion) => (
                <article key={`${suggestion.englishText}-${suggestion.translationText}`} className="suggestion-card">
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <strong className="english-text word-primary">{suggestion.englishText}</strong>
                      <PlayButton text={suggestion.englishText} />
                    </div>
                    <p className="translation-copy translation-text">
                      {suggestion.translationText} · {suggestion.translationLanguage}
                    </p>
                    {suggestion.reason ? <small>{suggestion.reason}</small> : null}
                  </div>
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => void onQuickAddSuggestion(suggestion)}
                  >
                    {t('commonAdd')}
                  </button>
                </article>
              ))
            )}
          </div>
        </div>

        <div ref={editorSectionRef} className="detail-stack builder-form-stack">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">{words.length === 0 ? t('onboardingVocabEyebrow') : t('vocabBuilderEyebrow')}</p>
              <h2>{words.length === 0 ? t('onboardingVocabTitle') : editingWord ? t('vocabEditTitle') : t('vocabAddTitle')}</h2>
            </div>
            {editingWord ? (
              <button type="button" className="ghost-button" onClick={resetForm}>
                {t('vocabCancelEdit')}
              </button>
            ) : null}
          </div>

          {words.length === 0 ? <p className="helper-text">{t('onboardingVocabCopy')}</p> : null}

          {!editingWord && !isFullFormOpen ? (
            <form className="word-form" onSubmit={handleQuickSubmit} style={{ marginBottom: '24px' }}>
              <div className="quick-add-row">
                <input
                  className="english-input"
                  value={form.englishText}
                  onChange={(e) => setForm((c) => ({ ...c, englishText: e.target.value }))}
                  placeholder={t('fieldEnglish')}
                  required
                />
                <input
                  className="translation-input"
                  value={form.translationText}
                  onChange={(e) => setForm((c) => ({ ...c, translationText: e.target.value }))}
                  placeholder={form.translationLanguage || activeTranslationLanguage || t('fieldTranslationFallback')}
                  required
                />
                <button type="submit" className="primary-button" disabled={quickSaving}>
                  {quickSaving ? t('vocabSaving') : t('commonAdd')}
                </button>
              </div>
              {quickFormMessage ? (
                <p className={quickFormMessageIsError ? 'helper-text error-text' : 'helper-text'}>{quickFormMessage}</p>
              ) : null}
            </form>
          ) : null}

          <details 
            className="full-form-details" 
            open={Boolean(editingWord) || isFullFormOpen}
            onToggle={(e) => setIsFullFormOpen((e.target as HTMLDetailsElement).open)}
          >
            <summary style={{ cursor: 'pointer', fontWeight: 600, color: 'var(--teal)', marginBottom: '16px' }}>
              {editingWord ? t('vocabEditTitle') : t('vocabFullFormSummary')}
            </summary>
            <form className="word-form" onSubmit={handleSubmit}>
            <WordEditorFields
              appLanguage={appLanguage}
              value={form}
              activeTranslationLanguage={activeTranslationLanguage}
              availableTranslationLanguages={availableTranslationLanguages}
              languageDatalistId="vocabulary-language-options"
              required
              onChange={(patch) =>
                setForm((current) => ({
                  ...current,
                  ...patch,
                }))
              }
            />

            <div className="form-actions">
              <button type="submit" className="primary-button" disabled={saving}>
                {saving ? t('vocabSaving') : editingWord ? t('vocabSaveChanges') : t('vocabAddWord')}
              </button>
              {formMessage ? (
                <p className={formMessageIsError ? 'helper-text error-text' : 'helper-text'}>{formMessage}</p>
              ) : null}
            </div>
          </form>
          </details>
        </div>

      </section>

      <section className="panel vocabulary-list-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">{t('vocabDictionaryEyebrow')}</p>
            <h2>{t('vocabSavedWords')}</h2>
          </div>
          <div className="stats-inline">
            <span>{visibleWords.length} {t('statTotalWords').toLocaleLowerCase()}</span>
            <span>
              {t('vocabKnownCount', {
                count: visibleWords.filter((word) => getWordStatus(word, settings.masteryThreshold) === 'known').length,
              })}
            </span>
          </div>
        </div>

        <div className="suggestion-panel csv-transfer-panel">
          <div className="panel-heading compact">
            <div>
              <p className="eyebrow">{t('vocabCsvEyebrow')}</p>
              <h3>{t('vocabCsvTitle')}</h3>
            </div>
            <div className="action-row narrow">
              <button type="button" className="secondary-button" onClick={handleExportCsv}>
                {t('vocabExportCsv')}
              </button>
              <button
                type="button"
                className="ghost-button"
                disabled={csvImporting}
                onClick={() => csvImportRef.current?.click()}
              >
                {csvImporting ? t('vocabCsvImporting') : t('vocabImportCsv')}
              </button>
            </div>
          </div>

          <p className="helper-text">{t('vocabCsvHelp')}</p>

          {csvMessage ? (
            <p className={csvMessageIsError ? 'helper-text error-text' : 'helper-text'}>{csvMessage}</p>
          ) : null}

          <input
            ref={csvImportRef}
            type="file"
            accept=".csv,text/csv"
            hidden
            onChange={handleImportCsv}
          />
        </div>

        <label className="full-width search-field">
          {t('vocabSearchLabel')}
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('vocabSearchPlaceholder')}
          />
        </label>

        <div className="word-list">
          {filteredWords.length === 0 ? (
            <div className="empty-state">
              <p>
                {activeTranslationLanguage
                  ? `${activeTranslationLanguage}: ${t('commonNoDataYet')}`
                  : t('commonNoDataYet')}
              </p>
            </div>
          ) : (
            filteredWords.map((word) => {
              const status = getWordStatus(word, settings.masteryThreshold);
              const isSuggestionTarget = suggestionTargetWord?.id === word.id;

              return (
                <div key={word.id} className="word-entry-stack">
                  <article className="word-card">
                    <div>
                      <div className="word-card-header">
                        <strong className="english-text word-primary">{word.englishText}</strong>
                        <span className={`status-badge ${status}`}>{getStatusLabel(status)}</span>
                      </div>
                      <div className="value-chip-row compact">
                        {word.translations.map((translation) => (
                          <span key={translation} className="value-chip translation-text">
                            {translation}
                          </span>
                        ))}
                      </div>
                      <small>
                        {word.translationLanguage}
                      </small>
                      {word.groups.length > 0 ? (
                        <div className="value-chip-row compact">
                          {word.groups.map((group) => (
                            <span key={group} className="value-chip muted-chip">
                              {group}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>

                    <div className="word-card-actions">
                      <button type="button" className="ghost-button" onClick={() => showDetails(word)}>
                        {t('vocabDetails')}
                      </button>
                      <button type="button" className="ghost-button" onClick={() => beginEdit(word)}>
                        {t('commonEdit')}
                      </button>
                      <button
                        type="button"
                        className="ghost-button"
                        onClick={() =>
                          void onUpdateWord(
                            buildManualStatusWord(
                              word,
                              status === 'known' ? 'unknown' : 'known',
                              settings.masteryThreshold,
                            ),
                          )
                        }
                      >
                        {status === 'known' ? t('vocabMarkUnknown') : t('vocabMarkKnown')}
                      </button>
                      {aiReady && structuredAiReady ? (
                        <button type="button" className="ghost-button" onClick={() => void handleSuggest(word)}>
                          {t('vocabRelated')}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="ghost-button danger-button"
                        onClick={() => {
                          if (window.confirm(t('vocabDeleteConfirm', { word: word.englishText }))) {
                            void onDeleteWord(word.id);
                          }
                        }}
                      >
                        {t('commonDelete')}
                      </button>
                    </div>
                  </article>

                  {isSuggestionTarget ? (
                    <div ref={suggestionPanelRef} className="suggestion-panel inline-suggestion-panel">
                      <div className="panel-heading compact">
                        <div>
                          <p className="eyebrow">{t('vocabAiEyebrow')}</p>
                          <h3>{`${t('vocabRelated')} · ${word.englishText}`}</h3>
                        </div>
                        <div className="action-row narrow">
                          <button
                            type="button"
                            className="secondary-button"
                            disabled={!aiReady || !structuredAiReady || aiBusyFeature === `related:${word.id}`}
                            onClick={() => void handleSuggest(word)}
                          >
                            {aiBusyFeature === `related:${word.id}`
                              ? t('commonThinking')
                              : suggestions.length > 0 || suggestionMessage
                                ? t('vocabFindMore')
                                : t('vocabRelated')}
                          </button>
                          <button
                            type="button"
                            className="ghost-button"
                            disabled={aiBusyFeature === `related:${word.id}`}
                            onClick={closeSuggestions}
                          >
                            {t('commonClose')}
                          </button>
                        </div>
                      </div>

                      {!structuredAiReady && aiReady ? (
                        <p className="helper-text">
                          {t('vocabNextHelpStructured')}
                        </p>
                      ) : null}

                      {suggestionMessage ? (
                        <p className={suggestionMessageIsError ? 'helper-text error-text' : 'helper-text'}>
                          {suggestionMessage}
                        </p>
                      ) : null}

                      <div className="suggestion-list">
                        {suggestions.length === 0 &&
                        !suggestionMessageIsError &&
                        aiBusyFeature !== `related:${word.id}` ? (
                          <p className="helper-text">
                            {t('vocabRelatedHelp')}
                          </p>
                        ) : (
                          suggestions.map((suggestion) => (
                            <article
                              key={`${suggestion.englishText}-${suggestion.translationText}`}
                              className="suggestion-card"
                            >
                              <div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                  <strong className="english-text word-primary">{suggestion.englishText}</strong>
                                  <PlayButton text={suggestion.englishText} />
                                </div>
                                <p className="translation-copy translation-text">
                                  {suggestion.translationText} · {suggestion.translationLanguage}
                                </p>
                                {suggestion.reason ? <small>{suggestion.reason}</small> : null}
                              </div>
                              <button
                                type="button"
                                className="ghost-button"
                                onClick={() => void onQuickAddSuggestion(suggestion)}
                              >
                                {t('commonAdd')}
                              </button>
                            </article>
                          ))
                        )}
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })
          )}
        </div>
      </section>

      <section ref={detailsSectionRef} className="panel detail-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">{t('vocabWordDetailsEyebrow')}</p>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <h2 className={selectedWord ? 'english-text' : undefined} style={{ margin: 0 }}>
                {selectedWord ? selectedWord.englishText : t('commonWord')}
              </h2>
              {selectedWord ? <PlayButton text={selectedWord.englishText} /> : null}
            </div>
          </div>
        </div>

        {selectedWord ? (
          <div className="detail-stack">
            <div className="detail-grid">
              <article>
                <span>{t('vocabTranslationsLabel')}</span>
                <div className="value-chip-row compact">
                  {selectedWord.translations.map((translation) => (
                    <span key={translation} className="value-chip translation-text">
                      {translation}
                    </span>
                  ))}
                </div>
              </article>
              <article>
                <span>{t('commonStatus')}</span>
                <strong>{getStatusLabel(getWordStatus(selectedWord, settings.masteryThreshold))}</strong>
              </article>
              <article>
                <span>{t('commonReviews')}</span>
                <strong>{selectedWord.reviewCount}</strong>
              </article>
              <article>
                <span>{t('vocabConsecutiveCorrect')}</span>
                <strong>{selectedWord.consecutiveCorrect}</strong>
              </article>
            </div>

            <div className="detail-copy">
              <p>
                <strong>{t('commonCreated')}:</strong> {formatDateTime(selectedWord.createdAt)}
              </p>
              <p>
                <strong>{t('commonLastSeen')}:</strong> {formatDateTime(selectedWord.lastSeenAt)}
              </p>
              {selectedWord.groups.length > 0 ? (
                <div className="detail-copy-row">
                  <strong>{t('vocabGroups')}:</strong>
                  <div className="value-chip-row compact">
                    {selectedWord.groups.map((group) => (
                      <span key={group} className="value-chip muted-chip">
                        {group}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
              {selectedWord.textHint ? (
                <p>
                  <strong>{t('commonHint')}:</strong> {selectedWord.textHint}
                </p>
              ) : null}
              {selectedWord.imageHint ? (
                <div className="image-preview small">
                  <img src={selectedWord.imageHint.dataUrl} alt={selectedWord.imageHint.name} />
                </div>
              ) : null}
            </div>

            <div className="history-list">
              <h3>{t('vocabReviewHistory')}</h3>
              {selectedAttempts.length === 0 ? (
                <p className="helper-text">{t('vocabNoReviewHistory')}</p>
              ) : (
                selectedAttempts.map((attempt) => (
                  <article key={attempt.id} className="history-row">
                    <div>
                      <strong>
                        {attempt.action === 'dontKnow'
                          ? t('vocabReviewActionDontKnow')
                          : attempt.action === 'dontShowToday'
                            ? t('vocabReviewActionDontShowToday')
                            : attempt.wasCorrect
                              ? t('commonCorrect')
                              : t('commonMissed')}
                      </strong>
                      <p>{formatDateTime(attempt.shownAt)}</p>
                    </div>
                    <small>
                      {`${t('studyShowedIn', {
                        language:
                          attempt.promptSide === 'english'
                            ? t('commonEnglish')
                            : selectedWord.translationLanguage,
                      })}${attempt.usedHint ? ` · ${t('commonHint').toLocaleLowerCase()}` : ''}`}
                    </small>
                  </article>
                ))
              )}
            </div>
          </div>
        ) : (
          <div className="empty-state">
            <p>{t('vocabSelectWordForDetails')}</p>
          </div>
        )}
      </section>
    </div>
  );
}
