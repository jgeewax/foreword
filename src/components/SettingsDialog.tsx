import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { PROJECT_FILE } from '../app/project-settings';
import { studio, type SettingsPage } from '../app/studio';
import { ipc, type ToolInfo, type ToolProbe } from '../lib/ipc';
import { useStore } from '../lib/store';
import { pastedPath, tildePath } from '../lib/paths';
import { hasWords, searchWords, wordSpans } from '../lib/word-search';
import { PermissionsEditor } from './Permissions';
import { Icon, type IconName } from './icons';
import { LOOK_COMMANDS } from '../services/agent/permissions';
import { AssistantPage } from './AssistantSettings';
import { Choice, SwitchRow } from './SettingControls';
import { DEFAULT_SETTINGS, EDITOR_FONT_SIZES, isCommandName, type ToolName } from '../app/settings';

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="settings-section">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function ProjectSection() {
  const ws = useStore(studio.store, (s) => s.workspace);
  const project = useStore(studio.store, (s) => s.project);
  const [errors, setErrors] = useState<string[]>([]);
  const [outputDir, setOutputDir] = useState(project.settings.outputDir ?? '');
  useEffect(() => setOutputDir(project.settings.outputDir ?? ''), [project.settings.outputDir]);
  const [root, setRoot] = useState(project.settings.root ?? '');
  useEffect(() => setRoot(project.settings.root ?? ''), [project.settings.root]);
  if (!ws) return null;

  const typFiles = ws.files.filter((f) => f.endsWith('.typ'));
  const fonts = project.settings.fontPaths ?? [];
  const locked = !!project.error;
  const save = async (patch: Parameters<typeof studio.updateProjectSettings>[0]) => setErrors(await studio.updateProjectSettings(patch));
  const entry = project.settings.entryPoint ?? ws.entry ?? '';
  const pdfName = (entry.split('/').pop() ?? 'main.typ').replace(/\.typ$/, '.pdf');
  const entryDir = entry.includes('/') ? entry.slice(0, entry.lastIndexOf('/') + 1) : '';
  const outputExample = outputDir.trim() ? `${outputDir.trim().replace(/^\.\/+/, '').replace(/\/+$/, '')}/${pdfName}` : `${entryDir}${pdfName}`;

  const addFontFolder = async () => {
    const picked = await openDialog({ directory: true, multiple: false, defaultPath: ws.root, title: 'Choose a font folder' });
    if (typeof picked !== 'string') return;
    const rel = picked === ws.root ? '.' : picked.startsWith(ws.root + '/') ? picked.slice(ws.root.length + 1) : picked;
    if (!fonts.includes(rel)) await save({ fontPaths: [...fonts, rel] });
  };

  return (
    <Section title="The book’s files">
      {project.error && (
        <p className="bad">
          {project.error}{' '}
          <button
            className="link"
            onClick={() => {
              studio.closeSettings();
              void studio.openFile(PROJECT_FILE);
            }}
          >
            Open the file
          </button>
        </p>
      )}
      <div className="settings-field">
        <label className="settings-label" htmlFor="project-entry">
          Main file
        </label>
        <select id="project-entry" value={entry} disabled={locked} onChange={(e) => void save({ entryPoint: e.target.value })}>
          {typFiles.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
        <p className="settings-help">The file the preview and PDF export start from; chapters are included from it.</p>
      </div>
      <div className="settings-field">
        <label className="settings-label" htmlFor="project-root">
          Book folder (Typst root)
        </label>
        <input
          id="project-root"
          className="settings-input"
          value={root}
          placeholder={entryDir ? `${entryDir.replace(/\/$/, '')} (the main file’s folder)` : 'this folder'}
          disabled={locked}
          onChange={(e) => setRoot(e.target.value)}
          onBlur={() => root.trim() !== (project.settings.root ?? '') && void save({ root: root.trim() })}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
        <p className="settings-help">
          Where paths starting with <code>/</code> begin, like <code>image("/figures/map.png")</code>, and the folder Typst may read. For a book kept in a subfolder such as{' '}
          <code>src/</code>, the main file’s folder is used unless you set it here.
        </p>
      </div>
      <div className="settings-field">
        <label className="settings-label" htmlFor="project-output">
          PDF output folder
        </label>
        <input
          id="project-output"
          className="settings-input"
          value={outputDir}
          placeholder="next to the main file"
          disabled={locked}
          onChange={(e) => setOutputDir(e.target.value)}
          onBlur={() => outputDir.trim() !== (project.settings.outputDir ?? '') && void save({ outputDir: outputDir.trim() })}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
        <p className="settings-help">
          Export PDF (⇧⌘E) builds <code>{outputExample}</code>, then saves a copy where you choose.
        </p>
      </div>
      <div className="settings-field">
        <div className="settings-label">Extra font folders</div>
        {fonts.length === 0 && <p className="settings-help">None. Fonts installed on this Mac are always available.</p>}
        {fonts.map((f) => (
          <div className="settings-list-row" key={f}>
            <code>{f}</code>
            <button className="link" disabled={locked} onClick={() => void save({ fontPaths: fonts.filter((x) => x !== f) })}>
              Remove
            </button>
          </div>
        ))}
        <button disabled={locked} onClick={() => void addFontFolder()}>
          Add folder…
        </button>
        <p className="settings-help">Folders with .otf/.ttf files this book uses (for example a fonts/ folder in the project).</p>
      </div>
      {errors.map((e) => (
        <p className="bad" key={e}>
          {e}
        </p>
      ))}
    </Section>
  );
}

/** The assistant in this book: its style guide, the commands it may run here, and its code examples. */
function BookAssistantPage() {
  const ws = useStore(studio.store, (s) => s.workspace);
  const project = useStore(studio.store, (s) => s.project);
  const guide = useStore(studio.store, (s) => s.styleGuide);
  const code = useStore(studio.store, (s) => s.code);
  if (!ws) return null;
  return (
    <>
      <Section title="Writing style guide">
        <p className="settings-help">
          {guide.exists ? (
            <>
              Every message follows <code>WRITING_STYLE.md</code>.{' '}
              <button
                className="link"
                onClick={() => {
                  studio.closeSettings();
                  void studio.openFile('WRITING_STYLE.md');
                }}
              >
                Open it
              </button>
            </>
          ) : (
            'This book has no style guide yet: the chat offers to draft one from your chapters.'
          )}
        </p>
      </Section>
      <Section title="Commands to run without asking, in this book">
        <p className="settings-help">On top of those allowed in every book (Typst Studio ▸ Permissions), for the tools this book needs, like a book’s own scripts.</p>
        <div className="settings-field">
          <CommandList
            commands={project.settings.allowCommands ?? []}
            disabled={!!project.error}
            onChange={(allowCommands) => void studio.updateProjectSettings({ allowCommands })}
          />
        </div>
      </Section>
      {code.trusted && (
        <Section title="Code examples">
          <div className="settings-list-row">
            <span>Typst Studio may run this book’s code examples.</span>
            <button onClick={() => studio.code.revokeTrust()}>Stop allowing</button>
          </div>
        </Section>
      )}
    </>
  );
}

/** Where a page's settings are kept: Typst Studio's settings file, or the book's own. */
function ScopeBanner({ scope }: { scope: 'app' | 'book' }) {
  const file = useStore(studio.store, (s) => s.configFile);
  const ws = useStore(studio.store, (s) => s.workspace);
  if (scope === 'app') {
    return (
      <div className="settings-scope">
        <span>
          <strong>For every book.</strong> Saved in <code className="selectable">{file?.path ?? '~/.typst-studio/settings.json'}</code>; edit it by hand if you like, and changes apply when
          you come back to Typst Studio.{' '}
          <button className="link" onClick={() => void studio.openConfigFile()}>
            Open in text editor
          </button>
        </span>
        {file?.error && <span className="bad">The file can’t be read: {file.error} Typst Studio keeps your last settings and won’t change the file until it’s fixed.</span>}
      </div>
    );
  }
  return (
    <div className="settings-scope book">
      <span>
        <strong>For {ws?.name ?? 'this book'} only.</strong> Saved in <code>{PROJECT_FILE}</code> in the book’s folder, so it travels with the book.{' '}
        <button
          className="link"
          onClick={() => {
            studio.closeSettings();
            void studio.openFile(PROJECT_FILE);
          }}
        >
          Open the file
        </button>
      </span>
    </div>
  );
}

type Page = SettingsPage;
const PAGE_KEY = 'studio.settingsPage';

function readPage(): Page {
  try {
    const p = localStorage.getItem(PAGE_KEY);
    return p === 'general' || p === 'assistant' || p === 'permissions' || p === 'tools' || p === 'book' || p === 'book-assistant' ? p : 'general';
  } catch {
    return 'general';
  }
}

function GeneralPage() {
  const settings = useStore(studio.store, (s) => s.settings);
  const zoom = useStore(studio.store, (s) => s.zoom);
  const setTextSize = (px: number) => studio.updateSettings({ editorFontSize: Math.min(EDITOR_FONT_SIZES.max, Math.max(EDITOR_FONT_SIZES.min, Math.round(px))) });
  return (
    <>
      <Section title="Chat">
        <div className="settings-field">
          <div className="settings-label">Send a message with</div>
          <Choice
            label="Send a message with"
            value={settings.sendKey}
            onChange={(v) => studio.updateSettings({ sendKey: v })}
            options={[
              { value: 'enter', label: 'Enter', detail: 'Enter sends; Shift+Enter for a new line.' },
              { value: 'mod-enter', label: '⌘ Enter', detail: '⌘ Enter sends; Enter for a new line.' },
            ]}
          />
          <p className="settings-help">While the assistant works, the same key queues a message; ⌥⏎ sends it to the assistant right away.</p>
        </div>
      </Section>
      <Section title="Editor">
        <div className="settings-field">
          <div className="settings-label">Text size</div>
          <div className="settings-row">
            <button onClick={() => setTextSize(settings.editorFontSize - 1)} disabled={settings.editorFontSize <= EDITOR_FONT_SIZES.min} aria-label="Smaller text">
              −
            </button>
            <span className="settings-zoom">{settings.editorFontSize} px</span>
            <button onClick={() => setTextSize(settings.editorFontSize + 1)} disabled={settings.editorFontSize >= EDITOR_FONT_SIZES.max} aria-label="Bigger text">
              +
            </button>
            <button onClick={() => setTextSize(DEFAULT_SETTINGS.editorFontSize)} disabled={settings.editorFontSize === DEFAULT_SETTINGS.editorFontSize}>
              Default
            </button>
          </div>
          <p className="settings-help">The text you write, in the editor and in What changed. Size of everything (⌘= and ⌘−) scales the whole window, this text included.</p>
        </div>
        <div className="settings-field">
          <SwitchRow checked={settings.formatOnSave} onChange={(formatOnSave) => studio.updateSettings({ formatOnSave })}>
            <span className="settings-switch-label">Format on save</span>
            <span className="settings-help">Tidy spacing and indentation in Typst files, line up &amp; and &amp;&amp; in equations, and leave a blank line above and below each heading.</span>
          </SwitchRow>
          <p className="settings-help">
            With typstyle, the formatter VS Code’s Typst extension uses, so a file formatted here doesn’t change there; the blank lines around headings are Typst Studio’s own. Your sentences and
            line breaks stay as you wrote them. Format Document (⇧⌥F) formats the open file either way; ⌘Z undoes it.
          </p>
        </div>
      </Section>
      <Section title="Layout">
        <div className="settings-field">
          <div className="settings-label">History</div>
          <Choice
            label="History"
            value={settings.historyPlacement}
            onChange={(v) => studio.updateSettings({ historyPlacement: v })}
            options={[
              { value: 'tab', label: 'In its own tab', detail: 'A view of its own in the sidebar, next to Files.' },
              { value: 'below', label: 'Below the files', detail: 'Both visible at once; drag the divider between them to resize.' },
            ]}
          />
        </div>
        <div className="settings-field">
          <div className="settings-label">Size of everything</div>
          <div className="settings-row">
            <button onClick={() => void studio.zoom('out', 'key')} aria-label="Smaller">
              −
            </button>
            <span className="settings-zoom">{Math.round(zoom * 100)}%</span>
            <button onClick={() => void studio.zoom('in', 'key')} aria-label="Bigger">
              +
            </button>
            <button onClick={() => void studio.zoom('reset', 'key')}>Actual size</button>
          </div>
          <p className="settings-help">⌘= and ⌘− too, ⌘0 for actual size. Everything in the window follows it except the preview, whose pages always fit the pane.</p>
        </div>
      </Section>
    </>
  );
}

/** A list of commands to allow, with an add box. */
function CommandList({ commands, onChange, disabled = false }: { commands: string[]; onChange: (next: string[]) => void; disabled?: boolean }) {
  const [draft, setDraft] = useState('');
  const valid = isCommandName(draft.trim()) && !commands.includes(draft.trim());
  const add = () => {
    if (!valid) return;
    onChange([...commands, draft.trim()]);
    setDraft('');
  };
  return (
    <div className="command-list">
      <div className="command-chips">
        {commands.length === 0 && <span className="settings-help">None yet.</span>}
        {commands.map((c) => (
          <span key={c} className="command-chip editable">
            <code>{c}</code>
            <button className="icon chip-remove" aria-label={`Stop allowing ${c}`} disabled={disabled} onClick={() => onChange(commands.filter((x) => x !== c))}>
              <Icon name="close" size={11} />
            </button>
          </span>
        ))}
      </div>
      <form
        className="settings-row"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <input className="settings-input" aria-label="Command to allow" placeholder="e.g. python3" value={draft} disabled={disabled} onChange={(e) => setDraft(e.target.value)} />
        <button type="submit" disabled={!valid || disabled}>
          Allow
        </button>
      </form>
    </div>
  );
}

function PermissionsPage() {
  const settings = useStore(studio.store, (s) => s.settings);
  const ws = useStore(studio.store, (s) => s.workspace);
  return (
    <>
      <Section title="What the assistant may do">
        <PermissionsEditor />
      </Section>
      <Section title="Commands that never need asking">
        <p className="settings-help">They only look (list, read, search, compare), so they run in every mode. Written to save into a file (&gt; file) or with a writing option, they ask like any other command; hiding errors (2&gt;/dev/null) doesn't count. <code>sed -n</code> printing lines of a file runs too.</p>
        <div className="command-chips">
          {LOOK_COMMANDS.map((c) => (
            <code key={c} className="command-chip">
              {c}
            </code>
          ))}
        </div>
      </Section>
      <Section title="More commands to run without asking, in every book">
        <p className="settings-help">
          Tools your books use, like <code>python3</code> or <code>Rscript</code>. A command line still asks if any part of it isn’t allowed, writes with &gt;, or
          deletes; building the book stays blocked.
        </p>
        <div className="settings-field">
          <CommandList commands={settings.allowCommands} onChange={(allowCommands) => studio.updateSettings({ allowCommands })} />
          {ws && <p className="settings-help">Those for one book only are in that book’s settings (This book ▸ Assistant).</p>}
        </div>
      </Section>
    </>
  );
}

/**
 * One tool: what's in use and where it came from, and every way to pick
 * another: a copy found on this Mac, a file, a pasted path or a typed one
 * (checked as it's typed). Automatic goes back to the first copy found.
 */
function ToolCard({ tool, label, purpose, info, install, error }: { tool: ToolName; label: string; purpose: string; info: ToolInfo | undefined; install: string; error?: string }) {
  const chosen = useStore(studio.store, (s) => s.settings.toolPaths[tool] ?? '');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  // The path box's text while it's shown, and what's at that path.
  const [typing, setTyping] = useState<string | null>(null);
  const [probe, setProbe] = useState<ToolProbe | null>(null);
  const [busy, setBusy] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const copies = info?.copies ?? [];
  // The chosen path with ~ expanded, and the copy in use (for where it came from).
  const configured = info?.configured ?? null;
  const inUse = copies.find((c) => c.path === info?.path);
  const unusable = !!chosen && !!info && info.fromSettings === false;

  const apply = async (path: string) => {
    setOpen(false);
    setBusy(true);
    try {
      await studio.setToolPath(tool, path);
    } finally {
      setBusy(false);
    }
  };
  // A path from the file picker or the clipboard: used if it's the program, or else shown in the box with what's wrong.
  const offer = async (raw: string | null) => {
    const path = pastedPath(raw ?? '');
    if (!path) {
      studio.toast('There’s no path on the clipboard.');
      return;
    }
    const found = await ipc.toolProbe(tool, path).catch(() => null);
    if (found && !found.problem) {
      setTyping(null);
      await apply(path);
    } else {
      setTyping(path);
      setProbe(found);
    }
  };
  const choose = async () => {
    setOpen(false);
    const picked = await openDialog({ directory: false, multiple: false, defaultPath: info?.path ?? undefined, title: `Choose the ${label} program` });
    if (typeof picked === 'string') await offer(picked);
  };
  const paste = async () => {
    setOpen(false);
    await offer(await ipc.clipboardRead().catch(() => null));
  };
  const startTyping = () => {
    setOpen(false);
    setTyping(chosen && !copies.some((c) => c.path === configured) ? chosen : '');
  };
  const use = () => typing !== null && probe && !probe.problem && void apply(typing).then(() => setTyping(null));

  // What's at the typed path, checked as it's typed.
  useEffect(() => {
    if (typing === null || !typing.trim()) return setProbe(null);
    const timer = setTimeout(() => void ipc.toolProbe(tool, typing).then(setProbe, () => setProbe(null)), 200);
    return () => clearTimeout(timer);
  }, [typing, tool]);

  type Row = { key: string; run: () => void; selected?: boolean; content: ReactNode; className?: string };
  const rows: Row[] = [
    {
      key: 'automatic',
      run: () => void apply(''),
      selected: !chosen,
      content: (
        <>
          <span className="tool-option-title">Automatic</span>
          <span className="tool-option-detail">{copies[0] ? `The first one found: ${copies[0].version ?? 'version unknown'}, ${copies[0].source}` : 'Nothing found yet'}</span>
        </>
      ),
    },
    ...copies.map((c) => ({
      key: c.path,
      run: () => void apply(c.path),
      selected: !!chosen && configured === c.path,
      className: 'tool-copy',
      content: (
        <>
          <span className="tool-option-title">
            {c.version ?? 'version unknown'} <span className="muted">· {c.source}</span>
          </span>
          <span className="tool-option-path">{tildePath(c.path)}</span>
        </>
      ),
    })),
    { key: 'choose', run: () => void choose(), className: 'tool-action', content: <><Icon name="folder" size={14} /> Choose a file…</> },
    { key: 'paste', run: () => void paste(), className: 'tool-action', content: <><Icon name="paste" size={14} /> Paste a path</> },
    { key: 'type', run: startTyping, className: 'tool-action', content: <><Icon name="edit" size={14} /> Type a path…</> },
  ];
  const firstAction = rows.length - 3;

  useEffect(() => {
    if (!open) return;
    setHighlight(Math.max(0, rows.findIndex((r) => r.selected)));
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    listRef.current?.querySelector(`[data-row="${highlight}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [highlight]);
  const onListKey = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => (h + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      rows[highlight]?.run();
    } else if (e.key === 'Escape') {
      // Closes the list, not Settings.
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    }
  };

  return (
    <div className="tool-card" ref={rootRef}>
      <div className="tool-card-head">
        <span className={`tool-dot ${info ? (info.path ? 'ok' : 'bad') : ''}`} title={info ? (info.path ? 'Installed' : 'Not found') : 'Looking…'} />
        <span className="settings-label">{label}</span>
        <span className="settings-help">{purpose}</span>
      </div>
      <div className="tool-picker" onKeyDown={onListKey}>
        <button className="tool-trigger" aria-haspopup="listbox" aria-expanded={open} aria-label={`${label}: which program`} disabled={busy} onClick={() => setOpen(!open)}>
          <span className="tool-choice">{chosen ? 'Your choice' : 'Automatic'}</span>
          {info?.path ? (
            <>
              <span className="tool-version">{info.version ?? 'version unknown'}</span>
              <span className="tool-source">{inUse?.source ?? 'a path you chose'}</span>
              <span className="tool-path">{tildePath(info.path)}</span>
            </>
          ) : (
            <span className="tool-version bad">{info ? 'Not found' : 'Looking…'}</span>
          )}
          <Icon name="chevronDown" size={14} />
        </button>
        {open && (
          <div className="tool-list" role="listbox" aria-label={`${label} programs`} ref={listRef}>
            {rows.map((r, i) => (
              <div key={r.key}>
                {i === 1 && copies.length > 0 && <div className="tool-list-section">Found on this Mac</div>}
                {i === firstAction && <div className="tool-list-divider" />}
                <div
                  role="option"
                  aria-selected={!!r.selected}
                  data-row={i}
                  className={`tool-option ${r.className ?? ''}${i === highlight ? ' highlighted' : ''}`}
                  onMouseEnter={() => setHighlight(i)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={r.run}
                >
                  <span className="tool-option-check">{r.selected && <Icon name="check" size={13} />}</span>
                  <span className="tool-option-body">{r.content}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {typing !== null && (
        <div className="tool-typing">
          <div className="settings-row">
            <input
              className="settings-input"
              aria-label={`${label} program path`}
              placeholder={`/path/to/${tool}, or ~/…`}
              spellCheck={false}
              autoFocus
              value={typing}
              onChange={(e) => setTyping(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') use();
                else if (e.key === 'Escape') {
                  // Closes the box, not Settings.
                  e.stopPropagation();
                  setTyping(null);
                }
              }}
            />
            <button className="small primary" disabled={!probe || !!probe.problem || busy} onClick={use}>
              Use
            </button>
            <button className="small" onClick={() => setTyping(null)}>
              Cancel
            </button>
          </div>
          <div className={`tool-probe ${probe ? (probe.problem ? 'bad' : 'ok') : ''}`}>
            {!typing.trim() ? 'Type or paste the path of the program.' : !probe ? 'Checking…' : probe.problem ?? `${label} ${probe.version ?? ''} — ready to use`}
          </div>
        </div>
      )}
      {unusable && <div className="settings-help bad">There’s no program at {tildePath(configured ?? chosen)}, so Typst Studio uses {info?.path ? 'the first one it found' : 'none'}.</div>}
      {info && !info.path && (
        <div className="settings-help">
          Not installed? In Terminal: <code className="selectable">{install}</code>{' '}
          <button className="link" onClick={() => void ipc.clipboardWrite(install).then(() => studio.toast('Copied.'))}>
            Copy
          </button>
          , then Search again.
        </div>
      )}
      {error && <div className="settings-help bad">{error}</div>}
    </div>
  );
}

function ToolsPage() {
  const tools = useStore(studio.store, (s) => s.tools);
  const history = useStore(studio.store, (s) => s.history);
  const [searching, setSearching] = useState(false);
  const search = async () => {
    setSearching(true);
    try {
      await studio.refreshTools();
    } finally {
      setSearching(false);
    }
  };
  // A tool may have been installed or moved since the app started.
  useEffect(() => void search().catch(() => {}), []);
  return (
    <Section title="Tools Typst Studio uses">
      <div className="tools-intro">
        <p className="settings-help">
          Typst Studio looks in Homebrew, your PATH and editors’ Typst extensions, and uses the first copy it finds. Pick another and the preview, the assistant or History starts again with it.
        </p>
        <button className="small tools-search" disabled={searching} onClick={() => void search()}>
          <Icon name="refresh" size={13} /> {searching ? 'Searching…' : 'Search again'}
        </button>
      </div>
      <ToolCard tool="tinymist" label="Tinymist" purpose="Typesets the live preview and exports PDFs." info={tools?.tinymist} install="brew install tinymist" />
      <ToolCard tool="opencode" label="OpenCode" purpose="Runs the writing assistant." info={tools?.opencode} install="brew install opencode" />
      <ToolCard
        tool="git"
        label="Git"
        purpose="Keeps History, in Typst Studio’s own folder. If your book is in a Git repository, Source Control uses it too."
        info={tools?.git}
        install="xcode-select --install"
        error={tools?.git?.path ? history.error : undefined}
      />
    </Section>
  );
}

/**
 * Show only what matches a search, as VS Code's settings search does. Every page
 * is shown (see SettingsDialog), and each section keeps the parts whose text, with
 * the page's and the section's names, has every word. A section's opening help
 * stays with any match in it. Returns the number of matching parts on each page,
 * and where the words are in what's shown.
 */
function filterSettings(root: HTMLElement, words: string[]) {
  const counts: Record<string, number> = {};
  const marks: Range[] = [];
  const mark = (el: Element | null) => {
    if (!el) return;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
      for (const [start, end] of wordSpans(node.data, words)) {
        const range = new Range();
        range.setStart(node, start);
        range.setEnd(node, end);
        marks.push(range);
      }
    }
  };
  for (const page of root.querySelectorAll<HTMLElement>('.settings-page')) {
    const title = page.querySelector('.settings-page-title');
    let hits = 0;
    for (const section of page.querySelectorAll<HTMLElement>('.settings-section')) {
      const heading = section.querySelector(':scope > h2');
      const parts = [...section.children].filter((c): c is HTMLElement => c !== heading && c instanceof HTMLElement);
      const found = parts.map((p) => hasWords(`${title?.textContent} ${heading?.textContent} ${p.textContent}`, words));
      const any = found.includes(true);
      parts.forEach((p, i) => {
        p.hidden = !(found[i] || (any && p.matches('p.settings-help')));
        if (!p.hidden) mark(p);
      });
      section.hidden = !any;
      if (any) mark(heading);
      hits += found.filter(Boolean).length;
    }
    page.hidden = !hits;
    if (hits) mark(title);
    counts[page.dataset.page!] = hits;
  }
  return { counts, marks };
}

/**
 * Boxes behind the matched words, in `scroller`'s content coordinates (so they
 * scroll with it). WebKit's CSS Custom Highlight API registers ranges here but
 * doesn't paint them, so they're drawn as boxes.
 */
function markBoxes(scroller: HTMLElement, ranges: Range[]): [number, number, number, number][] {
  const at = scroller.getBoundingClientRect();
  const r = (n: number) => Math.round(n * 10) / 10;
  return ranges.flatMap((range) =>
    [...range.getClientRects()].map((b): [number, number, number, number] => [r(b.left - at.left + scroller.scrollLeft), r(b.top - at.top + scroller.scrollTop), r(b.width), r(b.height)]),
  );
}

export function SettingsDialog() {
  const ws = useStore(studio.store, (s) => s.workspace);
  const dialogRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [marks, setMarks] = useState<[number, number, number, number][]>([]);
  const words = searchWords(query);
  const searching = words.length > 0;
  const [page, setPageState] = useState<Page>(() => studio.state.settingsPage ?? readPage());
  const setPage = (p: Page) => {
    setPageState(p);
    try {
      localStorage.setItem(PAGE_KEY, p);
    } catch {
      // Only a convenience.
    }
  };
  // Typst Studio's own settings (every book), then this book's (saved with it), as VS Code's User and Workspace.
  const pages: { id: Page; label: string; icon: IconName; scope: 'app' | 'book' }[] = [
    { id: 'general', label: 'General', icon: 'settings', scope: 'app' },
    { id: 'assistant', label: 'Assistant', icon: 'sparkle', scope: 'app' },
    { id: 'permissions', label: 'Permissions', icon: 'shield', scope: 'app' },
    { id: 'tools', label: 'Tools', icon: 'code', scope: 'app' },
    ...(ws
      ? [
          { id: 'book' as const, label: 'Files', icon: 'book' as const, scope: 'book' as const },
          { id: 'book-assistant' as const, label: 'Assistant', icon: 'sparkle' as const, scope: 'book' as const },
        ]
      : []),
  ];
  const groupTitle = (scope: 'app' | 'book') => (scope === 'app' ? 'Typst Studio' : `This book · ${ws?.name ?? ''}`);
  const current = pages.some((p) => p.id === page) ? page : 'general';
  const total = pages.reduce((n, p) => n + (counts[p.id] ?? 0), 0);

  const focusSearch = () => {
    searchRef.current?.focus();
    searchRef.current?.select();
  };
  useEffect(() => studio.events.on('find-in-settings', focusSearch), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        // Esc clears a search first, as in VS Code; then it closes.
        if (searchRef.current?.value) setQuery('');
        else studio.closeSettings();
      } else if (e.metaKey && !e.altKey && !e.ctrlKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        focusSearch();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  // Opening puts the cursor in the search box; picking a page, on its first setting.
  useEffect(() => searchRef.current?.focus(), []);
  const shownPage = useRef(current);
  useEffect(() => {
    if (shownPage.current === current) return;
    shownPage.current = current;
    const root = dialogRef.current;
    // The page's first setting, not the line saying where it's saved.
    (
      root?.querySelector<HTMLElement>('.settings-section input:checked, .settings-section [role="radio"][aria-checked="true"]') ??
      root?.querySelector<HTMLElement>('.settings-section input, .settings-section select, .settings-section button')
    )?.focus();
  }, [current]);
  useLayoutEffect(() => {
    const scroller = contentRef.current;
    const results = resultsRef.current;
    if (!scroller || !results || !searching) return;
    const same = <T,>(a: T, b: T) => JSON.stringify(a) === JSON.stringify(b);
    const apply = () => {
      const found = filterSettings(results, words);
      const boxes = markBoxes(scroller, found.marks);
      setCounts((prev) => (same(prev, found.counts) ? prev : found.counts));
      setMarks((prev) => (same(prev, boxes) ? prev : boxes));
    };
    apply();
    // A page redraws on its own when a setting changes, and text rewraps when the window does.
    const observer = new MutationObserver(apply);
    observer.observe(results, { childList: true, subtree: true, characterData: true });
    const resized = new ResizeObserver(apply);
    resized.observe(results);
    return () => {
      observer.disconnect();
      resized.disconnect();
    };
  }, [query]);

  const pageContent = (id: Page) =>
    ({ general: <GeneralPage />, assistant: <AssistantPage goToTools={() => (setQuery(''), setPage('tools'))} />, permissions: <PermissionsPage />, tools: <ToolsPage />, book: <ProjectSection />, 'book-assistant': <BookAssistantPage /> })[id];
  const scopeOf = (id: Page) => pages.find((p) => p.id === id)?.scope ?? 'app';

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && studio.closeSettings()}>
      <div className="modal settings" role="dialog" aria-modal="true" aria-label="Settings" ref={dialogRef}>
        <header className="modal-header">
          <h1>Settings</h1>
          <span className="muted settings-shortcut">⌘,</span>
          <label className="settings-search">
            <Icon name="search" size={14} />
            <input ref={searchRef} value={query} placeholder="Search settings" aria-label="Search settings" spellCheck={false} onChange={(e) => setQuery(e.target.value)} />
            {searching && <span className="settings-found">{total === 1 ? '1 setting' : `${total} settings`}</span>}
          </label>
          <span className="spacer" />
          <button className="icon modal-close" aria-label="Close settings" title="Close (Esc)" onClick={() => studio.closeSettings()}>
            <Icon name="close" size={16} />
          </button>
        </header>
        <div className="settings-layout">
          <nav className="settings-nav" role="tablist" aria-orientation="vertical">
            {pages.map((p, i) => [
              pages[i - 1]?.scope !== p.scope && (
                <div key={`${p.scope}-title`} className="settings-nav-group" title={p.scope === 'book' ? 'Saved in the book’s folder, so they travel with it' : 'For every book'}>
                  {groupTitle(p.scope)}
                </div>
              ),
              searching ? (
                // While searching, every page is shown: its name goes to its matches, with their count.
                <button
                  key={p.id}
                  className={counts[p.id] ? '' : 'no-match'}
                  disabled={!counts[p.id]}
                  onClick={() => contentRef.current?.querySelector(`[data-page="${p.id}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' })}
                >
                  <Icon name={p.icon} size={16} />
                  {p.label}
                  <span className="settings-count">{counts[p.id] ?? 0}</span>
                </button>
              ) : (
                <button key={p.id} role="tab" aria-selected={current === p.id} className={current === p.id ? 'active' : ''} onClick={() => setPage(p.id)}>
                  <Icon name={p.icon} size={16} />
                  {p.label}
                </button>
              ),
            ])}
          </nav>
          <div className="settings-content" role="tabpanel" ref={contentRef}>
            {searching ? (
              <>
                <div className="settings-marks" aria-hidden>
                  {marks.map(([left, top, width, height], i) => (
                    <span key={i} className="settings-mark" style={{ left, top, width, height }} />
                  ))}
                </div>
                <div className="settings-results" ref={resultsRef}>
                  {pages.map((p) => (
                    <div key={p.id} className="settings-page" data-page={p.id}>
                      <h1 className="settings-page-title">
                        {p.scope === 'book' ? `This book · ${p.label}` : p.label}
                      </h1>
                      {pageContent(p.id)}
                    </div>
                  ))}
                </div>
                {total === 0 && <p className="settings-none muted">No settings match “{query.trim()}”.</p>}
              </>
            ) : (
              <>
                <ScopeBanner scope={scopeOf(current)} />
                {pageContent(current)}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
