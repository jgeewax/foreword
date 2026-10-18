import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';
import JsonWorker from 'monaco-editor/language/json/json.worker?worker';
import { registerTypst } from './typst-language';
import { editorLineHeight, type AppSettings } from '../app/settings';

self.MonacoEnvironment = {
  getWorker(_id: string, label: string) {
    return label === 'json' ? new JsonWorker() : new EditorWorker();
  },
};

// Token colours for Tinymist's TextMate scopes (see typst-language.ts).
const light: monaco.editor.ITokenThemeRule[] = [
  { token: 'comment', foreground: '6e7781', fontStyle: 'italic' },
  { token: 'markup.heading', foreground: '0550ae', fontStyle: 'bold' },
  { token: 'markup.bold', fontStyle: 'bold' },
  { token: 'markup.italic', fontStyle: 'italic' },
  { token: 'markup.raw', foreground: '953800' },
  { token: 'markup.math', foreground: '116329' },
  { token: 'markup.underline.link', foreground: '0969da', fontStyle: 'underline' },
  { token: 'string', foreground: '0a3069' },
  { token: 'string.other.label', foreground: '8250df' },
  { token: 'constant.numeric', foreground: '0550ae' },
  { token: 'constant.language', foreground: '0550ae' },
  { token: 'constant.other', foreground: '8250df' },
  { token: 'constant.character', foreground: '953800' },
  { token: 'keyword', foreground: 'cf222e' },
  { token: 'keyword.operator', foreground: 'cf222e' },
  { token: 'storage.type', foreground: 'cf222e' },
  { token: 'entity.name.function', foreground: '8250df' },
  { token: 'support.function', foreground: '8250df' },
  { token: 'entity.name', foreground: '0550ae' },
  { token: 'variable', foreground: '953800' },
  { token: 'punctuation', foreground: '57606a' },
];
const dark: monaco.editor.ITokenThemeRule[] = [
  { token: 'comment', foreground: '8b949e', fontStyle: 'italic' },
  { token: 'markup.heading', foreground: '79c0ff', fontStyle: 'bold' },
  { token: 'markup.bold', fontStyle: 'bold' },
  { token: 'markup.italic', fontStyle: 'italic' },
  { token: 'markup.raw', foreground: 'ffa657' },
  { token: 'markup.math', foreground: '7ee787' },
  { token: 'markup.underline.link', foreground: '58a6ff', fontStyle: 'underline' },
  { token: 'string', foreground: 'a5d6ff' },
  { token: 'string.other.label', foreground: 'd2a8ff' },
  { token: 'constant.numeric', foreground: '79c0ff' },
  { token: 'constant.language', foreground: '79c0ff' },
  { token: 'constant.other', foreground: 'd2a8ff' },
  { token: 'constant.character', foreground: 'ffa657' },
  { token: 'keyword', foreground: 'ff7b72' },
  { token: 'keyword.operator', foreground: 'ff7b72' },
  { token: 'storage.type', foreground: 'ff7b72' },
  { token: 'entity.name.function', foreground: 'd2a8ff' },
  { token: 'support.function', foreground: 'd2a8ff' },
  { token: 'entity.name', foreground: '79c0ff' },
  { token: 'variable', foreground: 'ffa657' },
  { token: 'punctuation', foreground: '8b949e' },
];

export const THEME_PREFIXES = [...new Set(light.map((r) => r.token))];

monaco.editor.defineTheme('studio-light', { base: 'vs', inherit: true, rules: light, colors: {} });
monaco.editor.defineTheme('studio-dark', {
  base: 'vs-dark',
  inherit: true,
  rules: dark,
  colors: { 'editor.background': '#1b1d21', 'editorGutter.background': '#1b1d21' },
});

const darkQuery = matchMedia('(prefers-color-scheme: dark)');
const applyTheme = () => monaco.editor.setTheme(darkQuery.matches ? 'studio-dark' : 'studio-light');
darkQuery.addEventListener('change', applyTheme);
applyTheme();

export const typstReady = registerTypst(THEME_PREFIXES).catch((e) => {
  void import('../lib/ipc').then(({ ipc }) => ipc.uiLog(`Typst highlighting unavailable: ${e?.stack ?? e}`));
});

/** Monaco's text size options for a text size in px (Settings ▸ Editor). */
export const editorTextOptions = (fontSize: number) => ({ fontSize, lineHeight: editorLineHeight(fontSize) });

/** Monaco's wrapping and rulers (Settings ▸ Editor): a column wraps at it or the edge, whichever comes first. */
export const editorWrapOptions = (s: Pick<AppSettings, 'wordWrap' | 'wordWrapColumn' | 'rulers'>): monaco.editor.IEditorOptions => ({
  wordWrap: ({ window: 'on', column: 'bounded', off: 'off' } as const)[s.wordWrap],
  wordWrapColumn: s.wordWrapColumn,
  rulers: s.rulers,
});

export function languageFor(path: string): string {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  return (
    { typ: 'typst', json: 'json', md: 'markdown', yaml: 'yaml', yml: 'yaml', svg: 'xml', xml: 'xml', toml: 'ini', csv: 'plaintext' }[
      ext
    ] ?? 'plaintext'
  );
}

export { monaco };
