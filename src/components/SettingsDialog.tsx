import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { PROJECT_FILE } from '../app/project-settings';
import { studio, type SettingsPage } from '../app/studio';
import { useStore } from '../lib/store';
import { hasWords, searchWords, wordSpans } from '../lib/word-search';
import { PermissionsEditor } from './Permissions';
import { Icon, type IconName } from './icons';
import { LOOK_COMMANDS } from '../services/agent/permissions';
import { isCommandName } from '../app/settings';

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="settings-section">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function Radio<T extends string>({ name, value, current, onChange, label, detail }: { name: string; value: T; current: T; onChange: (v: T) => void; label: string; detail?: string }) {
  return (
    <label className="settings-option">
      <input type="radio" name={name} checked={current === value} onChange={() => onChange(value)} />
      <span>
        {label}
        {detail && <span className="muted"> — {detail}</span>}
      </span>
    </label>
  );
}

function ProjectSection() {
  const ws = useStore(studio.store, (s) => s.workspace);
  const project = useStore(studio.store, (s) => s.project);
  const code = useStore(studio.store, (s) => s.code);
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
    <Section title={`Project · ${ws.name}`}>
      <p className="settings-help">
        Saved in <code>{PROJECT_FILE}</code> in the project folder, so these travel with the book.
      </p>
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
      {code.trusted && (
        <div className="settings-field">
          <div className="settings-label">Code examples</div>
          <div className="settings-list-row">
            <span>Typst Studio may run this book’s code examples.</span>
            <button onClick={() => studio.code.revokeTrust()}>Stop allowing</button>
          </div>
        </div>
      )}
    </Section>
  );
}

type Page = SettingsPage;
const PAGE_KEY = 'studio.settingsPage';

function readPage(): Page {
  try {
    const p = localStorage.getItem(PAGE_KEY);
    return p === 'general' || p === 'assistant' || p === 'permissions' || p === 'book' || p === 'tools' ? p : 'general';
  } catch {
    return 'general';
  }
}

/** Where all of these are kept: a file the author can edit by hand. */
function SettingsFileSection() {
  const file = useStore(studio.store, (s) => s.configFile);
  if (!file) return null;
  return (
    <Section title="Settings file">
      <div className="settings-row">
        <code className="selectable">{file.path}</code>
        <button className="small" onClick={() => void studio.openConfigFile()}>
          Open in text editor
        </button>
      </div>
      {file.error ? (
        <p className="settings-help bad">
          The file can’t be read: {file.error} Typst Studio keeps your last settings and won’t change the file until it’s fixed.
        </p>
      ) : (
        <p className="settings-help">Everything here is kept in this file. Edit it by hand if you like: changes apply when you come back to Typst Studio.</p>
      )}
    </Section>
  );
}

function GeneralPage() {
  const settings = useStore(studio.store, (s) => s.settings);
  const zoom = useStore(studio.store, (s) => s.zoom);
  return (
    <>
      <Section title="Chat">
        <div className="settings-field">
          <div className="settings-label">Send a message with</div>
          <Radio name="sendKey" value="enter" current={settings.sendKey} onChange={(v) => studio.updateSettings({ sendKey: v })} label="Enter" detail="Shift+Enter for a new line" />
          <Radio name="sendKey" value="mod-enter" current={settings.sendKey} onChange={(v) => studio.updateSettings({ sendKey: v })} label="⌘ Enter" detail="Enter for a new line" />
          <p className="settings-help">While the assistant works, the same key queues a message; ⌥⏎ sends it to the assistant right away.</p>
        </div>
      </Section>
      <SettingsFileSection />
      <Section title="Layout">
        <div className="settings-field">
          <div className="settings-label">History</div>
          <Radio name="historyPlacement" value="tab" current={settings.historyPlacement} onChange={(v) => studio.updateSettings({ historyPlacement: v })} label="In its own tab" detail="next to Files" />
          <Radio
            name="historyPlacement"
            value="below"
            current={settings.historyPlacement}
            onChange={(v) => studio.updateSettings({ historyPlacement: v })}
            label="Below the files"
            detail="both visible at once; drag the divider to resize"
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
          <p className="settings-help">⌘= and ⌘− too. Toolbar and sidebar icons never get smaller than they are at 100%.</p>
        </div>
      </Section>
    </>
  );
}

