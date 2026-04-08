import type {
  AiFeature,
  AiUsageLog,
  MarathonRun,
  ProgressDateRange,
  ProgressRangePreset,
  ReviewAttempt,
  ReviewAction,
  WordEntry,
  WordStatus,
  WordStatusTransition,
} from '../types';
import { getRuntimeIntlLocale, tRuntime } from './i18n';
import { formatDateOnly, getTodayDateKey } from './text';

export interface ResolvedProgressRange {
  preset: ProgressRangePreset;
  from: string;
  to: string;
  label: string;
}

export interface ProgressSummary {
  newWords: number;
  trainedWords: number;
  accuracy: number;
  changedWords: number;
  correctAttempts: number;
  totalAttempts: number;
  promotions: number;
  setbacks: number;
}

export interface CountPoint {
  key: string;
  label: string;
  value: number;
}

export interface SplitCountPoint {
  key: string;
  label: string;
  promotions: number;
  setbacks: number;
}

export interface RecentlyMasteredItem {
  word: WordEntry;
  changedAt: string;
}

export interface NeedsAttentionItem {
  word: WordEntry;
  misses: number;
  lastMissedAt: string;
}

export interface AiUsageSummary {
  requests: number;
  successful: number;
  failed: number;
  totalTokens: number;
}

export interface MarathonSummary {
  runsPlayed: number;
  totalAnswers: number;
  accuracy: number;
  meanAnswerTimeMs: number;
  longestStreak: number;
}

export interface RecentMarathonRun {
  run: MarathonRun;
}

const statusOrder: Record<WordStatus, number> = {
  new: 0,
  learning: 1,
  known: 2,
};

function getAiFeatureLabel(feature: AiFeature): string {
  switch (feature) {
    case 'sentenceHint':
      return tRuntime('progressFeatureSentence');
    case 'relatedWords':
      return tRuntime('progressFeatureRelated');
    case 'nextWords':
      return tRuntime('progressFeatureNext');
    case 'chat':
      return tRuntime('progressFeatureChat');
    case 'addFromSelection':
      return tRuntime('progressFeatureAddFromChat');
    default:
      return tRuntime('progressFeatureChat');
  }
}

function parseDateKey(dateKey: string): Date {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(year, month - 1, day, 12);
}

function formatShortDate(dateKey: string): string {
  return new Intl.DateTimeFormat(getRuntimeIntlLocale(), {
    month: 'short',
    day: 'numeric',
  }).format(parseDateKey(dateKey));
}

function addDays(dateKey: string, days: number): string {
  const nextDate = parseDateKey(dateKey);
  nextDate.setDate(nextDate.getDate() + days);
  return getTodayDateKey(nextDate);
}

function toLocalDateKey(isoString: string): string {
  return getTodayDateKey(new Date(isoString));
}

function isTrainingAction(action: ReviewAction): boolean {
  return action === 'check' || action === 'dontKnow';
}

function isPromotion(fromStatus: WordStatus, toStatus: WordStatus): boolean {
  return statusOrder[toStatus] > statusOrder[fromStatus];
}

function isSetback(fromStatus: WordStatus, toStatus: WordStatus): boolean {
  return statusOrder[toStatus] < statusOrder[fromStatus];
}

function buildLabelForPreset(preset: ProgressRangePreset, from: string, to: string): string {
  switch (preset) {
    case '7d':
      return tRuntime('rangeLast7Days');
    case '30d':
      return tRuntime('rangeLast30Days');
    case 'month':
      return tRuntime('rangeThisMonth');
    case 'custom':
      return from === to ? formatDateOnly(from) : `${formatDateOnly(from)} – ${formatDateOnly(to)}`;
    default:
      return `${formatDateOnly(from)} – ${formatDateOnly(to)}`;
  }
}

