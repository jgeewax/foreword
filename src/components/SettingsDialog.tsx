import { appDataDir } from '@tauri-apps/api/path';
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { BOOK_COLORS, effectiveBookColor, randomBookColor } from '../app/book-color';
import { PROJECT_FILE } from '../app/project-settings';
import { studio, type SettingsPage } from '../app/studio';
import { ipc, type ToolInfo } from '../lib/ipc';
import { useStore } from '../lib/store';
import { tildePath } from '../lib/paths';
import { hasWords, searchWords, wordSpans } from '../lib/word-search';
import { PermissionsEditor } from './Permissions';
import { Icon, type IconName } from './icons';
import { LOOK_COMMANDS } from '../services/agent/permissions';
import { AssistantPage } from './AssistantSettings';
import { BookFilesPage } from './BookFilesSettings';
import { Choice, ColorChoice, SwitchRow, TypedSetting } from './SettingControls';
import { ToolPicker } from './ToolPicker';
import { DownloadProgress, InstallSteps, RELEASES } from './UpdateDialog';
import appIcon from '../../src-tauri/icons/128x128@2x.png';
import { AUTO_SAVE_MINUTES, DEFAULT_SETTINGS, EDITOR_COLUMNS, EDITOR_FONT_SIZES, isAutoSaveMinutes, isCommandName, MARK_COLORS, parseRulers, rulersText, type ToolName } from '../app/settings';

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="settings-section">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

/**
 * This book's colour on its window, as VS Code's Peacock gives a folder: a
 * swatch, any colour, none, or one at random. A book with Peacock's colour
 * in its VS Code settings wears that until it has its own.
 */
function BookColorPage() {
  const ws = useStore(studio.store, (s) => s.workspace);
  const own = useStore(studio.store, (s) => s.project.settings.color);
  const peacock = useStore(studio.store, (s) => s.peacockColor);
  if (!ws) return null;
  const color = effectiveBookColor(own, peacock);
  return (
    <Section title="The book’s colour">
      <p className="settings-help">The window wears it on its title bar, its icons down the left and its status bar, so a glance tells this book’s window from another’s.</p>
      <div className="settings-field book-color-choice">
        <ColorChoice
          label="Book colour"
          on={!!color}
          color={color ?? BOOK_COLORS[5].color}
          colors={BOOK_COLORS}
          none={{ label: 'None', title: 'The window’s usual colours' }}
          onChange={(c) => studio.setBookColor(c.on ? c.color! : peacock ? 'none' : null)}
        />
        <button className="small" title="A colour of its own, at random" onClick={() => studio.setBookColor(randomBookColor())}>
          Surprise me
        </button>
      </div>
      {peacock && (
        <p className="settings-help">
          VS Code’s Peacock gives this book <span className="swatch-inline" style={{ '--swatch': peacock } as CSSProperties} /> <code>{peacock}</code>, in <code>.vscode/settings.json</code>
          {own ? (
            <>
              .{' '}
              <button className="link" onClick={() => studio.setBookColor(null)}>
                Use Peacock’s
              </button>
            </>
          ) : (
            ', so the window wears it here too.'
          )}
        </p>
      )}
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
          <strong>For every book.</strong> Saved in <code className="selectable">{tildePath(file?.path ?? '~/.typst-studio/settings.json')}</code>; edit it by hand if you like, and changes apply when
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
        <strong>For {ws?.name ?? 'this book'} only.</strong> Saved in <code className="selectable">{ws ? tildePath(`${ws.root}/${PROJECT_FILE}`) : PROJECT_FILE}</code>, in the
        book’s folder, so it travels with the book.{' '}
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
    return p === 'general' || p === 'editor' || p === 'assistant' || p === 'permissions' || p === 'tools' || p === 'book' || p === 'book-assistant' || p === 'book-color' ? p : 'general';
  } catch {
    return 'general';
  }
}

function GeneralPage() {
  const settings = useStore(studio.store, (s) => s.settings);
  const zoom = useStore(studio.store, (s) => s.zoom);
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
      <Section title="Layout">
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
      <UpdatesSection />
    </>
  );
}

