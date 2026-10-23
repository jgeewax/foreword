import { describe, expect, it } from 'vitest';
import { definitionPreview } from './definition-preview';

const STYLE = `#let accent = rgb("#1f4e79")

/// A term the reader must learn. #definition("Vector")[A vector is ...]
#let definition(title, body) = _box("Definition", accent, title, body)
/// The one thing to remember from a section.
#let key-idea(body) = _box("Key idea", rgb("#b35c00"), none, body)

/// Call once, after the contents, before the first chapter.
#let start-body() = {
  pagebreak(weak: true)
  counter(page).update(1)
}

/// A code example and its output.
#let run(name, src) = {
  let entry = code-outputs.at(name, default: none)
  let ok = rgb("#2a8a3e")
  let bad = rgb("#c62828")
  let warn = rgb("#b26a00")
  block(breakable: true, width: 100%, {
    if entry == none { return }
  })
}
#figure(
  image("square.svg"),
) <fig-square>
#let parens = (")", "(") // ( unbalanced in a comment
`.split('\n');

const at = (text: string) => STYLE.findIndex((l) => l.includes(text));

describe('definitionPreview', () => {
  it('shows a one-line definition with its doc comment', () => {
    expect(definitionPreview(STYLE, at('#let key-idea'))).toEqual({ from: at('The one thing'), to: at('#let key-idea') });
  });

  it('shows a definition without a doc comment on its own', () => {
    expect(definitionPreview(STYLE, at('#let accent'))).toEqual({ from: 0, to: 0 });
  });

  it('follows a definition to where its brackets close', () => {
    expect(definitionPreview(STYLE, at('#let start-body'))).toEqual({ from: at('Call once'), to: at('#let start-body') + 3 });
  });

  it('shows only the first line of a definition too long to show', () => {
    expect(definitionPreview(STYLE, at('#let run'))).toEqual({ from: at('A code example'), to: at('#let run') });
  });

  it("stops at a label's line, whose bracket closes one opened above", () => {
    expect(definitionPreview(STYLE, at('<fig-square>'))).toEqual({ from: at('<fig-square>'), to: at('<fig-square>') });
  });

  it('ignores brackets in strings and comments', () => {
    expect(definitionPreview(STYLE, at('#let parens'))).toEqual({ from: at('#let parens'), to: at('#let parens') });
  });

  it('keeps no more than `max` lines of doc comments', () => {
    const lines = ['/// one', '/// two', '/// three', '#let x = 1'];
    expect(definitionPreview(lines, 3, 3)).toEqual({ from: 1, to: 3 });
  });
});
