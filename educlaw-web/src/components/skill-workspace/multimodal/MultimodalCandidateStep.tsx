import { useEffect, useState } from 'react';
import type { MultimodalCandidateSuggestion } from '@educlaw/shared';
import type { MediaSessionDetail } from '../../../api/lite-api';
import { paginateMultimodalItems } from './multimodal-wizard-model';

type CandidateValidation =
  MediaSessionDetail['mediaState']['candidateValidations'][number];

export type MultimodalCandidateCardItem = {
  passKey: string;
  candidate: MultimodalCandidateSuggestion;
  validation: CandidateValidation | null;
};

export type FusedTopicCardItem = {
  fused: MultimodalCandidateCardItem;
  mergedSources: MultimodalCandidateCardItem[];
};

type Props = {
  topics: FusedTopicCardItem[];
  selectedCandidateIds: string[];
  selectionLimit: number;
  onToggle: (candidateId: string, checked: boolean) => void;
  onEditTopic: (candidate: MultimodalCandidateSuggestion) => void;
};

export function MultimodalCandidateStep(props: Props) {
  const [page, setPage] = useState(1);
  const pageResult = paginateMultimodalItems(props.topics, page, 6);

  useEffect(() => {
    if (page !== pageResult.page) setPage(pageResult.page);
  }, [page, pageResult.page]);

  return (
    <div className="skill-mm-candidates">
      <header>
        <div>
          <span className="skill-eyebrow">选择融合主题</span>
          <h2>确认由原子候选融合而成的教学主题</h2>
          <p>
            同类的原子候选已按教学任务合并为少量主题，每个主题将构建一个
            Skill。可调整主题标题与简介后再确认。
          </p>
        </div>
        <strong className="skill-mm-selection-count">
          已选择 {props.selectedCandidateIds.length}/{props.topics.length}
        </strong>
      </header>

      <div className="skill-mm-candidate-grid">
        {pageResult.items.map(({ fused, mergedSources }) => {
          const selected = props.selectedCandidateIds.includes(
            fused.candidate.candidateId,
          );
          const selectionFull =
            !selected &&
            props.selectedCandidateIds.length >= props.selectionLimit;
          const disabled = selectionFull;

          return (
            <article
              key={fused.candidate.candidateId}
              data-selected={selected}
              data-valid="true"
            >
              <label>
                <input
                  type="checkbox"
                  name="selected-multimodal-topic"
                  value={fused.candidate.candidateId}
                  checked={selected}
                  disabled={disabled}
                  onChange={(event) =>
                    props.onToggle(
                      fused.candidate.candidateId,
                      event.target.checked,
                    )
                  }
                />
                <span>融合主题</span>
              </label>
              <h3>{fused.candidate.title}</h3>
              <p>{fused.candidate.summary}</p>
              <small>
                {fused.candidate.evidenceIds.length} 条证据 · 融合自{' '}
                {mergedSources.length} 条原子候选
              </small>
              <div className="skill-mm-topic-actions">
                <button
                  type="button"
                  className="skill-text-button"
                  onClick={() => props.onEditTopic(fused.candidate)}
                >
                  查看详情与来源
                </button>
              </div>
            </article>
          );
        })}
      </div>

      <nav className="skill-mm-pagination" aria-label="融合主题分页">
        <button
          type="button"
          className="skill-secondary-button"
          disabled={pageResult.page === 1}
          onClick={() => setPage(pageResult.page - 1)}
        >
          上一页
        </button>
        <span>
          {pageResult.page}/{pageResult.pageCount}
        </span>
        <button
          type="button"
          className="skill-secondary-button"
          disabled={page === pageResult.pageCount}
          onClick={() => setPage(pageResult.page + 1)}
        >
          下一页
        </button>
      </nav>
    </div>
  );
}