export function resolveProgressRange(
  range: ProgressDateRange,
  now = new Date(),
): ResolvedProgressRange {
  const today = getTodayDateKey(now);

  if (range.preset === 'custom') {
    let from = range.from?.trim() || range.to?.trim() || today;
    let to = range.to?.trim() || range.from?.trim() || today;

    if (from > to) {
      [from, to] = [to, from];
    }

    return {
      preset: 'custom',
      from,
      to,
      label: buildLabelForPreset('custom', from, to),
    };
  }

  const to = today;
  let from = today;

  if (range.preset === '7d') {
    from = addDays(today, -6);
  } else if (range.preset === '30d') {
    from = addDays(today, -29);
  } else {
    from = `${today.slice(0, 8)}01`;
  }

  return {
    preset: range.preset,
    from,
    to,
    label: buildLabelForPreset(range.preset, from, to),
  };
}

export function getTodayProgressRange(now = new Date()): ResolvedProgressRange {
  const today = getTodayDateKey(now);
  return {
    preset: 'custom',
    from: today,
    to: today,
    label: tRuntime('rangeToday'),
  };
}

export function isDateKeyInRange(dateKey: string, range: ResolvedProgressRange): boolean {
  return dateKey >= range.from && dateKey <= range.to;
}

export function listDateKeys(range: ResolvedProgressRange): string[] {
  const keys: string[] = [];
  let current = range.from;

  while (current <= range.to) {
    keys.push(current);
    current = addDays(current, 1);
  }

  return keys;
}

function filterAttemptsByRange(
  reviewAttempts: ReviewAttempt[],
  range: ResolvedProgressRange,
): ReviewAttempt[] {
  return reviewAttempts.filter(
    (attempt) => isTrainingAction(attempt.action) && isDateKeyInRange(toLocalDateKey(attempt.shownAt), range),
  );
}

function filterTransitionsByRange(
  statusTransitions: WordStatusTransition[],
  range: ResolvedProgressRange,
): WordStatusTransition[] {
  return statusTransitions.filter((transition) =>
    isDateKeyInRange(toLocalDateKey(transition.changedAt), range),
  );
}

function filterMarathonRunsByRange(
  marathonRuns: MarathonRun[],
  range: ResolvedProgressRange,
): MarathonRun[] {
  return marathonRuns.filter((run) => isDateKeyInRange(toLocalDateKey(run.finishedAt), range));
}

export function summarizeProgress(
  words: WordEntry[],
  reviewAttempts: ReviewAttempt[],
  statusTransitions: WordStatusTransition[],
  range: ResolvedProgressRange,
): ProgressSummary {
  const attempts = filterAttemptsByRange(reviewAttempts, range);
  const transitions = filterTransitionsByRange(statusTransitions, range);
  const trainedWordIds = new Set(attempts.map((attempt) => attempt.wordId));
  const changedWordIds = new Set(transitions.map((transition) => transition.wordId));
  const correctAttempts = attempts.filter((attempt) => attempt.wasCorrect).length;
  const promotions = transitions.filter((transition) =>
    isPromotion(transition.fromStatus, transition.toStatus),
  ).length;
  const setbacks = transitions.filter((transition) =>
    isSetback(transition.fromStatus, transition.toStatus),
  ).length;

  return {
    newWords: words.filter((word) => isDateKeyInRange(toLocalDateKey(word.createdAt), range)).length,
    trainedWords: trainedWordIds.size,
    accuracy: attempts.length === 0 ? 0 : Math.round((correctAttempts / attempts.length) * 100),
    changedWords: changedWordIds.size,
    correctAttempts,
    totalAttempts: attempts.length,
    promotions,
    setbacks,
  };
}

