import { useEffect, useRef, useState } from 'react';
import { createTranslator } from '../lib/i18n';
import { shouldShowAudioForLanguage } from '../lib/language-settings';
import { PromptMixPicker } from './shared/PromptMixPicker';
import { StudyModeSelector } from './shared/StudyModeSelector';
import { PlayButton } from './shared/PlayButton';
import {
  areAnswersEquivalent,
  findMatchingAnswerOption,
  formatDateTime,
  formatDateOnly,
  getTodayDateKey,
  isNearMiss,
  isNearMissForOptions,
  normalizeForComparison,
} from '../lib/text';
import {
  buildStudyCards,
  buildWordPrompt,
  filterWordsByTranslationLanguage,
  getUniqueGroups,
  selectWordsByMode,
} from '../lib/study';
import type {
  AppSettings,
  PageLayoutMode,
  SupportedAppLanguage,
  StudyCard,
  StudySelection,
  WordEntry,
} from '../types';

interface StudyPanelProps {
  words: WordEntry[];
  settings: AppSettings;
  appLanguage: SupportedAppLanguage;
  activeTranslationLanguage: string;
  layoutMode: PageLayoutMode;
  aiReady: boolean;
  sentenceHints: Record<string, string>;
  aiBusyFeature: string;
  onRecordReview: (params: {
    wordId: string;
    promptSide: 'english' | 'translation';
    userAnswer: string;
    wasCorrect: boolean;
    usedHint: boolean;
    action: 'check' | 'dontKnow';
  }) => Promise<void>;
  onSnoozeWord: (wordId: string, promptSide: 'english' | 'translation') => Promise<void>;
  onGenerateSentence: (word: WordEntry) => Promise<string>;
  onExplainMistake: (word: WordEntry, userAnswer: string, promptSide: 'english' | 'translation') => Promise<string>;
}

interface FeedbackState {
  kind: 'correct' | 'incorrect' | 'revealed' | 'snoozed';
  message: string;
  answerListLabel?: string;
  answerList?: string[];
}

interface StudySessionHistoryEntry {
  id: string;
  cardId: string;
  wordId: string;
  promptSide: StudyCard['promptSide'];
  promptText: string;
  primaryAnswer: string;
  acceptedAnswers: string[];
  selectedAnswer: string;
  result: FeedbackState['kind'];
  translationLanguage: string;
  usedHint: boolean;
}

