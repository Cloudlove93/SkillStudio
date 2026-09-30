import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  generateJson: vi.fn(),
  buildGeneratedPackageSnapshot: vi.fn(),
  createPackageWithSnapshotTx: vi.fn(),
}));

vi.mock('./db.js', () => ({
  query: mocks.query,
  withTransaction: async (run: (client: { query: typeof mocks.query }) => unknown) =>
    run({ query: mocks.query }),
}));

vi.mock('./llm-service.js', () => ({ generateJson: mocks.generateJson }));
vi.mock('./package-service.js', () => ({
  buildGeneratedPackageSnapshot: mocks.buildGeneratedPackageSnapshot,
  createPackageWithSnapshotTx: mocks.createPackageWithSnapshotTx,
}));

import {
  confirmGuidedCreation,
  deleteGuidedCreation,
  getGuidedCreationDetail,
  listGuidedCreations,
  processGuidedCreationMessage,
  renameGuidedCreation,
  startGuidedCreation,
} from './guided-creation-service.js';

type Row = Record<string, unknown>;

function createMemoryDb() {
  let nextSessionId = 1;
  let nextMessageId = 1;
  const sessions: Row[] = [];
  const messages: Row[] = [];
  const now = () => new Date().toISOString();

  const result = (rows: Row[] = [], rowCount = rows.length) => ({ rows, rowCount });
  mocks.query.mockImplementation(async (sqlValue: string, params: unknown[] = []) => {
    const sql = sqlValue.replace(/\s+/g, ' ').trim().toLowerCase();

    if (sql.startsWith('insert into skill_guided_creation_sessions')) {
      const existing = sessions.find(
        (row) => row.user_id === params[0] && row.start_client_message_id === params[3],
      );
      if (existing) return result([], 0);
      const timestamp = now();
      const row: Row = {
        id: String(nextSessionId++),
        user_id: params[0],
        status: 'collecting',
        model: params[1],
        start_client_message_id: params[3],
        documents_json: JSON.parse(String(params[2])),
        draft_json: {},
        field_states_json: {},
        flow_version: sql.includes('$4, 3')
          ? 3
          : sql.includes('flow_version')
            ? 2
            : 1,
        confirmed_stages_json: [],
        display_name: null,
        deleted_at: null,
        confirmation_json: null,
        generated_snapshot_json: null,
        validation_result_json: null,
        package_id: null,
        skill_id: null,
        skill_version_id: null,
        error_json: null,
        revision_no: 0,
        finalize_request_id: null,
        created_at: timestamp,
        updated_at: timestamp,
        completed_at: null,
      };
      sessions.push(row);
      return result([row]);
    }
    if (sql.includes('where user_id = $1 and start_client_message_id = $2')) {
      const row = sessions.find(
        (item) => item.user_id === params[0] && item.start_client_message_id === params[1],
      );
      return result(row ? [{ id: row.id }] : []);
    }
    if (
      sql.startsWith('select * from skill_guided_creation_sessions') &&
      sql.includes('order by updated_at desc')
    ) {
      return result(
        sessions
          .filter(
            (item) => item.user_id === params[0] && item.deleted_at == null,
          )
          .sort((a, b) =>
            String(b.updated_at).localeCompare(String(a.updated_at)),
          ),
      );
    }
    if (sql.startsWith('select * from skill_guided_creation_sessions')) {
      const row = sessions.find(
        (item) =>
          String(item.id) === String(params[0]) &&
          item.user_id === params[1] &&
          (!sql.includes('deleted_at is null') || item.deleted_at == null),
      );
      return result(row ? [row] : []);
    }
    if (sql.startsWith('select m.* from skill_guided_creation_messages')) {
      return result(
        messages
          .filter((message) => String(message.session_id) === String(params[0]))
          .sort((a, b) => Number(a.message_no) - Number(b.message_no)),
      );
    }
    if (sql.startsWith('select revision_no, status from skill_guided_creation_sessions')) {
      const row = sessions.find(
        (item) => String(item.id) === String(params[0]) && item.user_id === params[1],
      );
      return result(row ? [{ revision_no: row.revision_no, status: row.status }] : []);
    }
    if (sql.startsWith('select id from skill_guided_creation_sessions') && sql.includes("status = 'finalizing'")) {
      const row = sessions.find(
        (item) =>
          String(item.id) === String(params[0]) &&
          item.user_id === params[1] &&
          item.status === 'finalizing' &&
          item.finalize_request_id === params[2] &&
          Number(item.revision_no) === Number(params[3]),
      );
      return result(row ? [{ id: row.id }] : []);
    }
    if (sql.startsWith('select message_no from skill_guided_creation_messages')) {
      const row = messages.find(
        (item) => String(item.session_id) === String(params[0]) && item.client_message_id === params[1],
      );
      return result(row ? [{ message_no: row.message_no }] : []);
    }
    if (sql.startsWith('select coalesce(max(message_no), 0)')) {
      const last = messages
        .filter((item) => String(item.session_id) === String(params[0]))
        .reduce((maximum, item) => Math.max(maximum, Number(item.message_no)), 0);
      return result([{ last_message_no: last }]);
    }
    if (sql.startsWith('insert into skill_guided_creation_messages')) {
      const isUser = sql.includes("'user'");
      messages.push({
        id: String(nextMessageId++),
        session_id: String(params[0]),
        message_no: Number(params[1]),
        client_message_id: isUser ? params[2] : null,
        role: isUser ? 'user' : 'assistant',
        content: isUser ? params[3] : params[2],
        metadata_json: isUser ? {} : JSON.parse(String(params[3])),
        created_at: now(),
      });
      return result([], 1);
    }
    if (
      sql.startsWith('update skill_guided_creation_sessions') &&
      sql.includes('set display_name = $4')
    ) {
      const row = sessions.find(
        (item) =>
          String(item.id) === String(params[0]) &&
          item.user_id === params[1] &&
          Number(item.revision_no) === Number(params[2]) &&
          item.deleted_at == null &&
          item.status !== 'finalizing',
      );
      if (!row) return result([], 0);
      row.display_name = params[3];
      row.revision_no = Number(row.revision_no) + 1;
      row.updated_at = now();
      return result([], 1);
    }
    if (
      sql.startsWith('update skill_guided_creation_sessions') &&
      sql.includes('set deleted_at = now()')
    ) {
      const row = sessions.find(
        (item) =>
          String(item.id) === String(params[0]) &&
          item.user_id === params[1] &&
          Number(item.revision_no) === Number(params[2]) &&
          item.deleted_at == null &&
          item.status !== 'finalizing',
      );
      if (!row) return result([], 0);
      row.deleted_at = now();
      row.revision_no = Number(row.revision_no) + 1;
      row.updated_at = now();
      return result([{ id: row.id, deleted_at: row.deleted_at }], 1);
    }
    if (sql.includes("set status = 'collecting'") && sql.includes('revision_no = revision_no + 1')) {
      const row = sessions.find(
        (item) =>
          String(item.id) === String(params[0]) &&
          item.user_id === params[1] &&
          Number(item.revision_no) === Number(params[2]),
      );
      if (!row) return result([], 0);
      row.status = 'collecting';
      row.confirmation_json = null;
      row.error_json = null;
      row.revision_no = Number(row.revision_no) + 1;
      row.updated_at = now();
      return result([], 1);
    }
    if (sql.includes("set status = 'collecting'") && sql.includes("status = 'failed'")) {
      const row = sessions.find(
        (item) =>
          String(item.id) === String(params[0]) &&
          item.user_id === params[1] &&
          Number(item.revision_no) === Number(params[2]) &&
          item.status === 'failed',
      );
      if (!row) return result([], 0);
      row.status = 'collecting';
      row.error_json = null;
      row.updated_at = now();
      return result([], 1);
    }
    if (sql.includes("set status = 'collecting'") && sql.includes("interval '2 minutes'")) {
      const row = sessions.find(
        (item) =>
          String(item.id) === String(params[0]) &&
          item.user_id === params[1] &&
          Number(item.revision_no) === Number(params[2]) &&
          item.status === 'collecting' &&
          Date.now() - new Date(String(item.updated_at)).getTime() >= 2 * 60 * 1_000,
      );
      if (!row) return result([], 0);
      row.error_json = null;
      row.updated_at = now();
      return result([], 1);
    }
    if (sql.includes("set status = 'failed'") && sql.includes("status = 'collecting'")) {
      const row = sessions.find(
        (item) =>
          String(item.id) === String(params[0]) &&
          item.user_id === params[1] &&
          Number(item.revision_no) === Number(params[2]) &&
          item.status === 'collecting',
      );
      if (!row) return result([], 0);
      row.status = 'failed';
      row.error_json = JSON.parse(String(params[3]));
      row.updated_at = now();
      return result([], 1);
    }
    if (sql.includes("set status = 'finalizing'") && sql.includes('finalize_request_id = $4')) {
      const row = sessions.find(
        (item) =>
          String(item.id) === String(params[0]) &&
          item.user_id === params[1] &&
          Number(item.revision_no) === Number(params[2]) &&
          (item.status === 'ready_for_confirmation' || item.status === 'failed'),
      );
      if (!row) return result([], 0);
      row.status = 'finalizing';
      row.finalize_request_id = params[3];
      row.error_json = null;
      row.updated_at = now();
      return result([], 1);
    }
    if (sql.includes("set status = 'failed'") && sql.includes('finalize_request_id = $3')) {
      const row = sessions.find(
        (item) =>
          String(item.id) === String(params[0]) &&
          item.user_id === params[1] &&
          item.status === 'finalizing' &&
          item.finalize_request_id === params[2],
      );
      if (!row) return result([], 0);
      row.status = 'failed';
      row.generated_snapshot_json = params[3] ? JSON.parse(String(params[3])) : null;
      row.validation_result_json = JSON.parse(String(params[4]));
      row.error_json = JSON.parse(String(params[5]));
      row.updated_at = now();
      return result([], 1);
    }
    if (sql.startsWith('update skill_guided_creation_sessions') && sql.includes('draft_json = $4::jsonb')) {
      const row = sessions.find(
        (item) =>
          String(item.id) === String(params[0]) &&
          item.user_id === params[1] &&
          Number(item.revision_no) === Number(params[7]),
      );
      if (!row) return result([], 0);
      row.status = params[2];
      row.draft_json = JSON.parse(String(params[3]));
      row.field_states_json = JSON.parse(String(params[4]));
      row.confirmed_stages_json = JSON.parse(String(params[5]));
      row.confirmation_json = params[6] ? JSON.parse(String(params[6])) : null;
      row.error_json = null;
      row.updated_at = now();
      return result([], 1);
    }
    throw new Error(`Unhandled SQL in memory test: ${sql}`);
  });

  return { sessions, messages };
}

