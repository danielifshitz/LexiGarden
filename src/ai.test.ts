import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppSettings } from './types';
import {
  prepareWordFromSelection,
  suggestNextWords,
  suggestRelatedWords,
  testOpenRouterConnection,
} from './ai';

function makeSettings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    id: 'app',
    appLanguage: 'en',
    theme: 'system',
  dailyCardsGoal: 20,
  dailyMarathonGoal: 50,
  learnerName: '',
    tutorName: 'Tutor',
    masteryThreshold: 3,
    lastAddedPercent: 25,
    lessSeenPercent: 25,
    activeTranslationLanguage: 'Hebrew',
    translationLanguages: ['Hebrew'],
    languageProfiles: {
      Hebrew: {
        learnerName: '',
        tutorName: 'Tutor',
        masteryThreshold: 3,
        translationFontFamily: 'sans',
        showAudioButtons: true,
      },
    },
    englishFontFamily: 'serif',
    translationFontFamily: 'sans',
    textFontScale: 100,
    studyLayoutMode: 'split',
    marathonLayoutMode: 'split',
    vocabularyLayoutMode: 'split',
    chatLayoutMode: 'split',
    progressLayoutMode: 'stacked',
    settingsLayoutMode: 'split',
    openRouterApiKey: 'sk-or-v1-test',
    openRouterModel: 'qwen/qwen3-next-80b-a3b-instruct:free',
    openRouterMaxTokens: 250,
    ...overrides,
  };
}

function createJsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response;
}

