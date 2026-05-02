import { formatGroupsForDisplay, formatTranslationsForDisplay, getWordStatus } from './lib/text';
import { tRuntime } from './lib/i18n';
import type {
  AiFeature,
  AiSuggestion,
  AppSettings,
  ChatMessage,
  OpenRouterModel,
  WordEntry,
} from './types';

const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';
const OPENROUTER_CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_FREE_MODEL = 'openrouter/free';
const RETRYABLE_STATUS_CODES = new Set([408, 429, 502, 503, 504]);
const RETRY_DELAYS_MS = [700, 1600];
function getAiFeatureLabel(feature: AiFeature): string {
  switch (feature) {
    case 'sentenceHint':
      return tRuntime('aiFeatureSentence');
    case 'relatedWords':
      return tRuntime('aiFeatureRelated');
    case 'nextWords':
      return tRuntime('aiFeatureNext');
    case 'chat':
      return tRuntime('aiFeatureChat');
    case 'addFromSelection':
      return tRuntime('aiFeatureAddFromChat');
    case 'explainMistake':
      return tRuntime('aiFeatureExplainMistake');
    default:
      return tRuntime('aiFeatureChat');
  }
}

interface OpenRouterMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface OpenRouterUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

interface OpenRouterResponse {
  model?: string;
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
  }>;
  usage?: OpenRouterUsage;
  error?: {
    message?: string;
    code?: string;
  };
}

class OpenRouterRequestError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'OpenRouterRequestError';
    this.status = status;
    this.code = code;
  }
}

function buildOpenRouterErrorMessage(
  status: number,
  data: OpenRouterResponse | Record<string, unknown> | null,
  modelId?: string,
): string {
  const responseData = data ?? {};
  const error = 'error' in responseData ? (responseData.error as Record<string, unknown> | undefined) : undefined;
  const message =
    (typeof error?.message === 'string' && error.message) ||
    (typeof (responseData as { message?: unknown }).message === 'string'
      ? ((responseData as { message?: string }).message ?? '')
      : '');
  const code = typeof error?.code === 'string' ? error.code : '';

  const parts = [tRuntime('aiRequestFailed', { status })];

  if (code) {
    parts.push(code);
  }

  if (message) {
    parts.push(message);
  }

  if (status === 429) {
    return [
      'AI request limit reached (429)',
      modelId?.endsWith(':free') || modelId === OPENROUTER_FREE_MODEL
        ? tRuntime('aiFreeBusy')
        : tRuntime('aiModelBusy'),
      message || code || tRuntime('aiTryOtherModel'),
    ].join(': ');
  }

  if (status === 401) {
    parts.push(tRuntime('aiCheckKey'));
  }

  return parts.join(': ');
}

function getHeaders(apiKey: string): HeadersInit {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'HTTP-Referer':
      typeof window !== 'undefined' && window.location.origin ? window.location.origin : 'http://localhost',
    'X-Title': 'LexiGarden',
  };
}

function getMessageContent(content: OpenRouterResponse['choices']): string {
  const value = content?.[0]?.message?.content;

  if (typeof value === 'string') {
    return value.trim();
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => item.text ?? '')
      .join('')
      .trim();
  }

  return '';
}

function getOpenRouterErrorCode(data: OpenRouterResponse | Record<string, unknown> | null): string | undefined {
  const responseData = data ?? {};
  const error = 'error' in responseData ? (responseData.error as Record<string, unknown> | undefined) : undefined;
  return typeof error?.code === 'string' ? error.code : undefined;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function shouldRetryStatus(status: number): boolean {
  return RETRYABLE_STATUS_CODES.has(status);
}

function shouldFallbackToFreeRouter(modelId: string, error: unknown): boolean {
  return (
    modelId.endsWith(':free') &&
    modelId !== OPENROUTER_FREE_MODEL &&
    error instanceof OpenRouterRequestError &&
    shouldRetryStatus(error.status)
  );
}

async function pause(ms: number, signal?: AbortSignal): Promise<void> {
  if (!ms) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('The operation was aborted.', 'AbortError'));
      return;
    }

    const timeoutId = globalThis.setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);

    function onAbort() {
      globalThis.clearTimeout(timeoutId);
      reject(new DOMException('The operation was aborted.', 'AbortError'));
    }

    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function assertAiReady(settings: AppSettings): void {
  if (!settings.openRouterApiKey.trim()) {
    throw new Error(tRuntime('aiNeedKey'));
  }

  if (!settings.openRouterModel.trim()) {
    throw new Error(tRuntime('aiNeedModel'));
  }
}

