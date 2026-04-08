import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  buildAiFeatureUsagePoints,
  buildAiModelUsagePoints,
  buildDailyAccuracyPoints,
  buildDailyAiRequestPoints,
  buildDailyAiTokenPoints,
  buildDailyNewWordPoints,
  buildDailyTransitionPoints,
  buildDailyTrainedWordPoints,
  filterAiUsageByRange,
  getCurrentTrainingStreak,
  getNeedsAttentionWords,
  getRecentlyMasteredWords,
  getTodayProgressRange,
  resolveProgressRange,
  summarizeAiUsage,
  summarizeProgress,
  type CountPoint,
  type SplitCountPoint,
} from '../lib/progress';
import { createTranslator, tRuntime } from '../lib/i18n';
import { formatDateTime, formatTranslationsForDisplay } from '../lib/text';
import { filterWordsByTranslationLanguage } from '../lib/study';
import type {
  AiUsageLog,
  PageLayoutMode,
  ProgressDateRange,
  ProgressRangePreset,
  ReviewAttempt,
  SupportedAppLanguage,
  WordEntry,
  WordStatusTransition,
} from '../types';

interface ProgressPanelProps {
  words: WordEntry[];
  reviewAttempts: ReviewAttempt[];
  aiUsageLogs: AiUsageLog[];
  statusTransitions: WordStatusTransition[];
  appLanguage: SupportedAppLanguage;
  activeTranslationLanguage: string;
  availableTranslationLanguages: string[];
  layoutMode: PageLayoutMode;
  onClearAiUsageLogs: () => Promise<void>;
}

const ALL_LANGUAGES_VALUE = '__all_languages__';

const chartColors = {
  ink: '#1b2a24',
  muted: '#57635d',
  primary: '#0d7c74',
  primarySoft: '#1c9f88',
  accent: '#e97f53',
  accentDeep: '#b6493d',
  grid: 'rgba(13, 124, 116, 0.1)',
  cursor: 'rgba(13, 124, 116, 0.05)',
  surface: 'rgba(255, 255, 255, 0.92)',
  border: 'rgba(13, 124, 116, 0.12)',
};

function hasCountValues(points: CountPoint[]): boolean {
  return points.some((point) => point.value > 0);
}

function getChartSummary(points: CountPoint[], noun: string): string {
  const total = points.reduce((sum, point) => sum + point.value, 0);
  return tRuntime('progressInThisPeriod', { count: total, noun });
}

function getTickInterval(length: number): number {
  if (length <= 8) {
    return 0;
  }

  if (length <= 14) {
    return 1;
  }

  if (length <= 31) {
    return 3;
  }

  return 6;
}

function truncateLabel(label: string, maxLength = 20): string {
  return label.length <= maxLength ? label : `${label.slice(0, maxLength - 1)}…`;
}

function ChartCard({
  title,
  subtitle,
  hasData,
  children,
  emptyLabel,
}: {
  title: string;
  subtitle?: string;
  hasData: boolean;
  children: ReactNode;
  emptyLabel: string;
}) {
  return (
    <article className="chart-card graph-card">
      <div className="chart-card-head">
        <h3>{title}</h3>
        {subtitle ? <p className="helper-text">{subtitle}</p> : null}
      </div>
      {hasData ? children : <p className="helper-text">{emptyLabel}</p>}
    </article>
  );
}

function TooltipStyles() {
  return {
    contentStyle: {
      borderRadius: 16,
      border: `1px solid ${chartColors.border}`,
      background: chartColors.surface,
      boxShadow: '0 18px 36px rgba(56, 44, 18, 0.12)',
    },
    labelStyle: {
      color: chartColors.ink,
      fontWeight: 700,
      marginBottom: 4,
    },
    itemStyle: {
      color: chartColors.ink,
    },
  };
}

function formatTooltipMetric(
  value: number | string | readonly (number | string)[] | undefined,
  valueLabel: string,
  suffix = '',
): [string, string] {
  const normalizedValue = Array.isArray(value) ? value.join(', ') : value;
  return [`${normalizedValue ?? 0}${suffix}`, valueLabel];
}