function AssistantPage() {
  const settings = useStore(studio.store, (s) => s.settings);
  const model = useStore(studio.store, (s) => s.agent.model);
  const guide = useStore(studio.store, (s) => s.styleGuide);
  const ws = useStore(studio.store, (s) => s.workspace);
  return (
    <>
      <Section title="Model">
        <p className="settings-help">
          Now: <strong>{model ? `${model.id} (${model.providerID})` : 'the server’s default'}</strong>. Change it under the chat’s message box; each conversation remembers its own.
        </p>
      </Section>
      <Section title="The assistant’s marks in the editor">
        <div className="settings-field">
          <label className="settings-option">
            <input type="checkbox" checked={settings.markAiEdits} onChange={(e) => studio.updateSettings({ markAiEdits: e.target.checked })} />
            <span>
              Lines the assistant changed <span className="ai-swatch edit" />
              <span className="muted"> — until you rewrite them; hover the line number for what was there before</span>
            </span>
          </label>
          <label className="settings-option">
            <input type="checkbox" checked={settings.markAiReads} onChange={(e) => studio.updateSettings({ markAiReads: e.target.checked })} />
            <span>
              Lines the assistant read <span className="ai-swatch read" />
              <span className="muted"> — in the current conversation</span>
            </span>
          </label>
        </div>
      </Section>
      {ws && (
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
      )}
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
  const project = useStore(studio.store, (s) => s.project);
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
      <Section title="More commands to run without asking">
        <p className="settings-help">
          Tools your books use, like <code>python3</code> or <code>Rscript</code>. A command line still asks if any part of it isn’t allowed, writes with &gt;, or
          deletes; building the book stays blocked.
        </p>
        <div className="settings-field">
          <div className="settings-label">In every book</div>
          <CommandList commands={settings.allowCommands} onChange={(allowCommands) => studio.updateSettings({ allowCommands })} />
        </div>
        {ws && (
          <div className="settings-field">
            <div className="settings-label">In this book only</div>
            <CommandList
              commands={project.settings.allowCommands ?? []}
              disabled={!!project.error}
              onChange={(allowCommands) => void studio.updateProjectSettings({ allowCommands })}
            />
            <p className="settings-help">
              Saved in <code>{PROJECT_FILE}</code>, so it travels with the book.
            </p>
          </div>
        )}
      </Section>
    </>
  );
}

function ToolsPage() {
  const tools = useStore(studio.store, (s) => s.tools);
  const history = useStore(studio.store, (s) => s.history);
  const row = (label: string, purpose: string, info: { path: string | null; version: string | null } | undefined, install: string) => (
    <div className="tool-status-row" key={label}>
      <span className={info?.path ? 'ok' : 'bad'}>{info ? (info.path ? '✓' : '✕') : '…'}</span>
      <div>
        <div className="settings-label">
          {label} {info?.version && <span className="muted">{info.version}</span>}
        </div>
        <div className="settings-help">{purpose}</div>
        {info?.path ? <code className="selectable">{info.path}</code> : info && <div className="settings-help">Not installed. In Terminal: <code className="selectable">{install}</code>, then restart Typst Studio.</div>}
      </div>
    </div>
  );
  return (
    <Section title="Tools Typst Studio uses">
      {row('Tinymist', 'Typesets the live preview and exports PDFs.', tools?.tinymist, 'brew install tinymist')}
      {row('OpenCode', 'Runs the writing assistant.', tools?.opencode, 'brew install opencode')}
      <div className="tool-status-row">
        <span className={history.status === 'ready' ? 'ok' : history.status === 'unavailable' ? 'bad' : 'muted'}>{history.status === 'ready' ? '✓' : history.status === 'unavailable' ? '✕' : '…'}</span>
        <div>
          <div className="settings-label">git</div>
          <div className="settings-help">Keeps History (in Typst Studio’s own folder; your book’s git is never touched).</div>
          {history.error && <div className="settings-help bad">{history.error}</div>}
        </div>
      </div>
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
  const pages: { id: Page; label: string; icon: IconName }[] = [
    { id: 'general', label: 'General', icon: 'settings' },
    { id: 'assistant', label: 'Assistant', icon: 'sparkle' },
    { id: 'permissions', label: 'Permissions', icon: 'shield' },
    ...(ws ? [{ id: 'book' as const, label: 'This book', icon: 'book' as const }] : []),
    { id: 'tools', label: 'Tools', icon: 'code' },
  ];
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
    (root?.querySelector<HTMLElement>('.settings-content input:checked') ?? root?.querySelector<HTMLElement>('.settings-content input, .settings-content select, .settings-content button'))?.focus();
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
    ({ general: <GeneralPage />, assistant: <AssistantPage />, permissions: <PermissionsPage />, book: <ProjectSection />, tools: <ToolsPage /> })[id];

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
            {pages.map((p) =>
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
            )}
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
                      <h1 className="settings-page-title">{p.label}</h1>
                      {pageContent(p.id)}
                    </div>
                  ))}
                </div>
                {total === 0 && <p className="settings-none muted">No settings match “{query.trim()}”.</p>}
              </>
            ) : (
              pageContent(current)
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
