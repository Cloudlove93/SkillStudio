import { strict as assert } from 'node:assert';
import test from 'node:test';

import { resolveRubricManualEditContent } from './rubric-edit-state.ts';

test('resolveRubricManualEditContent prefers explicit seed content', () => {
  const content = resolveRubricManualEditContent({
    seedContent: 'seed rubric',
    storedRubric: 'stored rubric',
    displayRubric: 'display rubric',
    fallbackTemplate: 'template rubric',
  });

  assert.equal(content, 'seed rubric');
});

test('resolveRubricManualEditContent prefers stored rubric over display rubric', () => {
  const content = resolveRubricManualEditContent({
    seedContent: '',
    storedRubric: '# Rubric\n\n## 原始 rubric 要点\n5、评价准则',
    displayRubric: '5、评价准则',
    fallbackTemplate: 'template rubric',
  });

  assert.equal(content, '# Rubric\n\n## 原始 rubric 要点\n5、评价准则');
});

test('resolveRubricManualEditContent falls back to display then template', () => {
  const fromDisplay = resolveRubricManualEditContent({
    seedContent: '',
    storedRubric: '',
    displayRubric: 'display rubric',
    fallbackTemplate: 'template rubric',
  });
  const fromTemplate = resolveRubricManualEditContent({
    seedContent: '',
    storedRubric: '',
    displayRubric: '',
    fallbackTemplate: 'template rubric',
  });

  assert.equal(fromDisplay, 'display rubric');
  assert.equal(fromTemplate, 'template rubric');
});

test('resolveRubricManualEditContent ignores object-like seed content and keeps stored rubric', () => {
  const content = resolveRubricManualEditContent({
    seedContent: { type: 'click', target: 'button' },
    storedRubric: '# Rubric\n\nActual stored rubric',
    displayRubric: 'display rubric',
    fallbackTemplate: 'template rubric',
  });

  assert.equal(content, '# Rubric\n\nActual stored rubric');
});
