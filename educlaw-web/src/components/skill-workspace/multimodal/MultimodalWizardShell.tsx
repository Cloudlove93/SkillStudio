import type { ReactNode } from 'react';
import { Check } from 'lucide-react';
import {
  MULTIMODAL_WIZARD_STEPS,
  type MultimodalWizardStep,
} from './multimodal-wizard-model';

type Props = {
  title: string;
  description: string;
  statusText: string;
  activeStep: MultimodalWizardStep;
  reviewStep: MultimodalWizardStep;
  onReviewStep: (step: MultimodalWizardStep) => void;
  media: ReactNode;
  children: ReactNode;
  actions: ReactNode;
};

export function MultimodalWizardShell(props: Props) {
  const activeIndex = MULTIMODAL_WIZARD_STEPS.findIndex(
    (step) => step.key === props.activeStep,
  );
  const currentIndex = MULTIMODAL_WIZARD_STEPS.findIndex(
    (step) => step.key === props.reviewStep,
  );
  const currentLabel =
    MULTIMODAL_WIZARD_STEPS[currentIndex]?.label ?? '处理素材';

  return (
    <div className="skill-mm-shell">
      <header className="skill-mm-header">
        <div>
          <span className="skill-eyebrow">多模态 Skill</span>
          <h1>{props.title}</h1>
          <p>{props.description}</p>
        </div>
        <span className="skill-mm-save-status" aria-live="polite">
          {props.statusText}
        </span>
      </header>

      <nav className="skill-mm-navigation" aria-label="创建进度">
        <ol className="skill-mm-steps">
          {MULTIMODAL_WIZARD_STEPS.map((step, index) => {
            const status =
              index === currentIndex
                ? 'current'
                : index < activeIndex
                  ? 'completed'
                  : index === activeIndex
                    ? 'available'
                    : 'future';
            const content = (
              <div className="skill-mm-step-content">
                <span className="skill-mm-step-index" aria-hidden="true">
                  {index < activeIndex ? <Check size={14} /> : index + 1}
                </span>
                <b>{step.label}</b>
                <i className="sr-only">
                  {index < activeIndex
                    ? '已完成'
                    : index === activeIndex
                      ? '当前处理阶段'
                      : '尚未开始'}
                </i>
              </div>
            );

            return (
              <li
                key={step.key}
                data-status={status}
                aria-current={status === 'current' ? 'step' : undefined}
              >
                {index <= activeIndex ? (
                  <button
                    type="button"
                    onClick={() => props.onReviewStep(step.key)}
                  >
                    {content}
                  </button>
                ) : (
                  <div className="skill-mm-step-content">{content}</div>
                )}
              </li>
            );
          })}
        </ol>
        <p className="skill-mm-mobile-step">
          第 {currentIndex + 1}/4 步 · {currentLabel}
        </p>
      </nav>

      <div className="skill-mm-main">
        <aside className="skill-mm-media">{props.media}</aside>
        <section className="skill-mm-task">{props.children}</section>
      </div>

      <footer className="skill-mm-actionbar">{props.actions}</footer>
    </div>
  );
}
