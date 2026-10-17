// One Tinymist process: LSP over stdio, with the preview started through the
// LSP so it renders the in-memory (unsaved) buffers.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { LspClient } from './lsp.mjs';

// Executable discovery: $TINYMIST_PATH, then PATH, then the VS Code extension.
export function findTinymist() {
  if (process.env.TINYMIST_PATH) return process.env.TINYMIST_PATH;
  try {
    return execFileSync('/usr/bin/which', ['tinymist'], { encoding: 'utf8' }).trim();
  } catch {}
  const extDir = join(homedir(), '.vscode', 'extensions');
  if (existsSync(extDir)) {
    const candidates = readdirSync(extDir)
      .filter((d) => d.startsWith('myriad-dreamin.tinymist-'))
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
      .map((d) => join(extDir, d, 'out', 'tinymist'))
      .filter(existsSync);
    if (candidates.length) return candidates[0];
  }
  throw new Error('tinymist not found: set TINYMIST_PATH, install it (brew install tinymist), or install the VS Code extension');
}

const CONFIG = {
  compileStatus: 'enable',
  exportPdf: 'never',
  semanticTokens: 'disable',
  preview: { refresh: 'onType', partialRendering: process.env.TINYMIST_PARTIAL_RENDERING !== '0' },
};

function lookup(section) {
  if (!section || section === 'tinymist') return CONFIG;
  if (!section.startsWith('tinymist.')) return null;
  return section.slice('tinymist.'.length).split('.').reduce((o, k) => (o == null ? null : o[k] ?? null), CONFIG);
}

export class TypstSession {
  docs = new Map(); // uri -> { version, text }
  partialRendering = CONFIG.preview.partialRendering;

  constructor(root, { onLog } = {}) {
    this.root = resolve(root);
    this.bin = findTinymist();
    this.lsp = new LspClient(this.bin, ['lsp'], { cwd: this.root, env: process.env });
    this.lsp.on('stderr', (s) => onLog?.(s));
    this.lsp.onRequest('workspace/configuration', ({ items }) => items.map((i) => lookup(i.section)));
    this.lsp.onRequest('window/workDoneProgress/create', () => null);
    this.lsp.onRequest('client/registerCapability', () => null);
    this.lsp.onRequest('workspace/semanticTokens/refresh', () => null);
  }

  uri(relPath) {
    return pathToFileURL(join(this.root, relPath)).href;
  }

  async initialize() {
    const rootUri = pathToFileURL(this.root).href;
    this.initResult = await this.lsp.request('initialize', {
      processId: process.pid,
      clientInfo: { name: 'typst-studio-prototype' },
      rootUri,
      workspaceFolders: [{ uri: rootUri, name: 'book' }],
      capabilities: {
        textDocument: { synchronization: { didSave: true }, publishDiagnostics: { versionSupport: true } },
        workspace: { configuration: true, workspaceFolders: true },
        window: { workDoneProgress: false },
      },
      initializationOptions: CONFIG,
    });
    this.lsp.notify('initialized', {});
    return this.initResult;
  }

  open(relPath) {
    const uri = this.uri(relPath);
    const text = readFileSync(join(this.root, relPath), 'utf8');
    this.docs.set(uri, { version: 1, text });
    this.lsp.notify('textDocument/didOpen', { textDocument: { uri, languageId: 'typst', version: 1, text } });
    return uri;
  }

  // Incremental change. Positions are 0-based line / UTF-16 character, as in LSP.
  change(relPathOrUri, contentChanges) {
    const uri = relPathOrUri.startsWith('file:') ? relPathOrUri : this.uri(relPathOrUri);
    const doc = this.docs.get(uri);
    doc.version += 1;
    for (const c of contentChanges) doc.text = applyChange(doc.text, c);
    this.lsp.notify('textDocument/didChange', { textDocument: { uri, version: doc.version }, contentChanges });
    return doc.version;
  }

  pinMain(relPath) {
    return this.lsp.request('workspace/executeCommand', {
      command: 'tinymist.pinMain',
      arguments: [join(this.root, relPath)],
    });
  }

  startPreview(relPath, taskId = 'preview-1') {
    this.previewTaskId = taskId;
    return this.lsp.request('workspace/executeCommand', {
      command: 'tinymist.doStartPreview',
      arguments: [['--task-id', taskId, '--data-plane-host', '127.0.0.1:0', join(this.root, relPath)]],
    });
  }

  // Source → preview: scroll the preview to the rendered location of a source position.
  scrollPreview(relPath, line, character) {
    return this.lsp.request('workspace/executeCommand', {
      command: 'tinymist.scrollPreview',
      arguments: [this.previewTaskId, { event: 'panelScrollTo', filepath: join(this.root, relPath), line, character }],
    });
  }

  shutdown() {
    return this.lsp.shutdown();
  }
}

export function offsetAt(text, { line, character }) {
  let offset = 0;
  for (let l = 0; l < line; l++) {
    const nl = text.indexOf('\n', offset);
    if (nl < 0) return text.length;
    offset = nl + 1;
  }
  return Math.min(offset + character, text.length);
}

export function applyChange(text, change) {
  if (!change.range) return change.text;
  return text.slice(0, offsetAt(text, change.range.start)) + change.text + text.slice(offsetAt(text, change.range.end));
}