const extraction = {
  operations: [{
    dimension: 'educational_goal',
    content: '帮助教师设计课堂活动',
    source: 'user_explicit',
    quote: '设计课堂活动',
  }],
  step_complete: false,
  acknowledgement: '明白了。',
  question: '你希望学生通过这些课堂活动获得什么具体变化？',
  suggested_options: ['备课', '课堂活动'],
};

describe('guided creation persistence and retry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reuses the same session and completed turn when Start is replayed', async () => {
    const db = createMemoryDb();
    mocks.generateJson.mockResolvedValueOnce(extraction);
    const request = {
      auth_user_id: 'user-1',
      content: '帮教师设计课堂活动',
      client_message_id: 'message-0001',
    };

    const first = await startGuidedCreation(request);
    const replay = await startGuidedCreation(request);

    expect(replay.id).toBe(first.id);
    expect(db.sessions).toHaveLength(1);
    expect(db.messages).toHaveLength(2);
    expect(mocks.generateJson).toHaveBeenCalledTimes(1);
    expect(mocks.generateJson.mock.calls[0]?.[0]).toMatchObject({ maxTokens: 4096 });
  });

  it('keeps the conversation moving with a local question when the model fails', async () => {
    const db = createMemoryDb();
    mocks.generateJson.mockRejectedValueOnce(new Error('model offline'));
    const request = {
      auth_user_id: 'user-1',
      content: '帮教师设计课堂活动',
      client_message_id: 'message-0002',
    };

    const created = await startGuidedCreation(request);

    expect(created.status).toBe('collecting');
    expect(db.sessions).toHaveLength(1);
    expect(db.sessions[0].status).toBe('collecting');
    expect(db.sessions[0].error_json).toBeNull();
    expect(db.messages).toHaveLength(2);
    expect(db.messages[0].content).toBe(request.content);
    expect(db.messages[1].content).toContain('这个方向准确吗');
    expect(mocks.generateJson).toHaveBeenCalledOnce();
  });

  it('requires user participation in each co-creation step before advancing', async () => {
    createMemoryDb();
    mocks.generateJson
      .mockResolvedValueOnce({
        operations: [
          {
            dimension: 'educational_goal',
            content: '指导学生完成物理浮力实验',
            source: 'user_explicit',
            quote: '物理浮力实验指导',
          },
        ],
        stage_complete: true,
        acknowledgement: '我先了解一下你的教学想法。',
      })
      .mockResolvedValueOnce({
        question: '你希望哪些学生在什么课堂情境中使用它？',
        suggested_options: ['教师指导学生', '学生自主探究'],
      });

    const created = await startGuidedCreation({
      auth_user_id: 'teacher-1',
      content: '我想做一个初中物理浮力实验指导的 Skill',
      client_message_id: 'buoyancy-start-0001',
    });

    expect(created.flow_version).toBe(3);
    expect(created.confirmed_stages).toEqual([]);
    expect(created.completed_steps).toEqual([]);
    expect(created.current_step).toBe('intent_context');
    expect(created.education_draft?.audience_context?.content).toContain('初中');
    expect(created.messages.at(-1)?.content).toContain('这个方向准确吗');
    expect(created.status).toBe('collecting');

    mocks.generateJson.mockResolvedValueOnce({
        operations: [
          {
            dimension: 'audience_context',
            content: '初中教师在分组实验课中指导学生',
            source: 'user_explicit',
            quote: '帮助初中教师设计实验的助手',
          },
        ],
        stage_complete: true,
        acknowledgement: '明白了，会把教师的实验设计经验融入进去。',
        question: '你实际带这个实验时，学生最容易卡在哪里？',
        suggested_options: ['概念理解', '实验操作'],
      });

    const continued = await processGuidedCreationMessage({
      auth_user_id: 'teacher-1',
      session_id: created.id,
      content: '我希望它是帮助初中教师设计实验的助手',
      client_message_id: 'buoyancy-role-0002',
      revision_no: created.revision_no,
    });

    expect(continued.status).toBe('collecting');
    expect(continued.completed_steps).toEqual(['intent_context']);
    expect(continued.current_step).toBe('teacher_experience');
    expect(continued.confirmation).toBeNull();
    expect(continued.messages.at(-1)?.metadata.focus_step).toBe(
      'teacher_experience',
    );
  });

  it('renames only an owned visible session', async () => {
    createMemoryDb();
    mocks.generateJson.mockResolvedValueOnce(extraction);
    const created = await startGuidedCreation({
      auth_user_id: 'owner-rename',
      content: '创建一个课堂实验 Skill',
      client_message_id: 'rename-session-0001',
    });

    const renamed = await renameGuidedCreation({
      auth_user_id: 'owner-rename',
      session_id: created.id,
      revision_no: created.revision_no,
      display_name: '浮力实验指导',
    });

    expect(renamed.display_name).toBe('浮力实验指导');
    await expect(
      renameGuidedCreation({
        auth_user_id: 'other-user',
        session_id: created.id,
        revision_no: renamed.revision_no,
        display_name: '不应成功',
      }),
    ).rejects.toMatchObject({ code: 'SESSION_REVISION_CONFLICT' });
  });

  it('soft deletes a completed session without deleting its generated Skill', async () => {
    const db = createMemoryDb();
    mocks.generateJson.mockResolvedValueOnce(extraction);
    const created = await startGuidedCreation({
      auth_user_id: 'owner-delete',
      content: '创建一个浮力实验 Skill',
      client_message_id: 'delete-session-0001',
    });
    Object.assign(db.sessions[0], {
      status: 'completed',
      package_id: '41',
      skill_id: '42',
      skill_version_id: '43',
    });

    const deleted = await deleteGuidedCreation({
      auth_user_id: 'owner-delete',
      session_id: created.id,
      revision_no: created.revision_no,
    });

    expect(deleted.deleted_at).toBeTruthy();
    expect(db.sessions[0]).toMatchObject({
      package_id: '41',
      skill_id: '42',
      skill_version_id: '43',
    });
    await expect(
      getGuidedCreationDetail({
        auth_user_id: 'owner-delete',
        session_id: created.id,
      }),
    ).rejects.toMatchObject({ code: 'GUIDED_SESSION_NOT_FOUND' });
    const listed = await listGuidedCreations({ auth_user_id: 'owner-delete' });
    expect(listed.items).toEqual([]);
  });

  it('reclaims a stale message after a process interruption', async () => {
    const db = createMemoryDb();
    mocks.generateJson.mockResolvedValueOnce(extraction);
    const request = {
      auth_user_id: 'user-1',
      content: 'Create a lesson activity Skill',
      client_message_id: 'message-stale-0001',
    };
    const created = await startGuidedCreation(request);
    db.messages.splice(1, 1);
    db.sessions[0].updated_at = new Date(Date.now() - 3 * 60 * 1_000).toISOString();
    mocks.generateJson.mockResolvedValueOnce(extraction);

    const recovered = await processGuidedCreationMessage({
      auth_user_id: request.auth_user_id,
      session_id: created.id,
      client_message_id: request.client_message_id,
      revision_no: created.revision_no,
      content: request.content,
    });

    expect(recovered.messages).toHaveLength(2);
    expect(recovered.messages[0].client_message_id).toBe(request.client_message_id);
  });

  it('does not expose a session to another authenticated user', async () => {
    createMemoryDb();
    mocks.generateJson.mockResolvedValueOnce(extraction);
    const created = await startGuidedCreation({
      auth_user_id: 'owner-1',
      content: '帮教师设计课堂活动',
      client_message_id: 'message-0003',
    });

    await expect(
      getGuidedCreationDetail({ auth_user_id: 'other-user', session_id: created.id }),
    ).rejects.toMatchObject({ code: 'GUIDED_SESSION_NOT_FOUND', statusCode: 404 });
  });

  it('returns the existing Skill when a completed confirmation is replayed', async () => {
    const db = createMemoryDb();
    mocks.generateJson.mockResolvedValueOnce(extraction);
    const created = await startGuidedCreation({
      auth_user_id: 'owner-1',
      content: '帮教师设计课堂活动',
      client_message_id: 'message-0004',
    });
    Object.assign(db.sessions[0], {
      status: 'completed',
      package_id: '41',
      skill_id: '42',
      skill_version_id: '43',
      completed_at: new Date().toISOString(),
    });

    const replay = await confirmGuidedCreation({
      auth_user_id: 'owner-1',
      session_id: created.id,
      revision_no: created.revision_no,
      request_id: 'finalize-0004',
    });

    expect(replay.skill_id).toBe('42');
    expect(replay.skill_version_id).toBe('43');
    expect(mocks.buildGeneratedPackageSnapshot).not.toHaveBeenCalled();
    expect(mocks.createPackageWithSnapshotTx).not.toHaveBeenCalled();
  });

  it('marks the session failed without result IDs when the save transaction rolls back', async () => {
    const db = createMemoryDb();
    mocks.generateJson.mockResolvedValueOnce(extraction);
    const created = await startGuidedCreation({
      auth_user_id: 'owner-1',
      content: '帮教师设计课堂活动',
      client_message_id: 'message-0005',
    });
    Object.assign(db.sessions[0], {
      status: 'ready_for_confirmation',
      draft_json: {
        roles: '教师助手', goal: '设计课堂活动', usage_scenario: '备课',
        input_contract: '教学目标', output_contract: '活动方案',
        core_capabilities: '分析并生成', workflow: '分析、生成、自检',
      },
      confirmation_json: { title: '课堂活动', sections: [] },
    });
    mocks.buildGeneratedPackageSnapshot.mockResolvedValueOnce({
      name: '课堂活动', description: '', versionLabel: 'v1',
      agentMd: '# Runtime', rubricMd: '',
      skills: [{ id: 'skill-1', dirName: 'classroom', name: '课堂活动', description: '', skillMd: '# Skill' }],
    });
    mocks.createPackageWithSnapshotTx.mockRejectedValueOnce(new Error('database write failed'));

    await expect(
      confirmGuidedCreation({
        auth_user_id: 'owner-1', session_id: created.id,
        revision_no: created.revision_no, request_id: 'finalize-0005',
      }),
    ).rejects.toMatchObject({ code: 'SKILL_GENERATION_FAILED', retryable: true });

    expect(db.sessions[0].status).toBe('failed');
    expect(db.sessions[0].package_id).toBeNull();
    expect(db.sessions[0].skill_id).toBeNull();
    expect(db.sessions[0].skill_version_id).toBeNull();
  });
});
