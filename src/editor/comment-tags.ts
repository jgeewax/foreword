// Tagged comments in the editor (`// TODO: …`, `// NOTE: …`): where the tag
// and its comment are on each line, so the editor can show the tag as a
// coloured label and tint the line. The text itself is left as it is.

export type TagKind = 'todo' | 'fix' | 'note' | 'idea' | 'question';

export type CommentTag = {
  /** 1-based line. */
  line: number;
  kind: TagKind;
  /** 1-based columns (Monaco's): the `//`, the tag (with its colon), the end of the comment. */
  slashes: [number, number];
  tag: [number, number];
  end: number;
};

const KINDS: Record<string, TagKind> = {
  TODO: 'todo',
  FIXME: 'fix',
  XXX: 'fix',
  HACK: 'fix',
  WARNING: 'fix',
  WARN: 'fix',
  NOTE: 'note',
  IDEA: 'idea',
  QUESTION: 'question',
};

// `//` at the start or after a space (so not the `//` of https://), then a tag in capitals and a colon, space or the end.
const TAGGED = /(^|\s)(\/\/+)(\s*)(TODO|FIXME|XXX|HACK|WARNING|WARN|NOTE|IDEA|QUESTION)(:?)(?=\s|$)/;

export function commentTags(lines: readonly string[]): CommentTag[] {
  const out: CommentTag[] = [];
  lines.forEach((text, i) => {
    const m = TAGGED.exec(text);
    if (!m) return;
    const slashStart = m.index + m[1].length;
    const tagStart = slashStart + m[2].length + m[3].length;
    const tagEnd = tagStart + m[4].length + m[5].length;
    out.push({ line: i + 1, kind: KINDS[m[4]], slashes: [slashStart + 1, slashStart + m[2].length + 1], tag: [tagStart + 1, tagEnd + 1], end: text.length + 1 });
  });
  return out;
}
