// Claude Code's own plan mode. The app's modes never use it (see modes.ts;
// Discuss is the app's way to think before writing), but a conversation had
// in it still shows its steps.

/**
 * Claude Code's own plan mode, in a conversation had in it (older ones, from
 * before the app's Plan mode, now Discuss, was its own): its steps in and out of planning, as
 * the app names them (a tool's name, a permission request's action). It
 * writes its plan down in a file of its own, outside the book, then asks to
 * leave plan mode and carry it out (ExitPlanMode, with the plan); it can also
 * ask to plan first (EnterPlanMode).
 */
export const PLAN_WRITE = 'plan_write';
export const PLAN_EXIT = 'plan_exit';
export const PLAN_ENTER = 'plan_enter';

/** One of Claude Code's plan files: a Markdown file right in a `.claude/plans` folder (~/.claude/plans/<name>.md). */
export function isPlanFile(path: unknown): boolean {
  return typeof path === 'string' && path.startsWith('/') && /\/\.claude\/plans\/[^/]+\.md$/.test(path) && !path.split('/').includes('..');
}
