// Runs a book's code examples and keeps code-output/outputs.json up to date
// (see cells.ts and code.typ). Running code needs the author's trust, given
// once per book and remembered on this Mac. After an assistant turn, examples
// that changed are re-run (trusted books only) and problems reported.
import type { Documents } from '../editor/documents';
import { errorMessage, ipc } from '../lib/ipc';
import { cellStatus, describeProblem, duplicateNames, HELPER_FILE, OUTPUTS_FILE, parseCells, parseOutputs, serializeOutputs, type CodeCell, type Outputs } from './cells';
import helperSource from './code.typ?raw';

export type CodeState = {
  cells: CodeCell[];
  outputs: Outputs;
  /** Names of examples running now. */
  running: string[];
  /** code-output/outputs.json exists (the book is set up for examples). */
  setUp: boolean;
  trusted: boolean;
};

export const initialCode: CodeState = { cells: [], outputs: {}, running: [], setUp: false, trusted: false };

export type CodeHost = {
  get(): CodeState;
  set(patch: Partial<CodeState>): void;
  root(): string | null;
  files(): string[];
  docs(): Documents | null;
  editFile(path: string, transform: (text: string) => string): Promise<boolean>;
  confirm(message: string, title: string, okLabel: string): Promise<boolean>;
  toast(text: string, tone?: 'info' | 'error'): void;
  /** A chat notice, optionally with a button that sends a message to the assistant. */
  notice(text: string, tone: 'info' | 'error', action?: { label: string; prompt: string }): void;
  refreshFiles(): Promise<void>;
};

const TRUST_KEY = 'studio.trustedCode';
const readTrusted = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem(TRUST_KEY) ?? '[]');
  } catch {
    return [];
  }
};

export class CodeRunner {
  private byFile = new Map<string, CodeCell[]>();
  private writing: Promise<unknown> = Promise.resolve();

  constructor(private readonly host: CodeHost) {}

  private get state() {
    return this.host.get();
  }

  /** Read every .typ file (open buffers as they are) and the outputs file. */
  async scan() {
    const docs = this.host.docs();
    this.byFile.clear();
    for (const path of this.host.files().filter((f) => f.endsWith('.typ'))) {
      const doc = docs?.get(path);
      const text = doc ? doc.model.getValue() : await ipc.fsRead(path).then((r) => r.text, () => '');
      if (text.includes('#run(')) this.byFile.set(path, parseCells(text, path));
    }
    const setUp = this.host.files().includes(OUTPUTS_FILE);
    const outputs = setUp ? parseOutputs(await ipc.fsRead(OUTPUTS_FILE).then((r) => r.text, () => '{}')) : {};
    const root = this.host.root();
    this.host.set({ cells: [...this.byFile.values()].flat(), outputs, setUp, trusted: !!root && readTrusted().includes(root) });
  }

  /** A buffer changed: re-read its examples. */
  updateFile(path: string, text: string) {
    const had = this.byFile.has(path);
    if (!had && !text.includes('#run(')) return;
    this.byFile.set(path, parseCells(text, path));
    this.host.set({ cells: [...this.byFile.values()].flat() });
  }

  reset() {
    this.byFile.clear();
    this.host.set(initialCode);
  }

  status(cell: CodeCell) {
    return cellStatus(cell, this.state.outputs[cell.name]);
  }

  /** Ask once per book; remembered on this Mac. */
  async ensureTrusted(): Promise<boolean> {
    const root = this.host.root();
    if (!root) return false;
    if (readTrusted().includes(root)) return true;
    const ok = await this.host.confirm(
      `Run the code examples in “${root.split('/').pop()}”?\n\nThey run on your Mac with your permissions, so they can read and change your files. Only run code you trust. Typst Studio remembers this for this book (you can turn it off in Settings).`,
      'Run code examples',
      'Allow and run',
    );
    if (!ok) return false;
    localStorage.setItem(TRUST_KEY, JSON.stringify([...readTrusted(), root]));
    this.host.set({ trusted: true });
    return true;
  }

  revokeTrust() {
    const root = this.host.root();
    localStorage.setItem(TRUST_KEY, JSON.stringify(readTrusted().filter((r) => r !== root)));
    this.host.set({ trusted: false });
  }

