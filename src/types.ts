export type StudyMode = 'all' | 'lastAdded' | 'group' | 'lessKnown' | 'lessSeen';
export type PromptSide = 'english' | 'translation';
export type WordStatus = 'new' | 'learning' | 'known';
export type AiFeature = 'sentenceHint' | 'relatedWords' | 'nextWords' | 'chat' | 'addFromSelection' | 'explainMistake';
export type ReviewAction = 'check' | 'dontKnow' | 'dontShowToday';
export type AiRequestState = 'idle' | 'loading' | 'success' | 'error';
export type Screen = 'study' | 'marathon' | 'vocabulary' | 'chat' | 'progress' | 'settings';
export type ProgressRangePreset = '7d' | '30d' | 'month' | 'custom';
export type PageLayoutMode = 'split' | 'stacked';
export type SupportedAppLanguage = 'en' | 'he' | 'ru';
export type MarathonDifficulty = 'study' | 'easy' | 'warm' | 'medium' | 'hard' | 'expert';

export interface TranslationLanguageProfile {
  learnerName: string;
  tutorName: string;
  masteryThreshold: number;
  translationFontFamily: string;
  showAudioButtons: boolean;
}

export interface ImageHint {
  name: string;
  dataUrl: string;
  mimeType: string;
}

export interface WordEntry {
  id: string;
  englishText: string;
  translations: string[];
  translationLanguage: string;
  groups: string[];
  textHint?: string;
  imageHint?: ImageHint;
  createdAt: string;
  reviewCount: number;
  correctCount: number;
  consecutiveCorrect: number;
  lastSeenAt?: string;
  lastResult?: 'correct' | 'incorrect';
  snoozedUntilDate?: string;
  knownAt?: string;
}

export interface ReviewAttempt {
  id: string;
  wordId: string;
  shownAt: string;
  promptSide: PromptSide;
  userAnswer: string;
  normalizedAnswer: string;
  wasCorrect: boolean;
  usedHint: boolean;
  action: ReviewAction;
}

export interface WordStatusTransition {
  id: string;
  wordId: string;
  changedAt: string;
  fromStatus: WordStatus;
  toStatus: WordStatus;
  masteryThreshold: number;
}

export type Theme = 'light' | 'dark' | 'system';

export interface AppSettings {
  id: 'app';
  appLanguage: SupportedAppLanguage;
  theme: Theme;
  dailyCardsGoal: number;
  dailyMarathonGoal: number;
  learnerName: string;
  tutorName: string;
  masteryThreshold: number;
  lastAddedPercent: number;
  lessSeenPercent: number;
  activeTranslationLanguage: string;
  translationLanguages: string[];
  languageProfiles: Record<string, TranslationLanguageProfile>;
  englishFontFamily: string;
  translationFontFamily: string;
  textFontScale: number;
  studyLayoutMode: PageLayoutMode;
  marathonLayoutMode: PageLayoutMode;
  vocabularyLayoutMode: PageLayoutMode;
  chatLayoutMode: PageLayoutMode;
  progressLayoutMode: PageLayoutMode;
  settingsLayoutMode: PageLayoutMode;
  openRouterApiKey: string;
  openRouterModel: string;
  openRouterMaxTokens: number;
}

export interface ChatMessage {
  id: string;
  role: 'system' | 'user' | 'assistant';
  content: string;
  createdAt: string;
}

export interface ChatSession {
  id: string;
  scope: StudyMode;
  selectedWordIds: string[];
  translationLanguage?: string;
  messages: ChatMessage[];
  label?: string;
  tutorPrompt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AiUsageLog {
  id: string;
  feature: AiFeature;
  model: string;
  requestedAt: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  success: boolean;
  errorCode?: string;
}

export interface MarathonCard {
  id: string;
  wordId: string;
  englishText: string;
  translationText: string;
  translationLanguage: string;
  promptSide: PromptSide;
}

export interface MarathonRun {
  id: string;
  startedAt: string;
  finishedAt: string;
  translationLanguage: string;
  mode: StudyMode;
  group?: string;
  englishPromptPercentage: number;
  difficulty: MarathonDifficulty;
  returnMissedCards: boolean;
  totalCards: number;
  answeredCards: number;
  correctCount: number;
  wrongCount: number;
  timeoutCount: number;
  accuracy: number;
  meanAnswerTimeMs: number;
  totalAnswerTimeMs: number;
  longestStreak: number;
}

export interface MarathonAnswer {
  id: string;
  runId: string;
  wordId: string;
  translationText: string;
  promptSide: PromptSide;
  shownAt: string;
  answerTimeMs: number;
  selectedOption: string;
  correctOption: string;
  wasCorrect: boolean;
  timedOut: boolean;
}

export interface BackupPayload {
  version: 8;
  exportedAt: string;
  words: WordEntry[];
  reviewAttempts: ReviewAttempt[];
  chatSessions: ChatSession[];
  aiUsageLogs: AiUsageLog[];
  statusTransitions: WordStatusTransition[];
  marathonRuns: MarathonRun[];
  marathonAnswers: MarathonAnswer[];
  settings: Omit<AppSettings, 'openRouterApiKey'> & {
    openRouterApiKey?: string;
  };
}

export interface AiSuggestion {
  englishText: string;
  translationText: string;
  translationLanguage: string;
  group?: string;
  reason?: string;
}

export interface AiModelCapabilities {
  supportsStructuredOutputs: boolean;
  supportsResponseFormat: boolean;
  supportsMaxTokens: boolean;
}

export interface OpenRouterModel {
  id: string;
  canonical_slug?: string;
  name: string;
  context_length?: number;
  architecture?: {
    modality?: string;
    input_modalities?: string[];
    output_modalities?: string[];
    tokenizer?: string;
    instruct_type?: string;
  };
  supported_parameters?: string[];
  top_provider?: {
    context_length?: number;
    max_completion_tokens?: number;
  };
}

export interface StudyCard {
  id: string;
  word: WordEntry;
  promptSide: PromptSide;
}

export interface StudySelection {
  mode: StudyMode;
  group?: string;
}

export interface ProgressDateRange {
  preset: ProgressRangePreset;
  from?: string;
  to?: string;
}

export interface PersistedState {
  words: WordEntry[];
  reviewAttempts: ReviewAttempt[];
  chatSessions: ChatSession[];
  aiUsageLogs: AiUsageLog[];
  statusTransitions: WordStatusTransition[];
  marathonRuns: MarathonRun[];
  marathonAnswers: MarathonAnswer[];
  settings: AppSettings;
}
