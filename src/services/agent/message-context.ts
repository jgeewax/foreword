import { formatSelectionContext } from '../../editor/selection';
import { formatAuthorEdits } from './author-edits';
import type { MessageContext } from './types';

/** How the turns another assistant had start (app/mode-setups.ts writes them). */
export const EARLIER_INTRO = 'The author switched assistants during this conversation. The turns you haven’t seen, for context:';

/** The chip on the author's message that they went with. */
export const EARLIER_CHIP = 'The chat so far';

/** A message as the assistant gets it: the author's words, then what goes with them (tasks.ts splits them again). */
export const messageText = (message: string, context: readonly MessageContext[]) =>
  [message, ...context.map((c) => ('authorEdits' in c ? formatAuthorEdits(c.authorEdits) : 'earlier' in c ? c.earlier : formatSelectionContext(c.selection, c.stale)))].join('\n\n');
