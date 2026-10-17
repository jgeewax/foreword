import { describe, expect, it } from 'vitest';
import { tidyEntries } from './context-menu';

describe('tidyEntries', () => {
  it('drops empty entries and stray separators', () => {
    const a = { label: 'A', action: () => {} };
    expect(tidyEntries(['separator', a, null, false, 'separator', 'separator', undefined, 'copy', 'separator'])).toEqual([a, 'separator', 'copy']);
    expect(tidyEntries([null, 'separator'])).toEqual([]);
  });
});
