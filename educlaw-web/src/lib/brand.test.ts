import { describe, expect, it } from 'vitest';
import { PRODUCT_NAME, PRODUCT_WORKSPACE_NAME } from './brand';

describe('InnoAgent display brand', () => {
  it('centralizes the user-visible product name', () => {
    expect(PRODUCT_NAME).toBe('InnoAgent');
    expect(PRODUCT_WORKSPACE_NAME).toBe('InnoAgent Workspace');
  });
});
