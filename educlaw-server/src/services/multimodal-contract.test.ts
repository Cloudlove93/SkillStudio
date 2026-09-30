import { describe, expect, it } from 'vitest';
import {
  CANDIDATE_PASS_KEYS,
  MEDIA_CONFIRMATION_STAGES,
  MEDIA_STAGES,
  parseAdlerOverview,
  parseAdlerOverviewReview,
  parseAdlerOverviewResult,
  parseCandidatePassMeta,
  parseCandidatePasses,
  parseMediaOperationReceipts,
  MULTIMODAL_FRAME_SOURCE_SIGNALS,
  parseEvidenceCard,
  parseMultimodalSessionState,
  parseMultimodalPrimarySource,
  parseMultimodalTranscript,
  parseNormalizedSemanticMoments,
  parseMediaJobRecord,
  parseMediaEvidenceDegradations,
  parseRiaSkillDrafts,
  parseSemanticMomentDrafts,
  parseValidatedCandidateResults,
} from '@educlaw/shared';

describe('multimodal contract', () => {
  it('exports shared media stage contracts for both server and web consumers', () => {
    expect(MEDIA_STAGES).toContain('ready_to_publish');
    expect(MEDIA_STAGES).toContain('published');
    expect(MEDIA_CONFIRMATION_STAGES).toEqual([
      'adler_overview',
      'evidence_and_candidates',
      'publish',
    ]);
  });

  it('accepts overview review with empty user notes and rejects extra keys', () => {
    const parsed = parseAdlerOverviewReview(
      {
        title: '教师确认标题',
        approved: true,
        userNotes: '',
      },
      'review',
    );

    expect(parsed).toEqual({
      title: '教师确认标题',
      approved: true,
      userNotes: '',
    });

    expect(() =>
      parseAdlerOverviewReview(
        {
          title: '教师确认标题',
          approved: true,
          userNotes: '',
          extra: true,
        },
        'review',
      ),
    ).toThrowError('INVALID_MULTIMODAL_CONTRACT');
  });

  it('accepts a single video primary source using the V2 assetRef shape', () => {
    const parsed = parseMultimodalSessionState({
      schemaVersion: 1,
      primarySource: {
        sourceId: 'source-1',
        kind: 'video',
        assetRef: {
          objectKey: 'skill-sessions/123/source/video.mp4',
          mimeType: 'video/mp4',
          sizeBytes: 524288,
          sha256: 'a'.repeat(64),
        },
      },
      transcript: {
        status: 'not_applicable',
        editable: true,
        segments: [],
      },
      evidenceTimeline: {
        evidenceItems: [],
      },
      candidatePasses: {
        frameworks: [],
        principles: [],
        cases: [],
        counterexamples: [],
        terms: [],
      },
      candidatePassMeta: null,
    });

    expect(parsed.primarySource?.kind).toBe('video');
    expect(parsed.primarySource?.assetRef.sizeBytes).toBe(524288);
    expect(parsed.candidatePasses.frameworks).toEqual([]);
  });

  it('accepts a pure audio session with a ready transcript and no frame evidence', () => {
    const parsed = parseMultimodalSessionState({
      schemaVersion: 1,
      primarySource: {
        sourceId: 'source-2',
        kind: 'audio',
        assetRef: {
          objectKey: 'skill-sessions/124/source/audio.wav',
          mimeType: 'audio/wav',
          sizeBytes: 4096,
          sha256: 'b'.repeat(64),
        },
      },
      transcript: {
        status: 'ready',
        editable: true,
        segments: [
          {
            startMs: 0,
            endMs: 1200,
            text: '第一段转录',
            speaker: null,
            confidence: 0.8,
          },
        ],
      },
      evidenceTimeline: {
        evidenceItems: [
          {
            evidenceId: 'ev-1',
            kind: 'audio_segment',
            source: {
              primarySourceId: 'source-2',
            },
            timeRange: {
              startMs: 0,
              endMs: 1200,
            },
            text: '纯音频证据',
            assetRef: {
              objectKey: 'skill-sessions/124/audio/segment-01.wav',
              sha256: 'c'.repeat(64),
              mimeType: 'audio/wav',
              sizeBytes: 2048,
            },
            provenance: {
              method: 'manual',
              processorVersion: 'v1',
              model: 'human-review',
              confidence: 0.8,
              editedByUser: false,
            },
            claimType: 'sourceFact',
            selectionReason: '用于证明纯音频链路不需要 frame',
          },
        ],
      },
      candidatePasses: {
        frameworks: [],
        principles: [],
        cases: [],
        counterexamples: [],
        terms: [],
      },
      candidatePassMeta: null,
    });

    expect(parsed.transcript.status).toBe('ready');
    expect(parsed.transcript.editable).toBe(true);
    expect(parsed.evidenceTimeline.evidenceItems).toHaveLength(1);
    expect(parsed.evidenceTimeline.evidenceItems[0]?.kind).toBe(
      'audio_segment',
    );
  });

  it('rejects extra keys on multimodal session state root and evidenceTimeline objects', () => {
    expect(() =>
      parseMultimodalSessionState({
        schemaVersion: 1,
        primarySource: null,
        transcript: {
          status: 'pending',
          editable: true,
          segments: [],
        },
        evidenceTimeline: {
          evidenceItems: [],
        },
        candidatePasses: {
          frameworks: [],
          principles: [],
          cases: [],
          counterexamples: [],
          terms: [],
        },
        candidatePassMeta: null,
        extraField: true,
      }),
    ).toThrowError('INVALID_MULTIMODAL_CONTRACT');

    expect(() =>
      parseMultimodalSessionState({
        schemaVersion: 1,
        primarySource: null,
        transcript: {
          status: 'pending',
          editable: true,
          segments: [],
        },
        evidenceTimeline: {
          evidenceItems: [],
          unexpected: true,
        },
        candidatePasses: {
          frameworks: [],
          principles: [],
          cases: [],
          counterexamples: [],
          terms: [],
        },
        candidatePassMeta: null,
      }),
    ).toThrowError('INVALID_MULTIMODAL_CONTRACT');
  });

  it('normalizes missing candidatePassMeta to null only when all candidate passes are empty', () => {
    const parsed = parseMultimodalSessionState({
      schemaVersion: 1,
      primarySource: {
        sourceId: 'source-audio',
        kind: 'audio',
        assetRef: {
          objectKey: 'skill-sessions/201/source/audio.mp3',
          mimeType: 'audio/mpeg',
          sizeBytes: 2048,
          sha256: 'a'.repeat(64),
        },
      },
      transcript: {
        status: 'ready',
        editable: true,
        segments: [
          {
            startMs: 0,
            endMs: 1000,
            text: '纯音频证据',
            confidence: 0.95,
            editedByUser: false,
          },
        ],
      },
      evidenceTimeline: {
        evidenceItems: [
          {
            evidenceId: 'ev-transcript',
            kind: 'transcript',
            source: { primarySourceId: 'source-audio' },
            timeRange: { startMs: 0, endMs: 1000 },
            text: '纯音频证据',
            provenance: {
              method: 'asr',
              processorVersion: 'asr-v1',
              confidence: 0.95,
              editedByUser: false,
            },
            claimType: 'sourceFact',
            selectionReason: '音频证据',
          },
        ],
      },
      candidatePasses: {
        frameworks: [],
        principles: [],
        cases: [],
        counterexamples: [],
        terms: [],
      },
    });

    expect(parsed.candidatePassMeta).toBeNull();
  });

  it('rejects candidatePassMeta drift when candidates or validations exist', () => {
    expect(() =>
      parseMultimodalSessionState({
        schemaVersion: 1,
        primarySource: {
          sourceId: 'source-video',
          kind: 'video',
          assetRef: {
            objectKey: 'skill-sessions/202/source/video.mp4',
            mimeType: 'video/mp4',
            sizeBytes: 4096,
            sha256: 'a'.repeat(64),
          },
        },
        transcript: {
          status: 'ready',
          editable: true,
          segments: [
            {
              startMs: 0,
              endMs: 1000,
              text: '转录',
              confidence: 0.95,
              editedByUser: false,
            },
          ],
        },
        evidenceTimeline: {
          evidenceItems: [
            {
              evidenceId: 'ev-transcript',
              kind: 'transcript',
              source: { primarySourceId: 'source-video' },
              timeRange: { startMs: 0, endMs: 1000 },
              text: '转录',
              provenance: {
                method: 'asr',
                processorVersion: 'asr-v1',
                confidence: 0.95,
                editedByUser: false,
              },
              claimType: 'sourceFact',
              selectionReason: '转录证据',
            },
          ],
        },
        candidatePasses: {
          frameworks: [
            {
              candidateId: 'candidate-1',
              passKey: 'frameworks',
              title: '候选',
              summary: 'summary',
              reusableRule: 'rule',
              evidenceIds: ['ev-transcript'],
              claimType: 'sourceFact',
              visualAssertion: false,
            },
          ],
          principles: [],
          cases: [],
          counterexamples: [],
          terms: [],
        },
      }),
    ).toThrowError('INVALID_MULTIMODAL_CONTRACT');

    expect(() =>
      parseMultimodalSessionState({
        schemaVersion: 1,
        primarySource: {
          sourceId: 'source-video',
          kind: 'video',
          assetRef: {
            objectKey: 'skill-sessions/203/source/video.mp4',
            mimeType: 'video/mp4',
            sizeBytes: 4096,
            sha256: 'a'.repeat(64),
          },
        },
        transcript: {
          status: 'ready',
          editable: true,
          segments: [
            {
              startMs: 0,
              endMs: 1000,
              text: '转录',
              confidence: 0.95,
              editedByUser: false,
            },
          ],
        },
        evidenceTimeline: {
          evidenceItems: [
            {
              evidenceId: 'ev-transcript',
              kind: 'transcript',
              source: { primarySourceId: 'source-video' },
              timeRange: { startMs: 0, endMs: 1000 },
              text: '转录',
              provenance: {
                method: 'asr',
                processorVersion: 'asr-v1',
                confidence: 0.95,
                editedByUser: false,
              },
              claimType: 'sourceFact',
              selectionReason: '转录证据',
            },
          ],
        },
        candidatePasses: {
          frameworks: [],
          principles: [],
          cases: [],
          counterexamples: [],
          terms: [],
        },
        candidateValidations: [
          {
            candidate: {
              candidateId: 'candidate-1',
              passKey: 'frameworks',
              title: '候选',
              summary: 'summary',
              reusableRule: 'rule',
              evidenceIds: ['ev-transcript'],
              claimType: 'sourceFact',
              visualAssertion: false,
            },
            validation: {
              candidateId: 'candidate-1',
              v1: {
                passed: true,
                reason: 'ok',
                reusableContexts: ['场景一', '场景二'],
              },
              v2: {
                passed: true,
                reason: 'ok',
                novelScenario: '新场景',
                capability: 'guide',
              },
              v3: {
                passed: true,
                reason: 'ok',
                differentiators: ['区分点'],
              },
            },
            overallPassed: true,
            disposition: 'retain',
          },
        ],
      }),
    ).toThrowError('INVALID_MULTIMODAL_CONTRACT');
  });

  it('parses exact candidatePassMeta and rejects nested drift', () => {
    const parsed = parseCandidatePassMeta({
      frameworks: {
        model: 'framework-model',
        promptVersion: 'framework-prompt',
      },
      principles: {
        model: 'principle-model',
        promptVersion: 'principle-prompt',
      },
      cases: { model: 'case-model', promptVersion: 'case-prompt' },
      counterexamples: {
        model: 'counter-model',
        promptVersion: 'counter-prompt',
      },
      terms: { model: 'term-model', promptVersion: 'term-prompt' },
    });

    expect(parsed.frameworks.model).toBe('framework-model');

    expect(() =>
      parseCandidatePassMeta({
        frameworks: { model: '', promptVersion: 'framework-prompt' },
        principles: {
          model: 'principle-model',
          promptVersion: 'principle-prompt',
        },
        cases: { model: 'case-model', promptVersion: 'case-prompt' },
        counterexamples: {
          model: 'counter-model',
          promptVersion: 'counter-prompt',
        },
        terms: { model: 'term-model', promptVersion: 'term-prompt' },
      }),
    ).toThrowError('INVALID_MULTIMODAL_CONTRACT');

    expect(() =>
      parseCandidatePassMeta({
        frameworks: {
          model: 'framework-model',
          promptVersion: 'framework-prompt',
          extra: true,
        },
        principles: {
          model: 'principle-model',
          promptVersion: 'principle-prompt',
        },
        cases: { model: 'case-model', promptVersion: 'case-prompt' },
        counterexamples: {
          model: 'counter-model',
          promptVersion: 'counter-prompt',
        },
        terms: { model: 'term-model', promptVersion: 'term-prompt' },
      }),
    ).toThrowError('INVALID_MULTIMODAL_CONTRACT');

    expect(() =>
      parseCandidatePassMeta({
        frameworks: {
          model: 'framework-model',
          promptVersion: 'framework-prompt',
        },
        principles: {
          model: 'principle-model',
          promptVersion: 'principle-prompt',
        },
        cases: { model: 'case-model', promptVersion: 'case-prompt' },
        counterexamples: {
          model: 'counter-model',
          promptVersion: 'counter-prompt',
        },
      }),
    ).toThrowError('INVALID_MULTIMODAL_CONTRACT');
  });

  it('accepts exactly the V2 evidence kind enum and rejects removed values', () => {
    const acceptedKinds = ['transcript', 'audio_segment', 'frame'] as const;
    for (const kind of acceptedKinds) {
      const parsed = parseEvidenceCard({
        evidenceId: `ev-kind-${kind}`,
        kind,
        source: { primarySourceId: 'source-1' },
        timeRange: { startMs: 0, endMs: 100 },
        text: 'valid kind',
        assetRef:
          kind === 'transcript'
            ? undefined
            : {
                objectKey: 'skill-sessions/125/frame/001.png',
                mimeType: kind === 'frame' ? 'image/png' : 'audio/wav',
                sizeBytes: 1024,
                sha256: 'c'.repeat(64),
              },
        provenance: {
          method: 'vision',
          processorVersion: 'v1',
          editedByUser: false,
        },
        claimType: 'sourceFact',
        selectionReason: 'valid kind',
      });

      expect(parsed.kind).toBe(kind);
    }

    const removedKinds = [
      'quote',
      'transcript_segment',
      'video_segment',
      'semantic_moment',
      'image',
    ];
    for (const kind of removedKinds) {
      expect(() =>
        parseEvidenceCard({
          evidenceId: 'ev-kind-invalid',
          kind,
          source: { primarySourceId: 'source-1' },
          timeRange: { startMs: 0, endMs: 100 },
          text: 'bad kind',
          assetRef: {
            objectKey: 'skill-sessions/125/frame/001.png',
            mimeType: 'image/png',
            sizeBytes: 1024,
            sha256: 'c'.repeat(64),
          },
          provenance: {
            method: 'vision',
            processorVersion: 'v1',
            editedByUser: false,
          },
          claimType: 'sourceFact',
          selectionReason: 'bad kind',
        }),
      ).toThrowError('INVALID_MULTIMODAL_CONTRACT');
    }
  });

  it('rejects evidence sources that do not carry a primarySourceId', () => {
    expect(() =>
      parseEvidenceCard({
        evidenceId: 'ev-source',
        kind: 'frame',
        source: { artifactKey: 'skill-sessions/125/frame/001.png' },
        timeRange: { startMs: 0, endMs: 100 },
        text: 'bad source',
        assetRef: {
          objectKey: 'skill-sessions/125/frame/001.png',
          mimeType: 'image/png',
          sizeBytes: 1024,
          sha256: 'd'.repeat(64),
        },
        provenance: {
          method: 'vision',
          processorVersion: 'v1',
          editedByUser: false,
        },
        claimType: 'sourceFact',
        selectionReason: 'bad source',
      }),
    ).toThrowError('INVALID_MULTIMODAL_CONTRACT');
  });

  it('rejects invalid evidence time ranges', () => {
    expect(() =>
      parseEvidenceCard({
        evidenceId: 'ev-time',
        kind: 'frame',
        source: { primarySourceId: 'source-1' },
        timeRange: { startMs: 200, endMs: 100 },
        text: 'bad time',
        assetRef: {
          objectKey: 'skill-sessions/125/frame/001.png',
          mimeType: 'image/png',
          sizeBytes: 1024,
          sha256: 'e'.repeat(64),
        },
        provenance: {
          method: 'vision',
          processorVersion: 'v1',
          editedByUser: false,
        },
        claimType: 'sourceFact',
        selectionReason: 'bad time',
      }),
    ).toThrowError('INVALID_MULTIMODAL_CONTRACT');

    expect(() =>
      parseEvidenceCard({
        evidenceId: 'ev-time-equal',
        kind: 'frame',
        source: { primarySourceId: 'source-1' },
        timeRange: { startMs: 100, endMs: 100 },
        text: 'equal time',
        assetRef: {
          objectKey: 'skill-sessions/125/frame/001.png',
          mimeType: 'image/png',
          sizeBytes: 1024,
          sha256: 'e'.repeat(64),
        },
        provenance: {
          method: 'vision',
          processorVersion: 'v1',
          editedByUser: false,
        },
        claimType: 'sourceFact',
        selectionReason: 'bad time',
      }),
    ).toThrowError('INVALID_MULTIMODAL_CONTRACT');
  });

  it('rejects invalid evidence assetRef hashes', () => {
    expect(() =>
      parseEvidenceCard({
        evidenceId: 'ev-sha',
        kind: 'frame',
        source: { primarySourceId: 'source-1' },
        timeRange: { startMs: 0, endMs: 100 },
        text: 'bad sha',
        assetRef: {
          objectKey: 'skill-sessions/125/frame/001.png',
          mimeType: 'image/png',
          sizeBytes: 1024,
          sha256: 'not-hex',
        },
        provenance: {
          method: 'vision',
          processorVersion: 'v1',
          editedByUser: false,
        },
        claimType: 'sourceFact',
        selectionReason: 'bad sha',
      }),
    ).toThrowError('INVALID_MULTIMODAL_CONTRACT');
  });

  it('rejects invalid provenance confidence and editedByUser values', () => {
    expect(() =>
      parseEvidenceCard({
        evidenceId: 'ev-confidence',
        kind: 'frame',
        source: { primarySourceId: 'source-1' },
        timeRange: { startMs: 0, endMs: 100 },
        text: 'bad confidence',
        assetRef: {
          objectKey: 'skill-sessions/125/frame/001.png',
          mimeType: 'image/png',
          sizeBytes: 1024,
          sha256: 'f'.repeat(64),
        },
        provenance: {
          method: 'vision',
          processorVersion: 'v1',
          confidence: 2,
          editedByUser: false,
        },
        claimType: 'sourceFact',
        selectionReason: 'bad confidence',
      }),
    ).toThrowError('INVALID_MULTIMODAL_CONTRACT');

    expect(() =>
      parseEvidenceCard({
        evidenceId: 'ev-edited',
        kind: 'frame',
        source: { primarySourceId: 'source-1' },
        timeRange: { startMs: 0, endMs: 100 },
        text: 'bad edited flag',
        assetRef: {
          objectKey: 'skill-sessions/125/frame/001.png',
          mimeType: 'image/png',
          sizeBytes: 1024,
          sha256: '0'.repeat(64),
        },
        provenance: {
          method: 'vision',
          processorVersion: 'v1',
          editedByUser: 'yes',
        },
        claimType: 'sourceFact',
        selectionReason: 'bad edited flag',
      }),
    ).toThrowError('INVALID_MULTIMODAL_CONTRACT');
  });

  it('accepts exactly the V2 claimType enum and rejects candidate category values', () => {
    const acceptedClaimTypes = [
      'sourceFact',
      'modelInference',
      'userInput',
    ] as const;
    for (const claimType of acceptedClaimTypes) {
      const parsed = parseEvidenceCard({
        evidenceId: `ev-claim-${claimType}`,
        kind: 'frame',
        source: { primarySourceId: 'source-1' },
        timeRange: { startMs: 0, endMs: 100 },
        text: 'valid claim type',
        assetRef: {
          objectKey: 'skill-sessions/125/frame/001.png',
          mimeType: 'image/png',
          sizeBytes: 1024,
          sha256: '1'.repeat(64),
        },
        provenance: {
          method: 'vision',
          processorVersion: 'v1',
          editedByUser: false,
        },
        claimType,
        selectionReason: 'valid claim type',
      });

      expect(parsed.claimType).toBe(claimType);
    }

    const rejectedClaimTypes = [
      'framework',
      'principle',
      'case',
      'counterexample',
      'term',
      'guessed',
    ];
    for (const claimType of rejectedClaimTypes) {
      expect(() =>
        parseEvidenceCard({
          evidenceId: 'ev-claim-invalid',
          kind: 'frame',
          source: { primarySourceId: 'source-1' },
          timeRange: { startMs: 0, endMs: 100 },
          text: 'bad claim type',
          assetRef: {
            objectKey: 'skill-sessions/125/frame/001.png',
            mimeType: 'image/png',
            sizeBytes: 1024,
            sha256: '1'.repeat(64),
          },
          provenance: {
            method: 'vision',
            processorVersion: 'v1',
            editedByUser: false,
          },
          claimType,
          selectionReason: 'bad claim type',
        }),
      ).toThrowError('INVALID_MULTIMODAL_CONTRACT');
    }
  });

  it('requires assetRef for audio_segment and frame, but allows transcript without assetRef', () => {
    const transcriptEvidence = parseEvidenceCard({
      evidenceId: 'ev-transcript-no-asset',
      kind: 'transcript',
      source: { primarySourceId: 'source-1' },
      timeRange: { startMs: 0, endMs: 100 },
      text: 'transcript without asset ref',
      provenance: {
        method: 'asr',
        processorVersion: 'v1',
        editedByUser: false,
      },
      claimType: 'sourceFact',
      selectionReason: 'transcript can inline text',
    });

    expect(transcriptEvidence.assetRef).toBeUndefined();

    expect(() =>
      parseEvidenceCard({
        evidenceId: 'ev-audio-no-asset',
        kind: 'audio_segment',
        source: { primarySourceId: 'source-1' },
        timeRange: { startMs: 0, endMs: 100 },
        text: 'missing audio asset',
        provenance: {
          method: 'asr',
          processorVersion: 'v1',
          editedByUser: false,
        },
        claimType: 'sourceFact',
        selectionReason: 'invalid missing asset',
      }),
    ).toThrowError('INVALID_MULTIMODAL_CONTRACT');

    expect(() =>
      parseEvidenceCard({
        evidenceId: 'ev-frame-no-asset',
        kind: 'frame',
        source: { primarySourceId: 'source-1' },
        timeRange: { startMs: 0, endMs: 100 },
        text: 'missing frame asset',
        provenance: {
          method: 'vision',
          processorVersion: 'v1',
          editedByUser: false,
        },
        claimType: 'sourceFact',
        selectionReason: 'invalid missing asset',
      }),
    ).toThrowError('INVALID_MULTIMODAL_CONTRACT');
  });

  it('rejects primarySource arrays', () => {
    expect(() =>
      parseMultimodalSessionState({
        schemaVersion: 1,
        primarySource: [],
        transcript: {
          status: 'not_applicable',
          editable: true,
          segments: [],
        },
        evidenceTimeline: {
          evidenceItems: [],
        },
        candidatePasses: {
          frameworks: [],
          principles: [],
          cases: [],
          counterexamples: [],
          terms: [],
        },
      }),
    ).toThrowError('INVALID_MULTIMODAL_CONTRACT');
  });

  it('rejects candidate pass objects with wrong keys', () => {
    expect(() =>
      parseMultimodalSessionState({
        schemaVersion: 1,
        transcript: {
          status: 'not_applicable',
          editable: true,
          segments: [],
        },
        evidenceTimeline: {
          evidenceItems: [],
        },
        candidatePasses: {
          frameworks: [],
          principles: [],
          cases: [],
          counterexamples: [],
          wrongKey: [],
        },
      }),
    ).toThrowError('INVALID_MULTIMODAL_CONTRACT');
  });

  it('rejects transcript segments with invalid timing or confidence', () => {
    expect(() =>
      parseMultimodalSessionState({
        schemaVersion: 1,
        transcript: {
          status: 'ready',
          editable: true,
          segments: [
            {
              startMs: -1,
              endMs: 100,
              text: 'negative time',
            },
          ],
        },
        evidenceTimeline: { evidenceItems: [] },
        candidatePasses: {
          frameworks: [],
          principles: [],
          cases: [],
          counterexamples: [],
          terms: [],
        },
      }),
    ).toThrowError('INVALID_MULTIMODAL_CONTRACT');

    expect(() =>
      parseMultimodalSessionState({
        schemaVersion: 1,
        transcript: {
          status: 'ready',
          editable: true,
          segments: [
            {
              startMs: 100,
              endMs: 100,
              text: 'equal time',
            },
          ],
        },
        evidenceTimeline: { evidenceItems: [] },
        candidatePasses: {
          frameworks: [],
          principles: [],
          cases: [],
          counterexamples: [],
          terms: [],
        },
      }),
    ).toThrowError('INVALID_MULTIMODAL_CONTRACT');

    expect(() =>
      parseMultimodalSessionState({
        schemaVersion: 1,
        transcript: {
          status: 'ready',
          editable: true,
          segments: [
            {
              startMs: 100,
              endMs: 99,
              text: 'reversed time',
            },
          ],
        },
        evidenceTimeline: { evidenceItems: [] },
        candidatePasses: {
          frameworks: [],
          principles: [],
          cases: [],
          counterexamples: [],
          terms: [],
        },
      }),
    ).toThrowError('INVALID_MULTIMODAL_CONTRACT');

    expect(() =>
      parseMultimodalSessionState({
        schemaVersion: 1,
        transcript: {
          status: 'ready',
          editable: true,
          segments: [
            {
              startMs: 0,
              endMs: 100,
              text: 'bad confidence',
              confidence: 2,
            },
          ],
        },
        evidenceTimeline: { evidenceItems: [] },
        candidatePasses: {
          frameworks: [],
          principles: [],
          cases: [],
          counterexamples: [],
          terms: [],
        },
      }),
    ).toThrowError('INVALID_MULTIMODAL_CONTRACT');

    expect(() =>
      parseMultimodalSessionState({
        schemaVersion: 1,
        transcript: {
          status: 'ready',
          editable: true,
          segments: [
            {
              startMs: 0,
              endMs: 100,
              text: 'bad edited flag',
              editedByUser: 'yes',
            },
          ],
        },
        evidenceTimeline: { evidenceItems: [] },
        candidatePasses: {
          frameworks: [],
          principles: [],
          cases: [],
          counterexamples: [],
          terms: [],
        },
      }),
    ).toThrowError('INVALID_MULTIMODAL_CONTRACT');
  });

  it('accepts strict semantic moment drafts and server-normalized semantic moments', () => {
    const drafts = parseSemanticMomentDrafts(
      [
        {
          startMs: 1200,
          endMs: 2400,
          importance: 0.9,
          type: 'concept',
          summary: '讲解核心概念',
          visualTarget: 'whiteboard diagram',
          transcriptEvidence: {
            timeRange: { startMs: 1200, endMs: 1700 },
            text: '定义核心概念',
            confidence: 0.91,
          },
          audioEvidence: {
            timeRange: { startMs: 1700, endMs: 2200 },
            text: '口头强调关键词',
            confidence: 0.88,
          },
          selectionReason: '概念首次被完整定义',
        },
      ],
      { durationMs: 5000 },
    );

    const normalized = parseNormalizedSemanticMoments(
      [
        {
          semanticMomentId: 'moment-001',
          startMs: 1200,
          endMs: 2400,
          importance: 0.9,
          type: 'concept',
          summary: '讲解核心概念',
          visualTarget: 'whiteboard diagram',
          transcriptEvidence: {
            timeRange: { startMs: 1200, endMs: 1700 },
            text: '定义核心概念',
            confidence: 0.91,
          },
          audioEvidence: {
            timeRange: { startMs: 1700, endMs: 2200 },
            text: '口头强调关键词',
            confidence: 0.88,
          },
          selectionReason: '概念首次被完整定义',
        },
      ],
      { durationMs: 5000 },
    );

    expect(drafts).toHaveLength(1);
    expect(normalized[0]?.semanticMomentId).toBe('moment-001');
    expect(normalized[0]?.type).toBe('concept');
  });

  it('rejects duplicate semanticMomentId values in normalized moments', () => {
    expect(() =>
      parseNormalizedSemanticMoments(
        [
          {
            semanticMomentId: 'moment-duplicate',
            startMs: 1200,
            endMs: 2400,
            importance: 0.9,
            type: 'concept',
            summary: '讲解核心概念',
            visualTarget: 'whiteboard diagram',
            transcriptEvidence: {
              timeRange: { startMs: 1200, endMs: 1700 },
              text: '定义核心概念',
              confidence: 0.91,
            },
            audioEvidence: {
              timeRange: { startMs: 1700, endMs: 2200 },
              text: '口头强调关键词',
              confidence: 0.88,
            },
            selectionReason: '概念首次被完整定义',
          },
          {
            semanticMomentId: 'moment-duplicate',
            startMs: 2500,
            endMs: 3200,
            importance: 0.7,
            type: 'summary',
            summary: '课堂小结',
            visualTarget: null,
            transcriptEvidence: null,
            audioEvidence: null,
            selectionReason: '总结',
          },
        ],
        { durationMs: 5000 },
      ),
    ).toThrowError('INVALID_MULTIMODAL_CONTRACT');
  });

  it('exports strict primarySource and transcript parsers with duration bounds', () => {
    const source = parseMultimodalPrimarySource({
      sourceId: 'video-source-1',
      kind: 'video',
      assetRef: {
        objectKey: 'skill-sessions/123/source/video.mp4',
        mimeType: 'video/mp4',
        sizeBytes: 524288,
        sha256: 'a'.repeat(64),
      },
    });
    expect(source?.assetRef.mimeType).toBe('video/mp4');

    const transcript = parseMultimodalTranscript(
      {
        status: 'ready',
        editable: true,
        segments: [
          {
            startMs: 0,
            endMs: 100,
            text: '第一段',
            confidence: 0.8,
          },
        ],
      },
      'transcript',
      { durationMs: 100, maxSegments: 1 },
    );
    expect(transcript.segments).toHaveLength(1);

    expect(() =>
      parseMultimodalTranscript(
        {
          status: 'ready',
          editable: true,
          segments: [
            {
              startMs: 0,
              endMs: 101,
              text: '越界片段',
            },
          ],
        },
        'transcript',
        { durationMs: 100, maxSegments: 1 },
      ),
    ).toThrowError('INVALID_MULTIMODAL_CONTRACT');

    expect(() =>
      parseMultimodalPrimarySource({
        sourceId: 'video-source-1',
        kind: 'video',
        assetRef: {
          objectKey: 'x',
          mimeType: 'image/png',
          sizeBytes: 1,
          sha256: 'a'.repeat(64),
          localPath: 'C:/secret',
        },
      }),
    ).toThrowError('INVALID_MULTIMODAL_CONTRACT');

    expect(() =>
      parseMultimodalPrimarySource({
        sourceId: 'video-source-1',
        kind: 'video',
        assetRef: {
          objectKey: '../escape.png',
          mimeType: 'video/mp4',
          sizeBytes: 1,
          sha256: 'a'.repeat(64),
        },
      }),
    ).toThrowError('INVALID_MULTIMODAL_CONTRACT');

    expect(() =>
      parseMultimodalTranscript(
        {
          status: 'ready',
          editable: true,
          segments: [
            {
              startMs: 0,
              endMs: 100,
              text: '第一段',
              unexpected: true,
            },
          ],
        },
        'transcript',
        { durationMs: 100, maxSegments: 1 },
      ),
    ).toThrowError('INVALID_MULTIMODAL_CONTRACT');

    for (const objectKey of [
      'C:/secret',
      'C:\\secret',
      'http://example.com/a.png',
      ' skill-sessions/1/a.png',
      'skill-sessions/1/a.png ',
      '/skill-sessions/1/a.png',
      'skill-sessions/1/a.png/',
      '../escape.png',
    ]) {
      expect(() =>
        parseMultimodalPrimarySource({
          sourceId: 'video-source-1',
          kind: 'video',
          assetRef: {
            objectKey,
            mimeType: 'video/mp4',
            sizeBytes: 1,
            sha256: 'a'.repeat(64),
          },
        }),
      ).toThrowError('INVALID_MULTIMODAL_CONTRACT');
    }
  });

  it('rejects invalid semantic moment arrays, fields, and source signal drift', () => {
    expect(() =>
      parseSemanticMomentDrafts(
        [
          {
            startMs: 1200,
            endMs: 1200,
            importance: 0.9,
            type: 'concept',
            summary: 'bad equal range',
            selectionReason: 'bad',
          },
        ],
        { durationMs: 5000 },
      ),
    ).toThrowError('INVALID_MULTIMODAL_CONTRACT');

    expect(() =>
      parseSemanticMomentDrafts(
        [
          {
            startMs: 1200,
            endMs: 2400,
            importance: Number.NaN,
            type: 'concept',
            summary: 'bad importance',
            selectionReason: 'bad',
          },
        ],
        { durationMs: 5000 },
      ),
    ).toThrowError('INVALID_MULTIMODAL_CONTRACT');

    expect(() =>
      parseSemanticMomentDrafts(
        [
          {
            startMs: 1200,
            endMs: 2400,
            importance: 0.5,
            type: 'document',
            summary: 'bad type',
            selectionReason: 'bad',
          },
        ],
        { durationMs: 5000 },
      ),
    ).toThrowError('INVALID_MULTIMODAL_CONTRACT');

    expect(() =>
      parseSemanticMomentDrafts(
        [
          {
            startMs: 1200,
            endMs: 2400,
            importance: 0.5,
            type: 'concept',
            summary: 'has unknown field',
            selectionReason: 'bad',
            extraField: true,
          },
        ],
        { durationMs: 5000 },
      ),
    ).toThrowError('INVALID_MULTIMODAL_CONTRACT');

    expect(() =>
      parseSemanticMomentDrafts(
        new Array(1).fill(null).map((_, index) =>
          index === 0
            ? {
                startMs: 0,
                endMs: 100,
                importance: 0.5,
                type: 'concept',
                summary: 'ok',
                selectionReason: 'ok',
              }
            : null,
        ),
        { durationMs: 5000 },
      ),
    ).not.toThrow();

    const sparseMoments = new Array(2);
    sparseMoments[0] = {
      startMs: 0,
      endMs: 100,
      importance: 0.5,
      type: 'concept',
      summary: 'ok',
      selectionReason: 'ok',
    };
    expect(() =>
      parseSemanticMomentDrafts(sparseMoments, { durationMs: 5000 }),
    ).toThrowError('INVALID_MULTIMODAL_CONTRACT');

    expect(MULTIMODAL_FRAME_SOURCE_SIGNALS).toEqual([
      'semantic_moment',
      'slow_visual_change',
      'transcript_visual_cue',
      'scene_change',
      'periodic_fallback',
    ]);
  });

  it('rejects transcript status values outside the V2 enum and editable false', () => {
    expect(() =>
      parseMultimodalSessionState({
        schemaVersion: 1,
        transcript: {
          status: 'processing',
          editable: true,
          segments: [],
        },
        evidenceTimeline: { evidenceItems: [] },
        candidatePasses: {
          frameworks: [],
          principles: [],
          cases: [],
          counterexamples: [],
          terms: [],
        },
      }),
    ).toThrowError('INVALID_MULTIMODAL_CONTRACT');

    expect(() =>
      parseMultimodalSessionState({
        schemaVersion: 1,
        transcript: {
          status: 'pending',
          editable: false,
          segments: [],
        },
        evidenceTimeline: { evidenceItems: [] },
        candidatePasses: {
          frameworks: [],
          principles: [],
          cases: [],
          counterexamples: [],
          terms: [],
        },
      }),
    ).toThrowError('INVALID_MULTIMODAL_CONTRACT');
  });

  it('rejects schemaVersion values other than 1', () => {
    expect(() =>
      parseMultimodalSessionState({
        schemaVersion: 2,
        transcript: {
          status: 'pending',
          editable: true,
          segments: [],
        },
        evidenceTimeline: { evidenceItems: [] },
        candidatePasses: {
          frameworks: [],
          principles: [],
          cases: [],
          counterexamples: [],
          terms: [],
        },
      }),
    ).toThrowError('INVALID_MULTIMODAL_CONTRACT');
  });

  it('accepts exactly the V2 jobType enum and rejects removed values', () => {
    const acceptedJobTypes = [
      'media_prepare',
      'transcribe',
      'frame_materialize',
      'media_quality_check',
    ] as const;

    for (const jobType of acceptedJobTypes) {
      const parsed = parseMediaJobRecord({
        id: `job-${jobType}`,
        sessionId: '88',
        jobType,
        status: 'queued',
        idempotencyKey: `job-key-${jobType}`,
        requestHash: '4'.repeat(64),
        attemptNo: 0,
        maxAttempts: 3,
        progress: {},
        inputManifest: {},
      });

      expect(parsed.jobType).toBe(jobType);
    }

    const rejectedJobTypes = [
      'ingest_media',
      'extract_transcript',
      'extract_keyframes',
      'build_evidence_timeline',
      'extract_candidates',
      'build_skill_package',
    ];

    for (const jobType of rejectedJobTypes) {
      expect(() =>
        parseMediaJobRecord({
          id: 'job-invalid',
          sessionId: '88',
          jobType,
          status: 'queued',
          idempotencyKey: 'job-key-invalid',
          requestHash: '4'.repeat(64),
          attemptNo: 0,
          maxAttempts: 3,
          progress: {},
          inputManifest: {},
        }),
      ).toThrowError('INVALID_MULTIMODAL_CONTRACT');
    }
  });

  it('rejects non V2 media job states and malformed hashes', () => {
    expect(() =>
      parseMediaJobRecord({
        id: '301',
        sessionId: '88',
        jobType: 'transcribe',
        status: 'processing',
        idempotencyKey: 'job-key-1',
        requestHash: 'z'.repeat(64),
        attemptNo: 0,
        maxAttempts: 3,
        progress: {},
        inputManifest: {},
      }),
    ).toThrowError('INVALID_MULTIMODAL_CONTRACT');
  });

  it('rejects media jobs whose attempt bounds violate the V2 limits', () => {
    expect(() =>
      parseMediaJobRecord({
        id: '302',
        sessionId: '88',
        jobType: 'transcribe',
        status: 'queued',
        idempotencyKey: 'job-key-2',
        requestHash: '2'.repeat(64),
        attemptNo: 0,
        maxAttempts: 11,
        progress: {},
        inputManifest: {},
      }),
    ).toThrowError('INVALID_MULTIMODAL_CONTRACT');

    expect(() =>
      parseMediaJobRecord({
        id: '303',
        sessionId: '88',
        jobType: 'transcribe',
        status: 'queued',
        idempotencyKey: 'job-key-3',
        requestHash: '3'.repeat(64),
        attemptNo: 2,
        maxAttempts: 1,
        progress: {},
        inputManifest: {},
      }),
    ).toThrowError('INVALID_MULTIMODAL_CONTRACT');
  });

  it('parses Adler overview with exact four layers, valid evidence references, and strict claim types', () => {
    const parsed = parseAdlerOverview(
      {
        structure: [
          {
            text: '按步骤组织讲解',
            evidenceIds: ['ev-transcript', 'ev-frame'],
            claimType: 'sourceFact',
          },
        ],
        interpretation: [
          {
            text: '老师在用图示解释概念',
            evidenceIds: ['ev-frame'],
            claimType: 'modelInference',
          },
        ],
        critique: [
          {
            text: '少了反例提醒',
            evidenceIds: ['ev-transcript'],
            claimType: 'modelInference',
          },
        ],
        application: [
          {
            text: '可迁移到例题讲解',
            evidenceIds: ['ev-transcript'],
            claimType: 'modelInference',
          },
        ],
      },
      {
        evidenceIds: ['ev-transcript', 'ev-frame'],
        sourceFactEligibleEvidenceIds: ['ev-transcript', 'ev-frame'],
      },
    );

    expect(parsed.structure).toHaveLength(1);
    expect(parsed.interpretation[0]?.claimType).toBe('modelInference');
  });

  it('parses structured media evidence degradations and rejects drift', () => {
    expect(
      parseMediaEvidenceDegradations([
        {
          code: 'ASR_LOW_CONFIDENCE_UNCONFIRMED',
          message: 'ASR output needs human confirmation',
          semanticMomentId: 'moment-001',
        },
      ]),
    ).toEqual([
      {
        code: 'ASR_LOW_CONFIDENCE_UNCONFIRMED',
        message: 'ASR output needs human confirmation',
        semanticMomentId: 'moment-001',
      },
    ]);

    expect(() =>
      parseMediaEvidenceDegradations([
        {
          code: 'BAD',
          message: 'x'.repeat(513),
        },
      ]),
    ).toThrowError('INVALID_MULTIMODAL_CONTRACT');

    expect(() =>
      parseMediaEvidenceDegradations([
        {
          code: 'BAD',
          message: 'valid',
          semanticMomentId: 'moment-001',
          extra: true,
        },
      ]),
    ).toThrowError('INVALID_MULTIMODAL_CONTRACT');
  });

  it('rejects Adler and candidate pass payloads that drift from the strict H1 schema', () => {
    expect(() =>
      parseAdlerOverview(
        {
          structure: [
            {
              text: 'bad reference',
              evidenceIds: ['missing-evidence'],
              claimType: 'sourceFact',
            },
          ],
          interpretation: [],
          critique: [],
          application: [],
        },
        {
          evidenceIds: ['ev-transcript'],
          sourceFactEligibleEvidenceIds: ['ev-transcript'],
        },
      ),
    ).toThrowError('INVALID_MULTIMODAL_CONTRACT');

    expect(() =>
      parseCandidatePasses(
        {
          frameworks: [
            {
              candidateId: 'candidate-1',
              passKey: 'principles',
              title: '错位 pass key',
              summary: 'summary',
              reusableRule: 'rule',
              evidenceIds: ['ev-transcript'],
              claimType: 'modelInference',
              visualAssertion: false,
            },
          ],
          principles: [],
          cases: [],
          counterexamples: [],
          terms: [],
        },
        {
          evidenceIds: ['ev-transcript', 'ev-frame'],
          frameEvidenceIds: ['ev-frame'],
          sourceFactEligibleEvidenceIds: ['ev-transcript'],
        },
      ),
    ).toThrowError('INVALID_MULTIMODAL_CONTRACT');

    expect(() =>
      parseCandidatePasses(
        {
          frameworks: [
            {
              candidateId: 'candidate-1',
              passKey: 'frameworks',
              title: '需要画面支撑',
              summary: 'summary',
              reusableRule: 'rule',
              evidenceIds: ['ev-transcript'],
              claimType: 'modelInference',
              visualAssertion: true,
            },
          ],
          principles: [],
          cases: [],
          counterexamples: [],
          terms: [],
        },
        {
          evidenceIds: ['ev-transcript', 'ev-frame'],
          frameEvidenceIds: ['ev-frame'],
          sourceFactEligibleEvidenceIds: ['ev-transcript'],
        },
      ),
    ).toThrowError('INVALID_MULTIMODAL_CONTRACT');

    expect(CANDIDATE_PASS_KEYS).toEqual([
      'frameworks',
      'principles',
      'cases',
      'counterexamples',
      'terms',
    ]);
  });

  it('normalizes legacy minimal multimodal session state to canonical persisted defaults', () => {
    const parsed = parseMultimodalSessionState({
      schemaVersion: 1,
      primarySource: null,
      transcript: {
        status: 'pending',
        editable: true,
        segments: [],
      },
      evidenceTimeline: {
        evidenceItems: [],
      },
      candidatePasses: {
        frameworks: [],
        principles: [],
        cases: [],
        counterexamples: [],
        terms: [],
      },
    });

    expect(parsed).toEqual({
      schemaVersion: 1,
      primarySource: null,
      pendingUpload: null,
      transcript: {
        status: 'pending',
        editable: true,
        segments: [],
      },
      evidenceTimeline: {
        evidenceItems: [],
      },
      candidatePasses: {
        frameworks: [],
        principles: [],
        cases: [],
        counterexamples: [],
        terms: [],
        fused: [],
      },
      candidatePassMeta: null,
      semanticMoments: [],
      degradations: [],
      adlerOverview: null,
      adlerOverviewReview: null,
      selectedCandidateIds: [],
      candidateValidations: [],
      candidateSkills: [],
      operationReceipts: [],
    });
  });

  it('round-trips a full persisted multimodal working state and unified H-domain contracts', () => {
    const fullState = {
      schemaVersion: 1,
      primarySource: {
        sourceId: 'source-audio-1',
        kind: 'audio',
        assetRef: {
          objectKey: 'skill-sessions/201/source/audio.mp3',
          mimeType: 'audio/mpeg',
          sizeBytes: 8192,
          sha256: 'a'.repeat(64),
        },
      },
      pendingUpload: null,
      transcript: {
        status: 'ready',
        editable: true,
        segments: [
          {
            startMs: 0,
            endMs: 1200,
            text: '先定义，再说明适用边界',
            speaker: null,
            confidence: 0.95,
            editedByUser: false,
          },
        ],
      },
      evidenceTimeline: {
        evidenceItems: [
          {
            evidenceId: 'ev-transcript',
            kind: 'transcript',
            source: {
              primarySourceId: 'source-audio-1',
              relatedAssetRef: undefined,
            },
            timeRange: {
              startMs: 0,
              endMs: 1200,
            },
            text: '先定义，再说明适用边界',
            provenance: {
              method: 'asr',
              processorVersion: 'asr-v1',
              model: undefined,
              confidence: 0.95,
              editedByUser: false,
            },
            assetRef: undefined,
            claimType: 'sourceFact',
            selectionReason: '原始转录证据',
          },
          {
            evidenceId: 'ev-audio',
            kind: 'audio_segment',
            source: {
              primarySourceId: 'source-audio-1',
              relatedAssetRef: undefined,
            },
            timeRange: {
              startMs: 0,
              endMs: 1200,
            },
            text: '可回放音频片段',
            assetRef: {
              objectKey: 'skill-sessions/201/audio/segment-1.wav',
              mimeType: 'audio/wav',
              sizeBytes: 4096,
              sha256: 'b'.repeat(64),
            },
            provenance: {
              method: 'media_quality_check',
              processorVersion: 'audio-v1',
              model: undefined,
              confidence: 0.95,
              editedByUser: false,
            },
            claimType: 'sourceFact',
            selectionReason: '供回放与人工核对',
          },
        ],
      },
      candidatePasses: {
        frameworks: [
          {
            candidateId: 'candidate-framework-1',
            passKey: 'frameworks',
            title: '定义到边界的讲解框架',
            summary: '先定义，再说明适用边界',
            reusableRule: '先下定义，再说适用和不适用',
            evidenceIds: ['ev-transcript', 'ev-audio'],
            claimType: 'sourceFact',
            visualAssertion: false,
          },
        ],
        principles: [],
        cases: [],
        counterexamples: [],
        terms: [],
        fused: [],
      },
      candidatePassMeta: {
        frameworks: {
          model: 'framework-model',
          promptVersion: 'framework-prompt-v1',
        },
        principles: {
          model: 'principle-model',
          promptVersion: 'principle-prompt-v1',
        },
        cases: {
          model: 'case-model',
          promptVersion: 'case-prompt-v1',
        },
        counterexamples: {
          model: 'counterexample-model',
          promptVersion: 'counterexample-prompt-v1',
        },
        terms: {
          model: 'term-model',
          promptVersion: 'term-prompt-v1',
        },
        fused: {
          model: 'fused-model',
          promptVersion: 'fused-prompt-v1',
        },
      },
      semanticMoments: [
        {
          semanticMomentId: 'moment-001',
          startMs: 0,
          endMs: 1200,
          importance: 0.9,
          type: 'concept',
          summary: '核心定义被完整提出',
          visualTarget: null,
          audioEvidence: {
            timeRange: { startMs: 0, endMs: 1200 },
            text: '老师完整口述定义',
            confidence: 0.95,
          },
          transcriptEvidence: {
            timeRange: { startMs: 0, endMs: 1200 },
            text: '先定义，再说明适用边界',
            confidence: 0.95,
          },
          selectionReason: '首次完整定义',
        },
      ],
      degradations: [
        {
          code: 'FRAME_NOT_APPLICABLE',
          message: 'Audio-only source skips frame extraction',
          semanticMomentId: undefined,
        },
      ],
      adlerOverview: {
        overview: {
          structure: [
            {
              text: '先定义，再给适用边界',
              evidenceIds: ['ev-transcript'],
              claimType: 'sourceFact',
            },
          ],
          interpretation: [],
          critique: [],
          application: [],
        },
        meta: {
          model: 'adler-model',
          promptVersion: 'adler-prompt-v1',
          generatorVersion: 'adler-generator-v1',
          degradations: [
            {
              code: 'FRAME_NOT_APPLICABLE',
              message: 'Audio-only source skips frame extraction',
              semanticMomentId: undefined,
            },
          ],
        },
      },
      adlerOverviewReview: {
        title: 'Adler Overview',
        approved: true,
        userNotes: '人工确认 Adler 概览可进入候选提取阶段',
      },
      selectedCandidateIds: ['candidate-framework-1'],
      candidateValidations: [
        {
          candidate: {
            candidateId: 'candidate-framework-1',
            passKey: 'frameworks',
            title: '定义到边界的讲解框架',
            summary: '先定义，再说明适用边界',
            reusableRule: '先下定义，再说适用和不适用',
            evidenceIds: ['ev-transcript', 'ev-audio'],
            claimType: 'sourceFact',
            visualAssertion: false,
          },
          validation: {
            v1: {
              passed: true,
              reason: '可迁移到不同讲解场景',
              reusableContexts: ['新课概念讲解', '习题订正复盘'],
              proofSatisfied: true,
            },
            v2: {
              passed: true,
              reason: '给出原材料未直接出现的新教学场景',
              novelScenario: '课后答疑时先重述定义再界定适用边界',
              capability: 'guide',
              proofSatisfied: true,
            },
            v3: {
              passed: true,
              reason: '强调定义与边界必须同时出现',
              differentiators: ['不能只给结论，必须同时说明适用边界'],
              proofSatisfied: true,
            },
          },
          overallPassed: true,
          disposition: 'retain',
        },
      ],
      candidateSkills: [
        {
          candidateId: 'candidate-framework-1',
          id: 'skill-framework-1',
          dirName: 'skill-framework-1',
          name: '定义-边界讲解法',
          description: '先定义，再交代适用边界的技能草稿',
          skillMd: '# 定义-边界讲解法',
          ria: {
            sourceEvidenceIds: ['ev-transcript'],
            mechanism: '通过先定义再给边界减少学生误用',
            sourceExample: '老师先说定义，再说明何时不适用',
            futureApplicability: '适用于概念讲解和错题复盘',
            execution: {
              input: '学生提出概念性问题',
              steps: ['先陈述定义', '再说明适用边界'],
              output: '学生得到完整可迁移解释',
              completionCriteria: '学生能复述定义和边界',
              stopCriteria: '学生仍无法区分定义与边界时停止扩展',
            },
            boundaries: {
              counterexamples: ['只有定义没有边界不算完整'],
              failureModes: ['边界过于抽象时学生仍会误用'],
              limits: ['不适合纯操作流程类技能'],
              confusions: ['容易和“先例子后定义”混淆'],
            },
          },
          evidenceIds: ['ev-transcript', 'ev-audio'],
          relations: [],
          manifest: {
            model: 'ria-model',
            promptVersion: 'ria-prompt-v1',
            generatorVersion: 'ria-generator-v1',
          },
        },
      ],
      operationReceipts: [
        {
          action: 'skill.media.overview.confirm',
          idempotencyKey: 'confirm-overview-001',
          requestHash: '1'.repeat(64),
          baseRevisionNo: 0,
          resultRevisionNo: 1,
          confirmedStage: 'adler_overview',
          recordedAt: '2026-08-21T10:00:00.000Z',
        },
        {
          action: 'skill.media.candidate.confirm',
          idempotencyKey: 'confirm-candidate-001',
          requestHash: '2'.repeat(64),
          baseRevisionNo: 1,
          resultRevisionNo: 2,
          confirmedStage: 'evidence_and_candidates',
          recordedAt: '2026-08-21T10:05:00.000Z',
        },
      ],
    };

    const parsed = parseMultimodalSessionState(fullState);
    expect(parsed).toEqual(fullState);

    expect(
      parseAdlerOverviewResult(fullState.adlerOverview, {
        evidenceIds: ['ev-transcript', 'ev-audio'],
        sourceFactEligibleEvidenceIds: ['ev-transcript', 'ev-audio'],
      }),
    ).toEqual(fullState.adlerOverview);

    expect(
      parseValidatedCandidateResults(fullState.candidateValidations, {
        candidatePasses: fullState.candidatePasses,
        evidenceIds: ['ev-transcript', 'ev-audio'],
        frameEvidenceIds: [],
        sourceFactEligibleEvidenceIds: ['ev-transcript', 'ev-audio'],
      }),
    ).toEqual(fullState.candidateValidations);

    expect(
      parseRiaSkillDrafts(fullState.candidateSkills, {
        validatedCandidates: fullState.candidateValidations,
        evidenceIds: ['ev-transcript', 'ev-audio'],
      }),
    ).toEqual(fullState.candidateSkills);

    expect(parseMediaOperationReceipts(fullState.operationReceipts)).toEqual(
      fullState.operationReceipts,
    );
  });

  it('binds fused validation results to the fused candidate pass', () => {
    const fusedCandidate = {
      candidateId: 'fused-topic-1',
      passKey: 'fused' as const,
      title: '函数表示方法的统一选择框架',
      summary: '根据问题目标选择解析式、图形或表格表示',
      reusableRule: '先判断任务目标，再选择最能暴露关系的表示方法',
      evidenceIds: ['ev-transcript'],
      claimType: 'modelInference' as const,
      visualAssertion: false,
    };
    const candidatePasses = {
      frameworks: [],
      principles: [],
      cases: [],
      counterexamples: [],
      terms: [],
      fused: [fusedCandidate],
    };
    const validations = [
      {
        candidate: fusedCandidate,
        validation: {
          v1: {
            passed: true,
            reason: '可迁移到不同课程',
            reusableContexts: ['函数课', '数据分析课'],
            proofSatisfied: true,
          },
          v2: {
            passed: true,
            reason: '可指导新问题',
            novelScenario: '为实验数据选择表示方法',
            capability: 'guide' as const,
            proofSatisfied: true,
          },
          v3: {
            passed: true,
            reason: '包含明确选择依据',
            differentiators: ['不是表示方法清单'],
            proofSatisfied: true,
          },
        },
        overallPassed: true,
        disposition: 'retain' as const,
      },
    ];

    expect(
      parseValidatedCandidateResults(validations, {
        candidatePasses,
        evidenceIds: ['ev-transcript'],
      }),
    ).toEqual(validations);
  });

  it('rejects persisted multimodal working-state drift across validations, skills, receipts, and extra keys', () => {
    const baseState = {
      schemaVersion: 1,
      primarySource: {
        sourceId: 'source-video-1',
        kind: 'video',
        assetRef: {
          objectKey: 'skill-sessions/301/source/video.mp4',
          mimeType: 'video/mp4',
          sizeBytes: 16384,
          sha256: 'd'.repeat(64),
        },
      },
      transcript: {
        status: 'ready',
        editable: true,
        segments: [
          {
            startMs: 0,
            endMs: 1000,
            text: '先定义，再配合画面解释',
            confidence: 0.95,
            editedByUser: false,
          },
        ],
      },
      evidenceTimeline: {
        evidenceItems: [
          {
            evidenceId: 'ev-transcript',
            kind: 'transcript',
            source: { primarySourceId: 'source-video-1' },
            timeRange: { startMs: 0, endMs: 1000 },
            text: '先定义，再配合画面解释',
            provenance: {
              method: 'asr',
              processorVersion: 'asr-v1',
              confidence: 0.95,
              editedByUser: false,
            },
            claimType: 'sourceFact',
            selectionReason: '主讲内容',
          },
          {
            evidenceId: 'ev-frame',
            kind: 'frame',
            source: { primarySourceId: 'source-video-1' },
            timeRange: { startMs: 500, endMs: 501 },
            text: '白板上的边界示意图',
            assetRef: {
              objectKey: 'skill-sessions/301/frames/selected/frame-1.png',
              mimeType: 'image/png',
              sizeBytes: 2048,
              sha256: 'e'.repeat(64),
            },
            provenance: {
              method: 'vision_soft_ranking',
              processorVersion: 'vision-v1',
              confidence: 0.8,
              editedByUser: false,
            },
            claimType: 'modelInference',
            selectionReason: '辅助解释白板内容',
          },
        ],
      },
      candidatePasses: {
        frameworks: [
          {
            candidateId: 'candidate-1',
            passKey: 'frameworks',
            title: '定义+示意图框架',
            summary: '配合画面讲定义和边界',
            reusableRule: '口头定义配合视觉示意',
            evidenceIds: ['ev-transcript', 'ev-frame'],
            claimType: 'modelInference',
            visualAssertion: true,
          },
        ],
        principles: [],
        cases: [],
        counterexamples: [],
        terms: [],
      },
      candidatePassMeta: {
        frameworks: {
          model: 'framework-model',
          promptVersion: 'framework-prompt-v1',
        },
        principles: {
          model: 'principle-model',
          promptVersion: 'principle-prompt-v1',
        },
        cases: {
          model: 'case-model',
          promptVersion: 'case-prompt-v1',
        },
        counterexamples: {
          model: 'counterexample-model',
          promptVersion: 'counterexample-prompt-v1',
        },
        terms: {
          model: 'term-model',
          promptVersion: 'term-prompt-v1',
        },
      },
      semanticMoments: [],
      degradations: [],
      adlerOverview: null,
      adlerOverviewReview: null,
      selectedCandidateIds: [],
      candidateValidations: [],
      candidateSkills: [],
      operationReceipts: [],
    };

    expect(() =>
      parseMultimodalSessionState({
        ...baseState,
        extraRoot: true,
      }),
    ).toThrowError('INVALID_MULTIMODAL_CONTRACT');

    expect(() =>
      parseMultimodalSessionState({
        ...baseState,
        candidateValidations: [
          {
            candidate: {
              ...baseState.candidatePasses.frameworks[0],
              summary: 'drifted summary',
            },
            validation: {
              v1: {
                passed: true,
                reason: 'ok',
                reusableContexts: ['场景一', '场景二'],
                proofSatisfied: true,
              },
              v2: {
                passed: true,
                reason: 'ok',
                novelScenario: '新场景',
                capability: 'guide',
                proofSatisfied: true,
              },
              v3: {
                passed: true,
                reason: 'ok',
                differentiators: ['边界不同'],
                proofSatisfied: true,
              },
            },
            overallPassed: true,
            disposition: 'retain',
          },
        ],
      }),
    ).toThrowError('INVALID_MULTIMODAL_CONTRACT');

    expect(() =>
      parseMultimodalSessionState({
        ...baseState,
        candidateValidations: [
          {
            candidate: baseState.candidatePasses.frameworks[0],
            validation: {
              v1: {
                passed: true,
                reason: 'ok',
                reusableContexts: ['同一个场景', '同一个场景'],
                proofSatisfied: true,
              },
              v2: {
                passed: true,
                reason: 'ok',
                novelScenario: '新场景',
                capability: 'guide',
                proofSatisfied: true,
              },
              v3: {
                passed: true,
                reason: 'ok',
                differentiators: ['边界不同'],
                proofSatisfied: true,
              },
            },
            overallPassed: true,
            disposition: 'retain',
          },
        ],
      }),
    ).toThrowError('INVALID_MULTIMODAL_CONTRACT');

    expect(() =>
      parseMultimodalSessionState({
        ...baseState,
        candidateValidations: [
          {
            candidate: baseState.candidatePasses.frameworks[0],
            validation: {
              v1: {
                passed: false,
                reason: '不够稳定',
                reusableContexts: ['场景一', '场景二'],
                proofSatisfied: true,
              },
              v2: {
                passed: true,
                reason: 'ok',
                novelScenario: '新场景',
                capability: 'guide',
                proofSatisfied: true,
              },
              v3: {
                passed: true,
                reason: 'ok',
                differentiators: ['边界不同'],
                proofSatisfied: true,
              },
            },
            overallPassed: false,
            disposition: 'retain',
          },
        ],
      }),
    ).toThrowError('INVALID_MULTIMODAL_CONTRACT');

    expect(() =>
      parseMultimodalSessionState({
        ...baseState,
        candidateValidations: [
          {
            candidate: baseState.candidatePasses.frameworks[0],
            validation: {
              v1: {
                passed: true,
                reason: 'ok',
                reusableContexts: ['场景一', '场景二'],
                proofSatisfied: true,
              },
              v2: {
                passed: true,
                reason: 'ok',
                novelScenario: '新场景',
                capability: 'guide',
                proofSatisfied: true,
              },
              v3: {
                passed: true,
                reason: 'ok',
                differentiators: ['边界不同'],
                proofSatisfied: true,
              },
            },
            overallPassed: true,
            disposition: 'retain',
          },
        ],
        candidateSkills: [
          {
            candidateId: 'candidate-1',
            id: 'skill-1',
            dirName: 'skill-1',
            name: '技能一',
            description: 'desc',
            skillMd: '# skill',
            ria: {
              sourceEvidenceIds: ['ev-transcript', 'missing-evidence'],
              mechanism: 'mechanism',
              sourceExample: 'source example',
              futureApplicability: 'future',
              execution: {
                input: 'input',
                steps: ['step'],
                output: 'output',
                completionCriteria: 'done',
                stopCriteria: 'stop',
              },
              boundaries: {
                counterexamples: ['counter'],
                failureModes: ['failure'],
                limits: ['limit'],
                confusions: ['confusion'],
              },
            },
            evidenceIds: ['ev-transcript', 'ev-frame'],
            relations: [],
            manifest: {
              model: 'ria-model',
              promptVersion: 'ria-prompt',
              generatorVersion: 'ria-generator',
            },
          },
        ],
      }),
    ).toThrowError('INVALID_MULTIMODAL_CONTRACT');

    expect(() =>
      parseMultimodalSessionState({
        ...baseState,
        candidateValidations: [
          {
            candidate: baseState.candidatePasses.frameworks[0],
            validation: {
              v1: {
                passed: true,
                reason: 'ok',
                reusableContexts: ['场景一', '场景二'],
                proofSatisfied: true,
              },
              v2: {
                passed: true,
                reason: 'ok',
                novelScenario: '新场景',
                capability: 'guide',
                proofSatisfied: true,
              },
              v3: {
                passed: true,
                reason: 'ok',
                differentiators: ['边界不同'],
                proofSatisfied: true,
              },
            },
            overallPassed: true,
            disposition: 'retain',
          },
        ],
        candidateSkills: [
          {
            candidateId: 'candidate-1',
            id: 'skill-1',
            dirName: 'skill-1',
            name: '技能一',
            description: 'desc',
            skillMd: '# skill',
            ria: {
              sourceEvidenceIds: ['ev-transcript'],
              mechanism: 'mechanism',
              sourceExample: 'source example',
              futureApplicability: 'future',
              execution: {
                input: 'input',
                steps: ['step'],
                output: 'output',
                completionCriteria: 'done',
                stopCriteria: 'stop',
              },
              boundaries: {
                counterexamples: ['counter'],
                failureModes: ['failure'],
                limits: ['limit'],
                confusions: ['confusion'],
              },
            },
            evidenceIds: ['ev-transcript', 'ev-frame'],
            relations: [
              {
                type: 'depends-on',
                targetSkillId: 'skill-1',
              },
            ],
            manifest: {
              model: 'ria-model',
              promptVersion: 'ria-prompt',
              generatorVersion: 'ria-generator',
            },
          },
        ],
      }),
    ).toThrowError('INVALID_MULTIMODAL_CONTRACT');

    expect(() =>
      parseMultimodalSessionState({
        ...baseState,
        operationReceipts: [
          {
            action: 'skill.media.overview.confirm',
            idempotencyKey: 'receipt-1',
            requestHash: '1'.repeat(64),
            baseRevisionNo: 0,
            resultRevisionNo: 1,
            confirmedStage: 'evidence_and_candidates',
            recordedAt: '2026-08-21T10:00:00.000Z',
          },
        ],
      }),
    ).toThrowError('INVALID_MULTIMODAL_CONTRACT');

    expect(() =>
      parseMultimodalSessionState({
        ...baseState,
        operationReceipts: [
          {
            action: 'skill.media.overview.confirm',
            idempotencyKey: 'receipt-1',
            requestHash: '1'.repeat(64),
            baseRevisionNo: 0,
            resultRevisionNo: 1,
            confirmedStage: 'adler_overview',
            recordedAt: '2026-08-21T10:00:00.000Z',
          },
          {
            action: 'skill.media.candidate.confirm',
            idempotencyKey: 'receipt-1',
            requestHash: '2'.repeat(64),
            baseRevisionNo: 1,
            resultRevisionNo: 1,
            confirmedStage: 'evidence_and_candidates',
            recordedAt: '2026-08-21T10:01:00.000Z',
          },
        ],
      }),
    ).toThrowError('INVALID_MULTIMODAL_CONTRACT');
  });

  it('rejects RIA skill evidenceIds that are valid session evidence but outside the owning candidate evidence set', () => {
    expect(() =>
      parseRiaSkillDrafts(
        [
          {
            candidateId: 'candidate-1',
            id: 'skill-1',
            dirName: 'skill-1',
            name: '技能一',
            description: 'desc',
            skillMd: '# skill',
            ria: {
              sourceEvidenceIds: ['ev-transcript'],
              mechanism: 'mechanism',
              sourceExample: 'example',
              futureApplicability: 'future',
              execution: {
                input: 'input',
                steps: ['step'],
                output: 'output',
                completionCriteria: 'done',
                stopCriteria: 'stop',
              },
              boundaries: {
                counterexamples: ['counter'],
                failureModes: ['failure'],
                limits: ['limit'],
                confusions: ['confusion'],
              },
            },
            evidenceIds: ['ev-transcript', 'ev-audio'],
            relations: [],
            manifest: {
              model: 'ria-model',
              promptVersion: 'ria-prompt',
              generatorVersion: 'ria-generator',
            },
          },
        ],
        {
          validatedCandidates: [
            {
              candidate: {
                candidateId: 'candidate-1',
                passKey: 'frameworks',
                title: 'candidate',
                summary: 'summary',
                reusableRule: 'rule',
                evidenceIds: ['ev-transcript'],
                claimType: 'sourceFact',
                visualAssertion: false,
              },
              validation: {
                v1: {
                  passed: true,
                  reason: 'ok',
                  reusableContexts: ['场景一', '场景二'],
                  proofSatisfied: true,
                },
                v2: {
                  passed: true,
                  reason: 'ok',
                  novelScenario: '新场景',
                  capability: 'guide',
                  proofSatisfied: true,
                },
                v3: {
                  passed: true,
                  reason: 'ok',
                  differentiators: ['区分点'],
                  proofSatisfied: true,
                },
              },
              overallPassed: true,
              disposition: 'retain',
            },
          ],
          evidenceIds: ['ev-transcript', 'ev-audio'],
        },
      ),
    ).toThrowError('INVALID_MULTIMODAL_CONTRACT');
  });

  it('rejects sourceless non-draft state and degradations that point to unknown semantic moments', () => {
    expect(() =>
      parseMultimodalSessionState({
        schemaVersion: 1,
        primarySource: null,
        transcript: {
          status: 'pending',
          editable: true,
          segments: [
            {
              startMs: 0,
              endMs: 100,
              text: 'orphan transcript',
            },
          ],
        },
        evidenceTimeline: {
          evidenceItems: [],
        },
        candidatePasses: {
          frameworks: [],
          principles: [],
          cases: [],
          counterexamples: [],
          terms: [],
        },
        semanticMoments: [],
        degradations: [],
        adlerOverview: null,
        adlerOverviewReview: null,
        selectedCandidateIds: [],
        candidateValidations: [],
        candidateSkills: [],
        operationReceipts: [],
      }),
    ).toThrowError('INVALID_MULTIMODAL_CONTRACT');

    expect(() =>
      parseMultimodalSessionState({
        schemaVersion: 1,
        primarySource: null,
        transcript: {
          status: 'pending',
          editable: true,
          segments: [],
        },
        evidenceTimeline: {
          evidenceItems: [],
        },
        candidatePasses: {
          frameworks: [],
          principles: [],
          cases: [],
          counterexamples: [],
          terms: [],
        },
        semanticMoments: [],
        degradations: [
          {
            code: 'ORPHAN_DEGRADATION',
            message: 'orphaned degradation',
          },
        ],
        adlerOverview: null,
        candidateValidations: [],
        candidateSkills: [],
        operationReceipts: [],
      }),
    ).toThrowError('INVALID_MULTIMODAL_CONTRACT');

    expect(() =>
      parseMultimodalSessionState({
        schemaVersion: 1,
        primarySource: {
          sourceId: 'source-audio-2',
          kind: 'audio',
          assetRef: {
            objectKey: 'skill-sessions/302/source/audio.mp3',
            mimeType: 'audio/mpeg',
            sizeBytes: 4096,
            sha256: 'a'.repeat(64),
          },
        },
        transcript: {
          status: 'ready',
          editable: true,
          segments: [
            {
              startMs: 0,
              endMs: 100,
              text: 'audio transcript',
              confidence: 0.95,
            },
          ],
        },
        evidenceTimeline: {
          evidenceItems: [
            {
              evidenceId: 'ev-audio',
              kind: 'audio_segment',
              source: { primarySourceId: 'source-audio-2' },
              timeRange: { startMs: 0, endMs: 100 },
              text: 'audio evidence',
              assetRef: {
                objectKey: 'skill-sessions/302/audio/segment-1.wav',
                mimeType: 'audio/wav',
                sizeBytes: 1024,
                sha256: 'b'.repeat(64),
              },
              provenance: {
                method: 'asr',
                processorVersion: 'audio-v1',
                confidence: 0.95,
                editedByUser: false,
              },
              claimType: 'sourceFact',
              selectionReason: 'audio proof',
            },
          ],
        },
        candidatePasses: {
          frameworks: [],
          principles: [],
          cases: [],
          counterexamples: [],
          terms: [],
        },
        semanticMoments: [
          {
            semanticMomentId: 'moment-1',
            startMs: 0,
            endMs: 100,
            importance: 0.8,
            type: 'concept',
            summary: 'audio concept',
            visualTarget: null,
            audioEvidence: {
              timeRange: { startMs: 0, endMs: 100 },
              text: 'audio evidence',
              confidence: 0.95,
            },
            transcriptEvidence: {
              timeRange: { startMs: 0, endMs: 100 },
              text: 'audio transcript',
              confidence: 0.95,
            },
            selectionReason: 'audio-only semantic moment',
          },
        ],
        degradations: [
          {
            code: 'UNKNOWN_MOMENT',
            message: 'bad pointer',
            semanticMomentId: 'moment-missing',
          },
        ],
        adlerOverview: null,
        candidateValidations: [],
        candidateSkills: [],
        operationReceipts: [],
      }),
    ).toThrowError('INVALID_MULTIMODAL_CONTRACT');
  });

  it('rejects malformed Adler review, selected candidates, candidate-skill sync, receipts, and sourceless review state', () => {
    const reviewedState = {
      schemaVersion: 1,
      primarySource: {
        sourceId: 'source-audio-4',
        kind: 'audio',
        assetRef: {
          objectKey: 'skill-sessions/304/source/audio.mp3',
          mimeType: 'audio/mpeg',
          sizeBytes: 4096,
          sha256: 'f'.repeat(64),
        },
      },
      transcript: {
        status: 'ready',
        editable: true,
        segments: [
          {
            startMs: 0,
            endMs: 900,
            text: 'audio candidate proof',
            confidence: 0.95,
            editedByUser: false,
          },
        ],
      },
      evidenceTimeline: {
        evidenceItems: [
          {
            evidenceId: 'ev-audio-transcript-4',
            kind: 'transcript',
            source: { primarySourceId: 'source-audio-4' },
            timeRange: { startMs: 0, endMs: 900 },
            text: 'audio candidate proof',
            provenance: {
              method: 'asr',
              processorVersion: 'asr-v1',
              confidence: 0.95,
              editedByUser: false,
            },
            claimType: 'sourceFact',
            selectionReason: 'transcript proof',
          },
          {
            evidenceId: 'ev-audio-segment-4',
            kind: 'audio_segment',
            source: { primarySourceId: 'source-audio-4' },
            timeRange: { startMs: 0, endMs: 900 },
            text: 'audio segment',
            assetRef: {
              objectKey: 'skill-sessions/304/audio/segment-1.wav',
              mimeType: 'audio/wav',
              sizeBytes: 2048,
              sha256: '1'.repeat(64),
            },
            provenance: {
              method: 'media_quality_check',
              processorVersion: 'audio-v1',
              confidence: 0.95,
              editedByUser: false,
            },
            claimType: 'sourceFact',
            selectionReason: 'audio proof',
          },
        ],
      },
      candidatePasses: {
        frameworks: [
          {
            candidateId: 'candidate-audio-4',
            passKey: 'frameworks',
            title: 'audio framework',
            summary: 'summary',
            reusableRule: 'rule',
            evidenceIds: ['ev-audio-transcript-4', 'ev-audio-segment-4'],
            claimType: 'sourceFact',
            visualAssertion: false,
          },
        ],
        principles: [],
        cases: [],
        counterexamples: [],
        terms: [],
      },
      candidatePassMeta: {
        frameworks: {
          model: 'framework-model',
          promptVersion: 'framework-prompt-v1',
        },
        principles: {
          model: 'principle-model',
          promptVersion: 'principle-prompt-v1',
        },
        cases: {
          model: 'case-model',
          promptVersion: 'case-prompt-v1',
        },
        counterexamples: {
          model: 'counterexample-model',
          promptVersion: 'counterexample-prompt-v1',
        },
        terms: {
          model: 'term-model',
          promptVersion: 'term-prompt-v1',
        },
      },
      semanticMoments: [],
      degradations: [],
      adlerOverview: {
        overview: {
          structure: [
            {
              text: 'audio structure',
              evidenceIds: ['ev-audio-transcript-4'],
              claimType: 'sourceFact',
            },
          ],
          interpretation: [],
          critique: [],
          application: [],
        },
        meta: {
          model: 'adler-model',
          promptVersion: 'adler-prompt-v1',
          generatorVersion: 'adler-generator-v1',
          degradations: [],
        },
      },
      adlerOverviewReview: {
        title: 'Adler Overview',
        approved: true,
        userNotes: '人工确认通过',
      },
      selectedCandidateIds: ['candidate-audio-4'],
      candidateValidations: [
        {
          candidate: {
            candidateId: 'candidate-audio-4',
            passKey: 'frameworks',
            title: 'audio framework',
            summary: 'summary',
            reusableRule: 'rule',
            evidenceIds: ['ev-audio-transcript-4', 'ev-audio-segment-4'],
            claimType: 'sourceFact',
            visualAssertion: false,
          },
          validation: {
            v1: {
              passed: true,
              reason: 'ok',
              reusableContexts: ['场景一', '场景二'],
              proofSatisfied: true,
            },
            v2: {
              passed: true,
              reason: 'ok',
              novelScenario: '新场景',
              capability: 'guide',
              proofSatisfied: true,
            },
            v3: {
              passed: true,
              reason: 'ok',
              differentiators: ['区分点'],
              proofSatisfied: true,
            },
          },
          overallPassed: true,
          disposition: 'retain',
        },
      ],
      candidateSkills: [
        {
          candidateId: 'candidate-audio-4',
          id: 'skill-audio-4',
          dirName: 'skill-audio-4',
          name: '音频技能',
          description: 'audio skill',
          skillMd: '# 音频技能',
          ria: {
            sourceEvidenceIds: ['ev-audio-transcript-4'],
            mechanism: 'mechanism',
            sourceExample: 'example',
            futureApplicability: 'future',
            execution: {
              input: 'input',
              steps: ['step'],
              output: 'output',
              completionCriteria: 'done',
              stopCriteria: 'stop',
            },
            boundaries: {
              counterexamples: ['counter'],
              failureModes: ['failure'],
              limits: ['limit'],
              confusions: ['confusion'],
            },
          },
          evidenceIds: ['ev-audio-transcript-4', 'ev-audio-segment-4'],
          relations: [],
          manifest: {
            model: 'ria-model',
            promptVersion: 'ria-prompt-v1',
            generatorVersion: 'ria-generator-v1',
          },
        },
      ],
      operationReceipts: [],
    };

    expect(() =>
      parseMultimodalSessionState({
        ...reviewedState,
        adlerOverviewReview: {
          title: 'Adler Overview',
          approved: false,
          userNotes: 'bad',
        },
      }),
    ).toThrowError('INVALID_MULTIMODAL_CONTRACT');

    expect(() =>
      parseMultimodalSessionState({
        ...reviewedState,
        adlerOverviewReview: {
          title: 'Adler Overview',
          approved: true,
          userNotes: 'ok',
          extra: true,
        },
      }),
    ).toThrowError('INVALID_MULTIMODAL_CONTRACT');

    expect(() =>
      parseMultimodalSessionState({
        ...reviewedState,
        adlerOverviewReview: {
          title: 'x'.repeat(201),
          approved: true,
          userNotes: 'ok',
        },
      }),
    ).toThrowError('INVALID_MULTIMODAL_CONTRACT');

    expect(() =>
      parseMultimodalSessionState({
        ...reviewedState,
        selectedCandidateIds: ['candidate-missing'],
      }),
    ).toThrowError('INVALID_MULTIMODAL_CONTRACT');

    const sparseSelection = new Array(2);
    sparseSelection[0] = 'candidate-audio-4';
    expect(() =>
      parseMultimodalSessionState({
        ...reviewedState,
        selectedCandidateIds: sparseSelection,
      }),
    ).toThrowError('INVALID_MULTIMODAL_CONTRACT');

    expect(() =>
      parseMultimodalSessionState({
        ...reviewedState,
        selectedCandidateIds: ['candidate-audio-4', 'candidate-audio-4'],
      }),
    ).toThrowError('INVALID_MULTIMODAL_CONTRACT');

    expect(() =>
      parseMultimodalSessionState({
        ...reviewedState,
        selectedCandidateIds: new Array(17)
          .fill(null)
          .map((_, index) => `candidate-${index}`),
      }),
    ).toThrowError('INVALID_MULTIMODAL_CONTRACT');

    expect(() =>
      parseMultimodalSessionState({
        ...reviewedState,
        candidateValidations: [
          {
            ...reviewedState.candidateValidations[0],
            validation: {
              ...reviewedState.candidateValidations[0].validation,
              v1: {
                ...reviewedState.candidateValidations[0].validation.v1,
                passed: false,
              },
            },
            overallPassed: false,
            disposition: 'case',
          },
        ],
      }),
    ).toThrowError('INVALID_MULTIMODAL_CONTRACT');

    expect(() =>
      parseMultimodalSessionState({
        ...reviewedState,
        selectedCandidateIds: [],
        candidateSkills: reviewedState.candidateSkills,
      }),
    ).toThrowError('INVALID_MULTIMODAL_CONTRACT');

    expect(() =>
      parseMultimodalSessionState({
        ...reviewedState,
        candidateSkills: [
          {
            ...reviewedState.candidateSkills[0],
            candidateId: 'candidate-other',
          },
        ],
      }),
    ).toThrowError('INVALID_MULTIMODAL_CONTRACT');

    expect(() =>
      parseMultimodalSessionState({
        ...reviewedState,
        adlerOverviewReview: {
          title: 'Adler Overview',
          approved: true,
          userNotes: '',
        },
        selectedCandidateIds: [],
        candidateValidations: [],
        candidateSkills: [],
      }),
    ).toThrowError('INVALID_MULTIMODAL_CONTRACT');

    expect(() =>
      parseMultimodalSessionState({
        ...reviewedState,
        candidateSkills: [],
      }),
    ).toThrowError('INVALID_MULTIMODAL_CONTRACT');

    expect(() =>
      parseMultimodalSessionState({
        ...reviewedState,
        adlerOverviewReview: null,
        operationReceipts: [
          {
            action: 'skill.media.overview.confirm',
            idempotencyKey: 'confirm-overview-audio-004',
            requestHash: '2'.repeat(64),
            baseRevisionNo: 0,
            resultRevisionNo: 1,
            confirmedStage: 'adler_overview',
            recordedAt: '2026-08-21T12:00:00.000Z',
          },
        ],
      }),
    ).toThrowError('INVALID_MULTIMODAL_CONTRACT');

    expect(() =>
      parseMultimodalSessionState({
        ...reviewedState,
        adlerOverviewReview: {
          title: 'Adler Overview',
          approved: true,
          userNotes: 123,
        },
      }),
    ).toThrowError('INVALID_MULTIMODAL_CONTRACT');

    expect(() =>
      parseMultimodalSessionState({
        ...reviewedState,
        adlerOverviewReview: {
          title: 'Adler Overview',
          approved: true,
          userNotes: 'x'.repeat(2001),
        },
      }),
    ).toThrowError('INVALID_MULTIMODAL_CONTRACT');

    expect(() =>
      parseMultimodalSessionState({
        ...reviewedState,
        adlerOverviewReview: {
          title: 'Adler Overview',
          approved: true,
          userNotes: '',
        },
        selectedCandidateIds: [],
        candidateValidations: [],
        candidateSkills: [],
        operationReceipts: [
          {
            action: 'skill.media.overview.confirm',
            idempotencyKey: 'confirm-overview-audio-004',
            requestHash: '2'.repeat(64),
            baseRevisionNo: 0,
            resultRevisionNo: 1,
            confirmedStage: 'adler_overview',
            recordedAt: '2026-08-21T12:00:00.000Z',
          },
        ],
      }),
    ).not.toThrow();

    expect(() =>
      parseMultimodalSessionState({
        ...reviewedState,
        candidateSkills: [],
        operationReceipts: [
          {
            action: 'skill.media.overview.confirm',
            idempotencyKey: 'confirm-overview-audio-004',
            requestHash: '2'.repeat(64),
            baseRevisionNo: 0,
            resultRevisionNo: 1,
            confirmedStage: 'adler_overview',
            recordedAt: '2026-08-21T12:00:00.000Z',
          },
        ],
      }),
    ).toThrowError('INVALID_MULTIMODAL_CONTRACT');

    expect(() =>
      parseMultimodalSessionState({
        ...reviewedState,
        candidateSkills: [],
        operationReceipts: [
          {
            action: 'skill.media.overview.confirm',
            idempotencyKey: 'confirm-overview-audio-004',
            requestHash: '2'.repeat(64),
            baseRevisionNo: 0,
            resultRevisionNo: 1,
            confirmedStage: 'adler_overview',
            recordedAt: '2026-08-21T12:00:00.000Z',
          },
          {
            action: 'skill.media.candidate.confirm',
            idempotencyKey: 'confirm-candidate-audio-004',
            requestHash: '3'.repeat(64),
            baseRevisionNo: 1,
            resultRevisionNo: 2,
            confirmedStage: 'evidence_and_candidates',
            recordedAt: '2026-08-21T12:01:00.000Z',
          },
        ],
      }),
    ).not.toThrow();

    expect(() =>
      parseMultimodalSessionState({
        ...reviewedState,
        operationReceipts: [
          {
            action: 'skill.media.candidate.confirm',
            idempotencyKey: 'confirm-candidate-audio-004',
            requestHash: '3'.repeat(64),
            baseRevisionNo: 1,
            resultRevisionNo: 2,
            confirmedStage: 'evidence_and_candidates',
            recordedAt: '2026-08-21T12:01:00.000Z',
          },
        ],
      }),
    ).toThrowError('INVALID_MULTIMODAL_CONTRACT');

    expect(() =>
      parseMultimodalSessionState({
        ...reviewedState,
        selectedCandidateIds: [],
        operationReceipts: [
          {
            action: 'skill.media.overview.confirm',
            idempotencyKey: 'confirm-overview-audio-004',
            requestHash: '2'.repeat(64),
            baseRevisionNo: 0,
            resultRevisionNo: 1,
            confirmedStage: 'adler_overview',
            recordedAt: '2026-08-21T12:00:00.000Z',
          },
          {
            action: 'skill.media.candidate.confirm',
            idempotencyKey: 'confirm-candidate-audio-004',
            requestHash: '3'.repeat(64),
            baseRevisionNo: 1,
            resultRevisionNo: 2,
            confirmedStage: 'evidence_and_candidates',
            recordedAt: '2026-08-21T12:01:00.000Z',
          },
        ],
      }),
    ).toThrowError('INVALID_MULTIMODAL_CONTRACT');

    expect(() =>
      parseMultimodalSessionState({
        ...reviewedState,
        primarySource: null,
      }),
    ).toThrowError('INVALID_MULTIMODAL_CONTRACT');

    expect(() =>
      parseMultimodalSessionState({
        ...reviewedState,
        adlerOverview: null,
      }),
    ).toThrowError('INVALID_MULTIMODAL_CONTRACT');
  });

  it('accepts audio-only state with source and no frame while rejecting malformed media operation receipts', () => {
    const audioOnly = parseMultimodalSessionState({
      schemaVersion: 1,
      primarySource: {
        sourceId: 'source-audio-3',
        kind: 'audio',
        assetRef: {
          objectKey: 'skill-sessions/303/source/audio.mp3',
          mimeType: 'audio/mpeg',
          sizeBytes: 2048,
          sha256: 'c'.repeat(64),
        },
      },
      transcript: {
        status: 'ready',
        editable: true,
        segments: [
          {
            startMs: 0,
            endMs: 100,
            text: 'audio ok',
            confidence: 0.95,
          },
        ],
      },
      evidenceTimeline: {
        evidenceItems: [
          {
            evidenceId: 'ev-audio',
            kind: 'audio_segment',
            source: { primarySourceId: 'source-audio-3' },
            timeRange: { startMs: 0, endMs: 100 },
            text: 'audio evidence',
            assetRef: {
              objectKey: 'skill-sessions/303/audio/segment-1.wav',
              mimeType: 'audio/wav',
              sizeBytes: 1024,
              sha256: 'd'.repeat(64),
            },
            provenance: {
              method: 'audio',
              processorVersion: 'audio-v1',
              confidence: 0.95,
              editedByUser: false,
            },
            claimType: 'sourceFact',
            selectionReason: 'audio-only proof',
          },
        ],
      },
      candidatePasses: {
        frameworks: [],
        principles: [],
        cases: [],
        counterexamples: [],
        terms: [],
      },
      semanticMoments: [],
      degradations: [],
      adlerOverview: null,
      adlerOverviewReview: null,
      selectedCandidateIds: [],
      candidateValidations: [],
      candidateSkills: [],
      operationReceipts: [],
    });

    expect(audioOnly.primarySource?.kind).toBe('audio');
    expect(audioOnly.adlerOverviewReview).toBeNull();
    expect(audioOnly.selectedCandidateIds).toEqual([]);
    expect(
      audioOnly.evidenceTimeline.evidenceItems.every(
        (item) => item.kind !== 'frame',
      ),
    ).toBe(true);

    expect(() =>
      parseMediaOperationReceipts([
        {
          action: 'skill.media.overview.confirm',
          idempotencyKey: 'short',
          requestHash: '1'.repeat(64),
          baseRevisionNo: 0,
          resultRevisionNo: 1,
          confirmedStage: 'adler_overview',
          recordedAt: '2026-08-21T10:00:00.000Z',
        },
      ]),
    ).toThrowError('INVALID_MULTIMODAL_CONTRACT');

    const sparseReceipts = new Array(2);
    sparseReceipts[0] = {
      action: 'skill.media.overview.confirm',
      idempotencyKey: 'confirm-overview-001',
      requestHash: '1'.repeat(64),
      baseRevisionNo: 0,
      resultRevisionNo: 1,
      confirmedStage: 'adler_overview',
      recordedAt: '2026-08-21T10:00:00.000Z',
    };
    expect(() => parseMediaOperationReceipts(sparseReceipts)).toThrowError(
      'INVALID_MULTIMODAL_CONTRACT',
    );

    expect(() =>
      parseMediaOperationReceipts([
        {
          action: 'skill.media.candidate.confirm',
          idempotencyKey: 'confirm-candidate-001',
          requestHash: '2'.repeat(64),
          baseRevisionNo: 1,
          resultRevisionNo: 2,
          confirmedStage: 'evidence_and_candidates',
          recordedAt: '2026-08-21T10:01:00.000Z',
        },
      ]),
    ).toThrowError('INVALID_MULTIMODAL_CONTRACT');

    expect(() =>
      parseMediaOperationReceipts(
        new Array(65).fill(null).map((_, index) => ({
          action:
            index === 0
              ? 'skill.media.overview.confirm'
              : 'skill.media.candidate.confirm',
          idempotencyKey: `confirm-${index.toString().padStart(3, '0')}`,
          requestHash: `${index % 10}`.repeat(64),
          baseRevisionNo: index,
          resultRevisionNo: index + 1,
          confirmedStage:
            index === 0 ? 'adler_overview' : 'evidence_and_candidates',
          recordedAt: `2026-08-21T10:${String(index % 60).padStart(2, '0')}:00.000Z`,
        })),
      ),
    ).toThrowError('INVALID_MULTIMODAL_CONTRACT');

    expect(() =>
      parseMediaOperationReceipts([
        {
          action: 'skill.media.overview.confirm',
          idempotencyKey: 'confirm-overview-001',
          requestHash: '1'.repeat(64),
          baseRevisionNo: 0,
          resultRevisionNo: 1,
          confirmedStage: 'adler_overview',
          recordedAt: '2026-08-21T10:00:00.000Z',
          extra: true,
        },
      ]),
    ).toThrowError('INVALID_MULTIMODAL_CONTRACT');

    expect(() =>
      parseMediaOperationReceipts([
        {
          action: 'skill.media.overview.confirm',
          idempotencyKey: 'confirm-overview-001',
          requestHash: '1'.repeat(64),
          baseRevisionNo: 0,
          resultRevisionNo: 1,
          confirmedStage: 'adler_overview',
          recordedAt: '2026-08-21T10:00:00.000Z',
        },
        {
          action: 'skill.media.overview.confirm',
          idempotencyKey: 'confirm-overview-001',
          requestHash: '2'.repeat(64),
          baseRevisionNo: 1,
          resultRevisionNo: 2,
          confirmedStage: 'adler_overview',
          recordedAt: '2026-08-21T10:01:00.000Z',
        },
      ]),
    ).toThrowError('INVALID_MULTIMODAL_CONTRACT');

    expect(() =>
      parseMediaOperationReceipts([
        {
          action: 'skill.media.overview.confirm',
          idempotencyKey: 'confirm-overview-001',
          requestHash: 'bad-hash',
          baseRevisionNo: 0,
          resultRevisionNo: 1,
          confirmedStage: 'adler_overview',
          recordedAt: '2026-08-21T10:00:00.000Z',
        },
      ]),
    ).toThrowError('INVALID_MULTIMODAL_CONTRACT');

    expect(() =>
      parseMediaOperationReceipts([
        {
          action: 'skill.media.overview.confirm',
          idempotencyKey: 'confirm-overview-001',
          requestHash: '1'.repeat(64),
          baseRevisionNo: 0,
          resultRevisionNo: 2,
          confirmedStage: 'adler_overview',
          recordedAt: '2026-08-21T10:00:00.000Z',
        },
      ]),
    ).toThrowError('INVALID_MULTIMODAL_CONTRACT');

    expect(() =>
      parseMediaOperationReceipts([
        {
          action: 'skill.media.overview.confirm',
          idempotencyKey: 'confirm-overview-001',
          requestHash: '1'.repeat(64),
          baseRevisionNo: 1,
          resultRevisionNo: 2,
          confirmedStage: 'adler_overview',
          recordedAt: '2026-08-21T10:00:00.000Z',
        },
        {
          action: 'skill.media.candidate.confirm',
          idempotencyKey: 'confirm-candidate-001',
          requestHash: '2'.repeat(64),
          baseRevisionNo: 0,
          resultRevisionNo: 1,
          confirmedStage: 'evidence_and_candidates',
          recordedAt: '2026-08-21T10:01:00.000Z',
        },
      ]),
    ).toThrowError('INVALID_MULTIMODAL_CONTRACT');

    expect(() =>
      parseMediaOperationReceipts([
        {
          action: 'skill.media.overview.confirm',
          idempotencyKey: 'confirm-overview-001',
          requestHash: '1'.repeat(64),
          baseRevisionNo: 0,
          resultRevisionNo: 1,
          confirmedStage: 'adler_overview',
          recordedAt: 'not-iso',
        },
      ]),
    ).toThrowError('INVALID_MULTIMODAL_CONTRACT');
  });

  it('explicitly rejects forged overallPassed, illegal downgrades, failed-skill sourcing, illegal relations, unknown evidence, and nested extra keys', () => {
    expect(() =>
      parseValidatedCandidateResults(
        [
          {
            candidate: {
              candidateId: 'candidate-1',
              passKey: 'frameworks',
              title: 'candidate',
              summary: 'summary',
              reusableRule: 'rule',
              evidenceIds: ['ev-transcript'],
              claimType: 'sourceFact',
              visualAssertion: false,
            },
            validation: {
              v1: {
                passed: true,
                reason: 'ok',
                reusableContexts: ['同一场景', '同一场景'],
                proofSatisfied: false,
              },
              v2: {
                passed: true,
                reason: 'ok',
                novelScenario: '新场景',
                capability: 'guide',
                proofSatisfied: true,
              },
              v3: {
                passed: true,
                reason: 'ok',
                differentiators: ['区分点'],
                proofSatisfied: true,
              },
            },
            overallPassed: true,
            disposition: 'retain',
          },
        ],
        {
          evidenceIds: ['ev-transcript'],
          sourceFactEligibleEvidenceIds: ['ev-transcript'],
        },
      ),
    ).toThrowError('INVALID_MULTIMODAL_CONTRACT');

    expect(() =>
      parseValidatedCandidateResults(
        [
          {
            candidate: {
              candidateId: 'candidate-1',
              passKey: 'frameworks',
              title: 'candidate',
              summary: 'summary',
              reusableRule: 'rule',
              evidenceIds: ['ev-transcript'],
              claimType: 'sourceFact',
              visualAssertion: false,
            },
            validation: {
              v1: {
                passed: true,
                reason: 'ok',
                reusableContexts: ['场景一', '场景二'],
                proofSatisfied: true,
              },
              v2: {
                passed: true,
                reason: 'ok',
                novelScenario: '新场景',
                capability: 'guide',
                proofSatisfied: true,
              },
              v3: {
                passed: true,
                reason: 'ok',
                differentiators: ['区分点'],
                proofSatisfied: true,
              },
            },
            overallPassed: true,
            disposition: 'discard',
          },
        ],
        {
          evidenceIds: ['ev-transcript'],
          sourceFactEligibleEvidenceIds: ['ev-transcript'],
        },
      ),
    ).toThrowError('INVALID_MULTIMODAL_CONTRACT');

    expect(() =>
      parseRiaSkillDrafts(
        [
          {
            candidateId: 'candidate-failed',
            id: 'skill-failed',
            dirName: 'skill-failed',
            name: '失败技能',
            description: 'desc',
            skillMd: '# failed',
            ria: {
              sourceEvidenceIds: ['ev-transcript'],
              mechanism: 'mechanism',
              sourceExample: 'example',
              futureApplicability: 'future',
              execution: {
                input: 'input',
                steps: ['step'],
                output: 'output',
                completionCriteria: 'done',
                stopCriteria: 'stop',
              },
              boundaries: {
                counterexamples: ['counter'],
                failureModes: ['failure'],
                limits: ['limit'],
                confusions: ['confusion'],
              },
            },
            evidenceIds: ['ev-transcript'],
            relations: [],
            manifest: {
              model: 'ria-model',
              promptVersion: 'ria-prompt',
              generatorVersion: 'ria-generator',
            },
          },
        ],
        {
          validatedCandidates: [
            {
              candidate: {
                candidateId: 'candidate-failed',
                passKey: 'cases',
                title: 'failed',
                summary: 'summary',
                reusableRule: 'rule',
                evidenceIds: ['ev-transcript'],
                claimType: 'sourceFact',
                visualAssertion: false,
              },
              validation: {
                v1: {
                  passed: false,
                  reason: 'bad',
                  reusableContexts: ['同一场景', '同一场景'],
                  proofSatisfied: false,
                },
                v2: {
                  passed: true,
                  reason: 'ok',
                  novelScenario: '新场景',
                  capability: 'guide',
                  proofSatisfied: true,
                },
                v3: {
                  passed: true,
                  reason: 'ok',
                  differentiators: ['区分点'],
                  proofSatisfied: true,
                },
              },
              overallPassed: false,
              disposition: 'discard',
            },
          ],
          evidenceIds: ['ev-transcript'],
        },
      ),
    ).toThrowError('INVALID_MULTIMODAL_CONTRACT');

    expect(() =>
      parseRiaSkillDrafts(
        [
          {
            candidateId: 'candidate-1',
            id: 'skill-1',
            dirName: 'skill-1',
            name: '技能一',
            description: 'desc',
            skillMd: '# skill',
            ria: {
              sourceEvidenceIds: ['ev-transcript'],
              mechanism: 'mechanism',
              sourceExample: 'example',
              futureApplicability: 'future',
              execution: {
                input: 'input',
                steps: ['step'],
                output: 'output',
                completionCriteria: 'done',
                stopCriteria: 'stop',
              },
              boundaries: {
                counterexamples: ['counter'],
                failureModes: ['failure'],
                limits: ['limit'],
                confusions: ['confusion'],
                extra: true,
              },
            },
            evidenceIds: ['ev-transcript'],
            relations: [{ type: 'illegal', targetSkillId: 'skill-2' }],
            manifest: {
              model: 'ria-model',
              promptVersion: 'ria-prompt',
              generatorVersion: 'ria-generator',
            },
          },
          {
            candidateId: 'candidate-2',
            id: 'skill-2',
            dirName: 'skill-2',
            name: '技能二',
            description: 'desc',
            skillMd: '# skill',
            ria: {
              sourceEvidenceIds: ['ev-unknown'],
              mechanism: 'mechanism',
              sourceExample: 'example',
              futureApplicability: 'future',
              execution: {
                input: 'input',
                steps: ['step'],
                output: 'output',
                completionCriteria: 'done',
                stopCriteria: 'stop',
              },
              boundaries: {
                counterexamples: ['counter'],
                failureModes: ['failure'],
                limits: ['limit'],
                confusions: ['confusion'],
              },
            },
            evidenceIds: ['ev-unknown'],
            relations: [
              { type: 'depends-on', targetSkillId: 'skill-2' },
              { type: 'depends-on', targetSkillId: 'skill-2' },
            ],
            manifest: {
              model: 'ria-model',
              promptVersion: 'ria-prompt',
              generatorVersion: 'ria-generator',
            },
          },
        ],
        {
          validatedCandidates: [
            {
              candidate: {
                candidateId: 'candidate-1',
                passKey: 'frameworks',
                title: 'candidate one',
                summary: 'summary',
                reusableRule: 'rule',
                evidenceIds: ['ev-transcript'],
                claimType: 'sourceFact',
                visualAssertion: false,
              },
              validation: {
                v1: {
                  passed: true,
                  reason: 'ok',
                  reusableContexts: ['场景一', '场景二'],
                  proofSatisfied: true,
                },
                v2: {
                  passed: true,
                  reason: 'ok',
                  novelScenario: '新场景',
                  capability: 'guide',
                  proofSatisfied: true,
                },
                v3: {
                  passed: true,
                  reason: 'ok',
                  differentiators: ['区分点'],
                  proofSatisfied: true,
                },
              },
              overallPassed: true,
              disposition: 'retain',
            },
            {
              candidate: {
                candidateId: 'candidate-2',
                passKey: 'terms',
                title: 'candidate two',
                summary: 'summary',
                reusableRule: 'rule',
                evidenceIds: ['ev-transcript'],
                claimType: 'sourceFact',
                visualAssertion: false,
              },
              validation: {
                v1: {
                  passed: true,
                  reason: 'ok',
                  reusableContexts: ['场景一', '场景二'],
                  proofSatisfied: true,
                },
                v2: {
                  passed: true,
                  reason: 'ok',
                  novelScenario: '新场景',
                  capability: 'guide',
                  proofSatisfied: true,
                },
                v3: {
                  passed: true,
                  reason: 'ok',
                  differentiators: ['区分点'],
                  proofSatisfied: true,
                },
              },
              overallPassed: true,
              disposition: 'retain',
            },
          ],
          evidenceIds: ['ev-transcript', 'ev-frame'],
        },
      ),
    ).toThrowError('INVALID_MULTIMODAL_CONTRACT');
  });

  it('rejects direct candidate-pass extra keys, sparse arrays, over-limit payloads, and cross-pass duplicate ids', () => {
    expect(() =>
      parseCandidatePasses(
        {
          frameworks: [
            {
              candidateId: 'candidate-extra',
              passKey: 'frameworks',
              title: 'extra key',
              summary: 'summary',
              reusableRule: 'rule',
              evidenceIds: ['ev-transcript'],
              claimType: 'modelInference',
              visualAssertion: false,
              extraKey: true,
            },
          ],
          principles: [],
          cases: [],
          counterexamples: [],
          terms: [],
        },
        {
          evidenceIds: ['ev-transcript', 'ev-frame'],
          frameEvidenceIds: ['ev-frame'],
        },
      ),
    ).toThrowError('INVALID_MULTIMODAL_CONTRACT');

    const sparseFrameworks = new Array(2);
    sparseFrameworks[0] = {
      candidateId: 'candidate-sparse',
      passKey: 'frameworks',
      title: 'sparse',
      summary: 'summary',
      reusableRule: 'rule',
      evidenceIds: ['ev-transcript'],
      claimType: 'modelInference',
      visualAssertion: false,
    };
    expect(() =>
      parseCandidatePasses(
        {
          frameworks: sparseFrameworks,
          principles: [],
          cases: [],
          counterexamples: [],
          terms: [],
        },
        {
          evidenceIds: ['ev-transcript', 'ev-frame'],
          frameEvidenceIds: ['ev-frame'],
        },
      ),
    ).toThrowError('INVALID_MULTIMODAL_CONTRACT');

    expect(() =>
      parseCandidatePasses(
        {
          frameworks: new Array(25).fill(null).map((_, index) => ({
            candidateId: `candidate-over-${index}`,
            passKey: 'frameworks',
            title: 'over',
            summary: 'summary',
            reusableRule: 'rule',
            evidenceIds: ['ev-transcript'],
            claimType: 'modelInference',
            visualAssertion: false,
          })),
          principles: [],
          cases: [],
          counterexamples: [],
          terms: [],
        },
        {
          evidenceIds: ['ev-transcript', 'ev-frame'],
          frameEvidenceIds: ['ev-frame'],
        },
      ),
    ).toThrowError('INVALID_MULTIMODAL_CONTRACT');

    expect(() =>
      parseCandidatePasses(
        {
          frameworks: [
            {
              candidateId: 'candidate-dup',
              passKey: 'frameworks',
              title: 'dup-1',
              summary: 'summary',
              reusableRule: 'rule',
              evidenceIds: ['ev-transcript'],
              claimType: 'modelInference',
              visualAssertion: false,
            },
          ],
          principles: [
            {
              candidateId: 'candidate-dup',
              passKey: 'principles',
              title: 'dup-2',
              summary: 'summary',
              reusableRule: 'rule',
              evidenceIds: ['ev-transcript'],
              claimType: 'modelInference',
              visualAssertion: false,
            },
          ],
          cases: [],
          counterexamples: [],
          terms: [],
        },
        {
          evidenceIds: ['ev-transcript', 'ev-frame'],
          frameEvidenceIds: ['ev-frame'],
        },
      ),
    ).toThrowError('INVALID_MULTIMODAL_CONTRACT');
  });

  it('normalizes missing pendingUpload to null and accepts a canonical pending upload state', () => {
    const minimal = parseMultimodalSessionState({
      schemaVersion: 1,
      primarySource: null,
      transcript: {
        status: 'pending',
        editable: true,
        segments: [],
      },
      evidenceTimeline: {
        evidenceItems: [],
      },
      candidatePasses: {
        frameworks: [],
        principles: [],
        cases: [],
        counterexamples: [],
        terms: [],
      },
      candidatePassMeta: null,
    });

    expect(minimal.pendingUpload).toBeNull();

    const pending = parseMultimodalSessionState({
      schemaVersion: 1,
      primarySource: null,
      transcript: {
        status: 'pending',
        editable: true,
        segments: [],
      },
      evidenceTimeline: {
        evidenceItems: [],
      },
      candidatePasses: {
        frameworks: [],
        principles: [],
        cases: [],
        counterexamples: [],
        terms: [],
      },
      candidatePassMeta: null,
      pendingUpload: {
        sourceId: 'source-upload-1',
        mediaKind: 'video',
        fileName: 'lesson.mp4',
        declaredMimeType: 'video/mp4',
        sizeBytes: 1024,
        uploadMode: 'single_put',
        materialStatus: 'uploading',
        verification: null,
        objectKey:
          'skill-sessions/101/source/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.mp4',
        idempotencyKey: 'upload-intent-001',
        requestHash: 'a'.repeat(64),
        intentClaimsHash: 'b'.repeat(64),
        intentRevisionNo: 1,
        expiresAt: '2026-08-22T10:00:00.000Z',
      },
    });

    expect(pending.pendingUpload).toMatchObject({
      sourceId: 'source-upload-1',
      mediaKind: 'video',
      fileName: 'lesson.mp4',
      declaredMimeType: 'video/mp4',
      sizeBytes: 1024,
      uploadMode: 'single_put',
      materialStatus: 'uploading',
      verification: null,
      intentRevisionNo: 1,
    });

    const multipartPending = parseMultimodalSessionState({
      schemaVersion: 1,
      primarySource: null,
      transcript: {
        status: 'pending',
        editable: true,
        segments: [],
      },
      evidenceTimeline: {
        evidenceItems: [],
      },
      candidatePasses: {
        frameworks: [],
        principles: [],
        cases: [],
        counterexamples: [],
        terms: [],
      },
      candidatePassMeta: null,
      pendingUpload: {
        sourceId: 'source-upload-1',
        mediaKind: 'video',
        fileName: 'lesson.mp4',
        declaredMimeType: 'video/mp4',
        sizeBytes: 1024,
        uploadMode: 'multipart',
        materialStatus: 'uploading',
        verification: null,
        objectKey:
          'skill-sessions/101/source/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.mp4',
        idempotencyKey: 'upload-intent-001',
        requestHash: 'a'.repeat(64),
        intentClaimsHash: 'b'.repeat(64),
        intentRevisionNo: 1,
        expiresAt: '2026-08-22T10:00:00.000Z',
        multipartUploadId: 'multipart-upload-123',
        partSizeBytes: 5 * 1024 * 1024,
        partCount: 3,
      },
    });

    expect(multipartPending.pendingUpload).toMatchObject({
      uploadMode: 'multipart',
      materialStatus: 'uploading',
      verification: null,
      multipartUploadId: 'multipart-upload-123',
      partSizeBytes: 5 * 1024 * 1024,
      partCount: 3,
    });
  });

  it('rejects pendingUpload drift, extra keys, and non-empty sourceless upload state', () => {
    expect(() =>
      parseMultimodalSessionState({
        schemaVersion: 1,
        primarySource: null,
        transcript: {
          status: 'pending',
          editable: true,
          segments: [],
        },
        evidenceTimeline: {
          evidenceItems: [],
        },
        candidatePasses: {
          frameworks: [],
          principles: [],
          cases: [],
          counterexamples: [],
          terms: [],
        },
        candidatePassMeta: null,
        pendingUpload: {
          sourceId: 'source-upload-1',
          mediaKind: 'video',
          fileName: 'lesson.mp4',
          declaredMimeType: 'video/mp4',
          sizeBytes: 1024,
          uploadMode: 'single_put',
          materialStatus: 'uploading',
          verification: null,
          objectKey:
            'skill-sessions/101/source/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.mp4',
          idempotencyKey: 'upload-intent-001',
          requestHash: 'a'.repeat(64),
          intentClaimsHash: 'b'.repeat(64),
          intentRevisionNo: 1,
          expiresAt: '2026-08-22T10:00:00.000Z',
          extra: true,
        },
      }),
    ).toThrowError('INVALID_MULTIMODAL_CONTRACT');

    expect(() =>
      parseMultimodalSessionState({
        schemaVersion: 1,
        primarySource: null,
        transcript: {
          status: 'pending',
          editable: true,
          segments: [],
        },
        evidenceTimeline: {
          evidenceItems: [],
        },
        candidatePasses: {
          frameworks: [],
          principles: [],
          cases: [],
          counterexamples: [],
          terms: [],
        },
        candidatePassMeta: null,
        pendingUpload: {
          sourceId: 'source-upload-1',
          mediaKind: 'video',
          fileName: 'lesson.mp4',
          declaredMimeType: 'video/mp4',
          sizeBytes: 1024,
          uploadMode: 'single_put',
          materialStatus: 'uploading',
          verification: null,
          objectKey:
            'skill-sessions/101/source/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.mp4',
          idempotencyKey: 'upload-intent-001',
          requestHash: 'a'.repeat(64),
          intentClaimsHash: 'b'.repeat(64),
          intentRevisionNo: 1,
          expiresAt: '2026-08-22T10:00:00.000Z',
          multipartUploadId: 'multipart-upload-123',
          partSizeBytes: 8 * 1024 * 1024,
          partCount: 3,
        },
      }),
    ).toThrowError('INVALID_MULTIMODAL_CONTRACT');

    expect(() =>
      parseMultimodalSessionState({
        schemaVersion: 1,
        primarySource: null,
        transcript: {
          status: 'pending',
          editable: true,
          segments: [],
        },
        evidenceTimeline: {
          evidenceItems: [],
        },
        candidatePasses: {
          frameworks: [],
          principles: [],
          cases: [],
          counterexamples: [],
          terms: [],
        },
        candidatePassMeta: null,
        pendingUpload: {
          sourceId: 'source-upload-1',
          mediaKind: 'video',
          fileName: 'lesson.mp4',
          declaredMimeType: 'video/mp4',
          sizeBytes: 1024,
          uploadMode: 'multipart',
          materialStatus: 'uploading',
          verification: null,
          objectKey:
            'skill-sessions/101/source/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.mp4',
          idempotencyKey: 'upload-intent-001',
          requestHash: 'a'.repeat(64),
          intentClaimsHash: 'b'.repeat(64),
          intentRevisionNo: 1,
          expiresAt: '2026-08-22T10:00:00.000Z',
        },
      }),
    ).toThrowError('INVALID_MULTIMODAL_CONTRACT');

    expect(() =>
      parseMultimodalSessionState({
        schemaVersion: 1,
        primarySource: null,
        transcript: {
          status: 'pending',
          editable: true,
          segments: [
            {
              startMs: 0,
              endMs: 1000,
              text: '漂移转录',
            },
          ],
        },
        evidenceTimeline: {
          evidenceItems: [],
        },
        candidatePasses: {
          frameworks: [],
          principles: [],
          cases: [],
          counterexamples: [],
          terms: [],
        },
        candidatePassMeta: null,
        pendingUpload: {
          sourceId: 'source-upload-1',
          mediaKind: 'video',
          fileName: 'lesson.mp4',
          declaredMimeType: 'video/mp4',
          sizeBytes: 1024,
          uploadMode: 'single_put',
          materialStatus: 'uploading',
          verification: null,
          objectKey:
            'skill-sessions/101/source/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.mp4',
          idempotencyKey: 'upload-intent-001',
          requestHash: 'a'.repeat(64),
          intentClaimsHash: 'b'.repeat(64),
          intentRevisionNo: 1,
          expiresAt: '2026-08-22T10:00:00.000Z',
        },
      }),
    ).toThrowError('INVALID_MULTIMODAL_CONTRACT');

    expect(() =>
      parseMultimodalSessionState({
        schemaVersion: 1,
        primarySource: null,
        transcript: {
          status: 'pending',
          editable: true,
          segments: [],
        },
        evidenceTimeline: {
          evidenceItems: [],
        },
        candidatePasses: {
          frameworks: [],
          principles: [],
          cases: [],
          counterexamples: [],
          terms: [],
        },
        candidatePassMeta: null,
        pendingUpload: {
          sourceId: 'source-upload-1',
          mediaKind: 'video',
          fileName: 'lesson.mp4',
          declaredMimeType: 'video/mp4',
          sizeBytes: 1024,
          uploadMode: 'single_put',
          materialStatus: 'uploading',
          verification: null,
          expiresAt: '2026-08-22T10:00:00.000Z',
        },
      }),
    ).toThrowError('INVALID_MULTIMODAL_CONTRACT');
  });

  it('accepts strict pendingUpload material status variants', () => {
    const singleVerifying = parseMultimodalSessionState({
      schemaVersion: 1,
      primarySource: null,
      transcript: {
        status: 'pending',
        editable: true,
        segments: [],
      },
      evidenceTimeline: {
        evidenceItems: [],
      },
      candidatePasses: {
        frameworks: [],
        principles: [],
        cases: [],
        counterexamples: [],
        terms: [],
      },
      candidatePassMeta: null,
      pendingUpload: {
        sourceId: 'source-upload-1',
        mediaKind: 'video',
        fileName: 'lesson.mp4',
        declaredMimeType: 'video/mp4',
        sizeBytes: 1024,
        uploadMode: 'single_put',
        materialStatus: 'verifying',
        verification: {
          jobId: 'job-123',
          idempotencyKey: 'confirm-upload-123',
          requestHash: 'c'.repeat(64),
          observedSizeBytes: 1024,
          observedContentType: 'video/mp4',
          confirmedAt: '2026-08-22T10:03:00.000Z',
        },
        objectKey:
          'skill-sessions/101/source/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.mp4',
        idempotencyKey: 'upload-intent-001',
        requestHash: 'a'.repeat(64),
        intentClaimsHash: 'b'.repeat(64),
        intentRevisionNo: 1,
        expiresAt: '2026-08-22T10:00:00.000Z',
      },
      operationReceipts: [
        {
          action: 'skill.media.upload.confirm' as const,
          idempotencyKey: 'confirm-upload-123',
          requestHash: 'c'.repeat(64),
          baseRevisionNo: 1,
          resultRevisionNo: 2,
          confirmedStage: 'uploading' as const,
          recordedAt: '2026-08-22T10:03:00.000Z',
        },
      ],
    });

    expect(singleVerifying.pendingUpload).toMatchObject({
      uploadMode: 'single_put',
      materialStatus: 'verifying',
      verification: {
        jobId: 'job-123',
        idempotencyKey: 'confirm-upload-123',
        requestHash: 'c'.repeat(64),
        observedSizeBytes: 1024,
        observedContentType: 'video/mp4',
        confirmedAt: '2026-08-22T10:03:00.000Z',
      },
    });

    const multipartVerifying = parseMultimodalSessionState({
      schemaVersion: 1,
      primarySource: null,
      transcript: {
        status: 'pending',
        editable: true,
        segments: [],
      },
      evidenceTimeline: {
        evidenceItems: [],
      },
      candidatePasses: {
        frameworks: [],
        principles: [],
        cases: [],
        counterexamples: [],
        terms: [],
      },
      candidatePassMeta: null,
      pendingUpload: {
        sourceId: 'source-upload-1',
        mediaKind: 'video',
        fileName: 'lesson.mp4',
        declaredMimeType: 'video/mp4',
        sizeBytes: 1024,
        uploadMode: 'multipart',
        materialStatus: 'verifying',
        verification: {
          jobId: 'job-456',
          idempotencyKey: 'confirm-upload-456',
          requestHash: 'd'.repeat(64),
          observedSizeBytes: 1024,
          observedContentType: 'video/mp4',
          confirmedAt: '2026-08-22T10:04:00.000Z',
        },
        objectKey:
          'skill-sessions/101/source/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.mp4',
        idempotencyKey: 'upload-intent-001',
        requestHash: 'a'.repeat(64),
        intentClaimsHash: 'b'.repeat(64),
        intentRevisionNo: 1,
        expiresAt: '2026-08-22T10:00:00.000Z',
        multipartUploadId: 'multipart-upload-123',
        partSizeBytes: 5 * 1024 * 1024,
        partCount: 3,
      },
      operationReceipts: [
        {
          action: 'skill.media.upload.confirm' as const,
          idempotencyKey: 'confirm-upload-456',
          requestHash: 'd'.repeat(64),
          baseRevisionNo: 1,
          resultRevisionNo: 2,
          confirmedStage: 'uploading' as const,
          recordedAt: '2026-08-22T10:04:00.000Z',
        },
      ],
    });

    expect(multipartVerifying.pendingUpload).toMatchObject({
      uploadMode: 'multipart',
      materialStatus: 'verifying',
      multipartUploadId: 'multipart-upload-123',
      partSizeBytes: 5 * 1024 * 1024,
      partCount: 3,
      verification: {
        jobId: 'job-456',
        idempotencyKey: 'confirm-upload-456',
        requestHash: 'd'.repeat(64),
        observedSizeBytes: 1024,
        observedContentType: 'video/mp4',
        confirmedAt: '2026-08-22T10:04:00.000Z',
      },
    });
  });

  it('rejects uploading + verification as an illegal state', () => {
    const baseState = {
      schemaVersion: 1,
      primarySource: null,
      transcript: { status: 'pending', editable: true, segments: [] },
      evidenceTimeline: { evidenceItems: [] },
      candidatePasses: {
        frameworks: [],
        principles: [],
        cases: [],
        counterexamples: [],
        terms: [],
      },
      candidatePassMeta: null,
    };

    const validVerification = {
      jobId: 'job-quality-1',
      idempotencyKey: 'upload-confirm-001',
      requestHash: 'c'.repeat(64),
      observedSizeBytes: 1024,
      observedContentType: 'video/mp4',
      confirmedAt: '2026-08-22T10:00:00.000Z',
    };

    expect(() =>
      parseMultimodalSessionState({
        ...baseState,
        pendingUpload: {
          sourceId: 'source-upload-1',
          mediaKind: 'video',
          fileName: 'lesson.mp4',
          declaredMimeType: 'video/mp4',
          sizeBytes: 1024,
          uploadMode: 'single_put',
          materialStatus: 'uploading',
          verification: validVerification,
          objectKey:
            'skill-sessions/101/source/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.mp4',
          idempotencyKey: 'upload-intent-001',
          requestHash: 'a'.repeat(64),
          intentClaimsHash: 'b'.repeat(64),
          intentRevisionNo: 1,
          expiresAt: '2026-08-22T10:00:00.000Z',
        },
      }),
    ).toThrowError('INVALID_MULTIMODAL_CONTRACT');
  });

  it('accepts verifying + matching upload confirm receipt', () => {
    const baseState = {
      schemaVersion: 1,
      primarySource: null,
      transcript: { status: 'pending', editable: true, segments: [] },
      evidenceTimeline: { evidenceItems: [] },
      candidatePasses: {
        frameworks: [],
        principles: [],
        cases: [],
        counterexamples: [],
        terms: [],
      },
      candidatePassMeta: null,
    };

    const verification = {
      jobId: 'job-quality-1',
      idempotencyKey: 'upload-confirm-001',
      requestHash: 'c'.repeat(64),
      observedSizeBytes: 1024,
      observedContentType: 'video/mp4',
      confirmedAt: '2026-08-22T10:00:00.000Z',
    };

    const uploadReceipt = {
      action: 'skill.media.upload.confirm' as const,
      idempotencyKey: verification.idempotencyKey,
      requestHash: verification.requestHash,
      baseRevisionNo: 1,
      resultRevisionNo: 2,
      confirmedStage: 'uploading' as const,
      recordedAt: verification.confirmedAt,
    };

    const result = parseMultimodalSessionState({
      ...baseState,
      pendingUpload: {
        sourceId: 'source-upload-1',
        mediaKind: 'video',
        fileName: 'lesson.mp4',
        declaredMimeType: 'video/mp4',
        sizeBytes: 1024,
        uploadMode: 'single_put',
        materialStatus: 'verifying',
        verification,
        objectKey:
          'skill-sessions/101/source/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.mp4',
        idempotencyKey: 'upload-intent-001',
        requestHash: 'a'.repeat(64),
        intentClaimsHash: 'b'.repeat(64),
        intentRevisionNo: 1,
        expiresAt: '2026-08-22T10:00:00.000Z',
      },
      operationReceipts: [uploadReceipt],
    });

    expect(result.pendingUpload).toMatchObject({
      uploadMode: 'single_put',
      materialStatus: 'verifying',
      verification: {
        jobId: 'job-quality-1',
        idempotencyKey: 'upload-confirm-001',
        requestHash: 'c'.repeat(64),
        observedSizeBytes: 1024,
        observedContentType: 'video/mp4',
        confirmedAt: '2026-08-22T10:00:00.000Z',
      },
    });
    expect(result.operationReceipts).toEqual([uploadReceipt]);
  });

  it('rejects verifying + mismatched upload confirm receipt', () => {
    const baseState = {
      schemaVersion: 1,
      primarySource: null,
      transcript: { status: 'pending', editable: true, segments: [] },
      evidenceTimeline: { evidenceItems: [] },
      candidatePasses: {
        frameworks: [],
        principles: [],
        cases: [],
        counterexamples: [],
        terms: [],
      },
      candidatePassMeta: null,
    };

    const verification = {
      jobId: 'job-quality-1',
      idempotencyKey: 'upload-confirm-001',
      requestHash: 'c'.repeat(64),
      observedSizeBytes: 1024,
      observedContentType: 'video/mp4',
      confirmedAt: '2026-08-22T10:00:00.000Z',
    };

    const makeState = (receiptOverrides: Partial<Record<string, unknown>>) => ({
      ...baseState,
      pendingUpload: {
        sourceId: 'source-upload-1',
        mediaKind: 'video',
        fileName: 'lesson.mp4',
        declaredMimeType: 'video/mp4',
        sizeBytes: 1024,
        uploadMode: 'single_put',
        materialStatus: 'verifying',
        verification,
        objectKey:
          'skill-sessions/101/source/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.mp4',
        idempotencyKey: 'upload-intent-001',
        requestHash: 'a'.repeat(64),
        intentClaimsHash: 'b'.repeat(64),
        intentRevisionNo: 1,
        expiresAt: '2026-08-22T10:00:00.000Z',
      },
      operationReceipts: [
        {
          action: 'skill.media.upload.confirm' as const,
          idempotencyKey: verification.idempotencyKey,
          requestHash: verification.requestHash,
          baseRevisionNo: 1,
          resultRevisionNo: 2,
          confirmedStage: 'uploading' as const,
          recordedAt: verification.confirmedAt,
          ...receiptOverrides,
        },
      ],
    });

    expect(() =>
      parseMultimodalSessionState(makeState({ idempotencyKey: 'wrong-key' })),
    ).toThrowError('INVALID_MULTIMODAL_CONTRACT');

    expect(() =>
      parseMultimodalSessionState(makeState({ requestHash: 'd'.repeat(64) })),
    ).toThrowError('INVALID_MULTIMODAL_CONTRACT');

    expect(() =>
      parseMultimodalSessionState(makeState({ baseRevisionNo: 99 })),
    ).toThrowError('INVALID_MULTIMODAL_CONTRACT');

    expect(() =>
      parseMultimodalSessionState(makeState({ resultRevisionNo: 99 })),
    ).toThrowError('INVALID_MULTIMODAL_CONTRACT');

    expect(() =>
      parseMultimodalSessionState(
        makeState({ recordedAt: '2025-01-01T00:00:00.000Z' }),
      ),
    ).toThrowError('INVALID_MULTIMODAL_CONTRACT');
  });

  it('rejects verifying with wrong receipt count or wrong receipt type', () => {
    const baseState = {
      schemaVersion: 1,
      primarySource: null,
      transcript: { status: 'pending', editable: true, segments: [] },
      evidenceTimeline: { evidenceItems: [] },
      candidatePasses: {
        frameworks: [],
        principles: [],
        cases: [],
        counterexamples: [],
        terms: [],
      },
      candidatePassMeta: null,
    };

    const verification = {
      jobId: 'job-quality-1',
      idempotencyKey: 'upload-confirm-001',
      requestHash: 'c'.repeat(64),
      observedSizeBytes: 1024,
      observedContentType: 'video/mp4',
      confirmedAt: '2026-08-22T10:00:00.000Z',
    };

    const uploadReceipt = {
      action: 'skill.media.upload.confirm' as const,
      idempotencyKey: verification.idempotencyKey,
      requestHash: verification.requestHash,
      baseRevisionNo: 1,
      resultRevisionNo: 2,
      confirmedStage: 'uploading' as const,
      recordedAt: verification.confirmedAt,
    };

    const verifyingPendingUpload = {
      sourceId: 'source-upload-1',
      mediaKind: 'video',
      fileName: 'lesson.mp4',
      declaredMimeType: 'video/mp4',
      sizeBytes: 1024,
      uploadMode: 'single_put',
      materialStatus: 'verifying',
      verification,
      objectKey:
        'skill-sessions/101/source/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.mp4',
      idempotencyKey: 'upload-intent-001',
      requestHash: 'a'.repeat(64),
      intentClaimsHash: 'b'.repeat(64),
      intentRevisionNo: 1,
      expiresAt: '2026-08-22T10:00:00.000Z',
    };

    expect(() =>
      parseMultimodalSessionState({
        ...baseState,
        pendingUpload: verifyingPendingUpload,
      }),
    ).toThrowError('INVALID_MULTIMODAL_CONTRACT');

    expect(() =>
      parseMultimodalSessionState({
        ...baseState,
        pendingUpload: verifyingPendingUpload,
        operationReceipts: [uploadReceipt, uploadReceipt],
      }),
    ).toThrowError('INVALID_MULTIMODAL_CONTRACT');

    expect(() =>
      parseMultimodalSessionState({
        ...baseState,
        pendingUpload: {
          ...verifyingPendingUpload,
          materialStatus: 'uploading',
          verification: null,
        },
        operationReceipts: [uploadReceipt],
      }),
    ).toThrowError('INVALID_MULTIMODAL_CONTRACT');

    expect(() =>
      parseMultimodalSessionState({
        ...baseState,
        pendingUpload: verifyingPendingUpload,
        operationReceipts: [
          {
            action: 'skill.media.overview.confirm' as const,
            idempotencyKey: 'overview-key',
            requestHash: 'e'.repeat(64),
            baseRevisionNo: 2,
            resultRevisionNo: 3,
            confirmedStage: 'adler_overview' as const,
            confirmedFields: ['adlerOverview', 'evidenceTimeline'],
            recordedAt: '2026-08-22T11:00:00.000Z',
          },
        ],
      }),
    ).toThrowError('INVALID_MULTIMODAL_CONTRACT');
  });

  it('rejects pendingUpload status and verification mismatches', () => {
    const baseState = {
      schemaVersion: 1,
      primarySource: null,
      transcript: {
        status: 'pending',
        editable: true,
        segments: [],
      },
      evidenceTimeline: {
        evidenceItems: [],
      },
      candidatePasses: {
        frameworks: [],
        principles: [],
        cases: [],
        counterexamples: [],
        terms: [],
      },
      candidatePassMeta: null,
    };

    expect(() =>
      parseMultimodalSessionState({
        ...baseState,
        pendingUpload: {
          sourceId: 'source-upload-1',
          mediaKind: 'video',
          fileName: 'lesson.mp4',
          declaredMimeType: 'video/mp4',
          sizeBytes: 1024,
          uploadMode: 'single_put',
          verification: null,
          objectKey:
            'skill-sessions/101/source/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.mp4',
          idempotencyKey: 'upload-intent-001',
          requestHash: 'a'.repeat(64),
          intentClaimsHash: 'b'.repeat(64),
          intentRevisionNo: 1,
          expiresAt: '2026-08-22T10:00:00.000Z',
        },
      }),
    ).toThrowError('INVALID_MULTIMODAL_CONTRACT');

    expect(() =>
      parseMultimodalSessionState({
        ...baseState,
        pendingUpload: {
          sourceId: 'source-upload-1',
          mediaKind: 'video',
          fileName: 'lesson.mp4',
          declaredMimeType: 'video/mp4',
          sizeBytes: 1024,
          uploadMode: 'single_put',
          materialStatus: 'uploading',
          verification: {
            jobId: 'job-123',
            idempotencyKey: 'confirm-upload-123',
            requestHash: 'c'.repeat(64),
            observedSizeBytes: 1024,
            observedContentType: 'video/mp4',
            confirmedAt: '2026-08-22T10:03:00.000Z',
          },
          objectKey:
            'skill-sessions/101/source/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.mp4',
          idempotencyKey: 'upload-intent-001',
          requestHash: 'a'.repeat(64),
          intentClaimsHash: 'b'.repeat(64),
          intentRevisionNo: 1,
          expiresAt: '2026-08-22T10:00:00.000Z',
        },
      }),
    ).toThrowError('INVALID_MULTIMODAL_CONTRACT');

    expect(() =>
      parseMultimodalSessionState({
        ...baseState,
        pendingUpload: {
          sourceId: 'source-upload-1',
          mediaKind: 'video',
          fileName: 'lesson.mp4',
          declaredMimeType: 'video/mp4',
          sizeBytes: 1024,
          uploadMode: 'single_put',
          materialStatus: 'verifying',
          verification: null,
          objectKey:
            'skill-sessions/101/source/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.mp4',
          idempotencyKey: 'upload-intent-001',
          requestHash: 'a'.repeat(64),
          intentClaimsHash: 'b'.repeat(64),
          intentRevisionNo: 1,
          expiresAt: '2026-08-22T10:00:00.000Z',
        },
      }),
    ).toThrowError('INVALID_MULTIMODAL_CONTRACT');

    expect(() =>
      parseMultimodalSessionState({
        ...baseState,
        pendingUpload: {
          sourceId: 'source-upload-1',
          mediaKind: 'video',
          fileName: 'lesson.mp4',
          declaredMimeType: 'video/mp4',
          sizeBytes: 1024,
          uploadMode: 'single_put',
          materialStatus: 'uploading',
          verification: null,
          objectKey: 'skill-versions/101/visual/asset.png',
          idempotencyKey: 'upload-intent-001',
          requestHash: 'a'.repeat(64),
          intentClaimsHash: 'b'.repeat(64),
          intentRevisionNo: 1,
          expiresAt: '2026-08-22T10:00:00.000Z',
        },
      }),
    ).toThrowError('INVALID_MULTIMODAL_CONTRACT');

    expect(() =>
      parseMultimodalSessionState({
        ...baseState,
        pendingUpload: {
          sourceId: 'source-upload-1',
          mediaKind: 'video',
          fileName: 'lesson.mp4',
          declaredMimeType: 'video/mp4',
          sizeBytes: 1024,
          uploadMode: 'single_put',
          materialStatus: 'uploading',
          verification: null,
          objectKey: 'skill-sessions/101/manifest/upload.json',
          idempotencyKey: 'upload-intent-001',
          requestHash: 'a'.repeat(64),
          intentClaimsHash: 'b'.repeat(64),
          intentRevisionNo: 1,
          expiresAt: '2026-08-22T10:00:00.000Z',
        },
      }),
    ).toThrowError('INVALID_MULTIMODAL_CONTRACT');
  });

  it('rejects pendingUpload verification drift and malformed fields', () => {
    const baseState = {
      schemaVersion: 1,
      primarySource: null,
      transcript: {
        status: 'pending',
        editable: true,
        segments: [],
      },
      evidenceTimeline: {
        evidenceItems: [],
      },
      candidatePasses: {
        frameworks: [],
        principles: [],
        cases: [],
        counterexamples: [],
        terms: [],
      },
      candidatePassMeta: null,
    };

    expect(() =>
      parseMultimodalSessionState({
        ...baseState,
        pendingUpload: {
          sourceId: 'source-upload-1',
          mediaKind: 'video',
          fileName: 'lesson.mp4',
          declaredMimeType: 'video/mp4',
          sizeBytes: 1024,
          uploadMode: 'single_put',
          materialStatus: 'verifying',
          verification: {
            jobId: 'job-123',
            idempotencyKey: 'confirm-upload-123',
            requestHash: 'bad-hash',
            observedSizeBytes: 1024,
            observedContentType: 'video/mp4',
            confirmedAt: '2026-08-22T10:03:00.000Z',
          },
          objectKey:
            'skill-sessions/101/source/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.mp4',
          idempotencyKey: 'upload-intent-001',
          requestHash: 'a'.repeat(64),
          intentClaimsHash: 'b'.repeat(64),
          intentRevisionNo: 1,
          expiresAt: '2026-08-22T10:00:00.000Z',
        },
      }),
    ).toThrowError('INVALID_MULTIMODAL_CONTRACT');

    expect(() =>
      parseMultimodalSessionState({
        ...baseState,
        pendingUpload: {
          sourceId: 'source-upload-1',
          mediaKind: 'video',
          fileName: 'lesson.mp4',
          declaredMimeType: 'video/mp4',
          sizeBytes: 1024,
          uploadMode: 'single_put',
          materialStatus: 'verifying',
          verification: {
            jobId: 'job-123',
            idempotencyKey: 'confirm-upload-123',
            requestHash: 'c'.repeat(64),
            observedSizeBytes: 0,
            observedContentType: 'video/mp4',
            confirmedAt: '2026-08-22T10:03:00.000Z',
          },
          objectKey:
            'skill-sessions/101/source/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.mp4',
          idempotencyKey: 'upload-intent-001',
          requestHash: 'a'.repeat(64),
          intentClaimsHash: 'b'.repeat(64),
          intentRevisionNo: 1,
          expiresAt: '2026-08-22T10:00:00.000Z',
        },
      }),
    ).toThrowError('INVALID_MULTIMODAL_CONTRACT');

    expect(() =>
      parseMultimodalSessionState({
        ...baseState,
        pendingUpload: {
          sourceId: 'source-upload-1',
          mediaKind: 'video',
          fileName: 'lesson.mp4',
          declaredMimeType: 'video/mp4',
          sizeBytes: 1024,
          uploadMode: 'single_put',
          materialStatus: 'verifying',
          verification: {
            jobId: 'job-123',
            idempotencyKey: 'confirm-upload-123',
            requestHash: 'c'.repeat(64),
            observedSizeBytes: 1024,
            observedContentType: 'video/mp4',
            confirmedAt: 'not-iso',
            extra: true,
          },
          objectKey:
            'skill-sessions/101/source/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.mp4',
          idempotencyKey: 'upload-intent-001',
          requestHash: 'a'.repeat(64),
          intentClaimsHash: 'b'.repeat(64),
          intentRevisionNo: 1,
          expiresAt: '2026-08-22T10:00:00.000Z',
        },
      }),
    ).toThrowError('INVALID_MULTIMODAL_CONTRACT');

    expect(() =>
      parseMultimodalSessionState({
        ...baseState,
        pendingUpload: {
          sourceId: 'source-upload-1',
          mediaKind: 'video',
          fileName: 'lesson.mp4',
          declaredMimeType: 'video/mp4',
          sizeBytes: 1024,
          uploadMode: 'multipart',
          materialStatus: 'uploading',
          verification: null,
          objectKey:
            'skill-sessions/101/source/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.mp4',
          idempotencyKey: 'upload-intent-001',
          requestHash: 'a'.repeat(64),
          intentClaimsHash: 'b'.repeat(64),
          intentRevisionNo: 1,
          expiresAt: '2026-08-22T10:00:00.000Z',
          multipartUploadId: 'multipart-upload-123',
          partSizeBytes: 5 * 1024 * 1024 - 1,
          partCount: 3,
        },
      }),
    ).toThrowError('INVALID_MULTIMODAL_CONTRACT');
  });
});
