// TypstService: LSP client for the single Tinymist process (diagnostics +
// live preview from unsaved buffers). Transport is the Rust stdio bridge.
import type { LspContentChange, LspDiagnostic, LspTextEdit } from '../editor/lsp-convert';
import { relativeToUri } from '../editor/lsp-convert';
import { Channel, ipc } from '../lib/ipc';
import { Emitter } from '../lib/store';

const CONFIG = {
  compileStatus: 'enable',
  exportPdf: 'never',
  semanticTokens: 'disable',
  // Preview follows keystrokes; partial rendering keeps big books fast (SPEC §3).
  preview: { refresh: 'onType', partialRendering: true },
  // Format Document and format on save: typstyle, as VS Code's Typst extension (and its defaults).
  formatterMode: 'typstyle',
  formatterPrintWidth: 120,
};

type Config = typeof CONFIG & { outputPath?: string; fontPaths?: string[]; rootPath?: string };

function lookupConfig(config: Config, section?: string): unknown {
  if (!section || section === 'tinymist') return config;
  if (!section.startsWith('tinymist.')) return null;
  return section
    .slice('tinymist.'.length)
    .split('.')
    .reduce<any>((o, k) => (o == null ? null : (o[k] ?? null)), config);
}

/** Per-project options that Tinymist reads at start-up. */
export type TypstOptions = { outputPath?: string; fontPaths?: string[]; rootPath?: string };

export type CompileStatus = {
  status: 'compiling' | 'compileSuccess' | 'compileError';
  path: string;
  pageCount: number;
  wordsCount: { words: number; chars: number } | null;
};

/** Preview → source: the user clicked rendered content. Positions are 0-based [line, character]. */
export type SourceJump = { filepath: string; start: [number, number] | null; end: [number, number] | null };

type Events = {
  diagnostics: [uri: string, diagnostics: LspDiagnostic[]];
  compile: [CompileStatus];
  scrollSource: [SourceJump];
  closed: [];
};

const PREVIEW_TASK = 'studio';

type Pending = { resolve: (v: any) => void; reject: (e: Error) => void; method: string };

export class TypstService extends Emitter<Events> {
  private nextId = 1;
  private pending = new Map<number, Pending>();
  running = false;
  bin = '';
  private config: Config = CONFIG;
  private entryAbs = '';

  async start(root: string, entry: string, options: TypstOptions = {}): Promise<{ previewUrl: string }> {
    // Export location and fonts are read at initialization (verified: outputPath is
    // ignored when only answered via workspace/configuration).
    this.config = {
      ...CONFIG,
      ...(options.outputPath ? { outputPath: options.outputPath } : {}),
      ...(options.fontPaths?.length ? { fontPaths: options.fontPaths } : {}),
      // Where paths starting with "/" begin (Tinymist otherwise uses the folder opened).
      ...(options.rootPath ? { rootPath: options.rootPath } : {}),
    };
    const channel = new Channel<any>();
    channel.onmessage = (msg) => this.dispatch(msg);
    this.bin = (await ipc.typstStart(channel)).bin;
    this.running = true;

    const rootUri = relativeToUri('', root).replace(/\/$/, '');
    await this.request('initialize', {
      processId: null,
      clientInfo: { name: 'typst-studio' },
      rootUri,
      workspaceFolders: [{ uri: rootUri, name: root.split('/').pop() }],
      capabilities: {
        textDocument: { synchronization: { didSave: true }, publishDiagnostics: { versionSupport: true } },
        workspace: { configuration: true, workspaceFolders: true },
        window: { workDoneProgress: false, showDocument: { support: true } },
      },
      initializationOptions: this.config,
    });
    this.notify('initialized', {});

    const entryAbs = (this.entryAbs = `${root}/${entry}`);
    await this.executeCommand('tinymist.pinMain', [entryAbs]);
    const preview = await this.executeCommand('tinymist.doStartPreview', [
      ['--task-id', PREVIEW_TASK, '--data-plane-host', '127.0.0.1:0', entryAbs],
    ]);
    if (!preview?.staticServerPort) throw new Error('Tinymist did not return a preview port');
    return { previewUrl: `http://127.0.0.1:${preview.staticServerPort}/` };
  }

