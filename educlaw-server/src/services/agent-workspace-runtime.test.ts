import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentExecutionSnapshot } from '@educlaw/shared';
import type { ArenaChatStreamEvent } from './arena-service.js';
import type { HarnessResult, HarnessRunRequest } from '../harness/contracts.js';

const queryMock = vi.fn();
const streamMock = vi.fn();
const piMock = vi.fn();
const getPackageMock = vi.fn();
const getPackageVersionMock = vi.fn();
const generateTextMock = vi.fn();
let execution: AgentExecutionSnapshot;
let answerRunInserts: unknown[][];

async function collect(stream: AsyncGenerator<ArenaChatStreamEvent>) {
  const events: ArenaChatStreamEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

async function loadRuntime(piEnabled: boolean) {
  vi.resetModules();
  vi.doMock('./db.js', () => ({
    query: queryMock,
    withTransaction: async (
      work: (db: { query: typeof queryMock }) => Promise<unknown>,
    ) => work({ query: queryMock }),
  }));
  vi.doMock('./package-service.js', () => ({
    assertRubricConfigured: vi.fn(),
    getPackage: getPackageMock,
    getPackageWithVersionId: getPackageVersionMock,
  }));
  vi.doMock('./llm-service.js', () => ({
    generateJson: vi.fn(),
    generateText: generateTextMock,
    streamTextParts: streamMock,
    resolveBaselineModel: (model?: string) => model || 'baseline',
    resolveEnhancedModel: (model?: string) => model || 'enhanced',
    supportsExplicitThinking: () => false,
  }));
  vi.doMock('../config.js', () => ({
    config: {
      piHarnessSkillRunEnabled: piEnabled,
      piHarnessMaxConcurrentRuns: 4,
      piHarnessRunTimeoutMs: 300_000,
    },
  }));
  vi.doMock('../harness/pi-core-adapter.js', async () => ({
    ...(await vi.importActual('../harness/pi-core-adapter.js')),
    runPiAgent: piMock,
  }));
  vi.doMock('../lib/request-context.js', () => ({
    getLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  }));
  return import('./arena-service.js');
}

beforeEach(() => {
  queryMock.mockReset();
  streamMock.mockReset();
  piMock.mockReset();
  generateTextMock.mockReset();
  // Package access must be skipped, including when the latest repository is unavailable.
  getPackageMock
    .mockReset()
    .mockRejectedValue(new Error('Latest package was removed'));
  getPackageVersionMock
    .mockReset()
    .mockRejectedValue(new Error('Latest package was removed'));
  execution = {
    agentId: '5',
    name: 'Fixed Agent',
    instructions: 'PINNED_AGENT_INSTRUCTIONS',
    model: 'fixed-model',
    skills: Array.from({ length: 4 }, (_, index) => ({
      skillId: String(11 + index),
      skillVersionId: String(101 + index),
      enabled: true,
      packageId: String(7 + index),
      packageVersionId: String(70 + index),
      skillUid: `uid-${index}`,
      name: `Fixed Skill ${index}`,
      description: 'No question keyword overlap',
      versionNumber: index + 1,
      skillMd: `PINNED_SKILL_BODY_${index}`,
    })),
  };
  let messageId = 100;
  answerRunInserts = [];
  queryMock.mockImplementation(async (sql: string, args: unknown[] = []) => {
    if (
      sql.startsWith(
        'select * from arena_threads where id = $1 and user_id = $2',
      )
    ) {
      return {
        rows:
          args[1] === 'owner'
            ? [
                {
                  id: 91,
                  user_id: 'owner',
                  package_id: 7,
                  title: 'Fixed Agent run',
                  model: 'fixed-model',
                  arena_kind: 'skill_arena',
                  base_package_version_id: 70,
                  arena_config_jsonb: {
                    mode: 'skill_arena',
                    compositionMode: 'skill_only',
                    surface: 'run',
                    basePackageVersionId: '70',
                    agentExecution: structuredClone(execution),
                  },
                  created_at: '2026-11-03T00:00:00.000Z',
                  updated_at: '2026-11-03T00:00:00.000Z',
                },
              ]
            : [],
        rowCount: args[1] === 'owner' ? 1 : 0,
      };
    }
    if (sql.includes('from arena_messages')) return { rows: [], rowCount: 0 };
    if (sql.startsWith('insert into arena_messages'))
      return { rows: [{ id: messageId++ }], rowCount: 1 };
    if (sql.startsWith('insert into arena_answer_runs')) {
      answerRunInserts.push(args);
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith('update arena_threads set updated_at'))
      return { rows: [], rowCount: 1 };
    throw new Error(`Unexpected runtime query: ${sql}`);
  });
});

afterEach(() => {
  for (const path of [
    './db.js',
    './package-service.js',
    './llm-service.js',
    '../config.js',
    '../harness/pi-core-adapter.js',
    '../lib/request-context.js',
  ])
    vi.doUnmock(path);
  vi.resetModules();
});

function assertNoPackageSelection(allowAnswerRun = false) {
  expect(getPackageMock).not.toHaveBeenCalled();
  expect(getPackageVersionMock).not.toHaveBeenCalled();
  expect(
    queryMock.mock.calls.some(([sql]) =>
      /agent_package_versions|agent_skill_versions|arena_thread_variants|user_agents/.test(
        sql,
      ),
    ),
  ).toBe(false);
  expect(
    queryMock.mock.calls.some(([sql]) =>
      sql.includes('insert into arena_answer_runs'),
    ),
  ).toBe(allowAnswerRun);
}

describe('Agent fixed snapshot runtime', () => {
  it('does not allow an optimization workspace to bypass Agent conversation creation', async () => {
    const runtime = await loadRuntime(false);
    const databaseQuery = queryMock.getMockImplementation()!;
    queryMock.mockImplementation(async (sql, args) => {
      const result = await databaseQuery(sql, args);
      if (sql.startsWith('select * from arena_threads'))
        result.rows[0].arena_config_jsonb.optimizationOnly = true;
      return result;
    });
    await expect(
      collect(
        runtime.streamMessage('owner', '91', 'Question', undefined, 'agent'),
      ),
    ).rejects.toMatchObject({ status: 422, code: 'AGENT_REQUIRED' });
    expect(streamMock).not.toHaveBeenCalled();
    expect(piMock).not.toHaveBeenCalled();
    expect(queryMock.mock.calls.some(([sql]) => sql.startsWith('insert'))).toBe(
      false,
    );
  });

  it('passes every cross-package skill to Pi and builds a system prompt with every body and Agent instruction', async () => {
    const runtime = await loadRuntime(true);
    const { buildPiSystemPrompt } =
      await import('../harness/pi-core-adapter.js');
    piMock.mockImplementation(
      async (request: HarnessRunRequest): Promise<HarnessResult> => ({
        runId: request.runId,
        status: 'completed',
        text: 'Pi answer',
        requestedModelId: request.model.modelId,
        providerRegistryId: 'fixture',
        responseModelId: 'fixed-model',
        selectedSkillVersionId: request.selectedSkill.versionId,
        error: null,
        evidence: {
          skillInjected: true,
          historyMessageCount: 0,
          modelRequestAttemptCount: 1,
          modelRequestCount: 1,
          toolCallCount: 0,
          toolNames: [],
          eventTypes: [],
          eventDeliveryFailureCount: 0,
          outputChars: 9,
          durationMs: 1,
          cleanupCompleted: true,
        },
      }),
    );
    const events = await collect(
      runtime.streamMessage(
        'owner',
        '91',
        'Unrelated question',
        'client-model-override',
        'agent',
      ),
    );
    expect(piMock).toHaveBeenCalledTimes(1);
    expect(streamMock).not.toHaveBeenCalled();
    const request = piMock.mock.calls[0][0] as HarnessRunRequest;
    expect([request.selectedSkill, ...request.additionalSkills!]).toEqual(
      execution.skills.map((skill) => ({
        versionId: Number(skill.skillVersionId),
        skillMd: skill.skillMd,
      })),
    );
    expect(request.model.modelId).toBe('fixed-model');
    const systemPrompt = buildPiSystemPrompt(request);
    expect(systemPrompt).toContain('PINNED_AGENT_INSTRUCTIONS');
    for (const skill of execution.skills) {
      expect(systemPrompt).toContain(skill.skillMd);
      expect(systemPrompt).toContain(
        `# Fixed Skill Version ${skill.skillVersionId}`,
      );
    }
    assertNoPackageSelection(true);
    const answerRun = answerRunInserts[0]!;
    expect(JSON.parse(String(answerRun[7]))).toEqual(
      execution.skills.map((skill) => skill.skillUid),
    );
    expect(answerRun[12]).toBeNull();
    expect(answerRun[13]).toBeNull();
    expect(answerRun[14]).toBe(Number(execution.skills[0]!.skillVersionId));
    expect(events).toContainEqual(
      expect.objectContaining({
        event: 'side_done',
        data: expect.objectContaining({ content: 'Pi answer', ok: true }),
      }),
    );
    expect(events.at(-1)?.event).toBe('done');
  });

  it('streams all fixed skills and instructions even if stored context changes after the snapshot is loaded', async () => {
    const runtime = await loadRuntime(false);
    const original = structuredClone(execution);
    const stream = runtime.streamMessage(
      'owner',
      '91',
      'Unrelated question',
      'client-model-override',
      'agent',
    );
    // The shared event occurs after loading the execution snapshot and before generation.
    const events: ArenaChatStreamEvent[] = [];
    while (true) {
      const next = await stream.next();
      if (next.done) throw new Error('Stream ended before snapshot was loaded');
      events.push(next.value);
      if (next.value.event === 'shared') break;
    }
    execution.instructions = 'CHANGED_INSTRUCTIONS';
    execution.skills = [
      { ...execution.skills[0], skillMd: 'CHANGED_SKILL_BODY' },
    ];
    streamMock.mockImplementation(async function* (request: {
      systemPrompt: string;
      model: string;
    }) {
      expect(request.model).toBe(original.model);
      expect(request.systemPrompt).toContain(original.instructions);
      for (const skill of original.skills)
        expect(request.systemPrompt).toContain(skill.skillMd);
      expect(request.systemPrompt).not.toContain('CHANGED_');
      yield { type: 'content', delta: 'Stream answer' };
    });
    events.push(...(await collect(stream)));
    expect(streamMock).toHaveBeenCalledTimes(1);
    expect(piMock).not.toHaveBeenCalled();
    assertNoPackageSelection(true);
    expect(JSON.parse(String(answerRunInserts[0]![7]))).toEqual(
      original.skills.map((skill) => skill.skillUid),
    );
    const assistant = queryMock.mock.calls.find(
      ([sql, args]) =>
        sql.startsWith('insert into arena_messages') && args[3] === 'assistant',
    );
    expect(assistant?.[1][4]).toBe('Stream answer');
    expect(events.at(-1)?.event).toBe('done');
  });

  it.each(['compare', 'baseline'] as const)(
    'rejects stream mode %s before writes or model calls',
    async (mode) => {
      const runtime = await loadRuntime(true);
      await expect(
        collect(
          runtime.streamMessage('owner', '91', 'Question', undefined, mode),
        ),
      ).rejects.toMatchObject({ status: 422, code: 'INVALID_ARGUMENT' });
      expect(
        queryMock.mock.calls.some(([sql]) => sql.startsWith('insert')),
      ).toBe(false);
      expect(piMock).not.toHaveBeenCalled();
      expect(streamMock).not.toHaveBeenCalled();
      assertNoPackageSelection();
    },
  );

  it('rejects legacy sendMessage in its default mode before generation or persistence', async () => {
    const runtime = await loadRuntime(false);
    await expect(
      runtime.sendMessage('owner', '91', 'Question'),
    ).rejects.toMatchObject({ status: 422, code: 'INVALID_ARGUMENT' });
    expect(generateTextMock).not.toHaveBeenCalled();
    expect(streamMock).not.toHaveBeenCalled();
    expect(queryMock.mock.calls.some(([sql]) => sql.startsWith('insert'))).toBe(
      false,
    );
  });

  it('does not reveal or execute another owner’s conversation snapshot', async () => {
    const runtime = await loadRuntime(true);
    await expect(
      collect(
        runtime.streamMessage('other', '91', 'Question', undefined, 'agent'),
      ),
    ).rejects.toMatchObject({ status: 404, code: 'THREAD_NOT_FOUND' });
    expect(piMock).not.toHaveBeenCalled();
    expect(streamMock).not.toHaveBeenCalled();
    expect(queryMock.mock.calls.some(([sql]) => sql.startsWith('insert'))).toBe(
      false,
    );
  });
});