/** Typst Studio's version and updates: check now, install, and whether to check at start. */
function UpdatesSection() {
  const update = useStore(studio.store, (s) => s.update);
  const settings = useStore(studio.store, (s) => s.settings);
  if (!update) return null;
  const { status, version } = update;
  const at = update.checkedAt ? new Date(update.checkedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : null;
  const line = {
    idle: 'Not checked yet.',
    checking: 'Checking…',
    none: `Up to date${at ? `, checked at ${at}` : ''}.`,
    available: `Typst Studio ${version} is available.`,
    downloading: `Downloading ${version}…`,
    downloaded: update.onQuit ? `${version} installs when you quit.` : `${version} is downloaded.`,
    installing: `Installing ${version}…`,
    restarting: 'Restarting…',
    error: update.error ?? 'Something went wrong.',
  }[status];
  const working = status === 'checking' || status === 'downloading' || status === 'installing' || status === 'restarting';
  return (
    <Section title="Updates">
      <div className="settings-field update-settings">
        <div className="update-row">
          <img src={appIcon} alt="" width={40} height={40} />
          <span className="settings-switch-text">
            <span className="settings-switch-label">Typst Studio {update.current}</span>
            <span className={`settings-help${status === 'error' ? ' bad' : ''}`}>{line}</span>
          </span>
          <button className="small" disabled={working} onClick={() => void studio.checkForUpdates({ dialog: false, inPlace: true })}>
            {status === 'checking' ? 'Checking…' : 'Check Now'}
          </button>
        </div>
        {status === 'available' && (
          <div className="update-actions">
            <button className="link" onClick={() => studio.store.set({ updateDialog: true })}>
              What’s new in {version}
            </button>
            <span className="spacer" />
            {update.installable ? (
              <>
                <button className="small" onClick={() => studio.skipUpdate()}>
                  Skip This Version
                </button>
                <button className="small" onClick={() => void studio.installUpdateOnQuit()}>
                  Install When I Quit
                </button>
                <button className="small primary" onClick={() => void studio.installUpdateNow()}>
                  Install Now
                </button>
              </>
            ) : (
              <button className="small" onClick={() => void ipc.openUrl(`${RELEASES}/tag/v${version}`)}>
                Open the Release Page
              </button>
            )}
          </div>
        )}
        {status === 'downloading' && <DownloadProgress update={update} />}
        {status === 'downloaded' && (
          <div className="update-actions">
            <span className="spacer" />
            {update.onQuit && (
              <button className="small" onClick={() => void studio.cancelUpdateOnQuit()}>
                Don’t Install at Quit
              </button>
            )}
            <button className="small primary" onClick={() => void studio.installUpdateNow()}>
              Install Now
            </button>
          </div>
        )}
        {(status === 'installing' || status === 'restarting') && <InstallSteps update={update} />}
      </div>
      <div className="settings-field">
        <SwitchRow checked={settings.checkForUpdates} onChange={(checkForUpdates) => studio.updateSettings({ checkForUpdates })}>
          <span className="settings-switch-label">Check for updates when Typst Studio starts</span>
          <span className="settings-help">A new version is offered once: install it now, when you quit, or skip it, and only a newer one is offered after.</span>
        </SwitchRow>
        {settings.skippedUpdate && (
          <p className="settings-help">
            You skipped {settings.skippedUpdate}.{' '}
            <button className="link" onClick={() => studio.updateSettings({ skippedUpdate: '' })}>
              Offer it again
            </button>
          </p>
        )}
        <p className="settings-help">
          From Typst Studio’s releases on GitHub,{' '}
          <button className="link" onClick={() => void ipc.openUrl(RELEASES)}>
            github.com/jgeewax/typststudio/releases
          </button>
          , each checked against its signature before it’s installed.
          {update.installable ? '' : ' This copy runs from source (npm run app), so it can’t replace itself: updates are for Typst Studio installed from its DMG.'}
        </p>
      </div>
    </Section>
  );
}

/** The editor: its text, formatting on save, long lines, and how the assistant's lines are marked in it. */
function EditorPage() {
  const settings = useStore(studio.store, (s) => s.settings);
  const setTextSize = (px: number) => studio.updateSettings({ editorFontSize: Math.min(EDITOR_FONT_SIZES.max, Math.max(EDITOR_FONT_SIZES.min, Math.round(px))) });
  return (
    <>
      <Section title="Text and formatting">
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
              Default ({DEFAULT_SETTINGS.editorFontSize} px)
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
        <div className="settings-field">
          <SwitchRow checked={settings.autoSaveMinutes > 0} onChange={(on) => studio.updateSettings({ autoSaveMinutes: on ? DEFAULT_SETTINGS.autoSaveMinutes : 0 })}>
            <span className="settings-switch-label">Auto save</span>
            <span className="settings-help">Every few minutes, files with unsaved changes are saved, so a crash or a flat battery costs you a few minutes at most. Not formatted, so nothing moves while you type.</span>
          </SwitchRow>
          {settings.autoSaveMinutes > 0 && (
            <div className="settings-wrap-column">
              <TypedSetting
                label="Auto save every"
                value={settings.autoSaveMinutes}
                parse={(text) => {
                  const n = Number(text.trim());
                  return isAutoSaveMinutes(n) && n > 0 ? n : null;
                }}
                format={String}
                onChange={(autoSaveMinutes) => studio.updateSettings({ autoSaveMinutes })}
                mistake={`A whole number of minutes, from 1 to ${AUTO_SAVE_MINUTES.max}.`}
                className="settings-column"
                before="Every"
                after="minutes"
              />
            </div>
          )}
        </div>
      </Section>
      <Section title="Long lines">
        <div className="settings-field">
          <div className="settings-label">Wrap long lines</div>
          <Choice
            label="Wrap long lines"
            value={settings.wordWrap}
            onChange={(wordWrap) => studio.updateSettings({ wordWrap })}
            options={[
              { value: 'window', label: 'At the edge', detail: 'Where the editor ends, so a paragraph rewraps as the window or the pane changes size.' },
              { value: 'column', label: 'At a column' },
              { value: 'off', label: 'Don’t wrap', detail: 'A line runs on past the edge until you start a new one; scroll sideways to read the rest.' },
            ]}
          />
          {settings.wordWrap === 'column' && (
            <div className="settings-wrap-column">
              <TypedSetting
                label="Wrap at column"
                value={settings.wordWrapColumn}
                parse={(text) => {
                  const n = Number(text.trim());
                  return Number.isInteger(n) && n >= EDITOR_COLUMNS.min && n <= EDITOR_COLUMNS.max ? n : null;
                }}
                format={String}
                onChange={(wordWrapColumn) => studio.updateSettings({ wordWrapColumn })}
                mistake={`A whole number of characters, from ${EDITOR_COLUMNS.min} to ${EDITOR_COLUMNS.max}.`}
                className="settings-column"
                before="Wrap at"
                after="characters"
              />
              <p className="settings-help">Or at the editor’s edge, when that comes first, so no line runs out of sight.</p>
            </div>
          )}
        </div>
        <div className="settings-field">
          <div className="settings-label">Rulers</div>
          <TypedSetting
            label="Rulers"
            value={settings.rulers}
            parse={parseRulers}
            format={rulersText}
            onChange={(rulers) => studio.updateSettings({ rulers })}
            mistake={`Columns from ${EDITOR_COLUMNS.min} to ${EDITOR_COLUMNS.max}, apart with commas: 80, 120.`}
            className="settings-rulers"
            placeholder="None"
          />
          <p className="settings-help">A thin line down the editor at each of these columns, to see how long a line is getting: 80, 120 draws two. Leave it empty for none.</p>
        </div>
      </Section>
      <Section title="The assistant’s marks">
        <p className="settings-help">A bar beside the line numbers, in a colour of your choice; or none, so they look like the lines you wrote.</p>
        <div className="settings-field">
          <div className="settings-color">
            <span className="settings-switch-text">
              <span className="settings-switch-label">Lines the assistant changed</span>
              <span className="settings-help">Until you rewrite them; hover the line number for what was there before.</span>
            </span>
            <ColorChoice
              label="Lines the assistant changed"
              on={settings.markAiEdits}
              color={settings.aiEditColor}
              colors={MARK_COLORS}
              onChange={({ on, color }) => studio.updateSettings({ markAiEdits: on, ...(color ? { aiEditColor: color } : {}) })}
            />
          </div>
          <div className="settings-color">
            <span className="settings-switch-text">
              <span className="settings-switch-label">Lines the assistant read</span>
              <span className="settings-help">In the current conversation.</span>
            </span>
            <ColorChoice
              label="Lines the assistant read"
              on={settings.markAiReads}
              color={settings.aiReadColor}
              colors={MARK_COLORS}
              onChange={({ on, color }) => studio.updateSettings({ markAiReads: on, ...(color ? { aiReadColor: color } : {}) })}
            />
          </div>
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

/** A tool on the Tools page: its name and what it's for, then which program it runs. */
function ToolCard({ purpose, ...picker }: { tool: ToolName; label: string; purpose: ReactNode; info: ToolInfo | undefined; install: string; error?: string }) {
  const { info, label } = picker;
  return (
    <div className="tool-card">
      <div className="tool-card-head">
        <span className={`tool-dot ${info ? (info.path ? 'ok' : 'bad') : ''}`} title={info ? (info.path ? 'Installed' : 'Not found') : 'Looking…'} />
        <span className="settings-label">{label}</span>
        <span className="settings-help">{purpose}</span>
      </div>
      <ToolPicker {...picker} />
    </div>
  );
}

function ToolsPage({ goToAssistant }: { goToAssistant: () => void }) {
  const tools = useStore(studio.store, (s) => s.tools);
  const history = useStore(studio.store, (s) => s.history);
  const [searching, setSearching] = useState(false);
  // Where History is kept: this book's repository, or (no book open) the folder they're all in.
  const [historyHome, setHistoryHome] = useState<string | null>(null);
  useEffect(() => void appDataDir().then((d) => setHistoryHome(`${d.replace(/\/$/, '')}/history`), () => {}), []);
  const historyAt = history.repo?.gitDir ?? historyHome;
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
          Typst Studio looks in Homebrew, your PATH and editors’ Typst extensions, and uses the first copy it finds. Pick another and the preview or History starts again with it.
          The assistant’s program is chosen with the assistant, in{' '}
          <button className="link" onClick={goToAssistant}>
            Assistant
          </button>
          .
        </p>
        <button className="small tools-search" disabled={searching} onClick={() => void search()}>
          <Icon name="refresh" size={13} /> {searching ? 'Searching…' : 'Search again'}
        </button>
      </div>
      <ToolCard tool="tinymist" label="Tinymist" purpose="Typesets the live preview and exports PDFs." info={tools?.tinymist} install="brew install tinymist" />
      <ToolCard
        tool="git"
        label="Git"
        purpose={
          <>
            Keeps History, in Typst Studio’s own folder
            {historyAt && (
              <>
                {history.repo ? ' (this book’s: ' : ' ('}
                <code className="selectable">{tildePath(historyAt)}</code>)
              </>
            )}
            . If your book is in a Git repository, Source Control uses it too.
          </>
        }
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
  const configPath = useStore(studio.store, (s) => s.configFile?.path ?? '~/.typst-studio/settings.json');
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
    { id: 'editor', label: 'Editor', icon: 'edit', scope: 'app' },
    { id: 'assistant', label: 'Assistant', icon: 'sparkle', scope: 'app' },
    { id: 'permissions', label: 'Permissions', icon: 'shield', scope: 'app' },
    { id: 'tools', label: 'Tools', icon: 'code', scope: 'app' },
    ...(ws
      ? [
          { id: 'book' as const, label: 'Files', icon: 'book' as const, scope: 'book' as const },
          { id: 'book-assistant' as const, label: 'Assistant', icon: 'sparkle' as const, scope: 'book' as const },
          { id: 'book-color' as const, label: 'Colour', icon: 'palette' as const, scope: 'book' as const },
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
    ({ general: <GeneralPage />, editor: <EditorPage />, assistant: <AssistantPage />, permissions: <PermissionsPage />, tools: <ToolsPage goToAssistant={() => (setQuery(''), setPage('assistant'))} />, book: <BookFilesPage />, 'book-assistant': <BookAssistantPage />, 'book-color': <BookColorPage /> })[id];
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
                <div key={`${p.scope}-title`} className="settings-nav-group" title={p.scope === 'book' ? `Saved in ${tildePath(`${ws?.root}/${PROJECT_FILE}`)}, so they travel with the book` : `For every book: saved in ${tildePath(configPath)}`}>
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
