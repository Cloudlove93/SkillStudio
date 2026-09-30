import { useEffect, useState, type RefObject } from 'react';
import {
  findActiveConversationTurn,
  type ConversationTurn,
} from './conversation-turn-navigation';

type Props = {
  containerRef: RefObject<HTMLDivElement | null>;
  turns: readonly ConversationTurn[];
};

export function ConversationTurnNavigation({ containerRef, turns }: Props) {
  const [activeIndex, setActiveIndex] = useState(turns.length ? 0 : -1);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || turns.length === 0) {
      setActiveIndex(-1);
      return;
    }

    let animationFrame = 0;
    const updateActiveTurn = () => {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(() => {
        const offsets = turns.map((turn) => document.getElementById(turn.id)?.offsetTop ?? 0);
        setActiveIndex(findActiveConversationTurn(
          offsets,
          container.scrollTop,
          container.clientHeight,
        ));
      });
    };

    updateActiveTurn();
    container.addEventListener('scroll', updateActiveTurn, { passive: true });
    window.addEventListener('resize', updateActiveTurn);
    return () => {
      window.cancelAnimationFrame(animationFrame);
      container.removeEventListener('scroll', updateActiveTurn);
      window.removeEventListener('resize', updateActiveTurn);
    };
  }, [containerRef, turns]);

  if (turns.length === 0) return null;

  const jumpToTurn = (turn: ConversationTurn, index: number) => {
    const container = containerRef.current;
    const target = document.getElementById(turn.id);
    if (!container || !target) return;
    setActiveIndex(index);
    container.scrollTo({
      top: Math.max(0, target.offsetTop - 28),
      behavior: 'smooth',
    });
  };

  return (
    <nav className="skill-turn-navigation" aria-label="对话导航">
      {turns.map((turn, index) => (
        <button
          key={turn.id}
          type="button"
          className={index === activeIndex ? 'is-active' : ''}
          aria-label={`跳转到第 ${index + 1} 次提问：${turn.label.slice(0, 30)}`}
          aria-describedby={`${turn.id}-tooltip`}
          onClick={() => jumpToTurn(turn, index)}
        >
          <span id={`${turn.id}-tooltip`} className="skill-turn-tooltip" role="tooltip">
            <b>{index + 1}</b>
            <span>{turn.label}</span>
          </span>
        </button>
      ))}
    </nav>
  );
}