export function buildDailyNewWordPoints(
  words: WordEntry[],
  range: ResolvedProgressRange,
): CountPoint[] {
  const counts = new Map<string, number>();

  for (const word of words) {
    const key = toLocalDateKey(word.createdAt);

    if (isDateKeyInRange(key, range)) {
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }

  return listDateKeys(range).map((key) => ({
    key,
    label: formatShortDate(key),
    value: counts.get(key) ?? 0,
  }));
}

export function buildDailyTrainedWordPoints(
  reviewAttempts: ReviewAttempt[],
  range: ResolvedProgressRange,
): CountPoint[] {
  const counts = new Map<string, Set<string>>();

  for (const attempt of filterAttemptsByRange(reviewAttempts, range)) {
    const key = toLocalDateKey(attempt.shownAt);
    const wordIds = counts.get(key) ?? new Set<string>();
    wordIds.add(attempt.wordId);
    counts.set(key, wordIds);
  }

  return listDateKeys(range).map((key) => ({
    key,
    label: formatShortDate(key),
    value: counts.get(key)?.size ?? 0,
  }));
}

export function buildDailyAccuracyPoints(
  reviewAttempts: ReviewAttempt[],
  range: ResolvedProgressRange,
): CountPoint[] {
  const counts = new Map<string, { correct: number; total: number }>();

  for (const attempt of filterAttemptsByRange(reviewAttempts, range)) {
    const key = toLocalDateKey(attempt.shownAt);
    const current = counts.get(key) ?? { correct: 0, total: 0 };
    current.total += 1;
    current.correct += attempt.wasCorrect ? 1 : 0;
    counts.set(key, current);
  }

  return listDateKeys(range).map((key) => {
    const current = counts.get(key);
    const value = current && current.total > 0 ? Math.round((current.correct / current.total) * 100) : 0;

    return {
      key,
      label: formatShortDate(key),
      value,
    };
  });
}

export function buildDailyTransitionPoints(
  statusTransitions: WordStatusTransition[],
  range: ResolvedProgressRange,
): SplitCountPoint[] {
  const counts = new Map<string, { promotions: number; setbacks: number }>();

  for (const transition of filterTransitionsByRange(statusTransitions, range)) {
    const key = toLocalDateKey(transition.changedAt);
    const current = counts.get(key) ?? { promotions: 0, setbacks: 0 };

    if (isPromotion(transition.fromStatus, transition.toStatus)) {
      current.promotions += 1;
    } else if (isSetback(transition.fromStatus, transition.toStatus)) {
      current.setbacks += 1;
    }

    counts.set(key, current);
  }

  return listDateKeys(range).map((key) => ({
    key,
    label: formatShortDate(key),
    promotions: counts.get(key)?.promotions ?? 0,
    setbacks: counts.get(key)?.setbacks ?? 0,
  }));
}

export function getCurrentTrainingStreak(reviewAttempts: ReviewAttempt[], now = new Date()): number {
  const trainingDays = new Set(
    reviewAttempts
      .filter((attempt) => isTrainingAction(attempt.action))
      .map((attempt) => toLocalDateKey(attempt.shownAt)),
  );

  if (trainingDays.size === 0) {
    return 0;
  }

  const today = getTodayDateKey(now);
  const yesterday = addDays(today, -1);

  let anchor: string | null = null;

  if (trainingDays.has(today)) {
    anchor = today;
  } else if (trainingDays.has(yesterday)) {
    anchor = yesterday;
  }

  if (!anchor) {
    return 0;
  }

  let streak = 0;
  let current = anchor;

  while (trainingDays.has(current)) {
    streak += 1;
    current = addDays(current, -1);
  }

  return streak;
}

export function getRecentlyMasteredWords(
  words: WordEntry[],
  statusTransitions: WordStatusTransition[],
  range: ResolvedProgressRange,
  limit = 5,
): RecentlyMasteredItem[] {
  const wordMap = new Map(words.map((word) => [word.id, word]));
  const latestByWord = new Map<string, RecentlyMasteredItem>();

  for (const transition of filterTransitionsByRange(statusTransitions, range)) {
    if (transition.toStatus !== 'known') {
      continue;
    }

    const word = wordMap.get(transition.wordId);

    if (!word) {
      continue;
    }

    const existing = latestByWord.get(word.id);

    if (!existing || existing.changedAt < transition.changedAt) {
      latestByWord.set(word.id, {
        word,
        changedAt: transition.changedAt,
      });
    }
  }

  return [...latestByWord.values()]
    .sort((left, right) => right.changedAt.localeCompare(left.changedAt))
    .slice(0, limit);
}

export function getNeedsAttentionWords(
  words: WordEntry[],
  reviewAttempts: ReviewAttempt[],
  range: ResolvedProgressRange,
  limit = 5,
): NeedsAttentionItem[] {
  const wordMap = new Map(words.map((word) => [word.id, word]));
  const missesByWord = new Map<string, { misses: number; lastMissedAt: string }>();

  for (const attempt of filterAttemptsByRange(reviewAttempts, range)) {
    if (attempt.wasCorrect) {
      continue;
    }

    const current = missesByWord.get(attempt.wordId) ?? {
      misses: 0,
      lastMissedAt: attempt.shownAt,
    };

    current.misses += 1;

    if (attempt.shownAt > current.lastMissedAt) {
      current.lastMissedAt = attempt.shownAt;
    }

    missesByWord.set(attempt.wordId, current);
  }

  return [...missesByWord.entries()]
    .map(([wordId, detail]) => {
      const word = wordMap.get(wordId);

      return word
        ? {
            word,
            misses: detail.misses,
            lastMissedAt: detail.lastMissedAt,
          }
        : null;
    })
    .filter((item): item is NeedsAttentionItem => Boolean(item))
    .sort((left, right) => {
      if (left.misses !== right.misses) {
        return right.misses - left.misses;
      }

      return right.lastMissedAt.localeCompare(left.lastMissedAt);
    })
    .slice(0, limit);
}

export function filterAiUsageByRange(
  aiUsageLogs: AiUsageLog[],
  range: ResolvedProgressRange,
): AiUsageLog[] {
  return aiUsageLogs.filter((entry) => isDateKeyInRange(toLocalDateKey(entry.requestedAt), range));
}

export function summarizeAiUsage(
  aiUsageLogs: AiUsageLog[],
  range: ResolvedProgressRange,
): AiUsageSummary {
  const entries = filterAiUsageByRange(aiUsageLogs, range);

  return {
    requests: entries.length,
    successful: entries.filter((entry) => entry.success).length,
    failed: entries.filter((entry) => !entry.success).length,
    totalTokens: entries.reduce((sum, entry) => sum + entry.totalTokens, 0),
  };
}

export function buildDailyAiRequestPoints(
  aiUsageLogs: AiUsageLog[],
  range: ResolvedProgressRange,
): CountPoint[] {
  const counts = new Map<string, number>();

  for (const entry of filterAiUsageByRange(aiUsageLogs, range)) {
    const key = toLocalDateKey(entry.requestedAt);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return listDateKeys(range).map((key) => ({
    key,
    label: formatShortDate(key),
    value: counts.get(key) ?? 0,
  }));
}

export function buildDailyAiTokenPoints(
  aiUsageLogs: AiUsageLog[],
  range: ResolvedProgressRange,
): CountPoint[] {
  const counts = new Map<string, number>();

  for (const entry of filterAiUsageByRange(aiUsageLogs, range)) {
    const key = toLocalDateKey(entry.requestedAt);
    counts.set(key, (counts.get(key) ?? 0) + entry.totalTokens);
  }

  return listDateKeys(range).map((key) => ({
    key,
    label: formatShortDate(key),
    value: counts.get(key) ?? 0,
  }));
}

export function buildAiModelUsagePoints(
  aiUsageLogs: AiUsageLog[],
  range: ResolvedProgressRange,
  limit = 5,
): CountPoint[] {
  const counts = new Map<string, number>();

  for (const entry of filterAiUsageByRange(aiUsageLogs, range)) {
    counts.set(entry.model, (counts.get(entry.model) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, limit)
    .map(([key, value]) => ({
      key,
      label: key,
      value,
    }));
}

export function buildAiFeatureUsagePoints(
  aiUsageLogs: AiUsageLog[],
  range: ResolvedProgressRange,
): CountPoint[] {
  const counts = new Map<string, number>();

  for (const entry of filterAiUsageByRange(aiUsageLogs, range)) {
    counts.set(entry.feature, (counts.get(entry.feature) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .map(([key, value]) => ({
      key,
      label: getAiFeatureLabel(key as AiFeature) ?? key,
      value,
    }));
}

export function summarizeMarathon(
  marathonRuns: MarathonRun[],
  range: ResolvedProgressRange,
): MarathonSummary {
  const runs = filterMarathonRunsByRange(marathonRuns, range);
  const totalAnswers = runs.reduce((sum, run) => sum + run.answeredCards, 0);
  const totalCorrect = runs.reduce((sum, run) => sum + run.correctCount, 0);
  const totalAnswerTimeMs = runs.reduce((sum, run) => sum + run.totalAnswerTimeMs, 0);

  return {
    runsPlayed: runs.length,
    totalAnswers,
    accuracy: totalAnswers === 0 ? 0 : Math.round((totalCorrect / totalAnswers) * 100),
    meanAnswerTimeMs: totalAnswers === 0 ? 0 : Math.round(totalAnswerTimeMs / totalAnswers),
    longestStreak: runs.reduce((highest, run) => Math.max(highest, run.longestStreak), 0),
  };
}

export function buildDailyMarathonRunPoints(
  marathonRuns: MarathonRun[],
  range: ResolvedProgressRange,
): CountPoint[] {
  const counts = new Map<string, number>();

  for (const run of filterMarathonRunsByRange(marathonRuns, range)) {
    const key = toLocalDateKey(run.finishedAt);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return listDateKeys(range).map((key) => ({
    key,
    label: formatShortDate(key),
    value: counts.get(key) ?? 0,
  }));
}

export function buildDailyMarathonAccuracyPoints(
  marathonRuns: MarathonRun[],
  range: ResolvedProgressRange,
): CountPoint[] {
  const counts = new Map<string, { correct: number; total: number }>();

  for (const run of filterMarathonRunsByRange(marathonRuns, range)) {
    const key = toLocalDateKey(run.finishedAt);
    const current = counts.get(key) ?? { correct: 0, total: 0 };
    current.correct += run.correctCount;
    current.total += run.answeredCards;
    counts.set(key, current);
  }

  return listDateKeys(range).map((key) => {
    const current = counts.get(key);
    return {
      key,
      label: formatShortDate(key),
      value:
        current && current.total > 0 ? Math.round((current.correct / current.total) * 100) : 0,
    };
  });
}

export function buildDailyMarathonMeanTimePoints(
  marathonRuns: MarathonRun[],
  range: ResolvedProgressRange,
): CountPoint[] {
  const counts = new Map<string, { totalAnswerTimeMs: number; totalAnswers: number }>();

  for (const run of filterMarathonRunsByRange(marathonRuns, range)) {
    const key = toLocalDateKey(run.finishedAt);
    const current = counts.get(key) ?? { totalAnswerTimeMs: 0, totalAnswers: 0 };
    current.totalAnswerTimeMs += run.totalAnswerTimeMs;
    current.totalAnswers += run.answeredCards;
    counts.set(key, current);
  }

  return listDateKeys(range).map((key) => {
    const current = counts.get(key);
    return {
      key,
      label: formatShortDate(key),
      value:
        current && current.totalAnswers > 0
          ? Math.round(current.totalAnswerTimeMs / current.totalAnswers)
          : 0,
    };
  });
}

export function buildDailyMarathonLongestStreakPoints(
  marathonRuns: MarathonRun[],
  range: ResolvedProgressRange,
): CountPoint[] {
  const counts = new Map<string, number>();

  for (const run of filterMarathonRunsByRange(marathonRuns, range)) {
    const key = toLocalDateKey(run.finishedAt);
    counts.set(key, Math.max(counts.get(key) ?? 0, run.longestStreak));
  }

  return listDateKeys(range).map((key) => ({
    key,
    label: formatShortDate(key),
    value: counts.get(key) ?? 0,
  }));
}

export function getRecentMarathonRuns(
  marathonRuns: MarathonRun[],
  range: ResolvedProgressRange,
  limit = 5,
): RecentMarathonRun[] {
  return filterMarathonRunsByRange(marathonRuns, range)
    .sort((left, right) => right.finishedAt.localeCompare(left.finishedAt))
    .slice(0, limit)
    .map((run) => ({ run }));
}
