// Minimal JSON-RPC/LSP client over stdio. Prototype only: no cancellation,
// no partial results, no progress tracking.
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';

export class LspClient extends EventEmitter {
  #nextId = 1;
  #pending = new Map();
  #requestHandlers = new Map();
  #buf = Buffer.alloc(0);

  constructor(command, args, { cwd, env } = {}) {
    super();
    this.proc = spawn(command, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
    this.proc.stdout.on('data', (chunk) => this.#onData(chunk));
    this.proc.stderr.on('data', (d) => this.emit('stderr', d.toString()));
    this.proc.on('exit', (code, signal) => {
      for (const p of this.#pending.values()) p.reject(new Error(`language server exited (${code ?? signal})`));
      this.#pending.clear();
      this.emit('server-exit', code, signal);
    });
  }

  request(method, params) {
    const id = this.#nextId++;
    this.#write({ jsonrpc: '2.0', id, method, params });
    return new Promise((resolve, reject) => this.#pending.set(id, { resolve, reject, method }));
  }

  notify(method, params) {
    this.#write({ jsonrpc: '2.0', method, params });
  }

  onRequest(method, handler) {
    this.#requestHandlers.set(method, handler);
  }

  async shutdown() {
    try {
      await Promise.race([this.request('shutdown', null), new Promise((r) => setTimeout(r, 2000))]);
      this.notify('exit', null);
    } catch {}
    setTimeout(() => this.proc.kill(), 500).unref();
  }

  #write(msg) {
    const body = Buffer.from(JSON.stringify(msg), 'utf8');
    this.proc.stdin.write(Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'ascii'), body]));
  }

  #onData(chunk) {
    this.#buf = Buffer.concat([this.#buf, chunk]);
    for (;;) {
      const headerEnd = this.#buf.indexOf('\r\n\r\n');
      if (headerEnd < 0) return;
      const header = this.#buf.subarray(0, headerEnd).toString('ascii');
      const m = /Content-Length:\s*(\d+)/i.exec(header);
      if (!m) throw new Error(`bad LSP header: ${header}`);
      const start = headerEnd + 4;
      const end = start + Number(m[1]);
      if (this.#buf.length < end) return;
      const msg = JSON.parse(this.#buf.subarray(start, end).toString('utf8'));
      this.#buf = this.#buf.subarray(end);
      this.#dispatch(msg);
    }
  }

  #dispatch(msg) {
    if (msg.id !== undefined && msg.method === undefined) {
      const p = this.#pending.get(msg.id);
      if (!p) return;
      this.#pending.delete(msg.id);
      if (msg.error) p.reject(Object.assign(new Error(`${p.method}: ${msg.error.message}`), { data: msg.error.data }));
      else p.resolve(msg.result);
    } else if (msg.id !== undefined) {
      const handler = this.#requestHandlers.get(msg.method);
      Promise.resolve(handler ? handler(msg.params) : null).then(
        (result) => this.#write({ jsonrpc: '2.0', id: msg.id, result: result ?? null }),
        (err) => this.#write({ jsonrpc: '2.0', id: msg.id, error: { code: -32603, message: String(err) } }),
      );
    } else {
      this.emit('notification', msg.method, msg.params);
    }
  }
}
