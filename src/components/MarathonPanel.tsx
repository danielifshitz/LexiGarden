import { useEffect, useMemo, useRef, useState } from 'react';
import { createTranslator } from '../lib/i18n';
import {
  getMarathonDifficultyAvailability,
  getMarathonPoolMetrics,
  MARATHON_DIFFICULTY_CONFIG,
} from '../lib/marathon';
import { filterWordsByTranslationLanguage, getUniqueGroups } from '../lib/study';
import { useMarathonEngine } from '../hooks/useMarathonEngine';
import { MarathonSetup } from './marathon/MarathonSetup';
import { MarathonRunner } from './marathon/MarathonRunner';
import { MarathonResults } from './marathon/MarathonResults';
import type {
  AppSettings,
  MarathonAnswer,
  MarathonDifficulty,
  MarathonRun,
  PageLayoutMode,
  StudySelection,
  SupportedAppLanguage,
  WordEntry,
} from '../types';

interface MarathonPanelProps {
  words: WordEntry[];
  settings: AppSettings;
  appLanguage: SupportedAppLanguage;
  activeTranslationLanguage: string;
  layoutMode: PageLayoutMode;
  onSaveRun: (run: MarathonRun, answers: MarathonAnswer[]) => Promise<void>;
}

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

  const [selection, setSelection] = useState<StudySelection>({ mode: 'all' });
  const [englishPromptPercentage, setEnglishPromptPercentage] = useState(50);
  const [difficulty, setDifficulty] = useState<MarathonDifficulty>('study');
  const [returnMissedCards, setReturnMissedCards] = useState(false);

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

  const { state, actions } = useMarathonEngine({
    activeLanguageWords,
    settings,
    selection,
    englishPromptPercentage,
    difficulty,
    returnMissedCards,
    activeTranslationLanguage,
    onSaveRun,
    t,
  });

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

  const canStart =
    Boolean(activeTranslationLanguage) &&
    poolMetrics.cardCount > 0 &&
    Boolean(selectedDifficulty?.supported);

  const progressCurrent = state.completedRun
    ? state.completedRun.run.answeredCards
    : state.currentCard
      ? Math.min(state.answeredCount + 1, state.baseCards.length || state.answeredCount + 1)
      : 0;
  const progressTotal = state.completedRun
    ? state.completedRun.run.totalCards
    : state.baseCards.length || poolMetrics.cardCount;

  const handleStartRun = () => {
    actions.startRun();
    requestAnimationFrame(() => {
      gameAreaRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  return (
    <div className={`panel-grid marathon-layout ${layoutMode === 'stacked' ? 'stacked-layout' : ''}`}>
      <MarathonSetup
        appLanguage={appLanguage}
        translationLabel={translationLabel}
        activeTranslationLanguage={activeTranslationLanguage}
        activeLanguageWordsCount={activeLanguageWords.length}
        canStart={canStart}
        isSavingRun={state.isSavingRun}
        selection={selection}
        groups={groups}
        englishPromptPercentage={englishPromptPercentage}
        difficulty={difficulty}
        difficultyOptions={difficultyOptions}
        selectedDifficulty={selectedDifficulty}
        returnMissedCards={returnMissedCards}
        poolMetricsCardCount={poolMetrics.cardCount}
        onStartRun={handleStartRun}
        onSelectionChange={setSelection}
        onEnglishPromptPercentageChange={setEnglishPromptPercentage}
        onDifficultyChange={setDifficulty}
        onReturnMissedCardsChange={setReturnMissedCards}
        getDifficultyLabel={getDifficultyLabel}
        getDifficultyDescription={getDifficultyDescription}
      />

      <section ref={gameAreaRef} className="panel marathon-panel">
        {state.completedRun ? (
          <MarathonResults
            completedRun={state.completedRun}
            appLanguage={appLanguage}
            savingError={state.savingError}
            onPlayAgain={handleStartRun}
            getDifficultyLabel={getDifficultyLabel}
          />
        ) : !state.currentCard ? (
          <div className="empty-state large">
            <p>{t('marathonEmpty')}</p>
          </div>
        ) : (
          <MarathonRunner
            currentCard={state.currentCard}
            currentOptions={state.currentOptions}
            correctOption={state.correctOption}
            difficulty={difficulty}
            currentStreak={state.currentStreak}
            longestStreak={state.longestStreak}
            progressCurrent={progressCurrent}
            progressTotal={progressTotal}
            feedbackKind={state.feedbackKind}
            selectedOption={state.selectedOption}
            roundStartedAt={state.roundStartedAt}
            elapsedBeforePause={state.elapsedBeforePause}
            roundDurationMs={MARATHON_DIFFICULTY_CONFIG[difficulty].seconds * 1000}
            isPaused={state.isPaused}
            isSavingRun={state.isSavingRun}
            showingFeedback={state.showingFeedback}
            appLanguage={appLanguage}
            onResolveAnswer={actions.resolveAnswer}
            onPause={actions.pauseRun}
            onResume={actions.resumeRun}
            onStop={actions.stopRun}
            getDifficultyLabel={getDifficultyLabel}
          />
        )}
      </section>
    </div>
  );
}