function VerticalBarGraph({
  title,
  points,
  valueLabel,
  barColor = chartColors.primary,
  emptyLabel,
}: {
  title: string;
  points: CountPoint[];
  valueLabel: string;
  barColor?: string;
  emptyLabel: string;
}) {
  const hasData = hasCountValues(points);
  const tooltipStyles = TooltipStyles();

  return (
    <ChartCard
      title={title}
      subtitle={getChartSummary(points, valueLabel)}
      hasData={hasData}
      emptyLabel={emptyLabel}
    >
      <div className="chart-canvas">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={points} margin={{ top: 12, right: 8, left: -18, bottom: 4 }}>
            <CartesianGrid vertical={false} stroke={chartColors.grid} strokeDasharray="4 4" />
            <XAxis
              dataKey="label"
              interval={getTickInterval(points.length)}
              tickLine={false}
              axisLine={false}
              tick={{ fill: chartColors.muted, fontSize: 12 }}
              minTickGap={14}
            />
            <YAxis
              allowDecimals={false}
              tickLine={false}
              axisLine={false}
              tick={{ fill: chartColors.muted, fontSize: 12 }}
              width={32}
            />
            <Tooltip
              cursor={{ fill: chartColors.cursor }}
              formatter={(value) => formatTooltipMetric(value, valueLabel)}
              {...tooltipStyles}
            />
            <Bar dataKey="value" name={valueLabel} fill={barColor} radius={[10, 10, 4, 4]} maxBarSize={30} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

function LineMetricGraph({
  title,
  points,
  valueLabel,
  lineColor = chartColors.primary,
  domain,
  valueSuffix = '',
  emptyLabel,
}: {
  title: string;
  points: CountPoint[];
  valueLabel: string;
  lineColor?: string;
  domain?: [number, number];
  valueSuffix?: string;
  emptyLabel: string;
}) {
  const hasData = hasCountValues(points);
  const tooltipStyles = TooltipStyles();

  return (
    <ChartCard
      title={title}
      subtitle={getChartSummary(points, valueLabel)}
      hasData={hasData}
      emptyLabel={emptyLabel}
    >
      <div className="chart-canvas">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points} margin={{ top: 12, right: 8, left: -18, bottom: 4 }}>
            <CartesianGrid vertical={false} stroke={chartColors.grid} strokeDasharray="4 4" />
            <XAxis
              dataKey="label"
              interval={getTickInterval(points.length)}
              tickLine={false}
              axisLine={false}
              tick={{ fill: chartColors.muted, fontSize: 12 }}
              minTickGap={14}
            />
            <YAxis
              allowDecimals={false}
              domain={domain}
              tickLine={false}
              axisLine={false}
              tick={{ fill: chartColors.muted, fontSize: 12 }}
              width={32}
            />
            <Tooltip
              formatter={(value) => formatTooltipMetric(value, valueLabel, valueSuffix)}
              {...tooltipStyles}
            />
            <Line
              type="monotone"
              dataKey="value"
              name={valueLabel}
              stroke={lineColor}
              strokeWidth={3}
              dot={points.length <= 14 ? { r: 4, fill: lineColor, strokeWidth: 0 } : false}
              activeDot={{ r: 5, fill: lineColor, strokeWidth: 0 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

function AreaMetricGraph({
  title,
  points,
  valueLabel,
  areaColor = chartColors.primary,
  domain,
  valueSuffix = '',
  emptyLabel,
}: {
  title: string;
  points: CountPoint[];
  valueLabel: string;
  areaColor?: string;
  domain?: [number, number];
  valueSuffix?: string;
  emptyLabel: string;
}) {
  const hasData = hasCountValues(points);
  const tooltipStyles = TooltipStyles();
  const gradientId = `gradient-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

  return (
    <ChartCard
      title={title}
      subtitle={getChartSummary(points, valueLabel)}
      hasData={hasData}
      emptyLabel={emptyLabel}
    >
      <div className="chart-canvas">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={points} margin={{ top: 12, right: 8, left: -18, bottom: 4 }}>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={areaColor} stopOpacity={0.28} />
                <stop offset="95%" stopColor={areaColor} stopOpacity={0.04} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke={chartColors.grid} strokeDasharray="4 4" />
            <XAxis
              dataKey="label"
              interval={getTickInterval(points.length)}
              tickLine={false}
              axisLine={false}
              tick={{ fill: chartColors.muted, fontSize: 12 }}
              minTickGap={14}
            />
            <YAxis
              allowDecimals={false}
              domain={domain}
              tickLine={false}
              axisLine={false}
              tick={{ fill: chartColors.muted, fontSize: 12 }}
              width={32}
            />
            <Tooltip
              formatter={(value) => formatTooltipMetric(value, valueLabel, valueSuffix)}
              {...tooltipStyles}
            />
            <Area
              type="monotone"
              dataKey="value"
              name={valueLabel}
              stroke={areaColor}
              strokeWidth={3}
              fill={`url(#${gradientId})`}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

function TransitionGraph({
  title,
  rows,
  subtitle,
  emptyLabel,
}: {
  title: string;
  rows: SplitCountPoint[];
  subtitle: string;
  emptyLabel: string;
}) {
  const hasData = rows.some((row) => row.promotions > 0 || row.setbacks > 0);
  const tooltipStyles = TooltipStyles();

  return (
    <ChartCard title={title} subtitle={subtitle} hasData={hasData} emptyLabel={emptyLabel}>
      <div className="chart-canvas">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 12, right: 8, left: -18, bottom: 4 }} barGap={8}>
            <CartesianGrid vertical={false} stroke={chartColors.grid} strokeDasharray="4 4" />
            <XAxis
              dataKey="label"
              interval={getTickInterval(rows.length)}
              tickLine={false}
              axisLine={false}
              tick={{ fill: chartColors.muted, fontSize: 12 }}
              minTickGap={14}
            />
            <YAxis
              allowDecimals={false}
              tickLine={false}
              axisLine={false}
              tick={{ fill: chartColors.muted, fontSize: 12 }}
              width={32}
            />
            <Tooltip {...tooltipStyles} />
            <Legend wrapperStyle={{ color: chartColors.muted, fontSize: 12 }} />
            <Bar
              dataKey="promotions"
              name={tRuntime('progressPromotions')}
              fill={chartColors.primary}
              radius={[8, 8, 4, 4]}
              maxBarSize={22}
            />
            <Bar
              dataKey="setbacks"
              name={tRuntime('progressSetbacks')}
              fill={chartColors.accent}
              radius={[8, 8, 4, 4]}
              maxBarSize={22}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

function HorizontalUsageGraph({
  title,
  points,
  valueLabel,
  barColor = chartColors.primary,
  emptyLabel,
}: {
  title: string;
  points: CountPoint[];
  valueLabel: string;
  barColor?: string;
  emptyLabel: string;
}) {
  const hasData = hasCountValues(points);
  const tooltipStyles = TooltipStyles();
  const data = points.map((point) => ({
    ...point,
    shortLabel: truncateLabel(point.label, 18),
  }));

  return (
    <ChartCard
      title={title}
      subtitle={getChartSummary(points, valueLabel)}
      hasData={hasData}
      emptyLabel={emptyLabel}
    >
      <div className="chart-canvas">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            layout="vertical"
            margin={{ top: 8, right: 8, left: 18, bottom: 8 }}
            barCategoryGap={14}
          >
            <CartesianGrid horizontal={false} stroke={chartColors.grid} strokeDasharray="4 4" />
            <XAxis
              type="number"
              allowDecimals={false}
              tickLine={false}
              axisLine={false}
              tick={{ fill: chartColors.muted, fontSize: 12 }}
            />
            <YAxis
              type="category"
              dataKey="shortLabel"
              tickLine={false}
              axisLine={false}
              tick={{ fill: chartColors.muted, fontSize: 12 }}
              width={92}
            />
            <Tooltip
              formatter={(value) => formatTooltipMetric(value, valueLabel)}
              labelFormatter={(_, payload) => payload?.[0]?.payload?.label ?? ''}
              {...tooltipStyles}
            />
            <Bar dataKey="value" name={valueLabel} fill={barColor} radius={[0, 10, 10, 0]} maxBarSize={24} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

export function ProgressPanel({
  words,
  reviewAttempts,
  aiUsageLogs,
  statusTransitions,
  appLanguage,
  activeTranslationLanguage,
  availableTranslationLanguages,
  layoutMode,
  onClearAiUsageLogs,
}: ProgressPanelProps) {
  const t = createTranslator(appLanguage);
  const presetOptions: Array<{ value: ProgressRangePreset; label: string }> = [
    { value: '7d', label: t('rangeLast7Days') },
    { value: '30d', label: t('rangeLast30Days') },
    { value: 'month', label: t('rangeThisMonth') },
    { value: 'custom', label: t('rangeCustom') },
  ];
  const [rangeDraft, setRangeDraft] = useState<ProgressDateRange>(() => {
    const defaultRange = resolveProgressRange({ preset: '30d' });

    return {
      preset: '30d',
      from: defaultRange.from,
      to: defaultRange.to,
    };
  });
  const [selectedLanguage, setSelectedLanguage] = useState(activeTranslationLanguage);
  const [aiHistoryExpanded, setAiHistoryExpanded] = useState(false);
  const availableLanguages = availableTranslationLanguages;

  const todayRange = getTodayProgressRange();
  const periodRange = useMemo(() => resolveProgressRange(rangeDraft), [rangeDraft]);
  const effectiveLanguage =
    selectedLanguage === ALL_LANGUAGES_VALUE ? '' : selectedLanguage || activeTranslationLanguage;
  const filteredWords = useMemo(
    () => filterWordsByTranslationLanguage(words, effectiveLanguage),
    [effectiveLanguage, words],
  );
  const filteredWordIds = useMemo(
    () => new Set(filteredWords.map((word) => word.id)),
    [filteredWords],
  );
  const filteredAttempts = useMemo(
    () => reviewAttempts.filter((attempt) => filteredWordIds.has(attempt.wordId)),
    [filteredWordIds, reviewAttempts],
  );
  const filteredTransitions = useMemo(
    () => statusTransitions.filter((transition) => filteredWordIds.has(transition.wordId)),
    [filteredWordIds, statusTransitions],
  );

  useEffect(() => {
    setSelectedLanguage(activeTranslationLanguage);
  }, [activeTranslationLanguage]);

  useEffect(() => {
    if (availableLanguages.length === 0) {
      if (selectedLanguage) {
        setSelectedLanguage('');
      }
      return;
    }

    if (
      !selectedLanguage ||
      selectedLanguage === ALL_LANGUAGES_VALUE ||
      availableLanguages.includes(selectedLanguage)
    ) {
      return;
    }

    setSelectedLanguage(activeTranslationLanguage || availableLanguages[0]);
  }, [activeTranslationLanguage, availableLanguages, selectedLanguage]);

  const todaySummary = useMemo(
    () => summarizeProgress(filteredWords, filteredAttempts, filteredTransitions, todayRange),
    [filteredAttempts, filteredTransitions, filteredWords, todayRange],
  );
  const periodSummary = useMemo(
    () => summarizeProgress(filteredWords, filteredAttempts, filteredTransitions, periodRange),
    [filteredAttempts, filteredTransitions, filteredWords, periodRange],
  );
  const currentStreak = useMemo(() => getCurrentTrainingStreak(filteredAttempts), [filteredAttempts]);
  const recentlyMastered = useMemo(
    () => getRecentlyMasteredWords(filteredWords, filteredTransitions, periodRange),
    [filteredTransitions, filteredWords, periodRange],
  );
  const needsAttention = useMemo(
    () => getNeedsAttentionWords(filteredWords, filteredAttempts, periodRange),
    [filteredAttempts, filteredWords, periodRange],
  );
  const aiSummary = useMemo(() => summarizeAiUsage(aiUsageLogs, periodRange), [aiUsageLogs, periodRange]);
  const filteredAiLogs = useMemo(
    () => filterAiUsageByRange(aiUsageLogs, periodRange),
    [aiUsageLogs, periodRange],
  );
  const aiLogRows = useMemo(
    () => (aiHistoryExpanded ? filteredAiLogs : filteredAiLogs.slice(0, 5)),
    [aiHistoryExpanded, filteredAiLogs],
  );

  const dailyNewWordPoints = useMemo(
    () => buildDailyNewWordPoints(filteredWords, periodRange),
    [filteredWords, periodRange],
  );
  const dailyTrainedPoints = useMemo(
    () => buildDailyTrainedWordPoints(filteredAttempts, periodRange),
    [filteredAttempts, periodRange],
  );
  const dailyAccuracyPoints = useMemo(
    () => buildDailyAccuracyPoints(filteredAttempts, periodRange),
    [filteredAttempts, periodRange],
  );
  const dailyTransitionRows = useMemo(
    () => buildDailyTransitionPoints(filteredTransitions, periodRange),
    [filteredTransitions, periodRange],
  );
  const aiRequestPoints = useMemo(
    () => buildDailyAiRequestPoints(aiUsageLogs, periodRange),
    [aiUsageLogs, periodRange],
  );
  const aiTokenPoints = useMemo(
    () => buildDailyAiTokenPoints(aiUsageLogs, periodRange),
    [aiUsageLogs, periodRange],
  );
  const aiModelPoints = useMemo(
    () => buildAiModelUsagePoints(aiUsageLogs, periodRange),
    [aiUsageLogs, periodRange],
  );
  const aiFeaturePoints = useMemo(
    () => buildAiFeatureUsagePoints(aiUsageLogs, periodRange),
    [aiUsageLogs, periodRange],
  );

  function getFeatureLabel(feature: AiUsageLog['feature']): string {
    switch (feature) {
      case 'sentenceHint':
        return t('progressFeatureSentence');
      case 'relatedWords':
        return t('progressFeatureRelated');
      case 'nextWords':
        return t('progressFeatureNext');
      case 'chat':
        return t('progressFeatureChat');
      case 'addFromSelection':
        return t('progressFeatureAddFromChat');
      default:
        return feature;
    }
  }

  async function handleClearUsageHistory() {
    if (aiUsageLogs.length === 0) {
      return;
    }

    if (window.confirm(t('progressClearHistoryConfirm'))) {
      await onClearAiUsageLogs();
    }
  }

  return (
    <div className={`panel-grid progress-layout ${layoutMode === 'stacked' ? 'stacked-layout' : ''}`}>
      <section className="panel progress-toolbar-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">{t('progressLanguageEyebrow')}</p>
            <h2>{t('progressLanguageTitle')}</h2>
          </div>
          <p className="helper-text">{t('progressLanguageHelp')}</p>
        </div>

        {availableLanguages.length > 0 ? (
          <div className="filter-grid progress-date-grid">
            <label>
              {t('progressLanguageTitle')}
              <select
                value={
                  selectedLanguage ||
                  activeTranslationLanguage ||
                  availableLanguages[0] ||
                  ALL_LANGUAGES_VALUE
                }
                onChange={(event) => setSelectedLanguage(event.target.value)}
              >
                <option value={ALL_LANGUAGES_VALUE}>{t('commonAllLanguages')}</option>
                {availableLanguages.map((language) => (
                  <option key={language} value={language}>
                    {language}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ) : (
          <label className="full-width">
            {t('progressLanguageTitle')}
            <input
              value={
                effectiveLanguage ||
                activeTranslationLanguage ||
                availableLanguages[0] ||
                t('commonAllLanguages')
              }
              disabled
              placeholder={t('heroVocabularyNone')}
            />
          </label>
        )}
      </section>

      <section className="panel accent-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">{t('progressTodayEyebrow')}</p>
            <h2>{t('progressTodayTitle')}</h2>
          </div>
          <p className="helper-text">{t('progressTodayHelp')}</p>
        </div>

        <div className="summary-strip four-up">
          <article>
            <span>{todaySummary.newWords}</span>
            <p>{t('progressNewWords')}</p>
          </article>
          <article>
            <span>{todaySummary.trainedWords}</span>
            <p>{t('progressTrainedWords')}</p>
          </article>
          <article>
            <span>{todaySummary.accuracy}%</span>
            <p>{t('statAccuracy')}</p>
          </article>
          <article>
            <span>{todaySummary.changedWords}</span>
            <p>{t('progressChangedWords')}</p>
          </article>
        </div>

        <div className="status-chip-row">
          <span className="status-chip positive">{`${todaySummary.promotions} ${t('progressPromotions').toLocaleLowerCase()}`}</span>
          <span className="status-chip warning">{`${todaySummary.setbacks} ${t('progressSetbacks').toLocaleLowerCase()}`}</span>
          <span className="status-chip neutral">{`${todaySummary.totalAttempts} ${t('progressReviewAttempts').toLocaleLowerCase()}`}</span>
        </div>
      </section>

      <section className="panel detail-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">{t('progressHighlightsEyebrow')}</p>
            <h2>{t('progressHighlightsTitle')}</h2>
          </div>
        </div>

        <div className="summary-strip">
          <article>
            <span>{currentStreak}</span>
            <p>{t('progressCurrentStreak')}</p>
          </article>
          <article>
            <span>{periodSummary.promotions}</span>
            <p>{t('progressPromotions')}</p>
          </article>
          <article>
            <span>{periodSummary.setbacks}</span>
            <p>{t('progressSetbacks')}</p>
          </article>
        </div>

        <article className="chart-card progress-widget">
          <h3>{t('progressRecentlyMastered')}</h3>
          <div className="history-list compact-history">
            {recentlyMastered.length === 0 ? (
              <p className="helper-text">{t('progressNothingMastered')}</p>
            ) : (
              recentlyMastered.map((item) => (
                <article key={item.word.id} className="history-row progress-list-row">
                  <div>
                    <strong className="english-copy english-text">{item.word.englishText}</strong>
                    <p className="translation-copy translation-text">{formatTranslationsForDisplay(item.word)}</p>
                  </div>
                  <small>{formatDateTime(item.changedAt)}</small>
                </article>
              ))
            )}
          </div>
        </article>

        <article className="chart-card progress-widget">
          <h3>{t('progressNeedsAttention')}</h3>
          <div className="history-list compact-history">
            {needsAttention.length === 0 ? (
              <p className="helper-text">{t('progressNoMissedWords')}</p>
            ) : (
              needsAttention.map((item) => (
                <article key={item.word.id} className="history-row progress-list-row">
                  <div>
                    <strong className="english-copy english-text">{item.word.englishText}</strong>
                    <p className="translation-copy translation-text">{formatTranslationsForDisplay(item.word)}</p>
                  </div>
                  <small>{t('progressWordMisses', { count: item.misses })}</small>
                </article>
              ))
            )}
          </div>
        </article>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">{t('progressPeriodEyebrow')}</p>
            <h2>{t('progressPeriodTitle')}</h2>
          </div>
          <p className="helper-text">{periodRange.label}</p>
        </div>

        <div className="progress-filter-row">
          {presetOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              className={rangeDraft.preset === option.value ? 'nav-pill active' : 'nav-pill'}
              onClick={() =>
                setRangeDraft((current) => ({
                  ...current,
                  preset: option.value,
                }))
              }
            >
              {option.label}
            </button>
          ))}
        </div>

        {rangeDraft.preset === 'custom' ? (
          <div className="filter-grid progress-date-grid">
            <label>
              {t('commonFrom')}
              <input
                type="date"
                value={rangeDraft.from ?? periodRange.from}
                onChange={(event) =>
                  setRangeDraft((current) => ({
                    ...current,
                    preset: 'custom',
                    from: event.target.value,
                  }))
                }
              />
            </label>
            <label>
              {t('commonTo')}
              <input
                type="date"
                value={rangeDraft.to ?? periodRange.to}
                onChange={(event) =>
                  setRangeDraft((current) => ({
                    ...current,
                    preset: 'custom',
                    to: event.target.value,
                  }))
                }
              />
            </label>
          </div>
        ) : null}

        <div className="summary-strip four-up">
          <article>
            <span>{periodSummary.newWords}</span>
            <p>{t('progressNewWords')}</p>
          </article>
          <article>
            <span>{periodSummary.trainedWords}</span>
            <p>{t('progressTrainedWords')}</p>
          </article>
          <article>
            <span>{periodSummary.accuracy}%</span>
            <p>{t('statAccuracy')}</p>
          </article>
          <article>
            <span>{periodSummary.changedWords}</span>
            <p>{t('progressChangedWords')}</p>
          </article>
        </div>

        <div className="chart-grid">
          <VerticalBarGraph
            title={t('progressDailyNewWords')}
            points={dailyNewWordPoints}
            valueLabel={t('progressNewWords').toLocaleLowerCase()}
            emptyLabel={t('commonNoDataYet')}
          />
          <LineMetricGraph
            title={t('progressDailyTrainedWords')}
            points={dailyTrainedPoints}
            valueLabel={t('progressTrainedWords').toLocaleLowerCase()}
            emptyLabel={t('commonNoDataYet')}
          />
          <AreaMetricGraph
            title={t('progressDailyAccuracy')}
            points={dailyAccuracyPoints}
            valueLabel={t('statAccuracy').toLocaleLowerCase()}
            valueSuffix="%"
            domain={[0, 100]}
            areaColor={chartColors.primarySoft}
            emptyLabel={t('commonNoDataYet')}
          />
          <TransitionGraph
            title={t('progressDailyTransitions')}
            rows={dailyTransitionRows}
            subtitle={t('progressPromotionsAndSetbacks')}
            emptyLabel={t('commonNoDataYet')}
          />
        </div>
      </section>

      <section className="panel detail-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">{t('progressAiEyebrow')}</p>
            <h2>{t('progressAiTitle')}</h2>
          </div>
          <div className="action-row narrow">
            <button
              type="button"
              className="ghost-button"
              disabled={filteredAiLogs.length <= 5}
              onClick={() => setAiHistoryExpanded((current) => !current)}
            >
              {aiHistoryExpanded ? t('progressCollapseHistory') : t('progressExpandHistory')}
            </button>
            <button
              type="button"
              className="ghost-button danger-button"
              disabled={aiUsageLogs.length === 0}
              onClick={() => void handleClearUsageHistory()}
            >
              {t('progressClearHistory')}
            </button>
          </div>
        </div>

        <div className="summary-strip four-up">
          <article>
            <span>{aiSummary.requests}</span>
            <p>{t('progressRequests')}</p>
          </article>
          <article>
            <span>{aiSummary.successful}</span>
            <p>{t('progressSuccessful')}</p>
          </article>
          <article>
            <span>{aiSummary.failed}</span>
            <p>{t('progressFailed')}</p>
          </article>
          <article>
            <span>{aiSummary.totalTokens}</span>
            <p>{t('progressTotalTokens')}</p>
          </article>
        </div>

        <div className="chart-grid">
          <LineMetricGraph
            title={t('progressDailyRequests')}
            points={aiRequestPoints}
            valueLabel={t('progressRequests').toLocaleLowerCase()}
            emptyLabel={t('commonNoDataYet')}
          />
          <AreaMetricGraph
            title={t('progressDailyTokens')}
            points={aiTokenPoints}
            valueLabel={t('progressTotalTokens').toLocaleLowerCase()}
            areaColor={chartColors.accent}
            emptyLabel={t('commonNoDataYet')}
          />
          <HorizontalUsageGraph
            title={t('progressModelsUsed')}
            points={aiModelPoints}
            valueLabel={t('progressRequests').toLocaleLowerCase()}
            emptyLabel={t('commonNoDataYet')}
          />
          <HorizontalUsageGraph
            title={t('progressFeaturesUsed')}
            points={aiFeaturePoints}
            valueLabel={t('progressRequests').toLocaleLowerCase()}
            barColor={chartColors.primarySoft}
            emptyLabel={t('commonNoDataYet')}
          />
        </div>

        <div className="history-list">
          {aiLogRows.length === 0 ? (
            <p className="helper-text">{t('progressAiEmpty')}</p>
          ) : (
            <>
              {aiLogRows.map((entry) => (
                <article key={entry.id} className="history-row log-row">
                  <div>
                    <strong>{getFeatureLabel(entry.feature)}</strong>
                    <p>{entry.model}</p>
                    <p>{formatDateTime(entry.requestedAt)}</p>
                  </div>
                  <div className="log-detail">
                    <small>
                      {entry.success
                        ? t('progressTokensTotalRow', { count: entry.totalTokens })
                        : t('progressDidNotFinish', {
                            reason: entry.errorCode ?? t('commonTryAgain'),
                          })}
                    </small>
                  </div>
                </article>
              ))}
              {filteredAiLogs.length > 5 ? (
                <p className="helper-text">
                  {aiHistoryExpanded
                    ? t('progressHistoryAll', { count: filteredAiLogs.length })
                    : t('progressHistoryLatest', { count: filteredAiLogs.length })}
                </p>
              ) : null}
            </>
          )}
        </div>
      </section>
    </div>
  );
}
