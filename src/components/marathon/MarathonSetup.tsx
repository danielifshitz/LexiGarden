import { createTranslator } from '../../lib/i18n';
import { PromptMixPicker } from '../shared/PromptMixPicker';
import { StudyModeSelector } from '../shared/StudyModeSelector';
import type { MarathonDifficulty, StudySelection, SupportedAppLanguage } from '../../types';

interface DifficultyOption {
  difficulty: MarathonDifficulty;
  supported: boolean;
  missingSide?: 'english' | 'translation' | 'both';
  optionCount: number;
}

interface MarathonSetupProps {
  appLanguage: SupportedAppLanguage;
  translationLabel: string;
  activeTranslationLanguage: string;
  activeLanguageWordsCount: number;
  canStart: boolean;
  isSavingRun: boolean;
  selection: StudySelection;
  groups: string[];
  englishPromptPercentage: number;
  difficulty: MarathonDifficulty;
  difficultyOptions: DifficultyOption[];
  selectedDifficulty?: DifficultyOption;
  returnMissedCards: boolean;
  poolMetricsCardCount: number;
  onStartRun: () => void;
  onSelectionChange: (selection: StudySelection) => void;
  onEnglishPromptPercentageChange: (percentage: number) => void;
  onDifficultyChange: (difficulty: MarathonDifficulty) => void;
  onReturnMissedCardsChange: (returnMissedCards: boolean) => void;
  getDifficultyLabel: (difficulty: MarathonDifficulty, t: ReturnType<typeof createTranslator>) => string;
  getDifficultyDescription: (difficulty: MarathonDifficulty, t: ReturnType<typeof createTranslator>) => string;
}

export function MarathonSetup({
  appLanguage,
  translationLabel,
  activeTranslationLanguage,
  activeLanguageWordsCount,
  canStart,
  isSavingRun,
  selection,
  groups,
  englishPromptPercentage,
  difficulty,
  difficultyOptions,
  selectedDifficulty,
  returnMissedCards,
  poolMetricsCardCount,
  onStartRun,
  onSelectionChange,
  onEnglishPromptPercentageChange,
  onDifficultyChange,
  onReturnMissedCardsChange,
  getDifficultyLabel,
  getDifficultyDescription,
}: MarathonSetupProps) {
  const t = createTranslator(appLanguage);

  function getDifficultySupportCopy() {
    if (!activeTranslationLanguage) {
      return t('marathonChooseLanguageFirst');
    }

    if (activeLanguageWordsCount === 0) {
      return t('marathonAddWordsFirst', { language: activeTranslationLanguage });
    }

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
          onClick={onStartRun}
        >
          {t('marathonStart')}
        </button>
      </div>

      <div className="filter-grid">
        <StudyModeSelector
          selection={selection}
          groups={groups}
          onChange={onSelectionChange}
          t={t}
        />

        <PromptMixPicker
          value={englishPromptPercentage}
          onChange={onEnglishPromptPercentageChange}
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
              onClick={() => onDifficultyChange(option.difficulty)}
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
            onChange={(event) => onReturnMissedCardsChange(event.target.checked)}
          />
          <span>{t('marathonReturnMissed')}</span>
        </label>
      </div>

      <div className="session-badges">
        <span>{t('marathonCardsReady', { count: poolMetricsCardCount })}</span>
      </div>

      <p className={selectedDifficulty?.supported ? 'helper-text' : 'helper-text error-text'}>
        {getDifficultySupportCopy()}
      </p>
    </section>
  );
}
