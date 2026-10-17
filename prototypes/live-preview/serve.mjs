#!/usr/bin/env node
// Interactive spike: Monaco on the left, Tinymist's live preview embedded on the
// right. Every Monaco change is forwarded to the single Tinymist LSP process as
// an incremental didChange. Nothing is ever written to disk.
//
//   node serve.mjs [--root DIR] [--port 5199]
import { createReadStream, readdirSync, realpathSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { TypstSession } from './tinymist.mjs';

const { values: opt } = parseArgs({
  options: {
    root: { type: 'string', default: resolve(import.meta.dirname, '../../fixtures/sample-book') },
    entry: { type: 'string', default: 'main.typ' },
    port: { type: 'string', default: '5199' },
  },
});
const root = realpathSync(resolve(opt.root));
const here = import.meta.dirname;
const monacoDir = join(here, 'node_modules/monaco-editor/min');

const session = new TypstSession(root);
await session.initialize();
session.open(opt.entry);
await session.pinMain(opt.entry);
const preview = await session.startPreview(opt.entry);
const previewUrl = `http://127.0.0.1:${preview.staticServerPort}/`;

const typFiles = readdirSync(root, { recursive: true })
  .filter((f) => f.endsWith('.typ'))
  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

// ---- server → page events (SSE) ---------------------------------------------
const sseClients = new Set();
function broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) res.write(msg);
}
let outline = [];
session.lsp.on('notification', (method, params) => {
  if (method === 'tinymist/documentOutline') outline = params.items;
  if (method === 'tinymist/compileStatus') broadcast('compile', params);
  if (method === 'textDocument/publishDiagnostics') {
    broadcast('diagnostics', { path: relative(root, fileURLToPath(params.uri)), diagnostics: params.diagnostics });
  }
});
session.lsp.on('server-exit', (code, signal) => broadcast('server-exit', { code, signal }));

// ---- helpers ------------------------------------------------------------------
function workspacePath(rel) {
  const abs = resolve(root, rel);
  if (!abs.startsWith(root + sep)) throw Object.assign(new Error('path outside workspace'), { status: 403 });
  if (!realpathSync(abs).startsWith(root + sep)) throw Object.assign(new Error('symlink outside workspace'), { status: 403 });
  return relative(root, abs);
}
async function readJson(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
const json = (res, status, body) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.ttf': 'font/ttf', '.json': 'application/json' };
function serveFile(res, file) {
  const s = createReadStream(file);
  s.on('error', () => res.writeHead(404).end());
  s.on('open', () => res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }));
  s.pipe(res);
}

// ---- routes -------------------------------------------------------------------
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  try {
    if (req.method === 'GET' && url.pathname === '/') return serveFile(res, join(here, 'index.html'));
    if (req.method === 'GET' && url.pathname.startsWith('/monaco/')) {
      const file = resolve(monacoDir, '.' + decodeURIComponent(url.pathname.slice('/monaco'.length)));
      if (!file.startsWith(monacoDir + sep)) return res.writeHead(403).end();
      return serveFile(res, file);
    }
    if (req.method === 'GET' && url.pathname === '/api/session') {
      return json(res, 200, { root, entry: opt.entry, files: typFiles, previewUrl, tinymist: session.bin });
    }
    if (req.method === 'GET' && url.pathname === '/api/outline') return json(res, 200, outline);
    if (req.method === 'GET' && url.pathname === '/api/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      res.write(': connected\n\n');
      sseClients.add(res);
      req.on('close', () => sseClients.delete(res));
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/open') {
      const path = workspacePath((await readJson(req)).path);
      const uri = session.uri(path);
      if (!session.docs.has(uri)) session.open(path);
      const doc = session.docs.get(uri);
      return json(res, 200, { path, version: doc.version, text: doc.text });
    }
    if (req.method === 'POST' && url.pathname === '/api/change') {
      const { path, changes } = await readJson(req);
      const uri = session.uri(workspacePath(path));
      if (!session.docs.has(uri)) return json(res, 409, { error: 'document not open' });
      return json(res, 200, { version: session.change(uri, changes) });
    }
    if (req.method === 'POST' && url.pathname === '/api/scroll') {
      const { path, line, character } = await readJson(req);
      await session.scrollPreview(workspacePath(path), line, character);
      return json(res, 200, { ok: true });
    }
    res.writeHead(404).end();
  } catch (err) {
    json(res, err.status ?? 500, { error: err.message });
  }
});

server.listen(Number(opt.port), '127.0.0.1', () => {
  console.log(`tinymist: ${session.bin} (partial rendering ${session.partialRendering ? 'on' : 'off'})`);
  console.log(`preview:  ${previewUrl}`);
  console.log(`LISTENING http://127.0.0.1:${server.address().port}/`);
});
const stop = async () => {
  await session.shutdown();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
