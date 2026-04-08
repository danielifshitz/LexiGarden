import { type CSSProperties, useEffect, useMemo, useRef, useState } from 'react';
import { createTranslator } from '../lib/i18n';
import {
  buildMarathonCards,
  buildMarathonChoices,
  getMarathonDifficultyAvailability,
  getMarathonPoolMetrics,
  MARATHON_DIFFICULTY_CONFIG,
} from '../lib/marathon';
import { PromptMixPicker } from './PromptMixPicker';
import { formatDateTime, normalizeForComparison } from '../lib/text';
import { filterWordsByTranslationLanguage, getSelectionLabel, getUniqueGroups } from '../lib/study';
import type {
  AppSettings,
  MarathonAnswer,
  MarathonCard,
  MarathonDifficulty,
  MarathonRun,
  PageLayoutMode,
  StudySelection,
  SupportedAppLanguage,
  WordEntry,
} from '../types';

type MarathonFeedbackKind = 'correct' | 'wrong' | 'timeout';

interface MarathonPanelProps {
  words: WordEntry[];
  settings: AppSettings;
  appLanguage: SupportedAppLanguage;
  activeTranslationLanguage: string;
  layoutMode: PageLayoutMode;
  onSaveRun: (run: MarathonRun, answers: MarathonAnswer[]) => Promise<void>;
}

interface CompletedRunSummary {
  run: MarathonRun;
  answers: MarathonAnswer[];
}

const CORRECT_ADVANCE_MS = 900;
const MISSED_ADVANCE_MS = 1700;

function getDifficultyLabel(
  difficulty: MarathonDifficulty,
  t: ReturnType<typeof createTranslator>,
): string {
  switch (difficulty) {
    case 'study':
      return t('marathonDifficultyStudy');
    case 'easy':
      return t('marathonDifficultyEasy');
    case 'warm':
      return t('marathonDifficultyWarm');
    case 'medium':
      return t('marathonDifficultyMedium');
    case 'hard':
      return t('marathonDifficultyHard');
    case 'expert':
      return t('marathonDifficultyExpert');
    default:
      return difficulty;
  }
}

function getDifficultyDescription(
  difficulty: MarathonDifficulty,
  t: ReturnType<typeof createTranslator>,
): string {
  const config = MARATHON_DIFFICULTY_CONFIG[difficulty];
  return t('marathonDifficultyDetails', {
    choices: config.optionCount,
    seconds: config.seconds,
  });
}

function getMixSummary(
  englishPromptPercentage: number,
  translationLanguage: string,
  t: ReturnType<typeof createTranslator>,
): string {
  if (englishPromptPercentage === 100) {
    return t('studyPromptEnglishOnly');
  }

  if (englishPromptPercentage === 0) {
    return t('studyPromptTranslationOnly', { language: translationLanguage });
  }

  return t('studyPromptBalanced');
}