export function StudyPanel({
  words,
  settings,
  appLanguage,
  activeTranslationLanguage,
  layoutMode,
  aiReady,
  sentenceHints,
  aiBusyFeature,
  onRecordReview,
  onSnoozeWord,
  onGenerateSentence,
  onExplainMistake,
}: StudyPanelProps) {
  const t = createTranslator(appLanguage);
  const audioButtonTitle = t('commonPlayAudio');
  const translationLabel = activeTranslationLanguage || t('commonLanguage');
  const shouldShowAudio = (language?: string) => shouldShowAudioForLanguage(settings, language);
  const studyAreaRef = useRef<HTMLElement | null>(null);
  const [selection, setSelection] = useState<StudySelection>({ mode: 'all' });
  const [englishPromptPercentage, setEnglishPromptPercentage] = useState(50);
  const [cards, setCards] = useState<StudyCard[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answer, setAnswer] = useState('');
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);
  const [hintVisible, setHintVisible] = useState(false);
  const [usedHint, setUsedHint] = useState(false);
  const [explainMistakeText, setExplainMistakeText] = useState('');
  const [explainMistakeLoading, setExplainMistakeLoading] = useState(false);
  const [sessionExplainMistakes, setSessionExplainMistakes] = useState<Record<string, string>>({});
  const [sessionExplainLoadingId, setSessionExplainLoadingId] = useState('');
  const [sessionStartedAt, setSessionStartedAt] = useState('');
  const [sessionFinishedAt, setSessionFinishedAt] = useState('');
  const [sessionHistory, setSessionHistory] = useState<StudySessionHistoryEntry[]>([]);
  const [summary, setSummary] = useState({ correct: 0, incorrect: 0, snoozed: 0 });
  const activeLanguageWords = filterWordsByTranslationLanguage(words, activeTranslationLanguage);
  const groups = getUniqueGroups(activeLanguageWords);

  const candidateCount = selectWordsByMode(activeLanguageWords, settings, selection).filter((word) => {
    const todayKey = getTodayDateKey();
    return word.snoozedUntilDate !== todayKey;
  }).length;
  const canStartSession = Boolean(activeTranslationLanguage) && candidateCount > 0;

  const currentCard = cards[currentIndex] ?? null;
  const sessionComplete = cards.length > 0 && currentIndex >= cards.length;
  const reviewedCount = sessionHistory.length;
  const attemptedCount = summary.correct + summary.incorrect;
  const accuracy = attemptedCount > 0 ? Math.round((summary.correct / attemptedCount) * 100) : 0;
  const promptClassName =
    currentCard?.promptSide === 'english'
      ? 'study-prompt english-display english-text'
      : 'study-prompt translation-display translation-text';
  const answerInputClassName =
    currentCard?.promptSide === 'english' ? 'translation-input' : 'english-input';
  useEffect(() => {
    if (selection.mode === 'group' && selection.group) {
      return;
    }

    if (selection.mode === 'group' && groups[0]) {
      setSelection({ mode: 'group', group: groups[0] });
    }
  }, [groups, selection.mode, selection.group]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement ||
        (event.target as HTMLElement).isContentEditable
      ) {
        return;
      }

      if (!currentCard) {
        return;
      }

      if (feedback) {
        if (event.key === 'Enter') {
          event.preventDefault();
          goToNextCard();
        }
        return;
      }

      switch (event.key.toLowerCase()) {
        case 'enter':
          if (answer.trim()) {
            event.preventDefault();
            void handleCheckAnswer();
          }
          break;
        case 'h':
          event.preventDefault();
          setHintVisible((current) => !current);
          setUsedHint(true);
          break;
        case 'd':
          event.preventDefault();
          void handleDontKnow();
          break;
        case 's':
          event.preventDefault();
          void handleSnooze();
          break;
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentCard, feedback, answer, hintVisible, usedHint, handleCheckAnswer, handleDontKnow, handleSnooze, goToNextCard]);

  function resetSessionState() {
    setCards([]);
    setCurrentIndex(0);
    setAnswer('');
    setFeedback(null);
    setHintVisible(false);
    setUsedHint(false);
    setExplainMistakeText('');
    setExplainMistakeLoading(false);
    setSessionExplainMistakes({});
    setSessionExplainLoadingId('');
    setSessionStartedAt('');
    setSessionFinishedAt('');
    setSessionHistory([]);
    setSummary({ correct: 0, incorrect: 0, snoozed: 0 });
  }

  function startSession() {
    if (!canStartSession) {
      return;
    }

    const nextCards = buildStudyCards(
      activeLanguageWords,
      settings,
      selection,
      englishPromptPercentage,
    );
    resetSessionState();
    setSessionStartedAt(new Date().toISOString());
    setCards(nextCards);
    requestAnimationFrame(() => {
      studyAreaRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
    });
  }

  function getSetupMessage() {
    if (!activeTranslationLanguage) {
      return t('studyChooseLanguageFirst');
    }

    if (activeLanguageWords.length === 0) {
      return t('studyAddWordsFirst', { language: activeTranslationLanguage });
    }

    if (candidateCount === 0) {
      return t('studyNoReadyWords');
    }

    return '';
  }

  function goToNextCard() {
    const nextIndex = currentIndex + 1;
    if (nextIndex >= cards.length) {
      setSessionFinishedAt(new Date().toISOString());
    }
    setCurrentIndex(nextIndex);
    setAnswer('');
    setFeedback(null);
    setHintVisible(false);
    setUsedHint(false);
    setExplainMistakeText('');
    setExplainMistakeLoading(false);
  }

  function finishSession() {
    if (cards.length === 0) {
      resetSessionState();
      return;
    }

    setSessionFinishedAt(new Date().toISOString());
    setCurrentIndex(cards.length);
    setAnswer('');
    setFeedback(null);
    setHintVisible(false);
    setUsedHint(false);
    setExplainMistakeText('');
    setExplainMistakeLoading(false);
    requestAnimationFrame(() => {
      studyAreaRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
    });
  }

  function removeUpcomingCardsForWord(wordId: string) {
    setCards((current) =>
      current.filter((card, index) => index <= currentIndex || card.word.id !== wordId),
    );
  }

  function appendSessionHistory(entry: StudySessionHistoryEntry) {
    setSessionHistory((current) => [...current, entry]);
  }

  function getPromptLanguage(promptSide: StudyCard['promptSide'], translationLanguage: string) {
    return promptSide === 'english' ? 'English' : translationLanguage;
  }

  function getAnswerLanguage(promptSide: StudyCard['promptSide'], translationLanguage: string) {
    return promptSide === 'english' ? translationLanguage : 'English';
  }

  function renderStudySessionEntry(entry: StudySessionHistoryEntry) {
    const promptLanguage = getPromptLanguage(entry.promptSide, entry.translationLanguage);
    const answerLanguage = getAnswerLanguage(entry.promptSide, entry.translationLanguage);
    const showPromptAudio = shouldShowAudio(promptLanguage);
    const showAnswerAudio = shouldShowAudio(answerLanguage);
    const statusMeta =
      entry.result === 'correct'
        ? { label: t('commonCorrect'), tone: 'positive' }
        : entry.result === 'snoozed'
          ? { label: t('commonSnoozed'), tone: 'neutral' }
          : { label: t('commonMissed'), tone: 'warning' };
    const sessionExplanation = sessionExplainMistakes[entry.id];
    const canExplainMistake = aiReady && entry.result === 'incorrect' && Boolean(entry.selectedAnswer);
    const sessionExplanationLoading = sessionExplainLoadingId === entry.id;
    const extraAcceptedAnswers = entry.acceptedAnswers.filter((acceptedAnswer) => {
      const normalizedAcceptedAnswer = normalizeForComparison(acceptedAnswer);
      const normalizedPrimaryAnswer = normalizeForComparison(entry.primaryAnswer);
      const normalizedSelectedAnswer = normalizeForComparison(entry.selectedAnswer);

      return (
        normalizedAcceptedAnswer !== normalizedPrimaryAnswer &&
        normalizedAcceptedAnswer !== normalizedSelectedAnswer
      );
    });

    return (
      <article key={entry.id} className="history-row" style={{ display: 'block' }}>
        <div className="study-session-history-row">
          <div className="study-session-history-copy">
            <strong className="study-session-inline-copy">
              <span className={entry.promptSide === 'english' ? 'english-text' : 'translation-text'}>
                {entry.promptText}
              </span>
              {showPromptAudio ? (
                <PlayButton
                  text={entry.promptText}
                  language={promptLanguage}
                  title={audioButtonTitle}
                />
              ) : null}
            </strong>
            <p>
              {entry.result === 'incorrect' && entry.selectedAnswer ? (
                <>
                  <span className="study-session-answer wrong">
                    <span className={entry.promptSide === 'english' ? 'translation-text' : 'english-text'}>
                      {entry.selectedAnswer}
                    </span>
                    {showAnswerAudio ? (
                      <PlayButton
                        text={entry.selectedAnswer}
                        language={answerLanguage}
                        title={audioButtonTitle}
                      />
                    ) : null}
                  </span>
                  {' → '}
                  <span className="study-session-answer correct">
                    <span className={entry.promptSide === 'english' ? 'translation-text' : 'english-text'}>
                      {entry.primaryAnswer}
                    </span>
                    {showAnswerAudio ? (
                      <PlayButton
                        text={entry.primaryAnswer}
                        language={answerLanguage}
                        title={audioButtonTitle}
                      />
                    ) : null}
                  </span>
                </>
              ) : (
                <span className="study-session-answer correct">
                  <span className={entry.promptSide === 'english' ? 'translation-text' : 'english-text'}>
                    {entry.primaryAnswer}
                  </span>
                  {showAnswerAudio ? (
                    <PlayButton
                      text={entry.primaryAnswer}
                      language={answerLanguage}
                      title={audioButtonTitle}
                    />
                  ) : null}
                </span>
              )}
            </p>
            {extraAcceptedAnswers.length > 0 ? (
              <div className="value-chip-row compact">
                {extraAcceptedAnswers.map((acceptedAnswer) => (
                  <span key={`${entry.id}-${acceptedAnswer}`} className="value-chip translation-text">
                    <span>{acceptedAnswer}</span>
                    {showAnswerAudio ? (
                      <PlayButton
                        text={acceptedAnswer}
                        language={answerLanguage}
                        title={audioButtonTitle}
                      />
                    ) : null}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
          <div className="study-session-history-side">
            <span className={`status-chip ${statusMeta.tone}`}>{statusMeta.label}</span>
            {canExplainMistake ? (
              <button
                type="button"
                className="ghost-button"
                disabled={sessionExplanationLoading}
                onClick={() => void handleExplainSessionMistake(entry)}
              >
                {sessionExplanationLoading ? t('commonWriting') : t('aiFeatureExplainMistake')}
              </button>
            ) : null}
            {entry.usedHint ? <small>{t('studyHintUsed')}</small> : null}
          </div>
        </div>
        {sessionExplanation ? (
          <div className="hint-box study-session-explanation">
            <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{sessionExplanation}</p>
          </div>
        ) : null}
      </article>
    );
  }

  async function handleCheckAnswer() {
    if (!currentCard) {
      return;
    }

    const matchedTranslation =
      currentCard.promptSide === 'english'
        ? findMatchingAnswerOption(currentCard.word.translations, answer)
        : undefined;
    const wasCorrect =
      currentCard.promptSide === 'english'
        ? Boolean(matchedTranslation)
        : areAnswersEquivalent(currentCard.word.englishText, answer);

    await onRecordReview({
      wordId: currentCard.word.id,
      promptSide: currentCard.promptSide,
      userAnswer: answer,
      wasCorrect,
      usedHint,
      action: 'check',
    });

    setSummary((current) => ({
      ...current,
      correct: current.correct + (wasCorrect ? 1 : 0),
      incorrect: current.incorrect + (wasCorrect ? 0 : 1),
    }));

    if (wasCorrect) {
      const otherAcceptedAnswers =
        currentCard.promptSide === 'english'
          ? currentCard.word.translations.filter(
              (translation) =>
                normalizeForComparison(translation) !==
                normalizeForComparison(matchedTranslation ?? ''),
            )
          : currentCard.word.translations.slice(1);

      setFeedback({
                kind: 'correct',
        message: t('studyCorrectFeedback', { word: currentCard.word.englishText }),
        answerListLabel:
          otherAcceptedAnswers.length > 0
            ? t('studyOtherAcceptedAnswers', {
                language: currentCard.word.translationLanguage,
              })
            : undefined,
        answerList: otherAcceptedAnswers,
      });
      appendSessionHistory({
        id: crypto.randomUUID(),
        cardId: currentCard.id,
        wordId: currentCard.word.id,
        promptSide: currentCard.promptSide,
        promptText: buildWordPrompt(currentCard.word, currentCard.promptSide),
        primaryAnswer:
          currentCard.promptSide === 'english'
            ? matchedTranslation ?? currentCard.word.translations[0] ?? ''
            : currentCard.word.englishText,
        acceptedAnswers:
          currentCard.promptSide === 'english'
            ? currentCard.word.translations.slice()
            : [currentCard.word.englishText],
        selectedAnswer: answer.trim(),
        result: 'correct',
        translationLanguage: currentCard.word.translationLanguage,
        usedHint,
      });
      return;
    }

    appendSessionHistory({
      id: crypto.randomUUID(),
      cardId: currentCard.id,
      wordId: currentCard.word.id,
      promptSide: currentCard.promptSide,
      promptText: buildWordPrompt(currentCard.word, currentCard.promptSide),
      primaryAnswer:
        currentCard.promptSide === 'english'
          ? currentCard.word.translations[0] ?? ''
          : currentCard.word.englishText,
      acceptedAnswers:
        currentCard.promptSide === 'english'
          ? currentCard.word.translations.slice()
          : [currentCard.word.englishText],
      selectedAnswer: answer.trim(),
      result: 'incorrect',
      translationLanguage: currentCard.word.translationLanguage,
      usedHint,
    });
    setFeedback({
      kind: 'incorrect',
      message:
        currentCard.promptSide === 'english'
          ? isNearMissForOptions(currentCard.word.translations, answer)
            ? t('studyAlmostManyAnswers', {
                word: currentCard.word.englishText,
                language: currentCard.word.translationLanguage,
              })
            : t('studyWrongManyAnswers', {
                word: currentCard.word.englishText,
                language: currentCard.word.translationLanguage,
              })
          : isNearMiss(currentCard.word.englishText, answer)
            ? t('studyAlmostEnglishWord', { word: currentCard.word.englishText })
            : t('studyWrongEnglishWord', { word: currentCard.word.englishText }),
      answerListLabel: t('studyAcceptedAnswers', {
        language: currentCard.word.translationLanguage,
      }),
      answerList: currentCard.word.translations,
    });
  }

  async function handleDontKnow() {
    if (!currentCard) {
      return;
    }

    await onRecordReview({
      wordId: currentCard.word.id,
      promptSide: currentCard.promptSide,
      userAnswer: '',
      wasCorrect: false,
      usedHint,
      action: 'dontKnow',
    });

    setSummary((current) => ({
      ...current,
      incorrect: current.incorrect + 1,
    }));

    appendSessionHistory({
      id: crypto.randomUUID(),
      cardId: currentCard.id,
      wordId: currentCard.word.id,
      promptSide: currentCard.promptSide,
      promptText: buildWordPrompt(currentCard.word, currentCard.promptSide),
      primaryAnswer:
        currentCard.promptSide === 'english'
          ? currentCard.word.translations[0] ?? ''
          : currentCard.word.englishText,
      acceptedAnswers:
        currentCard.promptSide === 'english'
          ? currentCard.word.translations.slice()
          : [currentCard.word.englishText],
      selectedAnswer: '',
      result: 'revealed',
      translationLanguage: currentCard.word.translationLanguage,
      usedHint,
    });
    setFeedback({
      kind: 'revealed',
      message:
        currentCard.promptSide === 'english'
          ? t('studyRevealForWord', { word: currentCard.word.englishText })
          : t('studyRevealEnglishWord', { word: currentCard.word.englishText }),
      answerListLabel: t('studyAcceptedAnswers', {
        language: currentCard.word.translationLanguage,
      }),
      answerList: currentCard.word.translations,
    });
  }

  async function handleExplainMistake() {
    if (!currentCard || !feedback || feedback.kind !== 'incorrect') return;
    setExplainMistakeLoading(true);
    try {
      const explanation = await onExplainMistake(currentCard.word, answer, currentCard.promptSide);
      setExplainMistakeText(explanation);
    } catch (err) {
      console.error('Failed to explain mistake:', err);
      setExplainMistakeText(t('aiExplainMistakeFailed'));
    } finally {
      setExplainMistakeLoading(false);
    }
  }

  async function handleExplainSessionMistake(entry: StudySessionHistoryEntry) {
    if (entry.result !== 'incorrect' || !entry.selectedAnswer) {
      return;
    }

    const matchedWord = words.find((word) => word.id === entry.wordId);
    if (!matchedWord) {
      setSessionExplainMistakes((current) => ({
        ...current,
        [entry.id]: t('aiExplainMistakeFailed'),
      }));
      return;
    }

    setSessionExplainLoadingId(entry.id);
    try {
      const explanation = await onExplainMistake(matchedWord, entry.selectedAnswer, entry.promptSide);
      setSessionExplainMistakes((current) => ({
        ...current,
        [entry.id]: explanation,
      }));
    } catch (err) {
      console.error('Failed to explain summary mistake:', err);
      setSessionExplainMistakes((current) => ({
        ...current,
        [entry.id]: t('aiExplainMistakeFailed'),
      }));
    } finally {
      setSessionExplainLoadingId('');
    }
  }

  async function handleSnooze() {
    if (!currentCard) {
      return;
    }

    await onSnoozeWord(currentCard.word.id, currentCard.promptSide);
    removeUpcomingCardsForWord(currentCard.word.id);
    setSummary((current) => ({
      ...current,
      snoozed: current.snoozed + 1,
    }));
    appendSessionHistory({
      id: crypto.randomUUID(),
      cardId: currentCard.id,
      wordId: currentCard.word.id,
      promptSide: currentCard.promptSide,
      promptText: buildWordPrompt(currentCard.word, currentCard.promptSide),
      primaryAnswer:
        currentCard.promptSide === 'english'
          ? currentCard.word.translations[0] ?? ''
          : currentCard.word.englishText,
      acceptedAnswers:
        currentCard.promptSide === 'english'
          ? currentCard.word.translations.slice()
          : [currentCard.word.englishText],
      selectedAnswer: '',
      result: 'snoozed',
      translationLanguage: currentCard.word.translationLanguage,
      usedHint,
    });
    setFeedback({
      kind: 'snoozed',
      message: t('studyHiddenUntilMidnight'),
    });
  }

  if (words.length === 0) {
    return (
      <div className={`panel-grid study-layout ${layoutMode === 'stacked' ? 'stacked-layout' : ''}`}>
        <section className="panel accent-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">{t('onboardingStudyEyebrow')}</p>
              <h2>{t('onboardingStudyTitle')}</h2>
            </div>
          </div>
          <p className="helper-text">{t('onboardingStudyCopy')}</p>
        </section>
        <section className="panel study-panel">
          <div className="empty-state large">
            <p>{t('studyEmpty')}</p>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className={`panel-grid study-layout ${layoutMode === 'stacked' ? 'stacked-layout' : ''}`}>
      <section className="panel accent-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">{t('studyEyebrow')}</p>
            <h2>{t('studyTitle')}</h2>
          </div>
          <button type="button" className="primary-button" disabled={!canStartSession} onClick={startSession}>
            {cards.length > 0 ? t('studyReshuffle') : t('studyStartSession')}
          </button>
        </div>

        <div className={`study-setup-body${currentCard ? ' collapsed' : ''}`}>
          <div className="filter-grid">
            <StudyModeSelector
              selection={selection}
              groups={groups}
              onChange={setSelection}
              t={t}
            />

            <PromptMixPicker
              value={englishPromptPercentage}
              onChange={setEnglishPromptPercentage}
              appLanguage={appLanguage}
              translationLabel={translationLabel}
            />
          </div>

          <div className="session-badges">
            <span>{t('studyEligibleToday', { count: candidateCount })}</span>
          </div>

          {getSetupMessage() ? <p className="helper-text">{getSetupMessage()}</p> : null}
        </div>

        <div className="summary-strip">
          <article>
            <span>{summary.correct}</span>
            <p>{t('commonCorrect')}</p>
          </article>
          <article>
            <span>{summary.incorrect}</span>
            <p>{t('commonMissed')}</p>
          </article>
          <article>
            <span>{summary.snoozed}</span>
            <p>{t('commonSnoozed')}</p>
          </article>
        </div>
      </section>

      <section ref={studyAreaRef} className="panel study-panel">
        {sessionComplete ? (
          <div className="study-result">
            <div className="panel-heading compact">
              <div>
                <p className="eyebrow">{t('studyFinishedEyebrow')}</p>
                <h2>{t('studyFinishedTitle')}</h2>
                <p className="helper-text">{t('studyComplete')}</p>
              </div>
              <button type="button" className="primary-button" onClick={startSession} disabled={!canStartSession}>
                {t('studyStartAnotherRound')}
              </button>
            </div>

            <div className="summary-strip four-up">
              <article>
                <span>{accuracy}%</span>
                <p>{t('statAccuracy')}</p>
              </article>
              <article>
                <span>{reviewedCount}</span>
                <p>{t('studyCardsPlayed')}</p>
              </article>
              <article>
                <span>{summary.correct}</span>
                <p>{t('commonCorrect')}</p>
              </article>
              <article>
                <span>{summary.incorrect}</span>
                <p>{t('commonMissed')}</p>
              </article>
            </div>

            <div className="history-list compact-history">
              <article className="history-row">
                <div>
                  <strong>{t('studySessionDetails')}</strong>
                  <p>{translationLabel}</p>
                </div>
                <small>{formatDateTime(sessionFinishedAt || sessionStartedAt || new Date().toISOString())}</small>
              </article>
              <article className="history-row">
                <div>
                  <strong>{t('studyCardsPlayed')}</strong>
                  <p>{reviewedCount}</p>
                </div>
                <small>{`${t('commonSnoozed')}: ${summary.snoozed}`}</small>
              </article>
            </div>

            <div>
              <h3 style={{ marginBottom: '12px' }}>{t('studySessionHistory')}</h3>
              <div className="history-list" style={{ maxHeight: '320px', overflowY: 'auto', paddingRight: '8px' }}>
                {sessionHistory.slice().reverse().map(renderStudySessionEntry)}
              </div>
            </div>
          </div>
        ) : !currentCard ? (
          <div className="empty-state large">
            <p>{t('studyEmpty')}</p>
          </div>
        ) : (
          <>
                <div className={`study-card animate-slide-in-right`} key={currentCard.word.id}>
              <div className="study-meta">
                <span>
                  {t('studyCardCounter', { current: currentIndex + 1, total: cards.length })}
                </span>
                <button type="button" className="ghost-button" onClick={finishSession}>
                  {t('studyEndSession')}
                </button>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px' }}>
                <h2 className={promptClassName} style={{ margin: 0 }}>{buildWordPrompt(currentCard.word, currentCard.promptSide)}</h2>
              {currentCard.promptSide === 'english' ? (
                <PlayButton text={currentCard.word.englishText} title={audioButtonTitle} />
              ) : shouldShowAudio(currentCard.word.translationLanguage) ? (
                <PlayButton
                  text={buildWordPrompt(currentCard.word, currentCard.promptSide)}
                  language={currentCard.word.translationLanguage}
                  title={audioButtonTitle}
                />
              ) : null}
              </div>
              <p className="study-subtitle">
                {t('studyTypeAnswer', {
                  language:
                    currentCard.promptSide === 'english'
                      ? currentCard.word.translationLanguage
                      : t('commonEnglish'),
                })}
              </p>

              <label className="full-width study-answer-field">
                {t('studyYourAnswer')}
                <input
                  className={answerInputClassName}
                  value={answer}
                  onChange={(event) => setAnswer(event.target.value)}
                  placeholder={
                    currentCard.promptSide === 'english'
                      ? t('studyTypeAnswerPlaceholder', {
                          language: currentCard.word.translationLanguage,
                        })
                      : t('studyTypeEnglishPlaceholder')
                  }
                  disabled={Boolean(feedback)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && answer.trim() && !feedback) {
                      event.preventDefault();
                      void handleCheckAnswer();
                    }
                  }}
                />
              </label>

              {!feedback ? (
                <div className="action-row action-row-spacious study-actions">
                  <button
                    type="button"
                    className="primary-button"
                    disabled={!answer.trim()}
                    onClick={() => void handleCheckAnswer()}
                  >
                    {t('studyCheck')}
                  </button>
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => void handleSnooze()}
                  >
                    {t('studyDontShowToday')}
                  </button>
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => void handleDontKnow()}
                  >
                    {t('studyDontKnow')}
                  </button>
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => {
                      setHintVisible((current) => !current);
                      setUsedHint(true);
                    }}
                  >
                    {t('commonHint')}
                  </button>
                </div>
              ) : null}

              {hintVisible ? (
                <div className="hint-box study-hint-box">
                  {currentCard.word.textHint ? (
                    <p className="study-hint-copy">{currentCard.word.textHint}</p>
                  ) : (
                    <p className="study-hint-copy">{t('studyNoTextHint')}</p>
                  )}
                  {currentCard.word.imageHint ? (
                    <img
                      src={currentCard.word.imageHint.dataUrl}
                      alt={currentCard.word.imageHint.name}
                      className="study-image"
                    />
                  ) : null}

                  {aiReady ? (
                    <div className="ai-inline study-ai-inline">
                      <button
                        type="button"
                        className="secondary-button"
                        disabled={aiBusyFeature === `sentence:${currentCard.word.id}`}
                        onClick={() => void onGenerateSentence(currentCard.word)}
                      >
                        {aiBusyFeature === `sentence:${currentCard.word.id}`
                          ? t('commonWriting')
                          : t('studyCreateSentence')}
                      </button>
                      {sentenceHints[currentCard.word.id] ? <p className="study-hint-copy">{sentenceHints[currentCard.word.id]}</p> : null}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {feedback ? (
                <div className={`feedback-box study-feedback-box ${feedback.kind}`}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <p style={{ margin: 0 }}>{feedback.message}</p>
                    {currentCard.promptSide !== 'english' ? (
                      <PlayButton text={currentCard.word.englishText} />
                    ) : null}
                  </div>
                  <div className="study-feedback-layout">
                    {feedback.answerListLabel && feedback.answerList && feedback.answerList.length > 0 ? (
                      <div className="feedback-answer-stack">
                        <strong>{feedback.answerListLabel}</strong>
                        <div className="value-chip-row">
                          {feedback.answerList.map((acceptedAnswer) => (
                            <span
                              key={acceptedAnswer}
                              className="value-chip translation-text"
                              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                            >
                              <span>{acceptedAnswer}</span>
                              {currentCard.promptSide === 'english' &&
                              shouldShowAudio(currentCard.word.translationLanguage) ? (
                                <PlayButton
                                  text={acceptedAnswer}
                                  language={currentCard.word.translationLanguage}
                                  title={audioButtonTitle}
                                />
                              ) : null}
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : null}
                    <div className="action-row study-feedback-actions">
                      <button type="button" className="secondary-button" onClick={goToNextCard}>
                        {t('studyNextWord')}
                      </button>
                      {aiReady ? (
                        <>
                          <button
                            type="button"
                            className="ghost-button"
                            disabled={aiBusyFeature === `sentence:${currentCard.word.id}`}
                            onClick={() => void onGenerateSentence(currentCard.word)}
                          >
                            {aiBusyFeature === `sentence:${currentCard.word.id}`
                              ? t('commonWriting')
                              : t('studyCreateSentence')}
                          </button>
                          {feedback.kind === 'incorrect' && (
                            <button
                              type="button"
                              className="ghost-button"
                              disabled={explainMistakeLoading}
                              onClick={() => void handleExplainMistake()}
                            >
                              {explainMistakeLoading
                                ? t('commonWriting')
                                : t('aiFeatureExplainMistake')}
                            </button>
                          )}
                        </>
                      ) : null}
                    </div>
                  </div>
                  {explainMistakeText ? (
                    <div className="hint-box" style={{ marginTop: '12px' }}>
                      <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{explainMistakeText}</p>
                    </div>
                  ) : null}
                  {sentenceHints[currentCard.word.id] ? (
                    <p className="study-hint-copy">{sentenceHints[currentCard.word.id]}</p>
                  ) : null}
                </div>
              ) : null}
            </div>

            <div className="study-footer">
              <p>
                {t('studyHiddenFooter', {
                  date: formatDateOnly(getTodayDateKey()),
                })}
              </p>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
