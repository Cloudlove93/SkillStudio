import { ArrowRight, CheckCircle2, Eye, Library } from 'lucide-react';
import type { MediaSessionDetail } from '../../../api/lite-api';

type CandidateSkill =
  MediaSessionDetail['mediaState']['candidateSkills'][number];

type Props = {
  detail: MediaSessionDetail;
  onOpenSkill: (skill: CandidateSkill) => void;
  onOpenTrial: () => void;
  onOpenRepository: () => void;
};

export function MultimodalReleaseStep(props: Props) {
  const skills = props.detail.mediaState.candidateSkills;
  const published = props.detail.publishedPackage ?? null;

  return (
    <div className="skill-mm-release-step">
      <header>
        <span className="skill-eyebrow">确认生成</span>
        <h2>{published ? 'Skill 已生成' : '确认要加入工作区的 Skill'}</h2>
        <p>
          {published
            ? '已加入工作区并保存到 Skill 仓库，现在可以直接试用。'
            : `将生成 ${skills.length} 个 Skill。确认前可以逐个预览，生成后仍可在仓库中管理。`}
        </p>
      </header>

      {published ? (
        <section className="skill-mm-generation-success" aria-live="polite">
          <div className="skill-mm-success-mark" aria-hidden="true">
            <CheckCircle2 size={24} />
          </div>
          <div className="skill-mm-success-copy">
            <h3>生成完成</h3>
            <p>已加入工作区并保存到 Skill 仓库</p>
            <small>
              共生成 {Object.keys(published.skillVersionIds).length} 个 Skill；
              来源素材和证据会继续保留。
            </small>
          </div>
          <div className="skill-mm-success-actions">
            <button
              type="button"
              className="skill-primary-button"
              onClick={props.onOpenTrial}
            >
              进入工作区试用
              <ArrowRight size={15} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="skill-secondary-button"
              onClick={props.onOpenRepository}
            >
              <Library size={15} aria-hidden="true" />
              进入 Skill 仓库
            </button>
          </div>
        </section>
      ) : (
        <section className="skill-mm-generation-review">
          <header>
            <div>
              <h3>待生成 Skill</h3>
              <span>{skills.length} 个</span>
            </div>
            <p>只保存你刚刚确认的融合主题，不会自动生成新版本。</p>
          </header>
          <ul className="skill-mm-generation-list">
            {skills.map((skill) => (
              <li key={skill.id}>
                <div>
                  <strong>{skill.name}</strong>
                  <p>{skill.description}</p>
                </div>
                <button
                  type="button"
                  className="skill-mm-preview-button"
                  onClick={() => props.onOpenSkill(skill)}
                  aria-label={`预览 ${skill.name}`}
                >
                  <Eye size={15} aria-hidden="true" />
                  预览
                </button>
              </li>
            ))}
          </ul>
          <p className="skill-mm-generation-note">
            确认后会一次写入工作区和 Skill 仓库；素材与证据不会被删除。
          </p>
        </section>
      )}
    </div>
  );
}