export async function fetchOpenRouterModels(apiKey: string): Promise<OpenRouterModel[]> {
  if (!apiKey.trim()) {
    throw new Error(tRuntime('aiNeedKeyBeforeModels'));
  }

  const response = await fetch(OPENROUTER_MODELS_URL, {
    headers: getHeaders(apiKey),
  });

  const data = (await response.json()) as { data?: OpenRouterModel[] } | Record<string, unknown>;

  if (!response.ok) {
    throw new Error(buildOpenRouterErrorMessage(response.status, data));
  }

  return ((data as { data?: OpenRouterModel[] }).data ?? []).sort((left, right) =>
    left.id.localeCompare(right.id),
  );
}

async function sendOpenRouterRequest(
  apiKey: string,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<{ content: string; usage?: OpenRouterUsage; model: string }> {
  const response = await fetch(OPENROUTER_CHAT_URL, {
    method: 'POST',
    headers: getHeaders(apiKey),
    body: JSON.stringify(body),
    signal,
  });

  let data: OpenRouterResponse | null = null;

  try {
    data = (await response.json()) as OpenRouterResponse;
  } catch {
    data = null;
  }

  if (!response.ok) {
    throw new OpenRouterRequestError(
      buildOpenRouterErrorMessage(response.status, data, typeof body.model === 'string' ? body.model : undefined),
      response.status,
      getOpenRouterErrorCode(data),
    );
  }

  const content = getMessageContent(data?.choices);

  if (!content) {
    throw new Error(tRuntime('aiNoReply'));
  }

  return {
    content,
    usage: data?.usage,
    model: typeof data?.model === 'string' ? data.model : String(body.model ?? ''),
  };
}

async function requestOpenRouterWithRetries(
  apiKey: string,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<{ content: string; usage?: OpenRouterUsage; model: string }> {
  let attempt = 0;

  while (true) {
    try {
      return await sendOpenRouterRequest(apiKey, body, signal);
    } catch (error) {
      if (
        isAbortError(error) ||
        !(error instanceof OpenRouterRequestError) ||
        !shouldRetryStatus(error.status) ||
        attempt >= RETRY_DELAYS_MS.length
      ) {
        throw error;
      }

      await pause(RETRY_DELAYS_MS[attempt], signal);
      attempt += 1;
    }
  }
}

async function callOpenRouter(
  settings: AppSettings,
  feature: AiFeature,
  messages: OpenRouterMessage[],
  options?: {
    maxTokens?: number;
    responseFormat?: Record<string, unknown>;
    signal?: AbortSignal;
  },
): Promise<{ content: string; usage?: OpenRouterUsage; model: string }> {
  assertAiReady(settings);

  const buildBody = (model: string): Record<string, unknown> => {
    const body: Record<string, unknown> = {
      model,
      messages,
    };

    if (options?.maxTokens ?? settings.openRouterMaxTokens) {
      body.max_tokens = options?.maxTokens ?? settings.openRouterMaxTokens;
    }

    if (options?.responseFormat) {
      body.response_format = options.responseFormat;
    }

    return body;
  };

  const primaryModel = settings.openRouterModel.trim();

  try {
    const response = await requestOpenRouterWithRetries(
      settings.openRouterApiKey,
      buildBody(primaryModel),
      options?.signal,
    );

    return {
      ...response,
      model: response.model || primaryModel,
    };
  } catch (error) {
    if (!shouldFallbackToFreeRouter(primaryModel, error)) {
      if (error instanceof Error && error.message === 'The AI did not send back a reply.') {
        throw new Error(tRuntime('aiEmptyFeature', { feature: getAiFeatureLabel(feature) }));
      }

      throw error;
    }
  }

  try {
    const fallbackResponse = await requestOpenRouterWithRetries(
      settings.openRouterApiKey,
      buildBody(OPENROUTER_FREE_MODEL),
      options?.signal,
    );

    return {
      ...fallbackResponse,
      model: fallbackResponse.model || OPENROUTER_FREE_MODEL,
    };
  } catch (fallbackError) {
    if (fallbackError instanceof OpenRouterRequestError) {
      throw new OpenRouterRequestError(
        `${fallbackError.message} Tried ${primaryModel} first and ${OPENROUTER_FREE_MODEL} as a fallback, but free capacity was still unavailable.`,
        fallbackError.status,
        fallbackError.code,
      );
    }

    throw fallbackError;
  }
}

export async function testOpenRouterConnection(
  settings: AppSettings,
): Promise<{ content: string; usage?: OpenRouterUsage; model: string }> {
  return callOpenRouter(
    settings,
    'chat',
    [
      {
        role: 'system',
        content: 'You are a connectivity test. Reply only with the word OK.',
      },
      {
        role: 'user',
        content: 'Reply with OK.',
      },
    ],
    {
      maxTokens: 12,
    },
  );
}

export async function generateMistakeExplanation(
  settings: AppSettings,
  word: WordEntry,
  userAnswer: string,
  promptSide: 'english' | 'translation',
): Promise<{ explanation: string; model: string; usage?: OpenRouterUsage }> {
  const systemPrompt = `You are a helpful language tutor. The user made a mistake in a vocabulary drill.
Keep your explanation strictly constrained to 2-3 brief bullets plus one tiny example.
Do not use conversational filler like "Sure" or "Here is the explanation".
Be encouraging but concise.`;

  const question =
    promptSide === 'english'
      ? `The user was asked to translate the English word "${word.englishText}" into ${word.translationLanguage}. The correct answers are: ${word.translations.join(', ')}. The user answered: "${userAnswer}". Explain the mistake.`
      : `The user was asked to translate the ${word.translationLanguage} word(s) "${word.translations.join(', ')}" into English. The correct answer is: "${word.englishText}". The user answered: "${userAnswer}". Explain the mistake.`;

  const messages: OpenRouterMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: question },
  ];

  const result = await callOpenRouter(
    settings,
    'explainMistake',
    messages,
  );

  return {
    explanation: result.content,
    model: result.model,
    usage: result.usage,
  };
}

