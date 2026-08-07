import { describe, expect, it } from 'vitest';
import {
  isGuidedCreationAction,
  parseGuidedCreationRequest,
} from './guided-creation-actions.js';

describe('guided creation POST /api actions', () => {
  it('recognizes the guided creation PascalCase actions', () => {
    expect(isGuidedCreationAction('SkillGuidedCreationStart')).toBe(true);
    expect(isGuidedCreationAction('SkillGuidedCreationConfirm')).toBe(true);
    expect(isGuidedCreationAction('SkillGuidedCreationRename')).toBe(true);
    expect(isGuidedCreationAction('SkillGuidedCreationDelete')).toBe(true);
    expect(isGuidedCreationAction('skill.guided.creation.start')).toBe(false);
    expect(isGuidedCreationAction('SkillGuidedCreationUnknown')).toBe(false);
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
});
