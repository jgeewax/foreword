import { useEffect, useRef, useState } from 'react';
import { studio } from '../app/studio';
import type { Doc } from '../editor/documents';
import { editorTextOptions, languageFor, monaco } from '../editor/monaco';
import { useStore } from '../lib/store';
import { attachEditorTools } from './editor-tools';

/**
 * One file's change in Monaco's diff editor, as VS Code shows it: side by
 * side when the pane is wide enough (VS Code's 900px), inline when it isn't,
 * switching as the pane is resized. Unchanged stretches are folded.
 * It's as tall as its content, so a list of files scrolls as one page.
 * Clicking in it (or moving with the keys) scrolls the preview there.
 *
 * Between two versions it's read-only. `live` (the file as it is now, as in
 * VS Code's working-tree diffs): the new side is the file's own text, the one
 * the editor has, so typing there is typing in the file (its undo, ⌘S, its
 * tab's ●), and edits made anywhere else show at once. It has the editor's
 * tools too (editor-tools.tsx): the selection bar, a TODO's, spelling, the
 * right-click menu, comments. The old side stays read-only.
 */
export function DiffEditor({ path, before, after, live = false }: { path: string; before: string | null; after: string | null; live?: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(80);
  const fontSize = useStore(studio.store, (s) => s.settings.editorFontSize);
  const diffEditor = useRef<monaco.editor.IStandaloneDiffEditor | null>(null);
  // The texts as shown now: a live diff's old side changes in place (a stage, a commit), not with a new editor.
  const texts = useRef({ before, after });
  texts.current = { before, after };

  useEffect(() => {
    let gone = false;
    let stop = () => {};
    const start = (doc: Doc | null) => {
      if (gone) return;
      const language = languageFor(path);
      const original = monaco.editor.createModel(texts.current.before ?? '', language);
      // Between versions (or a file that couldn't be opened): a copy of the text, read-only.
      const copy = doc ? null : monaco.editor.createModel(texts.current.after ?? '', language);
      const modified = doc?.model ?? copy!;
      const editor = monaco.editor.createDiffEditor(host.current!, {
        readOnly: !doc,
        originalEditable: false,
        // The file's own: the editor's native menu (editor-tools.tsx), spelling's fixes on ⌘. (not a bulb), ▶ Run over a
        // code example. Hovers go under the line: above it, they'd go under the file's name stuck at the top.
        ...(doc ? { contextmenu: false, lightbulb: { enabled: monaco.editor.ShowLightbulbIconMode.Off }, hover: { above: false }, diffCodeLens: true } : {}),
        automaticLayout: true,
        renderSideBySide: true,
        useInlineViewWhenSpaceIsLimited: true,
        renderSideBySideInlineBreakpoint: 900,
        hideUnchangedRegions: { enabled: true, contextLineCount: 3, minimumLineCount: 3, revealLineCount: 20 },
        renderOverviewRuler: false,
        wordWrap: 'on',
        diffWordWrap: 'on',
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        // The list scrolls, not each editor.
        scrollbar: { vertical: 'hidden', horizontal: 'hidden', alwaysConsumeMouseWheel: false },
        ...editorTextOptions(studio.state.settings.editorFontSize),
        fontFamily: '"SF Mono", Menlo, Monaco, monospace',
        unicodeHighlight: { ambiguousCharacters: false },
      });
      // Its view model made here, to be disposed with it: Monaco 0.57 never disposes the one it makes itself, so a diff
      // still being worked out when the tab changed failed on the closed texts ("no diff result available").
      const view = editor.createViewModel({ original, modified });
      editor.setModel(view);
      diffEditor.current = editor;
      const sides = [editor.getOriginalEditor(), editor.getModifiedEditor()];
      const fit = () => {
        // Monaco 0.57 stops wrapping the original side when it goes inline (it's hidden then), and
        // going side by side again turns only half of that back: lines on the left ran off the edge.
        if (host.current?.querySelector('.monaco-diff-editor.side-by-side')) sides[0].updateOptions({ wordWrapOverride2: 'inherit' });
        setHeight(Math.max(...sides.map((e) => e.getContentHeight())));
      };
      // Where the list shows the text (the page's y): under the file's name, stuck at the top as the list scrolls.
      const visibleTop = () => {
        const list = host.current?.closest('.changes-body');
        return list ? list.getBoundingClientRect().top + (host.current?.closest('.change-file')?.querySelector('header')?.getBoundingClientRect().height ?? 0) : 0;
      };
      // The cursor kept in sight as it moves (typing a new line at the bottom, say): the list scrolls, not the editor,
      // clear of the file's name.
      const reveal = (e: monaco.editor.ICodeEditor) => {
        const list = host.current?.closest('.changes-body');
        const pos = e.getPosition();
        const at = pos && e.getScrolledVisiblePosition(pos);
        if (!list || !at || !e.hasTextFocus()) return;
        const y = e.getDomNode()!.getBoundingClientRect().top + at.top;
        const box = list.getBoundingClientRect();
        const top = visibleTop() + at.height;
        const bottom = box.bottom - at.height;
        if (y < top) list.scrollTop -= top - y;
        else if (y + at.height > bottom) list.scrollTop += y + at.height - bottom;
      };
      // The preview follows the cursor, on either side, as it does in the editor.
      const follow = sides.map((e) =>
        e.onDidChangeCursorPosition((c) => {
          if (c.reason === monaco.editor.CursorChangeReason.Explicit) studio.previewDiffAt(path, e.getModel()?.getValue() ?? '', c.position.lineNumber, c.position.column);
          reveal(e);
        }),
      );
      // Monaco fixes a diff's floating widgets to the window, whatever it's told (and again at each change to its options),
      // so they stayed put as the list scrolled. The file's side has them over the page instead, moving with its text
      // and hidden with it; each widget takes this as it's made.
      const unfix = () => sides[1].getOption(monaco.editor.EditorOption.fixedOverflowWidgets) && sides[1].updateOptions({ fixedOverflowWidgets: false });
      if (doc) unfix();
      // The file's side is written in as the editor is, with its tools; the actions they start act here once it has the keys.
      const tools = doc ? [attachEditorTools(sides[1], { visibleTop }), studio.attachDiffWriter(sides[1])] : [];
      const subscriptions = [
        ...sides.map((e) => e.onDidContentSizeChange(fit)),
        editor.onDidUpdateDiff(fit),
        ...follow,
        ...(doc
          ? [
              sides[1].onDidChangeConfiguration((e) => e.hasChanged(monaco.editor.EditorOption.fixedOverflowWidgets) && unfix()),
              // The file closed under it (the book closing): the tab goes next.
              doc.model.onWillDispose(() => editor.setModel(null)),
            ]
          : []),
      ];
      fit();
      stop = () => {
        tools.forEach((off) => off());
        subscriptions.forEach((s) => s.dispose());
        diffEditor.current = null;
        editor.dispose();
        view.dispose();
        original.dispose();
        // The file's own text stays: it's the editor's too.
        copy?.dispose();
      };
    };
    if (live) void studio.diffDoc(path).then(start);
    else start(null);
    return () => {
      gone = true;
      stop();
    };
    // A live diff follows the file itself: only the old side changes, below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, live, live ? null : before, live ? null : after]);

  // A live diff read again (staged, committed): the old side, in place, the cursor and focus staying.
  useEffect(() => {
    const original = diffEditor.current?.getModel()?.original;
    if (live && original && original.getValue() !== (before ?? '')) original.setValue(before ?? '');
  }, [live, before]);

  // The editor's text size (Settings ▸ General ▸ Editor).
  useEffect(() => diffEditor.current?.updateOptions(editorTextOptions(fontSize)), [fontSize]);

  return <div className={`diff-editor${live ? ' live' : ''}`} ref={host} style={{ height }} />;
}
