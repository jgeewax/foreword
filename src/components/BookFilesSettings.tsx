// Settings ▸ This book ▸ Files: the main file, the book's folder (the Typst
// root), where Export PDF builds, and font folders. Each is a card that says
// exactly what's in use, with a menu of what it can be instead of a box to
// type a path in.
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { useState, type ReactNode } from 'react';
import { exportFolderOf, PROJECT_FILE, typstRootOf, type ProjectSettings } from '../app/project-settings';
import { studio } from '../app/studio';
import { baseName, tildePath } from '../lib/paths';
import { useStore } from '../lib/store';
import { FileIcon, Icon } from './icons';
import { Picker, type PickerRow } from './SettingControls';

const FONT_FILE = /\.(otf|ttf|ttc|otc)$/i;
const parentOf = (rel: string) => (rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '');
const clean = (rel: string) => rel.trim().replace(/^\.\/+/, '').replace(/\/+$/, '');
/** A folder the settings may name: inside the book, without "..". */
const insideBook = (rel: string) => !!rel && !rel.startsWith('/') && !rel.split('/').includes('..');

/** A path, said exactly: its folders, then its last part in bold. */
function PathText({ path }: { path: string }) {
  const at = path.lastIndexOf('/');
  return (
    <span className="path-text">
      {at > 0 && <span className="path-parent">{path.slice(0, at + 1)}</span>}
      <span className="path-leaf">{at > 0 ? path.slice(at + 1) : path}</span>
    </span>
  );
}

/** One setting: a tile, its name, whether it's the default, and what it is now. */
function FileCard({
  kind,
  icon,
  title,
  note,
  set,
  actions,
  help,
  errors,
  children,
}: {
  kind: string;
  icon: ReactNode;
  title: string;
  note?: string;
  set?: boolean;
  actions?: ReactNode;
  help?: ReactNode;
  errors?: string[];
  children: ReactNode;
}) {
  return (
    <div className={`file-card file-card-${kind}`}>
      <span className="file-card-icon" aria-hidden>
        {icon}
      </span>
      <div className="file-card-body">
        <div className="file-card-head">
          <span className="file-card-title">{title}</span>
          {note && <span className="file-card-note">{note}</span>}
          {set !== undefined && <span className={`file-card-chip${set ? ' set' : ''}`}>{set ? 'Set for this book' : 'Default'}</span>}
          {actions && <span className="file-card-actions">{actions}</span>}
        </div>
        {children}
        {help && <p className="settings-help file-card-help">{help}</p>}
        {errors?.map((e) => (
          <p className="file-card-error" key={e}>
            {e}
          </p>
        ))}
      </div>
    </div>
  );
}

