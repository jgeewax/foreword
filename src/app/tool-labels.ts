// How the chat describes the assistant's tool calls.

/** The live progress line while a tool runs. */
export function toolActivity(name: string, _input: unknown): string {
  return `Using ${name}`;
}