export function MarathonPanel({
  words,
  settings,
  appLanguage,
  activeTranslationLanguage,
  layoutMode,
  onSaveRun,
}: MarathonPanelProps) {
  const t = createTranslator(appLanguage);
  const translationLabel = activeTranslationLanguage || t('commonLanguage');
  const gameAreaRef = useRef<HTMLElement | null>(null);
  const timerRef = useRef<number | null>(null);
  const advanceRef = useRef<number | null>(null);
  const roundStartedAtRef = useRef<number>(0);
  const elapsedBeforePauseRef = useRef<number>(0);

  const [selection, setSelection] = useState<StudySelection>({ mode: 'all' });
  const [englishPromptPercentage, setEnglishPromptPercentage] = useState(50);
  const [difficulty, setDifficulty] = useState<MarathonDifficulty>('study');
  const [returnMissedCards, setReturnMissedCards] = useState(false);
  const [runId, setRunId] = useState('');
  const [runStartedAt, setRunStartedAt] = useState('');
  const [baseCards, setBaseCards] = useState<MarathonCard[]>([]);
  const [currentCard, setCurrentCard] = useState<MarathonCard | null>(null);
  const [remainingQueue, setRemainingQueue] = useState<MarathonCard[]>([]);
  const [currentOptions, setCurrentOptions] = useState<string[]>([]);
  const [correctOption, setCorrectOption] = useState('');
  const [preparedCardId, setPreparedCardId] = useState('');
  const [answeredCount, setAnsweredCount] = useState(0);
  const [correctCount, setCorrectCount] = useState(0);
  const [wrongCount, setWrongCount] = useState(0);
  const [timeoutCount, setTimeoutCount] = useState(0);
  const [currentStreak, setCurrentStreak] = useState(0);
  const [longestStreak, setLongestStreak] = useState(0);
  const [totalAnswerTimeMs, setTotalAnswerTimeMs] = useState(0);
  const [answers, setAnswers] = useState<MarathonAnswer[]>([]);
  const [feedbackKind, setFeedbackKind] = useState<MarathonFeedbackKind | null>(null);
  const [selectedOption, setSelectedOption] = useState('');
  const [timeLeftMs, setTimeLeftMs] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [isSavingRun, setIsSavingRun] = useState(false);
  const [completedRun, setCompletedRun] = useState<CompletedRunSummary | null>(null);
  const [savingError, setSavingError] = useState('');

  const activeLanguageWords = useMemo(
    () => filterWordsByTranslationLanguage(words, activeTranslationLanguage),
    [activeTranslationLanguage, words],
  );
  const groups = useMemo(() => getUniqueGroups(activeLanguageWords), [activeLanguageWords]);
  const poolMetrics = useMemo(
    () => getMarathonPoolMetrics(activeLanguageWords, settings, selection),
    [activeLanguageWords, selection, settings],
  );
  const difficultyOptions = useMemo(
    () => getMarathonDifficultyAvailability(poolMetrics, englishPromptPercentage),
    [englishPromptPercentage, poolMetrics],
  );
  const selectedDifficulty = difficultyOptions.find((item) => item.difficulty === difficulty);
  const showingFeedback = feedbackKind !== null;
  const roundDurationMs = MARATHON_DIFFICULTY_CONFIG[difficulty].seconds * 1000;

  useEffect(() => {
    if (selection.mode === 'group' && selection.group) {
      return;
    }

    if (selection.mode === 'group' && groups[0]) {
      setSelection({ mode: 'group', group: groups[0] });
    }
  }, [groups, selection.group, selection.mode]);

  useEffect(() => {
    if (selectedDifficulty?.supported) {
      return;
    }

    const fallbackDifficulty = difficultyOptions.find((item) => item.supported)?.difficulty ?? 'study';
    setDifficulty(fallbackDifficulty);
  }, [difficultyOptions, selectedDifficulty?.supported]);

  useEffect(
    () => () => {
      if (timerRef.current) {
        window.clearInterval(timerRef.current);
      }

      if (advanceRef.current) {
        window.clearTimeout(advanceRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (!currentCard) {
      return;
    }

    const nextChoiceState = buildMarathonChoices(currentCard, baseCards, difficulty);
    elapsedBeforePauseRef.current = 0;
    setCurrentOptions(nextChoiceState.options);
    setCorrectOption(nextChoiceState.correctOption);
    setPreparedCardId(currentCard.id);
    setTimeLeftMs(roundDurationMs);
    setIsPaused(false);
  }, [baseCards, currentCard, difficulty, roundDurationMs]);

  useEffect(() => {
    if (
      !currentCard ||
      showingFeedback ||
      isSavingRun ||
      isPaused ||
      currentOptions.length === 0 ||
      !correctOption ||
      preparedCardId !== currentCard.id
    ) {
      return;
    }

    const elapsedBeforePause = Math.min(roundDurationMs, elapsedBeforePauseRef.current);
    const startingRemaining = Math.max(0, roundDurationMs - elapsedBeforePause);
    roundStartedAtRef.current = Date.now() - elapsedBeforePause;
    setTimeLeftMs(startingRemaining);

    if (timerRef.current) {
      window.clearInterval(timerRef.current);
    }

    timerRef.current = window.setInterval(() => {
      const elapsed = Date.now() - roundStartedAtRef.current;
      const nextRemaining = Math.max(0, roundDurationMs - elapsed);
      setTimeLeftMs(nextRemaining);

      if (nextRemaining <= 0) {
        if (timerRef.current) {
          window.clearInterval(timerRef.current);
          timerRef.current = null;
        }

        resolveAnswer('', true);
      }
    }, 50);

    return () => {
      if (timerRef.current) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [
    correctOption,
    currentCard,
    currentOptions.length,
    isPaused,
    isSavingRun,
    preparedCardId,
    roundDurationMs,
    showingFeedback,
  ]);

  useEffect(() => {
    if (!currentCard || showingFeedback || isSavingRun || isPaused) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      const optionIndex = Number(event.key) - 1;

      if (optionIndex < 0 || optionIndex >= currentOptions.length) {
        return;
      }

      event.preventDefault();
      const option = currentOptions[optionIndex];

      if (option) {
        resolveAnswer(option, false);
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentCard, currentOptions, isPaused, isSavingRun, showingFeedback]);

  function resetRunState() {
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }

    if (advanceRef.current) {
      window.clearTimeout(advanceRef.current);
      advanceRef.current = null;
    }

    setRunId('');
    setRunStartedAt('');
    setBaseCards([]);
    setCurrentCard(null);
    setRemainingQueue([]);
    setCurrentOptions([]);
    setCorrectOption('');
    setPreparedCardId('');
    setAnsweredCount(0);
    setCorrectCount(0);
    setWrongCount(0);
    setTimeoutCount(0);
    setCurrentStreak(0);
    setLongestStreak(0);
    setTotalAnswerTimeMs(0);
    setAnswers([]);
    setFeedbackKind(null);
    setSelectedOption('');
    setTimeLeftMs(0);
    setIsPaused(false);
    setIsSavingRun(false);
    setSavingError('');
    elapsedBeforePauseRef.current = 0;
    roundStartedAtRef.current = 0;
  }

  function startRun() {
    const nextCards = buildMarathonCards(
      activeLanguageWords,
      settings,
      selection,
      englishPromptPercentage,
    );

    if (nextCards.length === 0) {
      return;
    }

    resetRunState();
    setCompletedRun(null);

    const [firstCard, ...restCards] = nextCards;
    setRunId(crypto.randomUUID());
    setRunStartedAt(new Date().toISOString());
    setBaseCards(nextCards);
    setCurrentCard(firstCard ?? null);
    setRemainingQueue(restCards);

    requestAnimationFrame(() => {
      gameAreaRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  async function finishRun(finalAnswers: MarathonAnswer[], finalStats: {
    answeredCards: number;
    correctCount: number;
    wrongCount: number;
    timeoutCount: number;
    totalAnswerTimeMs: number;
    longestStreak: number;
  }) {
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }

    if (advanceRef.current) {
      window.clearTimeout(advanceRef.current);
      advanceRef.current = null;
    }

    setIsSavingRun(true);

    const finishedAt = new Date().toISOString();
    const run: MarathonRun = {
      id: runId || crypto.randomUUID(),
      startedAt: runStartedAt || finishedAt,
      finishedAt,
      translationLanguage: activeTranslationLanguage,
      mode: selection.mode,
      group: selection.group,
      englishPromptPercentage,
      difficulty,
      returnMissedCards,
      totalCards: baseCards.length,
      answeredCards: finalStats.answeredCards,
      correctCount: finalStats.correctCount,
      wrongCount: finalStats.wrongCount,
      timeoutCount: finalStats.timeoutCount,
      accuracy:
        finalStats.answeredCards === 0
          ? 0
          : Math.round((finalStats.correctCount / finalStats.answeredCards) * 100),
      meanAnswerTimeMs:
        finalStats.answeredCards === 0
          ? 0
          : Math.round(finalStats.totalAnswerTimeMs / finalStats.answeredCards),
      totalAnswerTimeMs: finalStats.totalAnswerTimeMs,
      longestStreak: finalStats.longestStreak,
    };
    const summary = { run, answers: finalAnswers };

    try {
      await onSaveRun(run, finalAnswers);
      setCompletedRun(summary);
      setSavingError('');
    } catch (error) {
      setCompletedRun(summary);
      setSavingError(error instanceof Error ? error.message : t('commonTryAgain'));
    } finally {
      setCurrentCard(null);
      setRemainingQueue([]);
      setCurrentOptions([]);
      setCorrectOption('');
      setPreparedCardId('');
      setFeedbackKind(null);
      setSelectedOption('');
      setTimeLeftMs(0);
      setIsPaused(false);
      setIsSavingRun(false);
      elapsedBeforePauseRef.current = 0;
      roundStartedAtRef.current = 0;
    }
  }

  function resolveAnswer(option: string, timedOut: boolean) {
    if (!currentCard || showingFeedback || isSavingRun) {
      return;
    }

    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }

    const answerTimeMs = Math.round(
      Math.min(
        MARATHON_DIFFICULTY_CONFIG[difficulty].seconds * 1000,
        Math.max(0, Date.now() - roundStartedAtRef.current),
      ),
    );
    const wasCorrect =
      !timedOut &&
      normalizeForComparison(option) === normalizeForComparison(correctOption);
    const answerEntry: MarathonAnswer = {
      id: crypto.randomUUID(),
      runId,
      wordId: currentCard.wordId,
      translationText: currentCard.translationText,
      promptSide: currentCard.promptSide,
      shownAt: new Date().toISOString(),
      answerTimeMs,
      selectedOption: option,
      correctOption,
      wasCorrect,
      timedOut,
    };
    const nextAnswers = [...answers, answerEntry];
    const nextAnsweredCount = answeredCount + 1;
    const nextCorrectCount = correctCount + (wasCorrect ? 1 : 0);
    const nextWrongCount = wrongCount + (!wasCorrect && !timedOut ? 1 : 0);
    const nextTimeoutCount = timeoutCount + (timedOut ? 1 : 0);
    const nextCurrentStreak = wasCorrect ? currentStreak + 1 : 0;
    const nextLongestStreak = Math.max(longestStreak, nextCurrentStreak);
    const nextTotalAnswerTimeMs = totalAnswerTimeMs + answerTimeMs;
    const nextRemainingQueue = [...remainingQueue];

    if ((timedOut || !wasCorrect) && returnMissedCards) {
      nextRemainingQueue.push(currentCard);
    }

    setAnswers(nextAnswers);
    setAnsweredCount(nextAnsweredCount);
    setCorrectCount(nextCorrectCount);
    setWrongCount(nextWrongCount);
    setTimeoutCount(nextTimeoutCount);
    setCurrentStreak(nextCurrentStreak);
    setLongestStreak(nextLongestStreak);
    setTotalAnswerTimeMs(nextTotalAnswerTimeMs);
    setSelectedOption(option);
    setFeedbackKind(timedOut ? 'timeout' : wasCorrect ? 'correct' : 'wrong');
    setTimeLeftMs(0);
    setIsPaused(false);
    elapsedBeforePauseRef.current = 0;

    const advanceDelay = wasCorrect ? CORRECT_ADVANCE_MS : MISSED_ADVANCE_MS;
    advanceRef.current = window.setTimeout(() => {
      const [nextCard, ...restCards] = nextRemainingQueue;

      if (!nextCard) {
        void finishRun(nextAnswers, {
          answeredCards: nextAnsweredCount,
          correctCount: nextCorrectCount,
          wrongCount: nextWrongCount,
          timeoutCount: nextTimeoutCount,
          totalAnswerTimeMs: nextTotalAnswerTimeMs,
          longestStreak: nextLongestStreak,
        });
        return;
      }

      setCurrentCard(nextCard);
      setRemainingQueue(restCards);
      setFeedbackKind(null);
      setSelectedOption('');
    }, advanceDelay);
  }

  function pauseRun() {
    if (!currentCard || showingFeedback || isSavingRun || isPaused) {
      return;
    }

    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }

    const elapsed = Math.round(
      roundStartedAtRef.current
        ? Math.min(roundDurationMs, Math.max(0, Date.now() - roundStartedAtRef.current))
        : elapsedBeforePauseRef.current,
    );
    elapsedBeforePauseRef.current = elapsed;
    setTimeLeftMs(Math.max(0, roundDurationMs - elapsed));
    setIsPaused(true);
  }

  function resumeRun() {
    if (!currentCard || showingFeedback || isSavingRun || !isPaused) {
      return;
    }

    setIsPaused(false);
  }

  function stopRun() {
    if (!currentCard || isSavingRun) {
      return;
    }

    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }

    if (advanceRef.current) {
      window.clearTimeout(advanceRef.current);
      advanceRef.current = null;
    }

    void finishRun(answers, {
      answeredCards: answeredCount,
      correctCount,
      wrongCount,
      timeoutCount,
      totalAnswerTimeMs,
      longestStreak,
    });
  }

  const timerPercent = currentCard
    ? Math.max(
        0,
        Math.min(
          100,
          Math.round(
            (timeLeftMs / (MARATHON_DIFFICULTY_CONFIG[difficulty].seconds * 1000)) * 100,
          ),
        ),
      )
    : 0;
  const elapsedRatio = 1 - timerPercent / 100;
  const daylight = Math.sin(elapsedRatio * Math.PI);
  const edgeDarkness = 1 - daylight;
  const sunX = 12 + elapsedRatio * 76;
  const sunY = 74 - daylight * 50;
  const farmerX = 34 + elapsedRatio * 32;
  const farmerLift = daylight * 3;
  const sceneStyle = {
    '--marathon-sun-x': `${sunX}%`,
    '--marathon-sun-y': `${sunY}%`,
    '--marathon-scene-glow': `${0.08 + daylight * 0.92}`,
    '--marathon-scene-dim': `${0.34 - daylight * 0.26}`,
    '--marathon-scene-night': `${0.52 - daylight * 0.44}`,
    '--marathon-farmer-x': `${farmerX}%`,
    '--marathon-farmer-lift': `${farmerLift}px`,
    '--marathon-scene-shadow': `${0.28 - daylight * 0.18}`,
    '--marathon-scene-warmth': `${0.1 + edgeDarkness * 0.24}`,
  } as CSSProperties;
  const canStart =
    Boolean(activeTranslationLanguage) &&
    poolMetrics.cardCount > 0 &&
    Boolean(selectedDifficulty?.supported);
  const progressCurrent = completedRun
    ? completedRun.run.answeredCards
    : currentCard
      ? Math.min(answeredCount + 1, baseCards.length || answeredCount + 1)
      : 0;
  const progressTotal = completedRun ? completedRun.run.totalCards : baseCards.length || poolMetrics.cardCount;
  const topBadges = [
    getSelectionLabel(selection.mode, selection.group),
    activeTranslationLanguage || t('chatNoActiveLanguage'),
    getMixSummary(englishPromptPercentage, translationLabel, t),
    t('marathonCardsReady', { count: poolMetrics.cardCount }),
  ];

  function getDifficultySupportCopy() {
    if (selectedDifficulty?.supported) {
      return t('marathonReadyForLevel');
    }

    if (!selectedDifficulty?.missingSide) {
      return t('marathonNeedMoreCards');
    }

    if (selectedDifficulty.missingSide === 'both') {
      return t('marathonNeedMoreOptionsBoth', {
        choices: selectedDifficulty.optionCount,
        language: translationLabel,
      });
    }

    if (selectedDifficulty.missingSide === 'english') {
      return t('marathonNeedMoreEnglishOptions', {
        choices: selectedDifficulty.optionCount,
      });
    }

    return t('marathonNeedMoreTranslationOptions', {
      choices: selectedDifficulty.optionCount,
      language: translationLabel,
    });
  }

  return (
    <div className={`panel-grid marathon-layout ${layoutMode === 'stacked' ? 'stacked-layout' : ''}`}>
      <section className="panel accent-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">{t('marathonEyebrow')}</p>
            <h2>{t('marathonTitle')}</h2>
          </div>
          <button
            type="button"
            className="primary-button"
            disabled={!canStart || isSavingRun}
            onClick={startRun}
          >
            {t('marathonStart')}
          </button>
        </div>

        <div className="filter-grid">
          <label>
            {t('studyMode')}
            <select
              value={selection.mode}
              onChange={(event) =>
                setSelection({
                  mode: event.target.value as StudySelection['mode'],
                  group: event.target.value === 'group' ? selection.group ?? groups[0] : undefined,
                })
              }
            >
              <option value="all">{t('studyModeAll')}</option>
              <option value="lastAdded">{t('studyModeLastAdded')}</option>
              <option value="group">{t('studyModeGroup')}</option>
              <option value="lessKnown">{t('studyModeLessKnown')}</option>
              <option value="lessSeen">{t('studyModeLessSeen')}</option>
            </select>
          </label>

          {selection.mode === 'group' ? (
            <label>
              {t('studyGroupLabel')}
              <select
                value={selection.group ?? groups[0] ?? ''}
                onChange={(event) => setSelection({ mode: 'group', group: event.target.value })}
              >
                {groups.map((group) => (
                  <option key={group} value={group}>
                    {group}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <PromptMixPicker
            value={englishPromptPercentage}
            onChange={setEnglishPromptPercentage}
            appLanguage={appLanguage}
            translationLabel={translationLabel}
          />

          <div className="marathon-difficulty-grid full-width">
            {difficultyOptions.map((option) => (
              <button
                key={option.difficulty}
                type="button"
                className={
                  difficulty === option.difficulty
                    ? 'difficulty-card active'
                    : 'difficulty-card'
                }
                disabled={!option.supported}
                onClick={() => setDifficulty(option.difficulty)}
              >
                <strong>{getDifficultyLabel(option.difficulty, t)}</strong>
                <span>{getDifficultyDescription(option.difficulty, t)}</span>
              </button>
            ))}
          </div>

          <label className="checkbox-row full-width">
            <input
              type="checkbox"
              checked={returnMissedCards}
              onChange={(event) => setReturnMissedCards(event.target.checked)}
            />
            <span>{t('marathonReturnMissed')}</span>
          </label>
        </div>

        <div className="session-badges">
          {topBadges.map((badge) => (
            <span key={badge}>{badge}</span>
          ))}
        </div>

        <p className={selectedDifficulty?.supported ? 'helper-text' : 'helper-text error-text'}>
          {getDifficultySupportCopy()}
        </p>
      </section>

      <section ref={gameAreaRef} className="panel marathon-panel">
        {completedRun ? (
          <div className="marathon-result">
            <div className="panel-heading compact">
              <div>
                <p className="eyebrow">{t('marathonFinishedEyebrow')}</p>
                <h2>{t('marathonFinishedTitle')}</h2>
              </div>
              <button type="button" className="primary-button" onClick={startRun}>
                {t('marathonPlayAgain')}
              </button>
            </div>

            <div className="summary-strip marathon-summary-grid">
              <article>
                <span>{completedRun.run.accuracy}%</span>
                <p>{t('statAccuracy')}</p>
              </article>
              <article>
                <span>{Math.round(completedRun.run.meanAnswerTimeMs / 100) / 10}s</span>
                <p>{t('marathonMeanAnswerTime')}</p>
              </article>
              <article>
                <span>{completedRun.run.correctCount}</span>
                <p>{t('commonCorrect')}</p>
              </article>
              <article>
                <span>{completedRun.run.wrongCount}</span>
                <p>{t('commonMissed')}</p>
              </article>
              <article>
                <span>{completedRun.run.timeoutCount}</span>
                <p>{t('marathonTimeouts')}</p>
              </article>
              <article>
                <span>{completedRun.run.longestStreak}</span>
                <p>{t('marathonLongestStreak')}</p>
              </article>
            </div>

            <div className="history-list compact-history">
              <article className="history-row">
                <div>
                  <strong>{t('marathonRunDetails')}</strong>
                  <p>{`${getDifficultyLabel(completedRun.run.difficulty, t)} · ${completedRun.run.translationLanguage}`}</p>
                </div>
                <small>{formatDateTime(completedRun.run.finishedAt)}</small>
              </article>
              <article className="history-row">
                <div>
                  <strong>{t('marathonCardsPlayed')}</strong>
                  <p>{`${completedRun.run.answeredCards} / ${completedRun.run.totalCards}`}</p>
                </div>
                <small>
                  {completedRun.run.returnMissedCards ? t('marathonReturnMissed') : t('marathonOnePass')}
                </small>
              </article>
            </div>

            {savingError ? <p className="error-text">{savingError}</p> : null}
          </div>
        ) : !currentCard ? (
          <div className="empty-state large">
            <p>{t('marathonEmpty')}</p>
          </div>
        ) : (
          <div className="marathon-runner">
            <div className="panel-heading compact marathon-run-header">
              <div className="marathon-meta">
                <span>{t('marathonCardCounter', { current: progressCurrent, total: progressTotal })}</span>
                <span>{getDifficultyLabel(difficulty, t)}</span>
                <span>{t('marathonStreakNow', { count: currentStreak })}</span>
                <span>{t('marathonLongestStreakNow', { count: longestStreak })}</span>
              </div>
              <div className="marathon-run-actions">
                <button
                  type="button"
                  className="ghost-button"
                  disabled={showingFeedback || isSavingRun}
                  onClick={isPaused ? resumeRun : pauseRun}
                >
                  {isPaused ? t('marathonResume') : t('marathonPause')}
                </button>
                <button
                  type="button"
                  className="ghost-button danger-button"
                  disabled={isSavingRun}
                  onClick={stopRun}
                >
                  {t('marathonStop')}
                </button>
              </div>
            </div>

            {isPaused ? (
              <article className="marathon-paused-state">
                <h2>{t('marathonPaused')}</h2>
              </article>
            ) : (
              <>
                <article className={`marathon-card ${feedbackKind ? `marathon-card-${feedbackKind}` : ''}`}>
                  <p className="eyebrow">
                    {currentCard.promptSide === 'english'
                      ? t('marathonShowedInEnglish')
                      : t('marathonShowedInLanguage', { language: currentCard.translationLanguage })}
                  </p>
                  <h2
                    className={
                      currentCard.promptSide === 'english'
                        ? 'study-prompt english-display english-text'
                        : 'study-prompt translation-display translation-text'
                    }
                  >
                    {currentCard.promptSide === 'english'
                      ? currentCard.englishText
                      : currentCard.translationText}
                  </h2>
                </article>

                <div className="marathon-options">
                  {currentOptions.map((option, index) => {
                    const isCorrect = normalizeForComparison(option) === normalizeForComparison(correctOption);
                    const isSelected = normalizeForComparison(option) === normalizeForComparison(selectedOption);
                    const className = [
                      'marathon-option',
                      feedbackKind ? 'revealed-state' : '',
                      feedbackKind === 'correct' && isSelected ? 'correct' : '',
                      feedbackKind === 'wrong' && isSelected ? 'wrong' : '',
                      (feedbackKind === 'wrong' || feedbackKind === 'timeout') && isCorrect ? 'reveal' : '',
                    ]
                      .filter(Boolean)
                      .join(' ');

                    return (
                      <button
                        key={`${currentCard.id}-${option}`}
                        type="button"
                        className={className}
                        disabled={showingFeedback || isSavingRun}
                        onClick={() => resolveAnswer(option, false)}
                      >
                        <span className="marathon-option-index">{index + 1}</span>
                        <span
                          className={
                            currentCard.promptSide === 'english'
                              ? 'translation-text'
                              : 'english-text'
                          }
                        >
                          {option}
                        </span>
                      </button>
                    );
                  })}
                </div>

                <div className="marathon-scene" style={sceneStyle} aria-hidden="true">
                  <div className="marathon-scene-sky" />
                  <div className="marathon-scene-sun-glow" />
                  <div className="marathon-scene-sun" />
                  <div className="marathon-scene-cloud marathon-scene-cloud-one" />
                  <div className="marathon-scene-cloud marathon-scene-cloud-two" />
                  <div className="marathon-scene-hill marathon-scene-hill-back" />
                  <div className="marathon-scene-hill marathon-scene-hill-front" />
                  <div className="marathon-scene-path" />
                  <div className="marathon-scene-row marathon-scene-row-one" />
                  <div className="marathon-scene-row marathon-scene-row-two" />
                  <div className="marathon-scene-farmer">
                    <span className="marathon-scene-farmer-hat" />
                    <span className="marathon-scene-farmer-head" />
                    <span className="marathon-scene-farmer-body" />
                    <span className="marathon-scene-farmer-arm" />
                    <span className="marathon-scene-farmer-leg marathon-scene-farmer-leg-left" />
                    <span className="marathon-scene-farmer-leg marathon-scene-farmer-leg-right" />
                  </div>
                  <div className="marathon-scene-light" />
                  <div className="marathon-scene-time">{Math.ceil(timeLeftMs / 1000)}</div>
                </div>

                {feedbackKind ? (
                  <div className={`feedback-box ${feedbackKind === 'timeout' ? 'revealed' : feedbackKind === 'wrong' ? 'incorrect' : 'correct'}`}>
                    <p>
                      {feedbackKind === 'correct'
                        ? t('marathonCorrect')
                        : feedbackKind === 'timeout'
                          ? t('marathonTimeUp')
                          : t('marathonWrong')}
                    </p>
                  </div>
                ) : null}
              </>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
