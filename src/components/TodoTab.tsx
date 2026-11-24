import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { studio } from '../app/studio';
import { findRow, nearText, openCount, todoGroups, todoKey, todoRows, type BookChapter, type TodoKinds, type TodoRow } from '../app/todo-tab';
import { numberedTitle } from '../app/tool-labels';
import { removable, todoAt } from '../app/todos';
import { editorTextOptions, editorWrapOptions, monaco } from '../editor/monaco';
import { keepWidgetsInside } from '../editor/overflow-widgets';
import { onContextMenu, showContextMenu } from '../lib/context-menu';
import { Store, useStore } from '../lib/store';
import { attachEditorTools } from './editor-tools';
import { FileIcon, Icon } from './icons';
import { todoMenu } from './todo-menu';

/** Which kinds show and the words looked for: kept for the session, as they're seen above the list. */
const view = new Store<{ kinds: TodoKinds; query: string }>({ kinds: { todo: true, fix: true }, query: '' });

const basename = (p: string) => p.slice(p.lastIndexOf('/') + 1);

/** A button inside a row: its click is its own, not the row's. */
const own = (run: () => void) => (e: MouseEvent) => {
  e.stopPropagation();
  run();
};

/**
 * The To do tab: the TODOs of the chapter being written in (or one picked,
 * or the whole book) on the left, each with the line of the book it sits by,
 * and on the right the chapter itself at the TODO picked, with its bar (Ask
 * the assistant, Done). That's the file's own text: typing there is typing in
 * it. ↑ ↓ move through the list and ⏎ opens the TODO in its tab. Done keeps
 * its row, struck through with Undo, until the tab is left.
 */
