// @vitest-environment jsdom

import { BlockNoteEditor } from '@blocknote/core';
import { describe, expect, it } from 'vitest';

describe('diary editor dependency compatibility', () => {
  it('keeps the markdown import, edit, and export path used by DiaryPanel', () => {
    const editor = BlockNoteEditor.create();
    const blocks = editor.tryParseMarkdownToBlocks('# 课堂反思\n\n今天完成函数教学。');

    editor.replaceBlocks(editor.document, blocks);

    const markdown = editor.blocksToMarkdownLossy(editor.document);
    expect(markdown).toContain('# 课堂反思');
    expect(markdown).toContain('今天完成函数教学。');
  });
});