export function BookFilesPage() {
  const ws = useStore(studio.store, (s) => s.workspace);
  const project = useStore(studio.store, (s) => s.project);
  // What went wrong saving, under the card it's about.
  const [problem, setProblem] = useState<{ card: string; errors: string[] } | null>(null);
  // The output folder's box, while it's shown.
  const [typing, setTyping] = useState<string | null>(null);
  if (!ws) return null;

  const s = project.settings;
  const locked = !!project.error;
  const save = async (card: string, patch: ProjectSettings) => {
    const errors = await studio.updateProjectSettings(patch);
    setProblem(errors.length ? { card, errors } : null);
    return !errors.length;
  };
  const errorsOf = (card: string) => (problem?.card === card ? problem.errors : undefined);
  // A folder or file of the book (relative to it, or absolute) by its full path: a default is said exactly.
  const full = (rel: string) => {
    const r = clean(rel);
    return tildePath(r.startsWith('/') ? r : r && r !== '.' ? `${ws.root}/${r}` : ws.root);
  };
  // A folder picked in the Finder, relative to the book ('.' for the book's folder), or null when it's outside.
  const inBook = (picked: string) => (picked === ws.root ? '.' : picked.startsWith(`${ws.root}/`) ? picked.slice(ws.root.length + 1) : null);
  const folderIcon = <Icon name="folder" size={14} />;

  // The main file: any .typ file, those in the book's folder first, then by folder.
  const entry = s.entryPoint ?? ws.entry ?? '';
  const entryDir = parentOf(entry);
  const pdfName = (baseName(entry) || 'main.typ').replace(/\.typ$/, '.pdf');
  // Not Foreword's own (.foreword/) or other hidden folders', unless it's the main file now.
  const typFiles = ws.files
    .filter((f) => f.endsWith('.typ') && (f === entry || !f.split('/').some((p) => p.startsWith('.'))))
    .sort((a, b) => Number(!!parentOf(a)) - Number(!!parentOf(b)) || parentOf(a).localeCompare(parentOf(b)) || a.localeCompare(b));
  const mainRows: PickerRow[] = typFiles.map((f) => ({
    key: f,
    icon: <FileIcon path={f} />,
    title: baseName(f),
    section: parentOf(f) ? `${parentOf(f)}/` : 'The book’s folder',
    selected: f === entry,
    run: () => void save('main', { entryPoint: f }),
  }));

  // The book's folder: one that holds the main file, so the main file's own (the default) or one around it.
  const rootSet = !!s.root?.trim();
  const rootInUse = typstRootOf(s, entry);
  const around: string[] = [];
  for (let d = entryDir; d; ) around.push((d = parentOf(d)));
  const rootRows: PickerRow[] = [
    {
      key: 'default',
      icon: folderIcon,
      title: entryDir ? `${entryDir}/` : 'The book’s folder',
      detail: entryDir ? 'The main file’s folder (the default)' : 'The default',
      path: full(entryDir),
      selected: rootInUse === entryDir,
      run: () => void save('root', { root: '' }),
    },
    ...around.map((d) => ({
      key: `root:${d}`,
      icon: folderIcon,
      title: d ? `${d}/` : 'The book’s folder',
      path: full(d),
      selected: rootSet && rootInUse === d,
      run: () => void save('root', { root: d || '.' }),
    })),
  ];
  if (rootSet && !rootRows.some((r) => r.selected)) {
    rootRows.push({ key: 'root:set', icon: folderIcon, title: `${rootInUse}/`, detail: `Set in ${PROJECT_FILE}, but the main file isn’t in it`, path: full(rootInUse), selected: true, run: () => {} });
  }

  // Where Export PDF builds: next to the main file (the default), or a folder of the book.
  const outSet = !!s.outputDir?.trim();
  const outInUse = exportFolderOf(s, entry);
  const folders = new Set<string>();
  for (const f of ws.files) for (let d = parentOf(f); d; d = parentOf(d)) folders.add(d);
  const outFolders = [...folders].filter((d) => d !== entryDir && d.split('/').length <= 2 && !d.split('/').some((p) => p.startsWith('.'))).sort();
  if (outSet && outInUse !== entryDir && !outFolders.includes(outInUse)) outFolders.unshift(outInUse);
  const chooseOutput = async () => {
    const picked = await openDialog({ directory: true, multiple: false, defaultPath: `${ws.root}/${outInUse}`.replace(/\/$/, ''), title: 'Choose where Export PDF builds' });
    if (typeof picked !== 'string') return;
    const rel = inBook(picked);
    if (rel === null) setProblem({ card: 'output', errors: [`${tildePath(picked)} isn’t in the book. Choose a folder in ${full('')}.`] });
    else await save('output', { outputDir: rel });
  };
  const outRows: PickerRow[] = [
    {
      key: 'default',
      icon: folderIcon,
      title: 'Next to the main file',
      detail: 'The default',
      path: full(entryDir),
      selected: !outSet || outInUse === entryDir,
      run: () => void save('output', { outputDir: '' }),
    },
    ...outFolders.map((d) => ({
      key: `out:${d}`,
      icon: folderIcon,
      title: d === '.' ? 'The book’s folder' : `${d}/`,
      detail: folders.has(d) || d === '.' ? undefined : 'Not in the book yet',
      path: full(d),
      section: 'Folders in this book',
      selected: outSet && outInUse === d,
      run: () => void save('output', { outputDir: d }),
    })),
    { key: 'choose', action: true, icon: folderIcon, title: 'Choose a folder…', run: () => void chooseOutput() },
    { key: 'type', action: true, icon: <Icon name="edit" size={14} />, title: 'Type a folder name…', run: () => setTyping(outSet ? clean(s.outputDir ?? '') : '') },
  ];
  const typed = clean(typing ?? '');
  const typedOk = insideBook(typed);
  const useTyped = async () => {
    if (typedOk && (await save('output', { outputDir: typed }))) setTyping(null);
  };

  // Font folders, how many fonts each has, and folders of the book with fonts that aren't used yet.
  const fonts = s.fontPaths ?? [];
  const fontFiles = ws.files.filter((f) => FONT_FILE.test(f));
  const fontsIn = (p: string) => {
    const r = clean(p);
    if (r.startsWith('/')) return null;
    return r === '' || r === '.' ? fontFiles.length : fontFiles.filter((f) => f.startsWith(`${r}/`)).length;
  };
  const used = (f: string) => fonts.some((p) => fontsIn(p) !== null && (['', '.'].includes(clean(p)) || f.startsWith(`${clean(p)}/`)));
  // A font's folder: the outermost one called fonts (as in assets/fonts/Inter/…), or else its own.
  const fontFolderOf = (f: string) => {
    const parts = parentOf(f).split('/');
    const at = parts.findIndex((p) => /^fonts?$/i.test(p));
    return parts.slice(0, at >= 0 ? at + 1 : parts.length).join('/');
  };
  const unused = [...new Set(fontFiles.filter((f) => !used(f) && parentOf(f) && !f.split('/').some((p) => p.startsWith('.'))).map(fontFolderOf))];
  const suggested = unused.filter((d) => !unused.some((o) => o !== d && d.startsWith(`${o}/`)));
  const addFont = async (rel: string) => {
    if (!fonts.includes(rel)) await save('fonts', { fontPaths: [...fonts, rel] });
  };
  const addFontFolder = async () => {
    const picked = await openDialog({ directory: true, multiple: false, defaultPath: ws.root, title: 'Choose a folder of fonts' });
    if (typeof picked === 'string') await addFont(inBook(picked) ?? picked);
  };
  const countText = (n: number) => (n === 1 ? '1 font' : `${n} fonts`);

  return (
    <>
      {project.error && (
        <div className="file-alert">
          <span>{project.error}</span>
          <button
            className="small"
            onClick={() => {
              studio.closeSettings();
              void studio.openFile(PROJECT_FILE);
            }}
          >
            Open the file
          </button>
        </div>
      )}
      <section className="settings-section">
        <h2>Typesetting</h2>
        <FileCard
          kind="main"
          icon={<FileIcon path="main.typ" />}
          title="Main file"
          help="The preview and Export PDF start here; the chapters are included from it."
          errors={errorsOf('main')}
        >
          <Picker
            label="Main file"
            disabled={locked || typFiles.length < 2}
            filter={typFiles.length > 8 ? (r, q) => r.key.toLowerCase().includes(q) : undefined}
            rows={mainRows}
            trigger={
              entry ? (
                <>
                  <FileIcon path={entry} />
                  <span className="picker-value">{baseName(entry)}</span>
                  <span className="tool-path">{full(entry)}</span>
                </>
              ) : (
                <span className="picker-value bad">This book has no .typ file</span>
              )
            }
          />
        </FileCard>
        <FileCard
          kind="root"
          icon={<Icon name="folder" size={16} />}
          title="Book folder"
          note="Typst root"
          set={rootSet}
          help={
            <>
              Where paths starting with <code>/</code> begin, as in <code>image("/figures/map.png")</code>, and the only folder Typst may read from. It has to hold the main file
              {around.length ? '' : ', which is in the book’s folder, so there’s no other choice'}.
            </>
          }
          errors={errorsOf('root')}
        >
          <Picker
            label="Book folder"
            disabled={locked || rootRows.length < 2}
            rows={rootRows}
            trigger={
              <>
                <Icon name="folder" size={15} />
                <PathText path={full(rootInUse)} />
              </>
            }
          />
        </FileCard>
      </section>
      <section className="settings-section">
        <h2>Export</h2>
        <FileCard
          kind="output"
          icon={<FileIcon path="book.pdf" />}
          title="PDF output folder"
          set={outSet}
          help={<>Export PDF (⇧⌘E) builds {pdfName} here, then saves a copy where you choose.</>}
          errors={errorsOf('output')}
        >
          <Picker
            label="PDF output folder"
            disabled={locked}
            filter={outRows.length > 12 ? (r, q) => typeof r.title === 'string' && r.title.toLowerCase().includes(q) : undefined}
            rows={outRows}
            trigger={
              <>
                <FileIcon path={pdfName} />
                <PathText path={`${full(outInUse)}/${pdfName}`} />
              </>
            }
          />
          {typing !== null && (
            <div className="tool-typing">
              <div className="settings-row">
                <input
                  className="settings-input"
                  aria-label="PDF output folder, in the book"
                  placeholder="build"
                  spellCheck={false}
                  autoFocus
                  value={typing}
                  onChange={(e) => setTyping(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void useTyped();
                    else if (e.key === 'Escape') {
                      // Closes the box, not Settings.
                      e.stopPropagation();
                      setTyping(null);
                    }
                  }}
                />
                <button className="small primary" disabled={!typedOk} onClick={() => void useTyped()}>
                  Use
                </button>
                <button className="small" onClick={() => setTyping(null)}>
                  Cancel
                </button>
              </div>
              <div className={`tool-probe ${typed ? (typedOk ? 'ok' : 'bad') : ''}`}>
                {!typed
                  ? 'A folder in the book, like build or output/pdf. It needn’t exist yet.'
                  : typedOk
                    ? `Export PDF will build ${full(typed)}/${pdfName}`
                    : 'It has to be in the book: a name like build, without .. or a / at the start.'}
              </div>
            </div>
          )}
        </FileCard>
      </section>
      <section className="settings-section">
        <h2>Fonts</h2>
        <FileCard
          kind="fonts"
          icon={<span className="file-card-glyph">Aa</span>}
          title="Extra font folders"
          actions={
            <button className="small file-card-add" disabled={locked} onClick={() => void addFontFolder()}>
              <Icon name="plus" size={12} /> Add folder…
            </button>
          }
          help="Folders of .otf and .ttf files, and their subfolders, for fonts that aren’t installed on this Mac."
          errors={errorsOf('fonts')}
        >
          <div className="font-list">
            {fonts.length === 0 && (
              <div className="font-empty">
                None. Fonts installed on this Mac are always available (in <code>~/Library/Fonts</code>, <code>/Library/Fonts</code> and <code>/System/Library/Fonts</code>), and the ones
                Typst comes with.
              </div>
            )}
            {fonts.map((f) => {
              const n = fontsIn(f);
              const inside = !clean(f).startsWith('/');
              return (
                <div className="font-row" key={f}>
                  <Icon name="folder" size={15} />
                  <span className="font-row-text">
                    <span className="font-row-name">{inside ? (['', '.'].includes(clean(f)) ? 'The book’s folder' : `${clean(f)}/`) : baseName(f)}</span>
                    <code className="selectable">{full(f)}</code>
                  </span>
                  {n !== null && <span className={`font-count${n ? '' : ' none'}`}>{n ? countText(n) : 'No fonts in it'}</span>}
                  <button className="icon font-remove" aria-label={`Stop using the fonts in ${f}`} title="Remove" disabled={locked} onClick={() => void save('fonts', { fontPaths: fonts.filter((x) => x !== f) })}>
                    <Icon name="close" size={13} />
                  </button>
                </div>
              );
            })}
            {suggested.map((d) => (
              <div className="font-row suggested" key={`suggest:${d}`}>
                <Icon name="sparkle" size={15} />
                <span className="font-row-text">
                  <span>
                    <strong>{d}/</strong> has {countText(fontsIn(d) ?? 0)} the book can’t use yet.
                  </span>
                  <code className="selectable">{full(d)}</code>
                </span>
                <button className="small primary" disabled={locked} onClick={() => void addFont(d)}>
                  Use them
                </button>
              </div>
            ))}
          </div>
        </FileCard>
      </section>
    </>
  );
}