export function TodoTab() {
  const todos = useStore(studio.store, (s) => s.todos);
  const tab = useStore(studio.store, (s) => s.todoTab);
  const names = useStore(studio.store, (s) => s.names);
  const active = useStore(studio.store, (s) => s.active);
  const v = useStore(view, (s) => s);
  // The book's chapters follow its names (refreshed with what each file includes).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const book = useMemo(() => studio.todoBook(), [names, active]);
  const titleOf = (p: string) => numberedTitle(p, names);
  // One chapter or none: Book and Chapter would be the same.
  const chaptered = book.chapters.length > 1;
  const scope = chaptered ? tab.scope : 'book';
  // The chapter shown: the one picked, else the one being written in, else the file being written in.
  const chapterPath = tab.chapter ?? book.here ?? active;
  const chapter: BookChapter | null = chapterPath ? (book.chapters.find((c) => c.path === chapterPath) ?? { path: chapterPath, files: [chapterPath] }) : null;
  const groups = useMemo(
    () => todoGroups({ todos, done: tab.done, scope, chapter, chapters: book.chapters, here: book.here, titleOf: (p) => numberedTitle(p, names), kinds: v.kinds, query: v.query }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [todos, tab.done, scope, chapter?.path, chapter?.files.join('\n'), book, names, v.kinds, v.query],
  );
  const rows = todoRows(groups);
  const row = findRow(rows, tab.selected) ?? rows[0] ?? null;
  // The pick follows its TODO as lines move (one above it done, text typed).
  useEffect(() => {
    if (row && (!tab.selected || todoKey(row.todo) !== todoKey(tab.selected))) studio.setTodoTab({ selected: row.todo });
  }, [row, tab.selected]);
  // Left (another tab in front, or closed): the rows of TODOs done here go.
  useEffect(() => () => studio.leftTodoTab(), []);

  const listRef = useRef<HTMLDivElement>(null);
  const move = (step: number) => {
    if (!rows.length) return;
    const i = row ? rows.indexOf(row) : -1;
    const next = rows[Math.min(rows.length - 1, Math.max(0, i + step))];
    studio.setTodoTab({ selected: next.todo });
  };
  // Next and Previous TODO (the palette) move through the list here.
  useEffect(() => studio.events.on('todo-tab-move', (step) => move(step)));
  // The picked row in sight.
  useEffect(() => {
    listRef.current?.querySelector('.todo-tab-row.picked')?.scrollIntoView({ block: 'nearest' });
  }, [row?.key]);

  const openInTab = (r: TodoRow | null) => {
    if (!r) return;
    void (async () => {
      const text = (await studio.textOf(r.todo.path)) ?? '';
      const at = r.done ? null : todoAt(text.split('\n')[r.todo.line - 1] ?? '', r.todo.path, r.todo.line);
      await studio.openAt(r.todo.path, r.todo.line, at?.from ?? 1);
    })();
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      move(e.key === 'ArrowDown' ? 1 : -1);
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      if (rows.length) studio.setTodoTab({ selected: (e.key === 'Home' ? rows[0] : rows[rows.length - 1]).todo });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      openInTab(row);
    }
  };

  const inScope = scope === 'book' ? null : (chapter?.files ?? []);
  const scoped = inScope ? todos.filter((t) => inScope.includes(t.path)) : todos;
  const bookCount = todos.length;
  const chapterCount = openCount(todos, chapter?.files ?? []);
  const kinds = [
    { key: 'todo' as const, label: 'TODO', count: scoped.filter((t) => !t.fix).length },
    { key: 'fix' as const, label: 'FIXME', count: scoped.filter((t) => t.fix).length },
  ];
  const open = rows.filter((r) => !r.done).length;
  const doneHere = rows.length - open;
  const chapterTitle = chapter ? (titleOf(chapter.path) ?? basename(chapter.path)) : null;
  const hereTitle = book.here ? (titleOf(book.here) ?? basename(book.here)) : null;
  const filtered = !v.kinds.todo || !v.kinds.fix || !!v.query.trim();

  const pickChapter = () =>
    void showContextMenu([
      { label: hereTitle ? `The Chapter You’re Writing In (${hereTitle})` : 'The Chapter You’re Writing In', checked: !tab.chapter, action: () => studio.setTodoTab({ chapter: null }) },
      'separator',
      ...book.chapters.map((c) => ({ label: titleOf(c.path) ?? c.path, checked: !!tab.chapter && c.path === chapterPath, action: () => studio.setTodoTab({ chapter: c.path }) })),
    ]);

  return (
    <div className="todo-tab">
      <div className="todo-tab-head">
        {chaptered && (
          <div className="kind-switch todo-tab-scope" role="tablist" aria-label="Which TODOs">
            <button role="tab" aria-selected={scope === 'book'} className={scope === 'book' ? 'active' : ''} title="The whole book’s TODOs, chapter by chapter" onClick={() => studio.setTodoTab({ scope: 'book' })}>
              Book <span className="todo-tab-count">{bookCount}</span>
            </button>
            <button role="tab" aria-selected={scope === 'chapter'} className={scope === 'chapter' ? 'active' : ''} title="One chapter’s TODOs, by its sections" onClick={() => studio.setTodoTab({ scope: 'chapter' })}>
              Chapter <span className="todo-tab-count">{chapterCount}</span>
            </button>
          </div>
        )}
        {chaptered && scope === 'chapter' && (
          <>
            <button className="todo-tab-chapter" title="Another chapter’s TODOs" onClick={pickChapter}>
              <span className="todo-tab-chapter-name">{chapterTitle ?? 'No chapter'}</span>
              <Icon name="chevronDown" size={12} />
            </button>
            {!tab.chapter && book.here && <span className="todo-tab-hint">the chapter you’re writing in</span>}
          </>
        )}
        <span className="spacer" />
        <div className="todo-tab-kinds" role="group" aria-label="Kinds">
          {kinds.map((k) => (
            <button
              key={k.key}
              className={`todo-tab-kind kind-${k.key}${v.kinds[k.key] ? ' on' : ''}`}
              aria-pressed={v.kinds[k.key]}
              title={v.kinds[k.key] ? `Hide the ${k.label}s` : `Show the ${k.label}s`}
              onClick={() => view.set((s) => ({ kinds: { ...s.kinds, [k.key]: !s.kinds[k.key] } }))}
            >
              <span className="todo-tab-dot" />
              {k.label}
              <span className="todo-tab-count">{k.count}</span>
            </button>
          ))}
        </div>
        <label className="search-box todo-tab-search">
          <Icon name="search" size={13} />
          <input
            value={v.query}
            placeholder="Filter"
            aria-label="Filter TODOs"
            spellCheck={false}
            onChange={(e) => view.set({ query: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && v.query) {
                e.preventDefault();
                e.stopPropagation();
                view.set({ query: '' });
              }
            }}
          />
        </label>
      </div>

      <div className="todo-tab-body">
        <div className="todo-tab-list">
          <div className="todo-tab-sum">
            {open ? `${open} to do ${scope === 'book' ? 'in the book' : 'in this chapter'}` : rows.length ? `All done ${scope === 'book' ? 'in the book' : 'in this chapter'}` : ''}
            {doneHere > 0 && ` · ${doneHere} done`}
          </div>
          <div
            className="todo-tab-groups"
            ref={listRef}
            role="listbox"
            tabIndex={0}
            aria-label="TODOs"
            aria-activedescendant={row ? `todo-row-${rows.indexOf(row)}` : undefined}
            onKeyDown={onKeyDown}
          >
            {groups.map((g) => (
              <section key={g.key} className="todo-tab-group" role="group" aria-label={g.title}>
                <div className="todo-tab-group-head">
                  <span className="todo-tab-group-title">{g.title}</span>
                  {g.sub && <span className="todo-tab-group-file">{g.sub}</span>}
                  {g.here && <span className="todo-tab-here">You’re here</span>}
                  <span className="spacer" />
                  <span className="todo-tab-group-count">{g.open || 'done'}</span>
                </div>
                {g.rows.map((r) => {
                  const near = nearText(r.todo.near);
                  const picked = r === row;
                  return (
                    <div
                      key={r.key}
                      id={`todo-row-${rows.indexOf(r)}`}
                      role="option"
                      aria-selected={picked}
                      className={`todo-tab-row${picked ? ' picked' : ''}${r.done ? ' done' : ''}`}
                      title={`${r.todo.path}, line ${r.todo.line}`}
                      onMouseDown={(e) => {
                        // The list keeps the keys (↑ ↓), not the button under the pointer.
                        if (e.button === 0) e.preventDefault();
                        listRef.current?.focus();
                      }}
                      onClick={() => studio.setTodoTab({ selected: r.todo })}
                      onDoubleClick={() => openInTab(r)}
                      onContextMenu={onContextMenu(() => (r.done ? [{ label: 'Undo', action: () => void studio.todoUndo(r.done!) }] : todoMenu(r.todo, !!r.todo.fix)))}
                    >
                      {r.done ? (
                        <button className="todo-check checked" tabIndex={-1} title="Undo: put the TODO back" aria-label="Undo" onClick={own(() => void studio.todoUndo(r.done!))}>
                          <Icon name="check" size={11} />
                        </button>
                      ) : removable(r.todo) ? (
                        <button className="todo-check" tabIndex={-1} title="Done: take the TODO comment out (Undo puts it back)" aria-label="Done" onClick={own(() => void studio.todoDone(r.todo))}>
                          <Icon name="check" size={11} />
                        </button>
                      ) : (
                        <span className="todo-check fixed" title="Take this one out in the text: it isn’t a // TODO comment" />
                      )}
                      <span className="todo-tab-main">
                        <span className="todo-tab-text">
                          {r.todo.fix && <span className="todo-tab-tag">FIXME</span>}
                          {r.todo.text}
                        </span>
                        {near.text && <span className={`todo-tab-near${near.code ? ' code' : ''}`}>{near.text}</span>}
                      </span>
                      {r.done ? (
                        <button className="link todo-tab-undo" tabIndex={-1} onClick={own(() => void studio.todoUndo(r.done!))}>
                          Undo
                        </button>
                      ) : (
                        <span className="todo-tab-line">{r.todo.line}</span>
                      )}
                    </div>
                  );
                })}
              </section>
            ))}
            {!rows.length && (
              <div className="todo-tab-empty">
                {!todos.length ? (
                  <>
                    <Icon name="todos" size={30} />
                    <div className="todo-tab-empty-title">No TODOs in the book</div>
                    <div className="muted">
                      Write <code>// TODO: …</code> in a chapter to leave yourself a note. It shows up here and in the chat’s suggestions.
                    </div>
                  </>
                ) : filtered && (scope === 'book' || chapterCount > 0) ? (
                  <>
                    <div className="todo-tab-empty-title">Nothing matches</div>
                    <button onClick={() => view.set({ kinds: { todo: true, fix: true }, query: '' })}>Show them all</button>
                  </>
                ) : (
                  <>
                    <Icon name="todos" size={30} />
                    <div className="todo-tab-empty-title">Nothing to do in {chapterTitle ?? 'this chapter'}</div>
                    <div className="muted">
                      Write <code>// TODO: …</code> in the chapter to leave yourself a note. It shows up here and in the chat’s suggestions.
                    </div>
                    <button onClick={() => studio.setTodoTab({ scope: 'book' })}>{bookCount} in the rest of the book</button>
                  </>
                )}
              </div>
            )}
            {scope === 'chapter' && rows.length > 0 && (
              <div className="todo-tab-rest">
                <span>{bookCount - chapterCount > 0 ? `${bookCount - chapterCount} more in the rest of the book` : 'None in the rest of the book'}</span>
                <span className="spacer" />
                {bookCount - chapterCount > 0 && (
                  <button className="link" onClick={() => studio.setTodoTab({ scope: 'book' })}>
                    Show the whole book
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
        <Passage row={row} rows={rows} titleOf={titleOf} onOpen={() => openInTab(row)} onMove={move} />
      </div>
    </div>
  );
}

/**
 * The chapter at the TODO picked: the file's own text in an editor of its own,
 * with the editor's tools (the TODO's bar, the selection bar, spelling, the
 * menu). The TODO picked has its bar while the list has the keys; a click on
 * another TODO's line in it picks that one in the list.
 */
function Passage({ row, rows, titleOf, onOpen, onMove }: { row: TodoRow | null; rows: TodoRow[]; titleOf: (p: string) => string | undefined; onOpen: () => void; onMove: (step: number) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const [missing, setMissing] = useState(false);
  // The rows as shown, for a click in the text on another TODO's line.
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const closing = useRef<monaco.IDisposable | null>(null);

  useEffect(() => {
    const s = studio.state.settings;
    const editor = monaco.editor.create(host.current!, {
      model: null,
      automaticLayout: true,
      minimap: { enabled: false },
      ...editorTextOptions(s.editorFontSize),
      ...editorWrapOptions(s),
      fontFamily: '"SF Mono", Menlo, Monaco, monospace',
      scrollBeyondLastLine: false,
      renderLineHighlight: 'line',
      unicodeHighlight: { ambiguousCharacters: false },
      padding: { top: 8 },
      fixedOverflowWidgets: true,
      contextmenu: false,
      lightbulb: { enabled: monaco.editor.ShowLightbulbIconMode.Off },
    });
    editorRef.current = editor;
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => void studio.save(studio.fileOf(editor.getModel()) ?? undefined));
    // Written in as the editor is: its tools, and the actions they start act here once it has the keys.
    const offTools = attachEditorTools(editor, { inTodoTab: true });
    const offWriter = studio.attachDiffWriter(editor);
    const offWidgets = keepWidgetsInside(editor);
    const follow = editor.onDidChangeCursorPosition((c) => {
      const model = editor.getModel();
      const path = studio.fileOf(model);
      if (!model || !path || c.reason !== monaco.editor.CursorChangeReason.Explicit) return;
      // The preview follows, as it does the editor's cursor.
      studio.previewDiffAt(path, model.getValue(), c.position.lineNumber, c.position.column);
      // Onto another TODO's line: that one's picked in the list.
      const there = rowsRef.current.find((r) => !r.done && r.todo.path === path && r.todo.line === c.position.lineNumber);
      if (there) studio.setTodoTab({ selected: there.todo });
    });
    // The text size, wrapping and rulers (Settings ▸ Editor).
    let last = s;
    const offSettings = studio.store.subscribe(() => {
      const now = studio.state.settings;
      if (now === last) return;
      if (now.editorFontSize !== last.editorFontSize) editor.updateOptions(editorTextOptions(now.editorFontSize));
      if (now.wordWrap !== last.wordWrap || now.wordWrapColumn !== last.wordWrapColumn || now.rulers.join() !== last.rulers.join()) editor.updateOptions(editorWrapOptions(now));
      last = now;
    });
    return () => {
      closing.current?.dispose();
      follow.dispose();
      offSettings();
      offWidgets();
      offWriter();
      offTools();
      editorRef.current = null;
      editor.dispose();
    };
  }, []);

  // The TODO picked, in its file: the cursor at it (its bar above it), in sight.
  const key = row?.key ?? null;
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !row) return;
    let gone = false;
    void studio.todoPassageDoc(row.todo.path).then((doc) => {
      if (gone) return;
      setMissing(!doc);
      if (!doc) return editor.setModel(null);
      // Being written in (a TODO's words typed, a click on another TODO's line): the text stays as it is.
      if (editor.getModel() === doc.model && editor.hasTextFocus()) return;
      if (editor.getModel() !== doc.model) {
        editor.setModel(doc.model);
        // The file closed under it (the book closing): it lets go first.
        closing.current?.dispose();
        closing.current = doc.model.onWillDispose(() => editor.getModel() === doc.model && editor.setModel(null));
      }
      const model = doc.model;
      const line = Math.min(row.todo.line, model.getLineCount());
      const at = row.done ? null : todoAt(model.getLineContent(line), row.todo.path, line);
      editor.setSelection(new monaco.Selection(line, at?.from ?? 1, line, at?.from ?? 1));
      editor.revealLineInCenterIfOutsideViewport(line, monaco.editor.ScrollType.Immediate);
      // A little room above the TODO, for its bar.
      const top = editor.getTopForLineNumber(line);
      if (top - editor.getScrollTop() < 60) editor.setScrollTop(Math.max(0, top - 120), monaco.editor.ScrollType.Immediate);
      studio.previewDiffAt(row.todo.path, model.getValue(), line, 1);
    });
    return () => {
      gone = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const i = row ? rows.indexOf(row) : -1;
  const path = row?.todo.path ?? null;
  const title = path ? (titleOf(path) ?? basename(path)) : null;
  return (
    <div className="todo-tab-passage">
      <div className="todo-tab-passage-head">
        {path && <FileIcon path={path} />}
        <span className="todo-tab-passage-title">{title ?? ''}</span>
        {path && (
          <span className="todo-tab-passage-where">
            {path} · line {row!.todo.line}
          </span>
        )}
        <span className="spacer" />
        {row && (
          <span className="todo-tab-pos">
            {i + 1} of {rows.length}
          </span>
        )}
        <button className="icon todo-tab-up" title="Previous TODO (↑)" aria-label="Previous TODO" disabled={i <= 0} onClick={() => onMove(-1)}>
          <Icon name="chevronDown" size={14} />
        </button>
        <button className="icon" title="Next TODO (↓)" aria-label="Next TODO" disabled={i < 0 || i >= rows.length - 1} onClick={() => onMove(1)}>
          <Icon name="chevronDown" size={14} />
        </button>
        <button className="small" disabled={!row} title="This TODO in its file’s tab (⏎)" onClick={onOpen}>
          Open in Its Tab
        </button>
      </div>
      <div className="todo-tab-editor" ref={host} hidden={!row || missing} />
      {!row && <div className="todo-tab-passage-empty muted">Pick a TODO to see it in its chapter.</div>}
      {row && missing && <div className="todo-tab-passage-empty muted">{row.todo.path} can’t be read.</div>}
    </div>
  );
}