export async function generateSentenceHint(
  settings: AppSettings,
  word: WordEntry,
): Promise<{ sentence: string; usage?: OpenRouterUsage; model: string }> {
  const response = await callOpenRouter(settings, 'sentenceHint', [
    {
      role: 'system',
      content:
        'Write one short, natural English sentence that uses the target word correctly. Return only the sentence.',
    },
    {
      role: 'user',
      content: `Target word: ${word.englishText}\nTranslation language: ${word.translationLanguage}\nAccepted translations: ${formatTranslationsForDisplay(word)}`,
    },
  ]);

  return {
    sentence: response.content,
    usage: response.usage,
    model: response.model,
  };
}

function buildStructuredResponseFormat(name: string, schema: Record<string, unknown>) {
  return {
    type: 'json_schema',
    json_schema: {
      name,
      strict: true,
      schema,
    },
  };
}

function normalizeJsonText(content: string): string {
  return content
    .trim()
    .replace(/^\uFEFF/, '')
    .replace(/\r/g, '')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'");
}

function extractJsonCandidate(content: string): string {
  const normalized = normalizeJsonText(content);
  const fencedMatch = normalized.match(/```(?:json)?\s*([\s\S]*?)```/i);

  if (fencedMatch?.[1]) {
    return fencedMatch[1].trim();
  }

  const firstObjectBrace = normalized.indexOf('{');
  const lastObjectBrace = normalized.lastIndexOf('}');

  if (firstObjectBrace !== -1 && lastObjectBrace > firstObjectBrace) {
    return normalized.slice(firstObjectBrace, lastObjectBrace + 1).trim();
  }

  const firstArrayBrace = normalized.indexOf('[');
  const lastArrayBrace = normalized.lastIndexOf(']');

  if (firstArrayBrace !== -1 && lastArrayBrace > firstArrayBrace) {
    return normalized.slice(firstArrayBrace, lastArrayBrace + 1).trim();
  }

  return normalized;
}

function repairJsonCandidate(content: string): string {
  return extractJsonCandidate(content)
    .replace(/,\s*([}\]])/g, '$1')
    .replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)(\s*:)/g, '$1"$2"$3');
}

function parseStructuredJson<T>(content: string, featureLabel: string): T {
  const candidates = [
    normalizeJsonText(content),
    extractJsonCandidate(content),
    repairJsonCandidate(content),
  ].filter((candidate, index, values) => candidate && values.indexOf(candidate) === index);

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as T;
    } catch {}
  }

  throw new Error(
    tRuntime('aiWrongFormat', { feature: featureLabel }),
  );
}

function asTrimmedOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function parseAiSuggestion(value: unknown, defaultTranslationLanguage?: string): AiSuggestion {
  if (!value || typeof value !== 'object') {
    throw new Error(tRuntime('aiCouldNotReadAnswer'));
  }

  const record = value as Record<string, unknown>;
  const englishText = asTrimmedOptionalString(record.englishText);
  const translationText = asTrimmedOptionalString(record.translationText);
  const translationLanguage =
    asTrimmedOptionalString(record.translationLanguage) ?? defaultTranslationLanguage?.trim();

  if (!englishText || !translationText || !translationLanguage) {
    throw new Error(tRuntime('aiMissingWordPart'));
  }

  return {
    englishText,
    translationText,
    translationLanguage,
    group: asTrimmedOptionalString(record.group),
    reason: asTrimmedOptionalString(record.reason),
  };
}

