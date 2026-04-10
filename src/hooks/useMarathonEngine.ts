import { useEffect, useRef, useState } from 'react';
import { createTranslator } from '../lib/i18n';
import { buildMarathonCards, buildMarathonChoices, MARATHON_DIFFICULTY_CONFIG } from '../lib/marathon';
import { normalizeForComparison } from '../lib/text';
import type {
  AppSettings,
  MarathonAnswer,
  MarathonCard,
  MarathonDifficulty,
  MarathonRun,
  StudySelection,
  WordEntry,
} from '../types';

export type MarathonFeedbackKind = 'correct' | 'wrong' | 'timeout';

export interface CompletedRunSummary {
  run: MarathonRun;
  answers: MarathonAnswer[];
}

interface UseMarathonEngineProps {
  activeLanguageWords: WordEntry[];
  settings: AppSettings;
  selection: StudySelection;
  englishPromptPercentage: number;
  difficulty: MarathonDifficulty;
  returnMissedCards: boolean;
  activeTranslationLanguage: string;
  onSaveRun: (run: MarathonRun, answers: MarathonAnswer[]) => Promise<void>;
  t: ReturnType<typeof createTranslator>;
}

const CORRECT_ADVANCE_MS = 900;
const MISSED_ADVANCE_MS = 1700;

export function useMarathonEngine({
  activeLanguageWords,
  settings,
  selection,
  englishPromptPercentage,
  difficulty,
  returnMissedCards,
  activeTranslationLanguage,
  onSaveRun,
  t,
}: UseMarathonEngineProps) {
  const timerRef = useRef<number | null>(null);
  const advanceRef = useRef<number | null>(null);
  const roundStartedAtRef = useRef<number>(0);
  const elapsedBeforePauseRef = useRef<number>(0);

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
  
  // Timer state for the UI
  const [roundStartedAt, setRoundStartedAtState] = useState(0);
  const [elapsedBeforePause, setElapsedBeforePauseState] = useState(0);
  
  const [isPaused, setIsPaused] = useState(false);
  const [isSavingRun, setIsSavingRun] = useState(false);
  const [completedRun, setCompletedRun] = useState<CompletedRunSummary | null>(null);
  const [savingError, setSavingError] = useState('');

  const showingFeedback = feedbackKind !== null;
  const roundDurationMs = MARATHON_DIFFICULTY_CONFIG[difficulty].seconds * 1000;

  useEffect(
    () => () => {
      if (timerRef.current) {
        window.clearTimeout(timerRef.current);
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
    setElapsedBeforePauseState(0);
    setCurrentOptions(nextChoiceState.options);
    setCorrectOption(nextChoiceState.correctOption);
    setPreparedCardId(currentCard.id);
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
    const now = Date.now();
    roundStartedAtRef.current = now - elapsedBeforePause;
    setRoundStartedAtState(now - elapsedBeforePause);

    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
    }

    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      resolveAnswer('', true);
    }, startingRemaining);

    return () => {
      if (timerRef.current) {
        window.clearTimeout(timerRef.current);
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
      window.clearTimeout(timerRef.current);
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
    setRoundStartedAtState(0);
    setElapsedBeforePauseState(0);
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
      window.clearTimeout(timerRef.current);
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
      setRoundStartedAtState(0);
      setElapsedBeforePauseState(0);
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
      window.clearTimeout(timerRef.current);
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
    
    // Stop timer visually
    setElapsedBeforePauseState(answerTimeMs);
    elapsedBeforePauseRef.current = answerTimeMs;
    
    setIsPaused(false);

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
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    const elapsed = Math.round(
      roundStartedAtRef.current
        ? Math.min(roundDurationMs, Math.max(0, Date.now() - roundStartedAtRef.current))
        : elapsedBeforePauseRef.current,
    );
    elapsedBeforePauseRef.current = elapsed;
    setElapsedBeforePauseState(elapsed);
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
      window.clearTimeout(timerRef.current);
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

  return {
    state: {
      baseCards,
      currentCard,
      currentOptions,
      correctOption,
      answeredCount,
      currentStreak,
      longestStreak,
      feedbackKind,
      selectedOption,
      roundStartedAt,
      elapsedBeforePause,
      isPaused,
      isSavingRun,
      completedRun,
      savingError,
      showingFeedback,
    },
    actions: {
      startRun,
      resolveAnswer,
      pauseRun,
      resumeRun,
      stopRun,
    },
  };
}
