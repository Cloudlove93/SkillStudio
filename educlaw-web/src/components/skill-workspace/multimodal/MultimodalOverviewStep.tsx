import type { AdlerLayerKey } from '@educlaw/shared';
import type { MediaSessionDetail } from '../../../api/lite-api';
import { ADLER_LAYER_LABELS } from './multimodal-wizard-model';

type AdlerOverview = NonNullable<
  MediaSessionDetail['mediaState']['adlerOverview']
>;

type Props = {
  overview: AdlerOverview;
  notes: string;
  busy: boolean;
  onNotesChange: (value: string) => void;
  onSelectEvidence: (evidenceIds: string[]) => void;
  onExpandLayer: (layer: AdlerLayerKey) => void;
};

export function MultimodalOverviewStep(props: Props) {
  const layers = Object.keys(props.overview.overview) as AdlerLayerKey[];

  return (
    <div className="skill-mm-overview-step">
      <header>
        <span className="skill-eyebrow">确认内容</span>
        <h2>这段课堂素材讲了什么</h2>
        <p>先核对模型整理的结论。点击任意结论，左侧会显示对应视频和证据。</p>
      </header>

      <div className="skill-mm-overview-layers">
        {layers.map((layer) => {
          const statements = props.overview.overview[layer];
          return (
            <section key={layer} className="skill-mm-overview-layer">
              <header>
                <h3>{ADLER_LAYER_LABELS[layer]}</h3>
                <span>{statements.length} 条结论</span>
              </header>
              <div>
                {statements.slice(0, 1).map((statement, index) => (
                  <button
                    type="button"
                    key={layer + '-' + index}
                    onClick={() =>
                      props.onSelectEvidence(statement.evidenceIds)
                    }
                  >
                    <span>{statement.text}</span>
                    <small>{statement.evidenceIds.length} 条支撑证据</small>
                  </button>
                ))}
              </div>
              {statements.length > 1 && (
                <button
                  type="button"
                  className="skill-text-button"
                  onClick={() => props.onExpandLayer(layer)}
                >
                  查看全部 {statements.length} 条
                </button>
              )}
            </section>
          );
        })}
      </div>

      <details className="skill-mm-review-notes">
        <summary>添加确认意见（可选）</summary>
        <textarea
          name="multimodal-review-notes"
          autoComplete="off"
          aria-label="本次确认意见"
          value={props.notes}
          onChange={(event) => props.onNotesChange(event.target.value)}
          placeholder="记录需要保留的修订意见"
          maxLength={4_000}
          disabled={props.busy}
        />
      </details>
    </div>
  );
}