  async stop() {
    this.running = false;
    await ipc.typstStop();
  }

  didOpen(uri: string, text: string, version: number) {
    this.notify('textDocument/didOpen', { textDocument: { uri, languageId: 'typst', version, text } });
  }

  didChange(uri: string, version: number, contentChanges: LspContentChange[]) {
    this.notify('textDocument/didChange', { textDocument: { uri, version }, contentChanges });
  }

  didSave(uri: string) {
    this.notify('textDocument/didSave', { textDocument: { uri } });
  }

  didClose(uri: string) {
    this.notify('textDocument/didClose', { textDocument: { uri } });
  }

  /**
   * typstyle's edits for an open document, against the text Tinymist has now:
   * spacing, indentation, `&` columns in equations. `[]` when it's already
   * formatted; null when typstyle can't parse it (a syntax error).
   */
  async format(uri: string): Promise<LspTextEdit[] | null> {
    if (!this.running) return null;
    return (await this.request('textDocument/formatting', { textDocument: { uri }, options: { tabSize: 2, insertSpaces: true } })) ?? null;
  }

  /**
   * Source → preview: ask the preview to scroll to where a source position
   * renders (0-based line/character). Positions that don't map to rendered
   * content (column 0, some math/label positions) are silently ignored by
   * Tinymist, so callers send a few candidates, most precise last.
   */
  scrollPreviewTo(absPath: string, line: number, character: number) {
    if (!this.running) return Promise.resolve();
    return this.executeCommand('tinymist.scrollPreview', [PREVIEW_TASK, { event: 'panelScrollTo', filepath: absPath, line, character }]);
  }

  /** Export the entry point (or another file) to PDF, in the configured output folder. Returns the written path. */
  async exportPdf(fileAbs = this.entryAbs): Promise<string> {
    const res = await this.executeCommand('tinymist.exportPdf', [fileAbs]);
    if (!res?.path) throw new Error('Tinymist did not report an output file');
    return res.path as string;
  }

  executeCommand(command: string, args: unknown[]) {
    return this.request('workspace/executeCommand', { command, arguments: args });
  }

  request(method: string, params: unknown): Promise<any> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      this.send({ jsonrpc: '2.0', id, method, params }).catch((e) => {
        this.pending.delete(id);
        reject(e);
      });
    });
  }

  notify(method: string, params: unknown) {
    if (!this.running) return;
    this.send({ jsonrpc: '2.0', method, params }).catch((e) => console.error(`tinymist ${method} failed`, e));
  }

  private send(msg: unknown) {
    return ipc.typstSend(JSON.stringify(msg));
  }

  private dispatch(msg: any) {
    if (msg.$closed) {
      this.running = false;
      for (const p of this.pending.values()) p.reject(new Error(`tinymist exited during ${p.method}`));
      this.pending.clear();
      this.emit('closed');
      return;
    }
    if (msg.id !== undefined && msg.method === undefined) {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(`${p.method}: ${msg.error.message}`));
      else p.resolve(msg.result);
    } else if (msg.id !== undefined) {
      // Server → client request.
      let result: unknown = null;
      if (msg.method === 'workspace/configuration') {
        result = msg.params.items.map((i: any) => lookupConfig(this.config, i.section));
      } else if (msg.method === 'window/showDocument') {
        // Preview → source: Tinymist sends this when rendered content is clicked.
        const { uri, selection } = msg.params;
        let filepath = '';
        try {
          filepath = decodeURIComponent(new URL(uri).pathname);
        } catch {}
        if (filepath && selection) {
          this.emit('scrollSource', {
            filepath,
            start: [selection.start.line, selection.start.character],
            end: [selection.end.line, selection.end.character],
          });
        }
        result = { success: !!filepath };
      }
      this.send({ jsonrpc: '2.0', id: msg.id, result }).catch(() => {});
    } else if (msg.method === 'textDocument/publishDiagnostics') {
      this.emit('diagnostics', msg.params.uri, msg.params.diagnostics);
    } else if (msg.method === 'tinymist/compileStatus') {
      this.emit('compile', msg.params);
    } else if (msg.method === 'tinymist/preview/scrollSource') {
      this.emit('scrollSource', msg.params);
    }
  }
}
