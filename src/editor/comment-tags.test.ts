import { describe, expect, it } from 'vitest';
import { commentTags } from './comment-tags';

describe('tagged comments', () => {
  it('finds the slashes, the tag and the comment, in Monaco columns', () => {
    expect(commentTags(['// TODO: check the proof'])).toEqual([{ line: 1, kind: 'todo', slashes: [1, 3], tag: [4, 9], end: 25 }]);
    expect(commentTags(['Some text. // NOTE about this'])[0]).toMatchObject({ kind: 'note', slashes: [12, 14], tag: [15, 19] });
    expect(commentTags(['  //FIXME'])[0]).toMatchObject({ kind: 'fix', slashes: [3, 5], tag: [5, 10] });
  });

  it('knows the usual tags, and only in capitals', () => {
    const kinds = commentTags(['// IDEA: a', '// QUESTION: b', '// XXX c', '// HACK', '// WARNING: d', '// todo: lower case', '// TODOS: plural']).map((t) => t.kind);
    expect(kinds).toEqual(['idea', 'question', 'fix', 'fix', 'fix']);
  });

  it("isn't fooled by links or ordinary comments", () => {
    expect(commentTags(['See https://example.com // a link', '// just a comment', '#link("http://x.org")[TODO]'])).toEqual([]);
  });
});
