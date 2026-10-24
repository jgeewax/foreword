// Spelling and grammar in the editor's own UI: a mistake's hover (what's
// wrong, its fixes as links, Add to Dictionary), its entries at the top of the
// right-click menu (as TextEdit puts them), and ⌘. for the same fixes. Only
// for the editor's own file: a diff's copy of a file gets none of it.
import type { Found } from '../app/proofing';
import { fixLabel, issueMessage, ISSUE_TITLE, proofMenu, type ProofAction } from '../app/proofing-core';
import { studio } from '../app/studio';
import type { MenuEntry } from '../lib/context-menu';
import { monaco } from '../editor/monaco';

const COMMAND = 'studio.proof';

/** Markdown text, as written. */
const md = (s: string) => s.replace(/[\\`*_{}[\]()#+\-.!|<>~]/g, '\\$&');

function act(found: Found, action: ProofAction) {
  const p = studio.proofing;
  if (action.kind === 'fix') p.fix(found, action.fix);
  else if (action.kind === 'ignore') p.ignore(found);
  else if (action.kind === 'learn') void p.learn(found.issue.word, action.scope);
  else if (action.kind === 'rule') p.disableRule(found, 'user');
}

/** The editor's file and the mistakes at a position in it, if the model is the editor's. */
function foundAt(model: monaco.editor.ITextModel, position: monaco.IPosition): Found[] {
  const path = studio.state.active;
  if (!path || model !== studio.editor?.getModel() || studio.state.viewTab) return [];
  return studio.proofing.at(path, model.getOffsetAt(position));
}

const link = (label: string, found: Found, action: ProofAction) =>
  `[${md(label)}](command:${COMMAND}?${encodeURIComponent(JSON.stringify([found.path, found.id, action]))})`;

/** What the hover says about a mistake: the kind and what's wrong, the fixes, then what else can be done. */
export function proofHover(found: Found): monaco.IMarkdownString {
  const { issue } = found;
  const head = `**${ISSUE_TITLE[issue.kind]}** · ${md(issueMessage(issue))}`;
  const fixes = issue.fixes.slice(0, 5);
  const fixLine = !fixes.length
    ? issue.kind === 'spelling'
      ? '_No guesses found._'
      : ''
    : issue.fixable
      ? fixes.map((f) => link(fixLabel(issue, f), found, { kind: 'fix', fix: f })).join(' · ')
      : `Try: ${fixes.map((f) => `“${md(fixLabel(issue, f))}”`).join(', ')}`;
  const more = proofMenu(issue)
    .filter((e): e is { label: string; action: ProofAction } => e !== 'separator' && !!e.action && e.action.kind !== 'fix')
    .map((e) => link(e.label, found, e.action))
    .join(' · ');
  return { value: [head, fixLine, more].filter(Boolean).join('\n\n'), isTrusted: { enabledCommands: [COMMAND] } };
}

/** The right-click menu's entries for the mistake under the pointer, first in the menu. */
export function proofEntries(model: monaco.editor.ITextModel, position: monaco.IPosition | null): MenuEntry[] {
  const found = position ? foundAt(model, position)[0] : undefined;
  if (!found) return [];
  return [
    ...proofMenu(found.issue).map((e): MenuEntry => (e === 'separator' ? e : { label: e.label, enabled: !!e.action, action: () => e.action && act(found, e.action) })),
    'separator',
  ];
}

/** The hover, ⌘. and the links' command, for this editor. Returns their cleanup. */
export function attachProofing(editor: monaco.editor.IStandaloneCodeEditor): () => void {
  const command = monaco.editor.registerCommand(COMMAND, (_accessor, path: string, id: string, action: ProofAction) => {
    const found = studio.proofing.find(path, id);
    if (found) act(found, action);
  });
  const hover = monaco.languages.registerHoverProvider('*', {
    provideHover: (model, position) => {
      const found = foundAt(model, position)[0];
      return found ? { range: found.range, contents: [proofHover(found)] } : null;
    },
  });
  const actions = monaco.languages.registerCodeActionProvider('*', {
    provideCodeActions: (model, range) => {
      const found = foundAt(model, range.getStartPosition())[0];
      if (!found) return { actions: [], dispose() {} };
      const list: monaco.languages.CodeAction[] = proofMenu(found.issue).flatMap((e, i) => {
        if (e === 'separator' || !e.action) return [];
        const title = e.action.kind === 'fix' ? `Change to “${e.label}”` : e.label;
        return [{ title, kind: 'quickfix', isPreferred: i === 0 && e.action.kind === 'fix', command: { id: COMMAND, title, arguments: [found.path, found.id, e.action] } }];
      });
      return { actions: list, dispose() {} };
    },
  });
  const caret = studio.proofing.attach(editor);
  return () => {
    command.dispose();
    hover.dispose();
    actions.dispose();
    caret();
  };
}