export async function suggestRelatedWords(
  settings: AppSettings,
  word: WordEntry,
): Promise<{ suggestions: AiSuggestion[]; usage?: OpenRouterUsage; model: string }> {
  const response = await callOpenRouter(
    settings,
    'relatedWords',
    [
      {
        role: 'system',
        content:
          'Return five related vocabulary suggestions for the learner. Keep them practical, varied, easy to study next, and use short clean vocabulary-style translations. Return only valid JSON that matches the schema. If more than one translation or group is needed, join them with " / ". Do not add markdown, comments, or extra text.',
      },
      {
        role: 'user',
        content: [
          `Word: ${word.englishText}`,
          `Accepted translations: ${formatTranslationsForDisplay(word)}`,
          `Translation language: ${word.translationLanguage}`,
          `Groups: ${word.groups.length > 0 ? formatGroupsForDisplay(word) : 'none'}`,
          'Return five items.',
        ].join('\n'),
      },
    ],
    {
      responseFormat: buildStructuredResponseFormat('related_words', {
        type: 'object',
        additionalProperties: false,
        required: ['suggestions'],
        properties: {
          suggestions: {
            type: 'array',
            minItems: 5,
            maxItems: 5,
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['englishText', 'translationText', 'translationLanguage', 'reason'],
              properties: {
                englishText: {
                  type: 'string',
                },
                translationText: {
                  type: 'string',
                },
                translationLanguage: {
                  type: 'string',
                },
                group: {
                  type: 'string',
                },
                reason: {
                  type: 'string',
                },
              },
            },
          },
        },
      }),
    },
  );

  const parsed = parseStructuredJson<{ suggestions: unknown[] }>(
    response.content,
    tRuntime('aiFeatureRelated'),
  );

  if (!Array.isArray(parsed.suggestions) || parsed.suggestions.length === 0) {
    throw new Error(tRuntime('aiNoRelatedSuggestions'));
  }

  return {
    suggestions: parsed.suggestions.map((suggestion) =>
      parseAiSuggestion(suggestion, word.translationLanguage),
    ),
    usage: response.usage,
    model: response.model,
  };
}

export async function suggestNextWords(
  settings: AppSettings,
  context: {
    recentWords: WordEntry[];
    masteryThreshold: number;
    translationLanguage: string;
    group?: string;
    englishText?: string;
    translationText?: string;
    textHint?: string;
  },
): Promise<{ suggestions: AiSuggestion[]; usage?: OpenRouterUsage; model: string }> {
  const recentVocabulary = context.recentWords
    .slice(0, 12)
    .map((word) => {
      const status = getWordStatus(word, context.masteryThreshold);
      return [
        `- ${word.englishText} = ${formatTranslationsForDisplay(word)}`,
        `language: ${word.translationLanguage}`,
        `groups: ${word.groups.length > 0 ? formatGroupsForDisplay(word) : 'none'}`,
        `status: ${status}`,
        `reviews: ${word.reviewCount}`,
      ].join(' | ');
    })
    .join('\n');

  const response = await callOpenRouter(
    settings,
    'nextWords',
    [
      {
        role: 'system',
        content:
          'Suggest five useful next vocabulary items for this learner. Base them on the learner’s recent vocabulary, likely level, current topic, and the kind of items they are adding. Keep the words practical, study-friendly, and use short clean vocabulary-style translations. Return only valid JSON that matches the schema. If more than one translation or group is needed, join them with " / ". Do not add markdown, comments, or extra text.',
      },
      {
        role: 'user',
        content: [
          `Target translation language: ${context.translationLanguage}`,
          `Current topic/group: ${context.group ?? 'not specified'}`,
          `Current draft English: ${context.englishText?.trim() || 'not specified'}`,
          `Current draft translation: ${context.translationText?.trim() || 'not specified'}`,
          `Current draft hint: ${context.textHint?.trim() || 'not specified'}`,
          'Recent vocabulary:',
          recentVocabulary || '- none yet',
          'Balance the suggestions for the learner level: prefer easier, concrete words if many recent items are new or learning.',
          'If the recent vocabulary includes phrases, you may include short phrases too.',
          'Return five items.',
        ].join('\n'),
      },
    ],
    {
      responseFormat: buildStructuredResponseFormat('next_words', {
        type: 'object',
        additionalProperties: false,
        required: ['suggestions'],
        properties: {
          suggestions: {
            type: 'array',
            minItems: 5,
            maxItems: 5,
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['englishText', 'translationText', 'translationLanguage', 'reason'],
              properties: {
                englishText: {
                  type: 'string',
                },
                translationText: {
                  type: 'string',
                },
                translationLanguage: {
                  type: 'string',
                },
                group: {
                  type: 'string',
                },
                reason: {
                  type: 'string',
                },
              },
            },
          },
        },
      }),
    },
  );

  const parsed = parseStructuredJson<{ suggestions: unknown[] }>(
    response.content,
    tRuntime('aiFeatureNext'),
  );

  if (!Array.isArray(parsed.suggestions) || parsed.suggestions.length === 0) {
    throw new Error(tRuntime('aiNoNextSuggestions'));
  }

  return {
    suggestions: parsed.suggestions.map((suggestion) =>
      parseAiSuggestion(suggestion, context.translationLanguage),
    ),
    usage: response.usage,
    model: response.model,
  };
}

