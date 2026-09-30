import { describe, expect, it } from 'vitest';
import {
  isGuidedCreationAction,
  isGuidedCreationStreamAction,
  parseGuidedCreationRequest,
} from './guided-creation-actions.js';

describe('guided creation POST /api actions', () => {
  it('recognizes the guided creation PascalCase actions', () => {
    expect(isGuidedCreationAction('SkillGuidedCreationStart')).toBe(true);
    expect(isGuidedCreationAction('SkillGuidedCreationConfirm')).toBe(true);
    expect(isGuidedCreationAction('SkillGuidedCreationRename')).toBe(true);
    expect(isGuidedCreationAction('SkillGuidedCreationDelete')).toBe(true);
    expect(isGuidedCreationAction('skill.media.session.create')).toBe(true);
    expect(isGuidedCreationAction('skill.media.session.list')).toBe(true);
    expect(isGuidedCreationAction('skill.media.session.detail')).toBe(true);
    expect(isGuidedCreationAction('skill.media.asset.preview')).toBe(true);
    expect(isGuidedCreationAction('skill.media.progress')).toBe(true);
    expect(isGuidedCreationAction('skill.media.progress.stream')).toBe(true);
    expect(isGuidedCreationAction('skill.media.upload.intent')).toBe(true);
    expect(isGuidedCreationAction('skill.media.transcript.update')).toBe(true);
    expect(isGuidedCreationAction('skill.media.evidence.update')).toBe(true);
    expect(isGuidedCreationAction('skill.media.candidate.update')).toBe(true);
    expect(isGuidedCreationAction('skill.media.overview.confirm')).toBe(true);
    expect(isGuidedCreationAction('skill.media.candidate.confirm')).toBe(true);
    expect(isGuidedCreationAction('skill.media.test.start')).toBe(true);
    expect(isGuidedCreationAction('skill.media.generate.confirm')).toBe(true);
    expect(isGuidedCreationAction('skill.media.publish')).toBe(true);
    expect(isGuidedCreationAction('skill.media.upload.confirm')).toBe(true);
    expect(isGuidedCreationAction('skill.media.url.import')).toBe(true);
    expect(isGuidedCreationAction('skill.media.process.start')).toBe(true);
    expect(isGuidedCreationAction('skill.media.retry')).toBe(true);
    expect(isGuidedCreationAction('skill.media.cancel')).toBe(true);
    expect(isGuidedCreationAction('skill.media.session.delete')).toBe(true);
    expect(isGuidedCreationAction('skill.guided.creation.start')).toBe(false);
    expect(isGuidedCreationAction('SkillGuidedCreationUnknown')).toBe(false);
  });

  it('parses strict Arena test and atomic publish requests', () => {
    expect(parseGuidedCreationRequest({
      action: 'skill.media.test.start',
      sessionId: '101',
      idempotencyKey: 'arena-test-001',
      payload: { expectedRevisionNo: 8 },
    })).toEqual({
      action: 'skill.media.test.start',
      sessionId: '101',
      idempotencyKey: 'arena-test-001',
      payload: { expectedRevisionNo: 8 },
    });
    expect(parseGuidedCreationRequest({
      action: 'skill.media.publish',
      sessionId: '101',
      idempotencyKey: 'media-publish-001',
      payload: {
        expectedRevisionNo: 9,
        targetPackageId: null,
        expectedPackageVersionId: null,
      },
    })).toEqual({
      action: 'skill.media.publish',
      sessionId: '101',
      idempotencyKey: 'media-publish-001',
      payload: {
        expectedRevisionNo: 9,
        targetPackageId: null,
        expectedPackageVersionId: null,
      },
    });
    expect(() => parseGuidedCreationRequest({
      action: 'skill.media.publish',
      sessionId: '101',
      idempotencyKey: 'media-publish-001',
      payload: { expectedRevisionNo: 9, targetPackageId: '55', expectedPackageVersionId: null },
    })).toThrowError();
  });

  it('parses direct multimodal generation confirmation', () => {
    expect(parseGuidedCreationRequest({
      action: 'skill.media.generate.confirm',
      sessionId: '101',
      idempotencyKey: 'generate-confirm-001',
      payload: {
        expectedRevisionNo: 10,
        targetPackageId: null,
        expectedPackageVersionId: null,
      },
    })).toEqual({
      action: 'skill.media.generate.confirm',
      sessionId: '101',
      idempotencyKey: 'generate-confirm-001',
      payload: {
        expectedRevisionNo: 10,
        targetPackageId: null,
        expectedPackageVersionId: null,
      },
    });
  });

  it('treats multimodal progress stream as stream-only while keeping progress JSON-only', () => {
    expect(isGuidedCreationStreamAction('skill.media.progress.stream')).toBe(true);
    expect(isGuidedCreationStreamAction('skill.media.progress')).toBe(false);
  });

  it('parses a session-scoped media asset preview request', () => {
    expect(
      parseGuidedCreationRequest({
        action: 'skill.media.asset.preview',
        payload: {
          sessionId: '101',
          objectKey: 'skill-sessions/101/source/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.mp4',
        },
      }),
    ).toEqual({
      action: 'skill.media.asset.preview',
      payload: {
        sessionId: '101',
        objectKey: 'skill-sessions/101/source/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.mp4',
      },
    });
    expect(() =>
      parseGuidedCreationRequest({
        action: 'skill.media.asset.preview',
        sessionId: '101',
        payload: { sessionId: '101', objectKey: 'arbitrary/object.mp4' },
      }),
    ).toThrowError();
  });

  it('parses multimodal media session requests with lowerCamelCase payloads', () => {
    expect(
      parseGuidedCreationRequest({
        action: 'skill.media.session.create',
        idempotencyKey: 'media-create-key-1',
        payload: {
          displayName: '多模态技能包',
        },
      }),
    ).toEqual({
      action: 'skill.media.session.create',
      idempotencyKey: 'media-create-key-1',
      payload: {
        displayName: '多模态技能包',
      },
    });

    expect(
      parseGuidedCreationRequest({
        action: 'skill.media.session.list',
        payload: {
          limit: 20,
          cursor: '2026-08-21T10:00:00.000Z',
        },
      }),
    ).toEqual({
      action: 'skill.media.session.list',
      payload: {
        limit: 20,
        cursor: '2026-08-21T10:00:00.000Z',
      },
    });

    expect(
      parseGuidedCreationRequest({
        action: 'skill.media.session.detail',
        payload: {
          sessionId: '101',
        },
      }),
    ).toEqual({
      action: 'skill.media.session.detail',
      payload: {
      sessionId: '101',
      },
    });

    expect(
      parseGuidedCreationRequest({
        action: 'skill.media.progress.stream',
        payload: {
          sessionId: '101',
        },
      }),
    ).toEqual({
      action: 'skill.media.progress.stream',
      payload: {
        sessionId: '101',
      },
    });

    expect(
      parseGuidedCreationRequest({
        action: 'skill.media.upload.intent',
        sessionId: '101',
        idempotencyKey: 'upload-intent-001',
        payload: {
          fileName: 'lesson.mp4',
          declaredMimeType: 'video/mp4',
          sizeBytes: 1024,
        },
      }),
    ).toEqual({
      action: 'skill.media.upload.intent',
      sessionId: '101',
      idempotencyKey: 'upload-intent-001',
      payload: {
        fileName: 'lesson.mp4',
        declaredMimeType: 'video/mp4',
        sizeBytes: 1024,
      },
    });

    expect(
      parseGuidedCreationRequest({
        action: 'skill.media.overview.confirm',
        sessionId: '101',
        idempotencyKey: 'overview-confirm-001',
        payload: {
          expectedRevisionNo: 2,
          overview: {
            title: '  Adler Overview  ',
            approved: true,
            userNotes: '',
          },
        },
      }),
    ).toEqual({
      action: 'skill.media.overview.confirm',
      sessionId: '101',
      idempotencyKey: 'overview-confirm-001',
      payload: {
        expectedRevisionNo: 2,
        overview: {
          title: 'Adler Overview',
          approved: true,
          userNotes: '',
        },
      },
    });

    expect(
      parseGuidedCreationRequest({
        action: 'skill.media.candidate.confirm',
        sessionId: '101',
        idempotencyKey: 'candidate-confirm-001',
        payload: {
          expectedRevisionNo: 3,
          selectedCandidateIds: ['candidate-a', 'candidate-b'],
        },
      }),
    ).toEqual({
      action: 'skill.media.candidate.confirm',
      sessionId: '101',
      idempotencyKey: 'candidate-confirm-001',
      payload: {
        expectedRevisionNo: 3,
        selectedCandidateIds: ['candidate-a', 'candidate-b'],
      },
    });

    expect(
      parseGuidedCreationRequest({
        action: 'skill.media.transcript.update',
        sessionId: '101',
        idempotencyKey: 'transcript-update-001',
        payload: {
          expectedRevisionNo: 4,
          segmentIndex: 0,
          expectedSegmentRevisionNo: 1,
          text: '  人工修订后的讲解  ',
          speaker: '  教师  ',
        },
      }),
    ).toEqual({
      action: 'skill.media.transcript.update',
      sessionId: '101',
      idempotencyKey: 'transcript-update-001',
      payload: {
        expectedRevisionNo: 4,
        segmentIndex: 0,
        expectedSegmentRevisionNo: 1,
        text: '人工修订后的讲解',
        speaker: '教师',
      },
    });

    const evidenceItems = [{ evidenceId: 'evidence-1' }];
    expect(
      parseGuidedCreationRequest({
        action: 'skill.media.evidence.update',
        sessionId: '101',
        idempotencyKey: 'evidence-update-001',
        payload: { expectedRevisionNo: 5, evidenceItems },
      }),
    ).toMatchObject({
      action: 'skill.media.evidence.update',
      sessionId: '101',
      payload: { expectedRevisionNo: 5, evidenceItems },
    });

    const candidatePasses = {
      frameworks: [],
      principles: [],
      cases: [],
      counterexamples: [],
      terms: [],
    };
    expect(
      parseGuidedCreationRequest({
        action: 'skill.media.candidate.update',
        sessionId: '101',
        idempotencyKey: 'candidate-update-001',
        payload: { expectedRevisionNo: 6, candidatePasses },
      }),
    ).toMatchObject({
      action: 'skill.media.candidate.update',
      sessionId: '101',
      payload: { expectedRevisionNo: 6, candidatePasses },
    });
  });

  it('parses upload confirm with uploadToken and expectedRevisionNo', () => {
    expect(
      parseGuidedCreationRequest({
        action: 'skill.media.upload.confirm',
        sessionId: '101',
        idempotencyKey: 'upload-confirm-001',
        payload: {
          uploadToken: 'a.b.c',
          expectedRevisionNo: 1,
        },
      }),
    ).toEqual({
      action: 'skill.media.upload.confirm',
      sessionId: '101',
      idempotencyKey: 'upload-confirm-001',
      payload: {
        uploadToken: 'a.b.c',
        expectedRevisionNo: 1,
        parts: undefined,
      },
    });
  });

  it('strictly parses direct media URL import with an explicit rights confirmation', () => {
    expect(
      parseGuidedCreationRequest({
        action: 'skill.media.url.import',
        sessionId: '101',
        idempotencyKey: 'url-import-001',
        payload: {
          url: 'https://media.example/lesson.mp4',
          rightsConfirmed: true,
        },
      }),
    ).toEqual({
      action: 'skill.media.url.import',
      sessionId: '101',
      idempotencyKey: 'url-import-001',
      payload: {
        url: 'https://media.example/lesson.mp4',
        rightsConfirmed: true,
      },
    });

    expect(() =>
      parseGuidedCreationRequest({
        action: 'skill.media.url.import',
        sessionId: '101',
        idempotencyKey: 'url-import-001',
        payload: {
          url: 'https://media.example/lesson.mp4',
          rightsConfirmed: false,
        },
      }),
    ).toThrow(/rightsConfirmed/);
  });

  it('strictly parses process start, retry, cancel, and logical delete requests', () => {
    expect(
      parseGuidedCreationRequest({
        action: 'skill.media.process.start',
        sessionId: '101',
        idempotencyKey: 'process-start-001',
        payload: {
          expectedRevisionNo: 3,
          understandingMode: 'auto',
          transcriptionMode: 'deploymentDefault',
        },
      }),
    ).toEqual({
      action: 'skill.media.process.start',
      sessionId: '101',
      idempotencyKey: 'process-start-001',
      payload: {
        expectedRevisionNo: 3,
        understandingMode: 'auto',
        transcriptionMode: 'deploymentDefault',
      },
    });

    expect(
      parseGuidedCreationRequest({
        action: 'skill.media.retry',
        sessionId: '101',
        idempotencyKey: 'process-retry-001',
        payload: { expectedRevisionNo: 4, failedJobId: '701' },
      }),
    ).toEqual({
      action: 'skill.media.retry',
      sessionId: '101',
      idempotencyKey: 'process-retry-001',
      payload: { expectedRevisionNo: 4, failedJobId: '701' },
    });

    expect(
      parseGuidedCreationRequest({
        action: 'skill.media.retry',
        sessionId: '101',
        idempotencyKey: 'pipeline-retry-001',
        payload: { expectedRevisionNo: 14 },
      }),
    ).toEqual({
      action: 'skill.media.retry',
      sessionId: '101',
      idempotencyKey: 'pipeline-retry-001',
      payload: { expectedRevisionNo: 14 },
    });

    for (const action of ['skill.media.cancel', 'skill.media.session.delete'] as const) {
      expect(
        parseGuidedCreationRequest({
          action,
          sessionId: '101',
          payload: { expectedRevisionNo: 5 },
        }),
      ).toEqual({
        action,
        sessionId: '101',
        payload: { expectedRevisionNo: 5 },
      });
    }
  });

  it('rejects unsupported processing modes and extra control fields', () => {
    expect(() =>
      parseGuidedCreationRequest({
        action: 'skill.media.process.start',
        sessionId: '101',
        idempotencyKey: 'process-start-001',
        payload: {
          expectedRevisionNo: 3,
          understandingMode: 'invented',
          transcriptionMode: 'deploymentDefault',
        },
      }),
    ).toThrow();
    expect(() =>
      parseGuidedCreationRequest({
        action: 'skill.media.cancel',
        sessionId: '101',
        payload: { expectedRevisionNo: 5, force: true },
      }),
    ).toThrow();
  });

  it('parses a snake_case message payload', () => {
    expect(
      parseGuidedCreationRequest({
        action: 'SkillGuidedCreationMessage',
        payload: {
          session_id: '12',
          client_message_id: 'message-123',
          revision_no: 2,
          content: '主要用于教师课后复盘',
        },
      }),
    ).toEqual({
      action: 'SkillGuidedCreationMessage',
      payload: {
        session_id: '12',
        client_message_id: 'message-123',
        revision_no: 2,
        content: '主要用于教师课后复盘',
      },
    });
  });

  it('rejects unknown fields, camelCase fields and body identity', () => {
    const parseForgedIdentity = () =>
      parseGuidedCreationRequest({
        action: 'SkillGuidedCreationDetail',
        user_id: 'forged-user',
        payload: { session_id: '12' },
      });
    const parseCamelCase = () =>
      parseGuidedCreationRequest({
        action: 'SkillGuidedCreationDetail',
        payload: { sessionId: '12' },
      });
    for (const parse of [parseForgedIdentity, parseCamelCase]) {
      try {
        parse();
        throw new Error('expected parser to reject the request');
      } catch (error) {
        expect(error).toMatchObject({ code: 'INVALID_GUIDED_REQUEST' });
      }
    }
  });

  it('rejects extra keys, forged identity and forged request hashes for media actions', () => {
    for (const request of [
      {
        action: 'skill.media.upload.intent',
        sessionId: '101',
        idempotencyKey: 'upload-intent-001',
        payload: {
          fileName: 'lesson.mp4',
          declaredMimeType: 'video/mp4',
          sizeBytes: 1024,
          requestHash: 'forged',
        },
      },
      {
        action: 'skill.media.upload.intent',
        userId: 'attacker',
        sessionId: '101',
        idempotencyKey: 'upload-intent-001',
        payload: {
          fileName: 'lesson.mp4',
          declaredMimeType: 'video/mp4',
          sizeBytes: 1024,
        },
      },
      {
        action: 'skill.media.upload.intent',
        sessionId: '101',
        idempotencyKey: 'upload-intent-001',
        payload: {
          fileName: 'lesson.mp4',
          declaredMimeType: 'video/mp4',
          sizeBytes: 1024,
        },
        extra: true,
      },
      {
        action: 'skill.media.session.create',
        idempotencyKey: 'media-create-key-1',
        payload: {
          displayName: '多模态技能包',
          requestHash: 'forged',
        },
      },
      {
        action: 'skill.media.progress',
        userId: 'attacker',
        payload: {
          sessionId: '101',
        },
      },
      {
        action: 'skill.media.session.detail',
        payload: {
          sessionId: '101',
          authUserId: 'attacker',
        },
      },
      {
        action: 'skill.media.overview.confirm',
        sessionId: '101',
        idempotencyKey: 'overview-confirm-001',
        payload: {
          expectedRevisionNo: 2,
          overview: {
            title: 'Adler Overview',
            approved: true,
            userNotes: '',
            extra: true,
          },
        },
      },
      {
        action: 'skill.media.candidate.confirm',
        sessionId: '101',
        idempotencyKey: 'candidate-confirm-001',
        payload: {
          expectedRevisionNo: 3,
          selectedCandidateIds: ['candidate-a'],
          requestHash: 'forged',
        },
      },
      {
        action: 'skill.media.overview.confirm',
        session_id: '101',
        idempotencyKey: 'overview-confirm-001',
        payload: {
          expectedRevisionNo: 2,
          overview: {
            title: 'Adler Overview',
            approved: true,
            userNotes: '',
          },
        },
      },
    ]) {
      expect(() => parseGuidedCreationRequest(request)).toThrowError();
    }
  });

  it('rejects malformed overview and candidate confirmation payloads', () => {
    for (const request of [
      {
        action: 'skill.media.upload.intent',
        sessionId: '101',
        idempotencyKey: 'upload-intent-001',
        payload: {
          fileName: '  ',
          declaredMimeType: 'video/mp4',
          sizeBytes: 1024,
        },
      },
      {
        action: 'skill.media.upload.intent',
        sessionId: '101',
        idempotencyKey: 'upload-intent-001',
        payload: {
          fileName: 'lesson.mp4',
          declaredMimeType: 'video/mp4',
          sizeBytes: 1.5,
        },
      },
      {
        action: 'skill.media.upload.intent',
        sessionId: '101',
        idempotencyKey: 'upload-intent-001',
        payload: {
          fileName: 'lesson.mp4',
          declaredMimeType: '',
          sizeBytes: 1024,
        },
      },
      {
        action: 'skill.media.overview.confirm',
        sessionId: '101',
        idempotencyKey: 'overview-confirm-001',
        payload: {
          expectedRevisionNo: 2,
          overview: {
            title: 'Adler Overview',
            approved: false,
            userNotes: '',
          },
        },
      },
      {
        action: 'skill.media.overview.confirm',
        sessionId: '101',
        idempotencyKey: 'overview-confirm-001',
        payload: {
          expectedRevisionNo: 2,
          overview: {
            title: '  ',
            approved: true,
            userNotes: '',
          },
        },
      },
      {
        action: 'skill.media.overview.confirm',
        sessionId: '101',
        idempotencyKey: 'overview-confirm-001',
        payload: {
          expectedRevisionNo: 2,
          overview: {
            title: 'Adler Overview',
            approved: true,
            userNotes: 1,
          },
        },
      },
      {
        action: 'skill.media.candidate.confirm',
        sessionId: '101',
        idempotencyKey: 'candidate-confirm-001',
        payload: {
          expectedRevisionNo: 3,
          selectedCandidateIds: ['candidate-a', 'candidate-a'],
        },
      },
      (() => {
        const sparse = new Array(2);
        sparse[0] = 'candidate-a';
        return {
          action: 'skill.media.candidate.confirm',
          sessionId: '101',
          idempotencyKey: 'candidate-confirm-001',
          payload: {
            expectedRevisionNo: 3,
            selectedCandidateIds: sparse,
          },
        };
      })(),
      {
        action: 'skill.media.candidate.confirm',
        sessionId: '101',
        idempotencyKey: 'candidate-confirm-001',
        payload: {
          expectedRevisionNo: 3,
          selectedCandidateIds: new Array(17)
            .fill(null)
            .map((_, index) => `candidate-${index}`),
        },
      },
    ]) {
      expect(() => parseGuidedCreationRequest(request)).toThrowError();
    }
  });

  it('accepts short SAFE_ID candidate selections but still rejects invalid candidate IDs', () => {
    expect(
      parseGuidedCreationRequest({
        action: 'skill.media.candidate.confirm',
        sessionId: '101',
        idempotencyKey: 'candidate-confirm-001',
        payload: {
          expectedRevisionNo: 3,
          selectedCandidateIds: ['c1'],
        },
      }),
    ).toMatchObject({
      action: 'skill.media.candidate.confirm',
      sessionId: '101',
      idempotencyKey: 'candidate-confirm-001',
      payload: {
        expectedRevisionNo: 3,
        selectedCandidateIds: ['c1'],
      },
    });

    for (const selectedCandidateIds of [[''], ['bad/id'], ['a'.repeat(129)]]) {
      expect(() =>
        parseGuidedCreationRequest({
          action: 'skill.media.candidate.confirm',
          sessionId: '101',
          idempotencyKey: 'candidate-confirm-001',
          payload: {
            expectedRevisionNo: 3,
            selectedCandidateIds,
          },
        }),
      ).toThrowError();
    }
  });

  it('requires positive string IDs and non-negative revision numbers', () => {
    try {
      parseGuidedCreationRequest({
        action: 'SkillGuidedCreationCancel',
        payload: { session_id: 12, revision_no: -1 },
      });
      throw new Error('expected parser to reject the request');
    } catch (error) {
      expect(error).toMatchObject({ code: 'INVALID_GUIDED_REQUEST' });
    }
  });

  it('parses rename and delete payloads with snake_case fields', () => {
    expect(
      parseGuidedCreationRequest({
        action: 'SkillGuidedCreationRename',
        payload: {
          session_id: '12',
          revision_no: 2,
          display_name: '浮力实验指导',
        },
      }),
    ).toEqual({
      action: 'SkillGuidedCreationRename',
      payload: {
        session_id: '12',
        revision_no: 2,
        display_name: '浮力实验指导',
      },
    });
    expect(
      parseGuidedCreationRequest({
        action: 'SkillGuidedCreationDelete',
        payload: { session_id: '12', revision_no: 2 },
      }),
    ).toEqual({
      action: 'SkillGuidedCreationDelete',
      payload: { session_id: '12', revision_no: 2 },
    });
  });

  it('rejects an empty rename and unknown delete fields', () => {
    for (const request of [
      {
        action: 'SkillGuidedCreationRename',
        payload: { session_id: '12', revision_no: 2, display_name: '  ' },
      },
      {
        action: 'SkillGuidedCreationDelete',
        payload: { session_id: '12', revision_no: 2, delete_skill: true },
      },
    ]) {
      expect(() => parseGuidedCreationRequest(request)).toThrowError();
    }
  });

  it('rejects upload confirm with invalid expectedRevisionNo, parts, or extra keys', () => {
    const baseRequest = {
      action: 'skill.media.upload.confirm',
      sessionId: '101',
      idempotencyKey: 'upload-confirm-001',
    };

    const invalidRequests = [
      { payload: { uploadToken: 'a.b.c' } },
      { payload: { uploadToken: 'a.b.c', expectedRevisionNo: -1 } },
      { payload: { uploadToken: 'a.b.c', expectedRevisionNo: 1.5 } },
      { payload: { uploadToken: 'a.b.c', expectedRevisionNo: '1' } },
      { payload: { uploadToken: 'a.b.c', expectedRevisionNo: 1, parts: 'not-array' } },
      { payload: { uploadToken: 'a.b.c', expectedRevisionNo: 1, parts: [{ partNumber: 1, etag: '"etag"', extra: true }] } },
      { payload: { uploadToken: 'a.b.c', expectedRevisionNo: 1, parts: [{ partNumber: 0, etag: '"etag"' }] } },
      { payload: { uploadToken: 'a.b.c', expectedRevisionNo: 1, parts: [{ partNumber: -1, etag: '"etag"' }] } },
      { payload: { uploadToken: 'a.b.c', expectedRevisionNo: 1, parts: [{ partNumber: '1', etag: '"etag"' }] } },
      { payload: { uploadToken: 'a.b.c', expectedRevisionNo: 1, parts: [{ partNumber: 1, etag: '' }] } },
      { payload: { uploadToken: 'a.b.c', expectedRevisionNo: 1, parts: [{ partNumber: 1, etag: '   ' }] } },
      { payload: { uploadToken: 'a.b.c', expectedRevisionNo: 1, parts: [{ partNumber: 1, etag: 123 }] } },
      { payload: { uploadToken: 'a.b.c', expectedRevisionNo: 1, extra: true } },
    ];

    for (const overrides of invalidRequests) {
      expect(() =>
        parseGuidedCreationRequest({ ...baseRequest, ...overrides }),
      ).toThrowError();
    }
  });

  it('rejects upload confirm with forged requestHash or extra payload keys', () => {
    for (const request of [
      {
        action: 'skill.media.upload.confirm',
        sessionId: '101',
        idempotencyKey: 'upload-confirm-001',
        payload: {
          uploadToken: 'a.b.c',
          expectedRevisionNo: 1,
          requestHash: 'forged',
        },
      },
      {
        action: 'skill.media.upload.confirm',
        userId: 'attacker',
        sessionId: '101',
        idempotencyKey: 'upload-confirm-001',
        payload: {
          uploadToken: 'a.b.c',
          expectedRevisionNo: 1,
        },
      },
      {
        action: 'skill.media.upload.confirm',
        sessionId: '101',
        idempotencyKey: 'upload-confirm-001',
        payload: {
          uploadToken: 'a.b.c',
          expectedRevisionNo: 1,
        },
        extra: true,
      },
    ]) {
      expect(() => parseGuidedCreationRequest(request)).toThrowError();
    }
  });

  it('rejects upload confirm with empty upload token', () => {
    for (const request of [
      {
        action: 'skill.media.upload.confirm',
        sessionId: '101',
        idempotencyKey: 'upload-confirm-001',
        payload: {
          uploadToken: '',
          expectedRevisionNo: 1,
        },
      },
      {
        action: 'skill.media.upload.confirm',
        sessionId: '101',
        idempotencyKey: 'upload-confirm-001',
        payload: {
          uploadToken: '   ',
          expectedRevisionNo: 1,
        },
      },
    ]) {
      expect(() => parseGuidedCreationRequest(request)).toThrowError();
    }
  });
});
