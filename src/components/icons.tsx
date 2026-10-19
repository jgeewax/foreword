// Line icons for the app's chrome (toolbar, sidebar), drawn on a 24×24 grid
// in the current text colour, so they stay crisp at every zoom level.
import type { ReactNode } from 'react';

const PATHS: Record<string, ReactNode> = {
  // The title bar's pane toggles, as VS Code's layout icons: the window with
  // the pane's column outlined, filled in while the pane shows.
  paneLeft: (
    <>
      <rect x="3" y="4.5" width="18" height="15" rx="2.5" />
      <path d="M9 4.5v15" />
    </>
  ),
  paneLeftOn: (
    <>
      <rect x="3" y="4.5" width="18" height="15" rx="2.5" />
      <path d="M9 4.5H5.5A2.5 2.5 0 0 0 3 7v10a2.5 2.5 0 0 0 2.5 2.5H9z" fill="currentColor" />
    </>
  ),
  paneMiddle: (
    <>
      <rect x="3" y="4.5" width="18" height="15" rx="2.5" />
      <path d="M10 4.5v15M15.5 4.5v15" />
    </>
  ),
  paneMiddleOn: (
    <>
      <rect x="3" y="4.5" width="18" height="15" rx="2.5" />
      <path d="M10 4.5h5.5v15H10z" fill="currentColor" />
    </>
  ),
  paneRight: (
    <>
      <rect x="3" y="4.5" width="18" height="15" rx="2.5" />
      <path d="M15 4.5v15" />
    </>
  ),
  paneRightOn: (
    <>
      <rect x="3" y="4.5" width="18" height="15" rx="2.5" />
      <path d="M15 4.5h3.5A2.5 2.5 0 0 1 21 7v10a2.5 2.5 0 0 1-2.5 2.5H15z" fill="currentColor" />
    </>
  ),
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6" />
      <path d="M15 15l5 5" />
    </>
  ),
  sparkle: <path d="M12 3.5l1.9 5.1 5.1 1.9-5.1 1.9L12 17.5l-1.9-5.1-5.1-1.9 5.1-1.9zM18.5 16l.8 2 2 .7-2 .8-.8 2-.7-2-2-.8 2-.7z" />,
  help: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.6 9.4a2.5 2.5 0 1 1 3.6 2.3c-.7.4-1.2 1-1.2 1.8v.5" />
      <path d="M12 17.2v.1" />
    </>
  ),
  settings: (
    <>
      <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
      <circle cx="15" cy="7" r="2" />
      <circle cx="9" cy="17" r="2" />
    </>
  ),
  // The sidebar's views, each its own shape so none reads as another: pages
  // (files), a clock turning back (history), a comment (review), branches
  // (source control), </> (code examples), ticked boxes (to do). Their
  // bottom-right corners are light, where a count's badge sits.
  files: (
    <>
      <path d="M9 7.5h5.5l4 4V20a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V8.5a1 1 0 0 1 1-1z" />
      <path d="M14.5 7.5v4h4" />
      <path d="M5 16.5V4a1 1 0 0 1 1-1h7" />
    </>
  ),
  history: (
    <>
      <path d="M4 12a8 8 0 1 0 2.35-5.65L4 8.7" />
      <path d="M4 4.5v4.2h4.2" />
      <path d="M12 8v4.2l2.8 1.8" />
    </>
  ),
  code: <path d="M8 7.5L3.5 12 8 16.5M16 7.5l4.5 4.5-4.5 4.5M13.6 5l-3.2 14" />,
  todos: (
    <>
      <rect x="3.5" y="4" width="6.5" height="6.5" rx="1.6" />
      <path d="M5.2 7.3l1.3 1.3 2-2.3" />
      <rect x="3.5" y="13.5" width="6.5" height="6.5" rx="1.6" />
      {/* The open box's line is left out: the view only shows with a count, whose badge sits there. */}
      <path d="M13.5 7.25h7" />
    </>
  ),
  // Source control (VS Code's): branches joining.
  branch: (
    <>
      <circle cx="7" cy="5.5" r="2" />
      <circle cx="7" cy="18.5" r="2" />
      <circle cx="17" cy="7.5" r="2" />
      <path d="M7 7.5v9M17 9.5c0 4.5-10 3-10 7" />
    </>
  ),
  // Review: a comment on the text.
  comments: (
    <>
      <path d="M5 4.5h14a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5h-7.5L7 20.5v-4H5A1.5 1.5 0 0 1 3.5 15V6A1.5 1.5 0 0 1 5 4.5z" />
      <path d="M7.5 9h9M7.5 12.5h5.5" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  close: <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />,
  pin: (
    <>
      <path d="M9.2 3.5h5.6l-.9 6.3 3.4 3.4H6.7l3.4-3.4z" />
      <path d="M12 13.2v7.3" />
    </>
  ),
  // The chat's effort menu: a dial.
  gauge: (
    <>
      <path d="M4.2 17a8.2 8.2 0 1 1 15.6 0" />
      <path d="M12 15.5l3.6-4.6" />
      <circle cx="12" cy="15.5" r="1.1" fill="currentColor" />
    </>
  ),
  chevronRight: <path d="M9.5 6l6 6-6 6" />,
  chevronDown: <path d="M6 9.5l6 6 6-6" />,
  shield: <path d="M12 3.2l7 2.8v5.2c0 4.3-2.9 7.7-7 9.6-4.1-1.9-7-5.3-7-9.6V6z" />,
  arrowUp: <path d="M12 19V5.5M6 11.5l6-6 6 6" />,
  stop: <rect x="7" y="7" width="10" height="10" rx="1.5" fill="currentColor" />,
  book: (
    <>
      <path d="M5 5.5A2 2 0 0 1 7 3.5h12v14H7a2 2 0 0 0-2 2z" />
      <path d="M5 19.5a2 2 0 0 0 2 2h12v-4" />
    </>
  ),
  // Source Control's actions and markers (codicons' shapes).
  more: (
    <>
      <circle cx="5.5" cy="12" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="18.5" cy="12" r="1.3" fill="currentColor" stroke="none" />
    </>
  ),
  refresh: (
    <>
      <path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" />
      <path d="M18 3.5v3.7h-3.7" />
    </>
  ),
  pull: <path d="M12 4v11.5M7 10.5l5 5 5-5M5 20h14" />,
  push: <path d="M12 20V8.5M7 13.5l5-5 5 5M5 4h14" />,
  openChanges: (
    <>
      <path d="M6 3.5h8l4 4v13H6z" />
      <path d="M9.5 10.5h5M12 8v5M9.5 16.5h5" />
    </>
  ),
  goToFile: (
    <>
      <path d="M13 3.5H6v17h12V8.5z" />
      <path d="M13 3.5v5h5M9 14.5h6.5M13 12l2.5 2.5L13 17" />
    </>
  ),
  // A book's colour: a painter's palette.
  palette: (
    <>
      <path d="M12 3.5a8.5 8.5 0 0 0 0 17c1.4 0 2-.9 2-1.9 0-.6-.3-1-.6-1.4-.3-.4-.6-.8-.6-1.4 0-1 .8-1.8 1.8-1.8h2.1a3.8 3.8 0 0 0 3.8-3.8C20.5 6.6 16.7 3.5 12 3.5z" />
      <circle cx="7.6" cy="11" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="10" cy="7.4" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="14.4" cy="7.4" r="1.1" fill="currentColor" stroke="none" />
    </>
  ),
  // Two versions side by side.
  sideBySide: (
    <>
      <rect x="3" y="4.5" width="18" height="15" rx="2.5" />
      <path d="M12 4.5v15M6 9h3.5M6 12h3.5M14.5 9h3.5M14.5 12h3.5" />
    </>
  ),
  target: (
    <>
      <circle cx="12" cy="12" r="7.5" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  cloud: <path d="M7.5 18.5a4 4 0 0 1-.6-7.95 5.5 5.5 0 0 1 10.6 1.45 3.25 3.25 0 0 1-.25 6.5z" />,
  tag: (
    <>
      <path d="M3.5 4.5v6.8l9 9 7.8-7.8-9-9H4.5a1 1 0 0 0-1 1z" />
      <circle cx="8" cy="9" r="1.4" />
    </>
  ),
  // A heading, in the path bar: an outline's lines, each further in.
  heading: <path d="M4 6.5h16M8 12h12M12 17.5h8" />,
  // Settings ▸ Tools: choose a file, paste a path, type one.
  folder: <path d="M3.5 6.5a1.5 1.5 0 0 1 1.5-1.5h4.2l2 2.2H19a1.5 1.5 0 0 1 1.5 1.5v9.3A1.5 1.5 0 0 1 19 19.5H5a1.5 1.5 0 0 1-1.5-1.5z" />,
  paste: (
    <>
      <path d="M8.5 5H6.5A1.5 1.5 0 0 0 5 6.5v12A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5v-12A1.5 1.5 0 0 0 17.5 5h-2" />
      <rect x="8.5" y="3.5" width="7" height="3.5" rx="1" />
    </>
  ),
  edit: <path d="M4.5 19.5l1-4.2L15.8 5a1.8 1.8 0 0 1 2.6 0l.6.6a1.8 1.8 0 0 1 0 2.6L8.7 18.5zM13.8 7l3.2 3.2" />,
  // The chat's trace: a thought, show it in the editor, undo, copy, try again.
  bulb: <path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.6 10.8c.7.6 1.1 1.3 1.1 2.2h5c0-.9.4-1.6 1.1-2.2A6 6 0 0 0 12 3z" />,
  eye: (
    <>
      <path d="M3.5 12s3-6 8.5-6 8.5 6 8.5 6-3 6-8.5 6-8.5-6-8.5-6z" />
      <circle cx="12" cy="12" r="2.5" />
    </>
  ),
  undo: <path d="M9 14L4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />,
  copy: (
    <>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3" />
    </>
  ),
  retry: <path d="M20 12a8 8 0 1 1-2.4-5.7M20 4v5h-5" />,
  // Settings ▸ Assistant: sign in, in Terminal.
  terminal: (
    <>
      <rect x="3" y="4.5" width="18" height="15" rx="2.5" />
      <path d="M7 9.5l2.5 2.5L7 14.5M12 15h5" />
    </>
  ),
};

/** A file's kind, coloured as VS Code's file icons: Typst, PDF, Markdown, data, images. */
export function FileIcon({ path }: { path: string }) {
  const ext = path.includes('.') ? path.slice(path.lastIndexOf('.') + 1).toLowerCase() : '';
  const glyph: Record<string, [kind: string, text: string]> = { typ: ['typ', 't'], json: ['json', '{}'], md: ['md', '↓'], bib: ['bib', '@'], csv: ['csv', '▦'], toml: ['conf', '⚙'], yaml: ['conf', '⚙'], yml: ['conf', '⚙'] };
  if (glyph[ext]) {
    const [kind, text] = glyph[ext];
    return (
      <span className={`file-icon ft-${kind}`} aria-hidden>
        {text}
      </span>
    );
  }
  const kind = ext === 'pdf' ? 'pdf' : /^(png|jpe?g|gif|svg|webp)$/.test(ext) ? 'image' : 'file';
  return (
    <span className={`file-icon ft-${kind}`} aria-hidden>
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round">
        {kind === 'image' ? (
          <>
            <rect x="2" y="3" width="12" height="10" rx="1.5" />
            <path d="M2.5 11.5l3.5-3.5 3 3 1.5-1.5 3 3" />
          </>
        ) : (
          <>
            <path d="M4 1.75h5l3.25 3.25v9.25H4z" />
            {kind === 'pdf' ? <path d="M6 9.5h4.25M6 11.75h4.25M6 7.25h2" /> : <path d="M9 1.75V5h3.25" />}
          </>
        )}
      </svg>
    </span>
  );
}

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg className="icon-svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {PATHS[name]}
    </svg>
  );
}
