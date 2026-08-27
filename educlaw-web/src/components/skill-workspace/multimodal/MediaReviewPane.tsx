import type { MultimodalEvidence } from '@educlaw/shared';
import { FileAudio, FileText, FileVideo, Images } from 'lucide-react';
import { EVIDENCE_KIND_LABELS } from './multimodal-wizard-model';
import type { EvidenceAlignmentRelation } from '../multimodal-guided-creation-state';

type Props = {
  hasVisualTrack: boolean;
  previewUrl: string | null;
  playerTimeMs: number;
  visibleEvidence: MultimodalEvidence[];
  evidenceRelation: EvidenceAlignmentRelation | 'selected';
  onPlayerElement: (node: HTMLVideoElement | HTMLAudioElement | null) => void;
  onTimeUpdate: (timeMs: number) => void;
  onSeek: (timeMs: number) => void;
  onOpenTranscript: () => void;
  onOpenEvidence: () => void;
};

function formatTime(value: number) {
  const seconds = Math.max(0, Math.floor(value / 1_000));
  return (
    String(Math.floor(seconds / 60)) +
    ':' +
    String(seconds % 60).padStart(2, '0')
  );
}

export function MediaReviewPane(props: Props) {
  const evidenceHeading =
    props.evidenceRelation === 'selected'
      ? '所选结论的证据'
      : props.evidenceRelation === 'upcoming'
        ? '即将出现的证据'
        : props.evidenceRelation === 'recent'
          ? '最近的证据'
          : '当前时间的证据';

  return (
    <div className="skill-mm-review-pane">
      <header>
        <h2>
          {props.hasVisualTrack ? (
            <FileVideo size={17} aria-hidden="true" />
          ) : (
            <FileAudio size={17} aria-hidden="true" />
          )}
          {props.hasVisualTrack ? '视频回放' : '音频回放'}
        </h2>
        <span>{formatTime(props.playerTimeMs)}</span>
      </header>

      {props.previewUrl ? (
        props.hasVisualTrack ? (
          <video
            ref={props.onPlayerElement}
            controls
            aria-label="课堂视频回放"
            preload="metadata"
            src={props.previewUrl}
            onTimeUpdate={(event) =>
              props.onTimeUpdate(event.currentTarget.currentTime * 1_000)
            }
          />
        ) : (
          <audio
            ref={props.onPlayerElement}
            controls
            aria-label="课堂音频回放"
            preload="metadata"
            src={props.previewUrl}
            onTimeUpdate={(event) =>
              props.onTimeUpdate(event.currentTarget.currentTime * 1_000)
            }
          />
        )
      ) : (
        <p className="skill-media-muted">正在取得短期预览授权…</p>
      )}

      {!props.hasVisualTrack && (
        <p className="skill-mm-audio-note">
          纯音频素材零关键帧是正常结果，证据以转录和音频时间段为主。
        </p>
      )}

      <section className="skill-mm-now-evidence">
        <div>
          <h3>{evidenceHeading}</h3>
          <span>{props.visibleEvidence.length} 条</span>
        </div>
        {props.visibleEvidence.length ? (
          props.visibleEvidence.map((item) => (
            <button
              type="button"
              key={item.evidenceId}
              onClick={() => props.onSeek(item.timeRange.startMs)}
            >
              <span>{EVIDENCE_KIND_LABELS[item.kind]}</span>
              <p>{item.text}</p>
              <small>
                {formatTime(item.timeRange.startMs)}–
                {formatTime(item.timeRange.endMs)}
              </small>
            </button>
          ))
        ) : (
          <p className="skill-media-muted">
            播放视频或选择右侧结论，即可查看对应证据。
          </p>
        )}
      </section>

      <footer>
        <button
          type="button"
          className="skill-secondary-button"
          onClick={props.onOpenTranscript}
        >
          <FileText size={14} aria-hidden="true" />
          完整转录
        </button>
        <button
          type="button"
          className="skill-secondary-button"
          onClick={props.onOpenEvidence}
        >
          <Images size={14} aria-hidden="true" />
          证据库
        </button>
      </footer>
    </div>
  );
}
