import { formatSelectionContext } from '../../editor/selection';
import { formatFiles } from './attached-files';
import { formatAuthorEdits } from './author-edits';
import type { MessageContext } from './types';

/** How the turns another assistant had start (app/mode-setups.ts writes them). */
export const EARLIER_INTRO = 'The author switched assistants during this conversation. The turns you haven’t seen, for context:';

/** The chip on the author's message that they went with. */
export const EARLIER_CHIP = 'The chat so far';

/** How a mode's reminder of how to reply starts, after the author's words (modes.ts). */
export const REMINDER_START = '(Foreword, ';

/** A message as the assistant gets it: the author's words, then what goes with them (tasks.ts splits them again). A message of files alone has no words. */
export const messageText = (message: string, context: readonly MessageContext[]) =>
  [
    message,
    ...context.map((c) =>
      'authorEdits' in c
        ? formatAuthorEdits(c.authorEdits)
        : 'earlier' in c
          ? c.earlier
          : 'reminder' in c
            ? c.reminder
            : 'files' in c
              ? formatFiles(c.files, c.inline)
              : formatSelectionContext(c.selection, c.stale),
    ),
  ]
    .filter((part, i) => i > 0 || part.trim())
    .join('\n\n');

/** The bytes that go in the message itself, beside its text (pictures, and files for an agent that takes them). */
export const inlineFiles = (context: readonly MessageContext[]) => context.flatMap((c) => ('files' in c ? c.inline : []));