  /** Run these examples one after another, saving each output as it finishes. */
  async run(names: string[]) {
    if (!names.length || !(await this.ensureTrusted())) return;
    if (!this.state.setUp) await this.setUp({ quiet: true });
    const dupes = new Set(duplicateNames(this.state.cells));
    for (const name of names) {
      const cell = this.state.cells.find((c) => c.name === name);
      if (!cell || this.state.running.includes(name)) continue;
      if (dupes.has(name)) {
        this.host.toast(`Two examples are called “${name}”; give each its own name.`, 'error');
        continue;
      }
      this.host.set({ running: [...this.state.running, name] });
      try {
        const r = await ipc.codeRun(cell.lang, cell.code);
        const outputs = {
          ...this.state.outputs,
          [name]: { code: cell.code, lang: cell.lang, stdout: r.stdout, stderr: r.stderr, exit: r.exit, timedOut: r.timedOut || undefined, durationMs: r.durationMs, ranAt: new Date().toISOString() },
        };
        this.host.set({ outputs });
        await this.save();
      } catch (e) {
        this.host.toast(`Couldn't run “${name}”: ${errorMessage(e)}`, 'error');
      } finally {
        this.host.set({ running: this.state.running.filter((n) => n !== name) });
      }
    }
  }

  /** Run every example, or only the ones that aren't up to date. */
  async runAll({ onlyStale = false } = {}) {
    const names = this.state.cells.filter((c) => !onlyStale || ['not-run', 'outdated'].includes(this.status(c))).map((c) => c.name);
    await this.run([...new Set(names)]);
  }

  /** Write the outputs file (one write at a time; the preview reads it). */
  private save() {
    this.writing = this.writing.then(() => this.host.editFile(OUTPUTS_FILE, () => serializeOutputs(this.state.outputs))).catch((e) => this.host.toast(`Couldn't save outputs: ${errorMessage(e)}`, 'error'));
    return this.writing;
  }

  /** Add code.typ and the outputs file to a book. */
  async setUp({ quiet = false } = {}) {
    const files = this.host.files();
    if (!files.includes(HELPER_FILE)) await ipc.fsWrite(HELPER_FILE, helperSource, null).catch(() => {});
    if (!files.includes(OUTPUTS_FILE)) {
      await ipc.fsMkdir('code-output').catch(() => {});
      await ipc.fsWrite(OUTPUTS_FILE, '{}\n', null).catch(() => {});
    }
    await this.host.refreshFiles();
    this.host.set({ setUp: true });
    if (!quiet) {
      this.host.toast('Runnable code is set up: add #import "/code.typ": run to a chapter, then write #run("name", ```python … ```).');
    }
  }

  /** Examples that aren't fine, one line each. */
  problems(): string[] {
    return this.state.cells.filter((c) => this.status(c) !== 'ok').map((c) => `${describeProblem(c, this.state.outputs[c.name])} (${c.path}:${c.line})`);
  }

  /** After an assistant turn: re-run what changed (trusted books), then report what's wrong. */
  async afterAgentTurn() {
    await this.scan();
    if (!this.state.cells.length || !this.state.trusted) return;
    const stale = this.state.cells.filter((c) => ['not-run', 'outdated'].includes(this.status(c)));
    if (!stale.length) return;
    await this.run([...new Set(stale.map((c) => c.name))]);
    const broken = this.state.cells.filter((c) => ['failed', 'mismatch'].includes(this.status(c)));
    if (!broken.length) {
      this.host.notice(`Ran ${stale.length} changed code example${stale.length > 1 ? 's' : ''}: all fine.`, 'info');
      return;
    }
    const lines = broken.map((c) => `- ${describeProblem(c, this.state.outputs[c.name])} (${c.path}:${c.line})`);
    this.host.notice(`${broken.length} code example${broken.length > 1 ? 's' : ''} failed:\n${lines.join('\n')}`, 'error', {
      label: 'Ask the assistant to fix them',
      prompt: `These code examples fail when Typst Studio runs them:\n${lines.join('\n')}\n\nFix each one so it runs and prints what the book says it does. Change the example code (or its expect: value, if the expectation itself is wrong). Don't run the code yourself: Typst Studio re-runs it after your changes.`,
    });
  }
}
