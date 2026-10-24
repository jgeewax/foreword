// The Spelling view: the whole book's spelling and grammar, as Word's Editor
// pane lists a document's. Words the dictionary doesn't know come first, the
// most frequent first, each once however often it's used, so a character's
// name is added to the book's dictionary with one click; then grammar, by
// chapter. A click goes to the mistake, with its suggestions.
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { groupWords, issueMessage, ISSUE_TITLE } from '../app/proofing-core';
import { studio } from '../app/studio';
import { numberedTitle } from '../app/tool-labels';
import type { ProofIssue } from '../lib/ipc';
import { useStore } from '../lib/store';
import { Icon } from './icons';

/** Rows shown at first; More shows the rest. */
const PAGE = 200;

/** Enter or Space on a row does what a click does. */
const keys = (go: () => void) => (e: KeyboardEvent) => {
  if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return;
  e.preventDefault();
  go();
};

export function SpellingPanel() {
  const book = useStore(studio.store, (s) => s.proofing.book);
  const names = useStore(studio.store, (s) => s.names);
  const on = useStore(studio.store, (s) => s.settings.checkSpelling || s.settings.checkGrammar);
  const [shown, setShown] = useState(PAGE);
  // Each word's next occurrence, for clicking through them.
  const next = useRef(new Map<string, number>());
  useEffect(() => {
    if (!studio.state.proofing.book) void studio.proofing.checkBook();
  }, []);
  const files = book?.files ?? {};
  const words = useMemo(() => groupWords(files), [files]);
  const grammar = useMemo(
    () =>
      Object.entries(files)
        .map(([path, list]) => [path, list.filter((i) => i.kind !== 'spelling')] as const)
        .filter(([, list]) => list.length)
        .sort(([a], [b]) => a.localeCompare(b)),
    [files],
  );
  if (!on) {
    return <div className="todo-panel empty muted">Spelling and grammar checking is off. Turn it on in Settings ▸ Spelling &amp; Grammar.</div>;
  }
  const where = (path: string) => numberedTitle(path, names) ?? path.slice(path.lastIndexOf('/') + 1);
  /** A word's next place in the book, in file and text order. */
  const goWord = (word: string) => {
    const places = Object.entries(files)
      .sort(([a], [b]) => a.localeCompare(b))
      .flatMap(([path, list]) => list.filter((i) => i.kind === 'spelling' && i.word === word).map((issue) => ({ path, issue })));
    if (!places.length) return;
    const k = (next.current.get(word) ?? 0) % places.length;
    next.current.set(word, k + 1);
    void studio.proofing.go(places[k].path, places[k].issue);
  };
  const go = (path: string, issue: ProofIssue) => void studio.proofing.go(path, issue);
  const checking = book?.status === 'checking';
  return (
    <div className="todo-panel spelling-panel">
      <div className="spelling-status muted">
        {checking ? (
          <span>
            Checking the book… {book.done} of {book.total}
          </span>
        ) : (
          <span>{book ? `${book.total === 1 ? '1 file' : `${book.total} files`} checked` : ''}</span>
        )}
        <span className="spacer" />
        {!checking && (
          <button className="icon" title="Check the book again" aria-label="Check the book again" onClick={() => void studio.proofing.checkBook()}>
            <Icon name="refresh" size={13} />
          </button>
        )}
      </div>
      {book && !checking && !words.length && !grammar.length && <div className="todo-panel empty muted">No spelling or grammar mistakes found.</div>}
      {words.length > 0 && (
        <section className="todo-file">
          <div className="todo-file-head">
            <span className="todo-file-title">Not in the dictionary</span>
            <span className="todo-file-path">{words.length}</span>
          </div>
          {words.slice(0, shown).map((w) => (
            <div key={w.word} className="todo-row spelling-word" role="button" tabIndex={0} title={`${w.count === 1 ? 'Once' : `${w.count} times`}, in ${w.files.map(where).join(', ')}. Click to go to each in turn.`} onClick={() => goWord(w.word)} onKeyDown={keys(() => goWord(w.word))}>
              <span className="spelling-mark" aria-hidden />
              <span className="todo-text">
                <span className="spelling-word-text">{w.word}</span>
                <span className="muted">
                  {' '}
                  ×{w.count}
                  {w.files.length > 1 ? ` · ${w.files.length} files` : ` · ${where(w.files[0])}`}
                </span>
              </span>
              <button
                className="spelling-add"
                title={`Add “${w.word}” to the book’s dictionary: not flagged again in this book`}
                aria-label={`Add ${w.word} to the book’s dictionary`}
                onClick={(e) => {
                  e.stopPropagation();
                  void studio.proofing.learn(w.word, 'book');
                }}
              >
                <Icon name="plus" size={14} />
              </button>
            </div>
          ))}
          {words.length > shown && (
            <button className="link spelling-more" onClick={() => setShown(shown + PAGE)}>
              {words.length - shown} more
            </button>
          )}
        </section>
      )}
      {grammar.map(([path, list]) => (
        <section key={path} className="todo-file">
          <div className="todo-file-head" title={path}>
            <span className="todo-file-title">{where(path)}</span>
            <span className="todo-file-path">{list.length === 1 ? '1 to look at' : `${list.length} to look at`}</span>
          </div>
          {list.map((i) => (
            <div key={`${i.start}:${i.key}`} className={`todo-row spelling-issue ${i.kind}`} role="button" tabIndex={0} title={`${ISSUE_TITLE[i.kind]}: go there`} onClick={() => go(path, i)} onKeyDown={keys(() => go(path, i))}>
              <span className="spelling-mark" aria-hidden />
              <span className="todo-text">
                {issueMessage(i)} <span className="muted">“{i.word}”</span>
              </span>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
