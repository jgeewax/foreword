// Typst Studio's own tools (src/app/studio-tools.ts) as the assistants name
// them: Claude Code "mcp__typst-studio__set_model", OpenCode
// "typst-studio_set_model", others "typst-studio.set_model". The chat
// describes them, and the permission rules let them run without asking: they
// change only what the author asked for, and never what the assistant may do.

/** The MCP server's name. */
export const STUDIO_TOOLS = 'typst-studio';

/** The permission rules' action for them (ACP's asks are mapped to it). */
export const STUDIO_TOOL_ACTION = STUDIO_TOOLS;

/** The tools (studio-tools.ts has them). OpenCode asks about each by its own action, "typst-studio_set_model". */
export const STUDIO_TOOL_NAMES = ['get_settings', 'change_settings', 'list_models', 'set_model', 'switch_assistant', 'set_mode', 'open_settings'] as const;

/** The tool's own name ("set_model") from the name an assistant gives it, or null if it isn't one of ours. */
export function studioToolName(name: unknown): string | null {
  if (typeof name !== 'string') return null;
  const m = /^(?:mcp__)?typst[-_]studio(?:__|[_./:])([a-z_]+)$/i.exec(name.trim());
  return m ? m[1].toLowerCase() : null;
}