function buildChatSystemPrompt(
  words: WordEntry[],
  translationLanguage?: string,
  learnerName?: string,
  tutorName?: string,
  tutorPrompt?: string,
): string {
  const vocabulary = words
    .slice(0, 150)
    .map(
      (word) =>
        `- ${word.englishText} = ${formatTranslationsForDisplay(word)}${
          word.groups.length > 0 ? ` [groups: ${formatGroupsForDisplay(word)}]` : ''
        }`,
    )
    .join('\n');

  return [
    `You are a friendly English conversation tutor${tutorName ? ` named ${tutorName}` : ''}.`,
    'Talk mostly in English.',
    translationLanguage
      ? `Use ${translationLanguage} only if the learner asks for help or clearly needs clarification.`
      : 'Use the learner’s other language only if they explicitly ask for it.',
    learnerName ? `The learner's name is ${learnerName}.` : '',
    tutorName ? `Introduce yourself as ${tutorName} when it feels natural.` : '',
    'Naturally weave the saved vocabulary into the conversation without turning every reply into a list.',
    'Keep the tone encouraging, concise, and useful.',
    tutorPrompt ? `Extra tutor instructions: ${tutorPrompt}` : '',
    'Saved vocabulary:',
    vocabulary || '- No vocabulary available yet',
  ].join('\n');
}

export async function continueVocabularyChat(
  settings: AppSettings,
  messages: ChatMessage[],
  words: WordEntry[],
  translationLanguage?: string,
  learnerName?: string,
  tutorName?: string,
  tutorPrompt?: string,
  signal?: AbortSignal,
): Promise<{ assistantMessage: string; usage?: OpenRouterUsage; model: string }> {
  const response = await callOpenRouter(settings, 'chat', [
    {
      role: 'system',
      content: buildChatSystemPrompt(words, translationLanguage, learnerName, tutorName, tutorPrompt),
    },
    ...messages
      .filter((message) => message.role !== 'system')
      .map((message) => ({
        role: message.role,
        content: message.content,
      })),
  ], { signal });

  return {
    assistantMessage: response.content,
    usage: response.usage,
    model: response.model,
  };
}

export async function prepareWordFromSelection(
  settings: AppSettings,
  selectedText: string,
  translationLanguage: string,
  context: string,
): Promise<{ suggestion: AiSuggestion; usage?: OpenRouterUsage; model: string }> {
  const response = await callOpenRouter(
    settings,
    'addFromSelection',
    [
      {
        role: 'system',
        content:
          'Turn the selected text into one vocabulary item suitable for a language learner. Prefer the simplest useful translation and keep the translation short and study-friendly. Return only valid JSON that matches the schema. If more than one translation or group is needed, join them with " / ". Do not add markdown, comments, or extra text.',
      },
      {
        role: 'user',
        content: [
          `Selected text: ${selectedText}`,
          `Target translation language: ${translationLanguage}`,
          `Conversation context: ${context}`,
        ].join('\n'),
      },
    ],
    {
      responseFormat: buildStructuredResponseFormat('selection_to_word', {
        type: 'object',
        additionalProperties: false,
        required: ['englishText', 'translationText', 'translationLanguage'],
        properties: {
          englishText: {
            type: 'string',
          },
          translationText: {
            type: 'string',
          },
          translationLanguage: {
            type: 'string',
          },
          group: {
            type: 'string',
          },
          reason: {
            type: 'string',
          },
        },
      }),
    },
  );

  return {
    suggestion: parseAiSuggestion(
      parseStructuredJson<unknown>(response.content, tRuntime('aiFeatureAddFromChat')),
      translationLanguage,
    ),
    usage: response.usage,
    model: response.model,
  };
}
