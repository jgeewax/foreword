import { describe, expect, it } from 'vitest';
import { AcpAdapter, type AcpKind, type AcpTransport } from './acp';
import type { AttachedFile, InlineFile } from './types';

const ROOT = '/Users/ada/Books/Linear Algebra';

/** An agent that answers everything at once, with these prompt capabilities. */
function agent(kind: AcpKind, promptCapabilities: Record<string, boolean>) {
  const sent: any[] = [];
  let deliver: (m: any) => void = () => {};
  const transport: AcpTransport = {
    start: async (_kind, onMessage) => {
      deliver = onMessage;
    },
    send: async (line) => {
      const m = JSON.parse(line);
      sent.push(m);
      if (m.id === undefined || !m.method) return;
      const result =
        m.method === 'initialize'
          ? { protocolVersion: 1, agentCapabilities: { promptCapabilities } }
          : m.method === 'session/new'
            ? { sessionId: `s${m.id}` }
            : m.method === 'session/prompt'
              ? undefined
              : {};
      if (result) queueMicrotask(() => deliver({ jsonrpc: '2.0', id: m.id, result }));
    },
    stop: async () => {},
  };
  return { adapter: new AcpAdapter(ROOT, kind, transport), sent };
}

const photo: AttachedFile = { path: '.foreword/attachments/shot.png', name: 'shot.png', size: 9 };
const pdf: AttachedFile = { path: '.foreword/attachments/brief.pdf', name: 'brief.pdf', size: 4 };
const picture: InlineFile = { path: photo.path, mime: 'image/png', data: 'iVBORw0K', picture: true };
const pdfBytes: InlineFile = { path: pdf.path, mime: 'application/pdf', data: 'JVBERg==', picture: false };

describe('ACP: attached files', () => {
  it('what each agent takes, from its prompt capabilities', async () => {
    const claude = agent('claude', { image: true, embeddedContext: true }).adapter;
    await claude.start();
    expect(claude.takes()).toEqual({ pictures: true, files: false });
    const gemini = agent('gemini', { image: true, audio: true, embeddedContext: true }).adapter;
    await gemini.start();
    expect(gemini.takes()).toEqual({ pictures: true, files: true });
    const plain = agent('antigravity', {}).adapter;
    await plain.start();
    expect(plain.takes()).toEqual({ pictures: false, files: false });
  });

  it('a picture goes before the words; every file is named in them', async () => {
    const { adapter, sent } = agent('claude', { image: true });
    await adapter.start();
    const sessionId = await adapter.createSession(null);
    await adapter.send(sessionId, 'What does it say?', [{ files: [photo, pdf], inline: [picture] }]);
    const prompt = sent.find((m) => m.method === 'session/prompt').params.prompt;
    expect(prompt[0]).toEqual({ type: 'image', mimeType: 'image/png', data: 'iVBORw0K' });
    expect(prompt[1].type).toBe('text');
    expect(prompt[1].text).toMatch(/^What does it say\?\n\nFiles the author attached/);
    expect(prompt[1].text).toContain('<attachment path=".foreword/attachments/brief.pdf" type="application/pdf" size="4 B"/>');
    expect(prompt).toHaveLength(2);

    // Queued while that turn runs, it keeps its picture for when it goes.
    await adapter.send(sessionId, 'And this one?', [{ files: [photo], inline: [picture] }]);
    const id = sent.find((m) => m.method === 'session/prompt').id;
    (adapter as any).receive({ jsonrpc: '2.0', id, result: { stopReason: 'end_turn' } });
    await Promise.resolve();
    const next = sent.filter((m) => m.method === 'session/prompt').at(-1).params.prompt;
    expect(next.map((b: any) => b.type)).toEqual(['image', 'text']);
    expect(next[1].text).toMatch(/^And this one\?/);
  });

  it('Gemini CLI: a PDF in the message too, as an embedded resource at its place in the book', async () => {
    const { adapter, sent } = agent('gemini', { image: true, embeddedContext: true });
    await adapter.start();
    const sessionId = await adapter.createSession(null);
    await adapter.send(sessionId, '', [{ files: [pdf], inline: [pdfBytes] }]);
    const prompt = sent.find((m) => m.method === 'session/prompt').params.prompt;
    expect(prompt[0]).toEqual({ type: 'resource', resource: { uri: 'file:///Users/ada/Books/Linear%20Algebra/.foreword/attachments/brief.pdf', mimeType: 'application/pdf', blob: 'JVBERg==' } });
    // No words: the message is the files' lines.
    expect(prompt.at(-1).text).toMatch(/^Files the author attached/);
  });
});
