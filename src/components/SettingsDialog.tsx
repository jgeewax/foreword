import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { PROJECT_FILE } from '../app/project-settings';
import { studio } from '../app/studio';
import { useStore } from '../lib/store';
import { PermissionsEditor } from './Permissions';

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
  const [errors, setErrors] = useState<string[]>([]);
  const [outputDir, setOutputDir] = useState(project.settings.outputDir ?? '');
  useEffect(() => setOutputDir(project.settings.outputDir ?? ''), [project.settings.outputDir]);
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
          Export PDF (⇧⌘E) writes <code>{outputExample}</code>.
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

export function SettingsDialog() {
  const settings = useStore(studio.store, (s) => s.settings);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = dialogRef.current;
    (root?.querySelector<HTMLElement>('.modal-body input:checked') ?? root?.querySelector<HTMLElement>('.modal-body input, .modal-body select'))?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        studio.closeSettings();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && studio.closeSettings()}>
      <div className="modal settings" role="dialog" aria-modal="true" aria-label="Settings" ref={dialogRef}>
        <header className="modal-header">
          <h1>Settings</h1>
          <button className="icon" aria-label="Close settings" onClick={() => studio.closeSettings()}>
            ×
          </button>
        </header>
        <div className="modal-body">
          <ProjectSection />
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
          </Section>
          <Section title="Chat">
            <div className="settings-field">
              <div className="settings-label">Send a message with</div>
              <Radio name="sendKey" value="enter" current={settings.sendKey} onChange={(v) => studio.updateSettings({ sendKey: v })} label="Enter" detail="Shift+Enter for a new line" />
              <Radio
                name="sendKey"
                value="mod-enter"
                current={settings.sendKey}
                onChange={(v) => studio.updateSettings({ sendKey: v })}
                label="⌘ Enter"
                detail="Enter for a new line"
              />
            </div>
          </Section>
          <Section title="Assistant permissions">
            <PermissionsEditor />
          </Section>
        </div>
      </div>
    </div>
  );
}
