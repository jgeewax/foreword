// Line icons for the app's chrome (toolbar, sidebar), drawn on a 24×24 grid
// in the current text colour, so they stay crisp at every zoom level.
import type { ReactNode } from 'react';

const PATHS: Record<string, ReactNode> = {
  panelLeft: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <path d="M9.5 4v16" />
    </>
  ),
  panelRight: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <path d="M14.5 4v16" />
    </>
  ),
  page: (
    <>
      <path d="M6.5 3h8l4 4v14h-12z" />
      <path d="M14.5 3v4h4M9.5 12h6M9.5 16h6" />
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
  // The sidebar's views, shaped like VS Code's (codicons): files, history, comments, to-do list.
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
  code: <path d="M8.5 7.5L4 12l4.5 4.5M15.5 7.5L20 12l-4.5 4.5" />,
  todos: (
    <>
      <path d="M4 6.5l1.5 1.5L8 5.5M4 12.5l1.5 1.5L8 11.5M4 18.5l1.5 1.5L8 17.5" />
      <path d="M11 7h9M11 13h9M11 19h9" />
    </>
  ),
  // Conversations with the assistant: a speech bubble with lines of text.
  chats: (
    <>
      <path d="M4 5.5h16v10.5h-8l-4.5 3.5V16H4z" />
      <path d="M8 9h8M8 12.5h5" />
    </>
  ),
  comments: (
    <>
      <path d="M3.5 4.5h11v8H9l-3 2.5v-2.5H3.5z" />
      <path d="M17.5 9h3v8h-2.5v2.5l-3-2.5h-4.5v-2" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  close: <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />,
  pin: (
    <>
      <path d="M9.2 3.5h5.6l-.9 6.3 3.4 3.4H6.7l3.4-3.4z" />
      <path d="M12 13.2v7.3" />
    </>
  ),
  chevronRight: <path d="M9.5 6l6 6-6 6" />,
  chevronDown: <path d="M6 9.5l6 6 6-6" />,
  shield: <path d="M12 3.2l7 2.8v5.2c0 4.3-2.9 7.7-7 9.6-4.1-1.9-7-5.3-7-9.6V6z" />,
  book: (
    <>
      <path d="M5 5.5A2 2 0 0 1 7 3.5h12v14H7a2 2 0 0 0-2 2z" />
      <path d="M5 19.5a2 2 0 0 0 2 2h12v-4" />
    </>
  ),
};

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg className="icon-svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {PATHS[name]}
    </svg>
  );
}
