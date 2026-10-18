import { useEffect, useRef, useState } from 'react';
import { studio } from '../app/studio';
import { editorTextOptions, languageFor, monaco } from '../editor/monaco';
import { useStore } from '../lib/store';

/**
 * One file's change in Monaco's diff editor (read-only), as VS Code shows it:
 * side by side when the pane is wide enough (VS Code's 900px), inline when it
 * isn't, switching as the pane is resized. Unchanged stretches are folded.
 * It's as tall as its content, so a list of files scrolls as one page.
 */
export function DiffEditor({ path, before, after }: { path: string; before: string | null; after: string | null }) {
  const host = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(80);
  const fontSize = useStore(studio.store, (s) => s.settings.editorFontSize);
  const diffEditor = useRef<monaco.editor.IStandaloneDiffEditor | null>(null);

  useEffect(() => {
    const language = languageFor(path);
    const original = monaco.editor.createModel(before ?? '', language);
    const modified = monaco.editor.createModel(after ?? '', language);
    const editor = monaco.editor.createDiffEditor(host.current!, {
      readOnly: true,
      originalEditable: false,
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
    editor.setModel({ original, modified });
    diffEditor.current = editor;
    const sides = [editor.getOriginalEditor(), editor.getModifiedEditor()];
    const fit = () => {
      // Monaco 0.57 stops wrapping the original side when it goes inline (it's hidden then), and
      // going side by side again turns only half of that back: lines on the left ran off the edge.
      if (host.current?.querySelector('.monaco-diff-editor.side-by-side')) sides[0].updateOptions({ wordWrapOverride2: 'inherit' });
      setHeight(Math.max(...sides.map((e) => e.getContentHeight())));
    };
    const subscriptions = [...sides.map((e) => e.onDidContentSizeChange(fit)), editor.onDidUpdateDiff(fit)];
    fit();
    return () => {
      subscriptions.forEach((s) => s.dispose());
      diffEditor.current = null;
      editor.dispose();
      original.dispose();
      modified.dispose();
    };
  }, [path, before, after]);

  // The editor's text size (Settings ▸ General ▸ Editor).
  useEffect(() => diffEditor.current?.updateOptions(editorTextOptions(fontSize)), [fontSize]);

  return <div className="diff-editor" ref={host} style={{ height }} />;
}