describe('OpenRouter requests', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('falls back to openrouter/free after repeated free-model rate limits', async () => {
    vi.useFakeTimers();

    const primaryModel = 'qwen/qwen3-next-80b-a3b-instruct:free';
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(createJsonResponse(429, { error: { message: 'Provider returned error' } }))
      .mockResolvedValueOnce(createJsonResponse(429, { error: { message: 'Provider returned error' } }))
      .mockResolvedValueOnce(createJsonResponse(429, { error: { message: 'Provider returned error' } }))
      .mockResolvedValueOnce(
        createJsonResponse(200, {
          model: 'openrouter/free',
          choices: [{ message: { content: 'OK' } }],
          usage: { total_tokens: 1 },
        }),
      );

    vi.stubGlobal('fetch', fetchMock);

    const responsePromise = testOpenRouterConnection(makeSettings({ openRouterModel: primaryModel }));
    await vi.runAllTimersAsync();
    const response = await responsePromise;

    expect(response.content).toBe('OK');
    expect(response.model).toBe('openrouter/free');
    expect(fetchMock).toHaveBeenCalledTimes(4);

    const requestedModels = fetchMock.mock.calls.map(([, init]) => {
      const body = JSON.parse(String((init as RequestInit).body)) as { model: string };
      return body.model;
    });

    expect(requestedModels).toEqual([
      primaryModel,
      primaryModel,
      primaryModel,
      'openrouter/free',
    ]);
  });

  it('retries a temporary 429 before succeeding on the selected model', async () => {
    vi.useFakeTimers();

    const primaryModel = 'qwen/qwen3-next-80b-a3b-instruct:free';
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(createJsonResponse(429, { error: { message: 'Provider returned error' } }))
      .mockResolvedValueOnce(
        createJsonResponse(200, {
          model: primaryModel,
          choices: [{ message: { content: 'OK' } }],
          usage: { total_tokens: 1 },
        }),
      );

    vi.stubGlobal('fetch', fetchMock);

    const responsePromise = testOpenRouterConnection(makeSettings({ openRouterModel: primaryModel }));
    await vi.runAllTimersAsync();
    const response = await responsePromise;

    expect(response.model).toBe(primaryModel);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('surfaces a clearer error when both the selected free model and fallback are full', async () => {
    vi.useFakeTimers();

    const primaryModel = 'qwen/qwen3-next-80b-a3b-instruct:free';
    const fetchMock = vi
      .fn()
      .mockResolvedValue(createJsonResponse(429, { error: { message: 'Provider returned error' } }));

    vi.stubGlobal('fetch', fetchMock);

    const responsePromise = testOpenRouterConnection(makeSettings({ openRouterModel: primaryModel }));
    const rejectionExpectation = expect(responsePromise).rejects.toThrow(
      `Tried ${primaryModel} first and openrouter/free as a fallback, but free capacity was still unavailable.`,
    );

    await vi.runAllTimersAsync();
    await rejectionExpectation;
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it('repairs common malformed JSON for related word suggestions', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      createJsonResponse(200, {
        model: 'openrouter/free',
        choices: [
          {
            message: {
              content: `\`\`\`json
{
  suggestions: [
    {
      englishText: "apple",
      translationText: "תפוח",
      translationLanguage: "Hebrew",
      reason: "common food word",
    },
  ],
}
\`\`\``,
            },
          },
        ],
        usage: { total_tokens: 1 },
      }),
    );

    vi.stubGlobal('fetch', fetchMock);

    const response = await suggestRelatedWords(makeSettings(), {
      id: 'w1',
      englishText: 'fruit',
      translations: ['פרי'],
      translationLanguage: 'Hebrew',
      groups: [],
      createdAt: new Date().toISOString(),
      reviewCount: 0,
      correctCount: 0,
      consecutiveCorrect: 0,
    });

    expect(response.suggestions[0]).toMatchObject({
      englishText: 'apple',
      translationText: 'תפוח',
      translationLanguage: 'Hebrew',
    });
  });

  it('extracts a valid add-from-chat object from fenced JSON content', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      createJsonResponse(200, {
        model: 'openrouter/free',
        choices: [
          {
            message: {
              content: `Here is the JSON:
\`\`\`json
{
  "englishText": "take off",
  "translationText": "להמריא",
  "translationLanguage": "Hebrew",
  "reason": "useful travel verb"
}
\`\`\``,
            },
          },
        ],
        usage: { total_tokens: 1 },
      }),
    );

    vi.stubGlobal('fetch', fetchMock);

    const response = await prepareWordFromSelection(
      makeSettings(),
      'take off',
      'Hebrew',
      'We talked about planes and airports.',
    );

    expect(response.suggestion).toMatchObject({
      englishText: 'take off',
      translationText: 'להמריא',
      translationLanguage: 'Hebrew',
    });
  });

  it('returns next-word suggestions from recent vocabulary context', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      createJsonResponse(200, {
        model: 'openrouter/free',
        choices: [
          {
            message: {
              content: JSON.stringify({
                suggestions: [
                  {
                    englishText: 'colleague',
                    translationText: 'עמית לעבודה',
                    translationLanguage: 'Hebrew',
                    group: 'work',
                    reason: 'fits the recent work vocabulary and stays practical',
                  },
                  {
                    englishText: 'meeting',
                    translationText: 'פגישה',
                    translationLanguage: 'Hebrew',
                    group: 'work',
                    reason: 'common word that supports daily work conversations',
                  },
                  {
                    englishText: 'deadline',
                    translationText: 'מועד אחרון',
                    translationLanguage: 'Hebrew',
                    group: 'work',
                    reason: 'useful next step for office vocabulary',
                  },
                  {
                    englishText: 'schedule',
                    translationText: 'לוח זמנים',
                    translationLanguage: 'Hebrew',
                    group: 'work',
                    reason: 'helps talk about planning and work routines',
                  },
                  {
                    englishText: 'project update',
                    translationText: 'עדכון פרויקט',
                    translationLanguage: 'Hebrew',
                    group: 'work',
                    reason: 'short phrase that matches practical work usage',
                  },
                ],
              }),
            },
          },
        ],
        usage: { total_tokens: 1 },
      }),
    );

    vi.stubGlobal('fetch', fetchMock);

    const response = await suggestNextWords(makeSettings(), {
      masteryThreshold: 3,
      translationLanguage: 'Hebrew',
      group: 'work',
      recentWords: [
        {
          id: 'w1',
          englishText: 'job',
          translations: ['עבודה'],
          translationLanguage: 'Hebrew',
          groups: ['work'],
          createdAt: new Date().toISOString(),
          reviewCount: 2,
          correctCount: 1,
          consecutiveCorrect: 1,
        },
      ],
    });

    expect(response.suggestions).toHaveLength(5);
    expect(response.suggestions[0]).toMatchObject({
      englishText: 'colleague',
      group: 'work',
    });
  });
});
