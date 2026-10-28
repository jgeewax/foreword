import { describe, expect, it } from 'vitest';
import { appTool, decide, permissionAsk } from '../services/agent/acp-events';
import { effortOption } from '../services/agent/models';
import { PRESETS, sessionRules, type Level } from '../services/agent/permissions';
import { STUDIO_TOOL_NAMES, studioToolName } from '../services/agent/studio-tool';
import type { AgentMode } from '../services/agent/modes';
import { DEFAULT_SETTINGS, type AppSettings, type AssistantId } from './settings';
import { handleMcp, parsePages, pngSize, TOOLS, type BookHost, type ModelChoice, type StudioHost } from './studio-tools';
import { describePermission, describeTool, NO_NAMES } from './tool-labels';

/** A PNG's first bytes (signature and header) for a page of this size, base64, as Tinymist sends one. */
function png(width: number, height: number): string {
  const bytes = [137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, ...'IHDR'.split('').map((c) => c.charCodeAt(0))];
  for (const n of [width, height]) bytes.push((n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);
  return btoa(String.fromCharCode(...bytes, 8, 6, 0, 0, 0));
}

/** A stand-in for the book as the preview has it: 120 pages of 6×9 in at the ppi asked for. */
function book(over: Partial<BookHost> = {}): BookHost & { drawn: { pages: number[]; ppi: number }[] } {
  const drawn: { pages: number[]; ppi: number }[] = [];
  return {
    drawn,
    preview: () => ({ shows: { kind: 'book' }, pages: 120, status: 'ok' }),
    settled: async () => true,
    pageImages: async (pages, ppi) => {
      drawn.push({ pages, ppi });
      return { total: 120, pages: pages.filter((p) => p <= 120).map((page) => ({ page, data: png(6 * ppi, 9 * ppi) })) };
    },
    outline: () => ({
      headings: [
        { level: 1, title: 'Preface', page: 7, at: 'front/preface.typ:1' },
        { level: 1, title: 'The Storm', page: 11, at: 'chapters/one.typ:1' },
        { level: 2, title: 'Before', page: 12, at: 'chapters/one.typ:9' },
        { level: 3, title: 'The harbour', page: 13 },
        { level: 1, title: 'The Calm', page: 40, at: 'chapters/two.typ:1' },
      ],
      stale: false,
    }),
    problems: () => [],
    comments: async () => [],
    ...over,
  };
}

/** A stand-in for Foreword: what the tools changed, and what waits for the reply's end. */
function host(permission: Level = 'allow', answer: 'yes' | 'no' | 'unanswered' = 'yes', pages: BookHost = book()) {
  const did: string[] = [];
  const asked: string[] = [];
  const idle: (() => unknown)[] = [];
  let settings: AppSettings = { ...DEFAULT_SETTINGS };
  let zoom = 1;
  const h: StudioHost = {
    state: () => ({
      settings,
      zoom,
      assistant: 'opencode' as AssistantId,
      models: [
        { providerID: 'opencode', id: 'beam-free', name: 'Beam Free', providerName: 'OpenCode', supportsTools: true },
        { providerID: 'anthropic', id: 'claude-sonnet-5', name: 'Claude Sonnet 5', providerName: 'Anthropic', supportsTools: true },
      ],
      model: { providerID: 'opencode', id: 'beam-free' },
      efforts: ['default', 'low', 'high'].map((v) => effortOption(v)),
      effort: 'default',
      mode: 'write' as AgentMode,
      permission,
    }),
    changePreferences: (patch, z) => {
      settings = { ...settings, ...patch };
      if (z !== undefined) zoom = z;
      did.push(`prefs ${JSON.stringify(patch)}${z !== undefined ? ` zoom ${z}` : ''}`);
    },
    approve: async (tool, what) => {
      asked.push(`${tool}: ${what}`);
      return answer;
    },
    whenIdle: (run) => void idle.push(run),
    switchAssistant: (id: AssistantId, choice: ModelChoice) => void did.push(`assistant ${id} ${JSON.stringify(choice)}`),
    chooseModel: async (choice: ModelChoice) => void did.push(`model ${JSON.stringify(choice)}`),
    setMode: async (mode: AgentMode) => void did.push(`mode ${mode}`),
    openSettings: (page) => void did.push(`settings ${page ?? ''}`),
    book: pages,
  };
  return { h, did, idle, asked, settings: () => settings, zoom: () => zoom };
}

/** The whole answer to a call: its words, its pictures, and whether it's an error. */
const callAll = async (h: StudioHost, name: string, args: object = {}) => {
  const r = await rpc(h, 'tools/call', { name, arguments: args });
  const content = r.result.content as { type: string; text?: string; data?: string; mimeType?: string }[];
  return { text: content[0].text!, images: content.slice(1), error: !!r.result.isError };
};

const rpc = async (h: StudioHost, method: string, params?: object, id: number | 'none' = 1) => {
  const out = await handleMcp(JSON.stringify({ jsonrpc: '2.0', ...(id === 'none' ? {} : { id }), method, params }), h);
  return out ? JSON.parse(out) : null;
};
const call = async (h: StudioHost, name: string, args: object = {}) => {
  const r = await rpc(h, 'tools/call', { name, arguments: args });
  return { text: r.result.content[0].text as string, error: !!r.result.isError };
};

describe('Foreword’s tools, as an MCP server', () => {
  it('says hello in the client’s version, lists its tools, and keeps quiet for notifications', async () => {
    const { h } = host();
    const init = await rpc(h, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'claude-code' } });
    expect(init.result).toMatchObject({ protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'foreword' } });
    expect((await rpc(h, 'initialize', { protocolVersion: '1999-01-01' })).result.protocolVersion).toBe('2025-06-18');
    expect(await rpc(h, 'notifications/initialized', {}, 'none')).toBeNull();
    const list = await rpc(h, 'tools/list');
    expect(list.result.tools.map((t: { name: string }) => t.name)).toEqual([
      'get_settings',
      'change_settings',
      'list_models',
      'set_model',
      'switch_assistant',
      'set_mode',
      'open_settings',
      'view_pages',
      'book_outline',
      'book_problems',
      'review_comments',
    ]);
    for (const t of list.result.tools) expect(t.inputSchema.type).toBe('object');
    expect((await rpc(h, 'resources/list')).error.code).toBe(-32601);
    expect(JSON.parse((await handleMcp('{oops', h))!).error.code).toBe(-32700);
    // A batch, answered as one.
    const batch = JSON.parse((await handleMcp(JSON.stringify([{ jsonrpc: '2.0', id: 1, method: 'ping' }, { jsonrpc: '2.0', method: 'notifications/initialized' }]), h))!);
    expect(batch).toEqual([{ jsonrpc: '2.0', id: 1, result: {} }]);
  });

  it('get_settings: the assistant, the assistants, and each preference with what it takes', async () => {
    const { h } = host();
    const r = await call(h, 'get_settings');
    const s = JSON.parse(r.text);
    expect(s.assistant).toMatchObject({ id: 'opencode', name: 'OpenCode', model: { id: 'beam-free' }, effort: { level: 'default', levels: ['default', 'low', 'high'] }, mode: { id: 'write' } });
    expect(s.assistants.map((a: { id: string }) => a.id)).toContain('claude');
    expect(s.preferences.editorFontSize).toMatchObject({ value: 12, values: '9 to 24' });
    expect(s.preferences.zoom.value).toBe(1);
    expect(s.preferences.permissions).toBeUndefined();
    expect(s.authorOnly).toMatch(/Settings ▸ Permissions/);
  });

  it('change_settings: changes preferences at once, and says what changed', async () => {
    const t = host();
    const r = await call(t.h, 'change_settings', { editorFontSize: 14, rulers: [120, 80], zoom: 1.25, formatOnSave: true });
    expect(r.error).toBe(false);
    expect(t.settings()).toMatchObject({ editorFontSize: 14, rulers: [80, 120] });
    expect(t.zoom()).toBe(1.25);
    expect(r.text).toBe('Changed (in effect now): editorFontSize: 12 px → 14 px; rulers: none → 80, 120; zoom: 100% → 125%; formatOnSave was already true.');
  });

  it('change_settings: also when an assistant wraps them in "settings"', async () => {
    const t = host();
    expect((await call(t.h, 'change_settings', { settings: '{"editorFontSize": 15, "rulers": [100]}' })).error).toBe(false);
    expect(t.settings()).toMatchObject({ editorFontSize: 15, rulers: [100] });
    expect((await call(t.h, 'change_settings', { settings: { wordWrap: 'off' } })).text).toBe('Changed (in effect now): wordWrap: window → off.');
    expect((await call(t.h, 'change_settings', { settings: { permissions: { shell: 'allow' } } })).error).toBe(true);
  });

  it('change_settings: never what the assistant may do, nor a value it doesn’t take', async () => {
    const t = host();
    for (const [args, says] of [
      [{ permissions: { shell: 'allow' } }, /can’t change what you may do without asking.*open_settings/],
      [{ allowCommands: ['rm'] }, /can’t change the commands you may run/],
      [{ alwaysAllow: ['rm *'] }, /can’t change the commands you may run/],
      [{ toolPaths: { git: '/tmp/x' } }, /programs Foreword runs/],
      [{ assistant: 'claude' }, /use switch_assistant/],
      [{ effort: 'high' }, /use set_model/],
      [{ fontFamily: 'Menlo' }, /No such preference: fontFamily/],
      [{ theme: 'sepia' }, /theme \(system, light, dark\)/],
      [{ editorFontSize: 99 }, /editorFontSize \(9 to 24\)/],
      [{ rulers: [5] }, /rulers/],
      [{ zoom: 9 }, /zoom/],
      [{}, /Nothing to change/],
    ] as const) {
      const r = await call(t.h, 'change_settings', args);
      expect(r.error, JSON.stringify(args)).toBe(true);
      expect(r.text).toMatch(says);
    }
    expect(t.did).toEqual([]);
    expect(t.settings().permissions).toEqual(DEFAULT_SETTINGS.permissions);
  });

  it('the assistant, model, effort and mode change when the reply ends', async () => {
    const t = host();
    expect((await call(t.h, 'switch_assistant', { assistant: 'claude', model: 'default' })).text).toMatch(/When your reply ends, Foreword switches to Claude Code \(model “default”\), and this task carries on with it: the author's next message goes to Claude Code, with the chat so far\./);
    expect((await call(t.h, 'set_model', { model: 'sonnet', effort: 'high' })).text).toMatch(/switches the model to “sonnet” and sets the effort to “high”/);
    expect((await call(t.h, 'set_mode', { mode: 'discuss' })).text).toBe('When your reply ends, the chat switches to Discuss mode.');
    expect(t.did).toEqual([]);
    for (const run of t.idle) await run();
    expect(t.did).toEqual(['assistant claude {"model":"default"}', 'model {"model":"sonnet","effort":"high"}', 'mode discuss']);
    // Plan, Discuss's old name, is Discuss.
    expect((await call(t.h, 'set_mode', { mode: 'Plan' })).text).toBe('When your reply ends, the chat switches to Discuss mode.');
    expect((await call(t.h, 'set_mode', { mode: 'draft' })).text).toBe('No mode is called “draft”: write, ask, discuss, options, figures.');
  });

  it('with the settings permission at Never, looks but changes nothing, and says why', async () => {
    const t = host('deny');
    expect(JSON.parse((await call(t.h, 'get_settings')).text).changing).toMatch(/You may not change them/);
    for (const [name, args] of [
      ['change_settings', { editorFontSize: 14 }],
      ['set_model', { effort: 'low' }],
      ['switch_assistant', { assistant: 'claude' }],
      ['set_mode', { mode: 'discuss' }],
    ] as const) {
      const r = await call(t.h, name, args);
      expect(r.error, name).toBe(true);
      expect(r.text).toMatch(/turned that off in Settings ▸ Permissions.*Nothing was changed/);
    }
    expect(t.did).toEqual([]);
    expect(t.idle).toEqual([]);
    expect((await call(t.h, 'open_settings', { page: 'permissions' })).error).toBe(false);
    expect(JSON.parse((await call(host('ask').h, 'get_settings')).text).changing).toMatch(/asked before each change/);
  });

  it('with the settings permission at Ask, changes only with the author’s yes, saying what to their card', async () => {
    const yes = host('ask', 'yes');
    expect((await call(yes.h, 'change_settings', { editorFontSize: 15, rulers: [100] })).error).toBe(false);
    expect(yes.asked).toEqual(['change_settings: text size 15 px, rulers at 100']);
    expect(yes.settings().editorFontSize).toBe(15);
    await call(yes.h, 'switch_assistant', { assistant: 'claude', model: 'default' });
    await call(yes.h, 'set_mode', { mode: 'discuss' });
    expect(yes.asked.slice(1)).toEqual(['switch_assistant: Claude Code (model “default”)', 'set_mode: Discuss mode']);
    expect(yes.idle).toHaveLength(2);
    // Looking never asks.
    await call(yes.h, 'get_settings');
    expect(yes.asked).toHaveLength(3);

    const no = host('ask', 'no');
    const refused = await call(no.h, 'change_settings', { editorFontSize: 15 });
    expect(refused).toEqual({ text: 'The author didn’t allow it. Nothing was changed.', error: true });
    expect(no.settings().editorFontSize).toBe(12);
    expect((await call(no.h, 'set_mode', { mode: 'discuss' })).error).toBe(true);
    expect(no.idle).toEqual([]);

    const away = host('ask', 'unanswered');
    expect((await call(away.h, 'set_model', { effort: 'low' })).text).toMatch(/hasn’t answered.*Ask them in your reply/);
    expect(away.idle).toEqual([]);
    // A mistake is said before anyone is asked.
    expect((await call(yes.h, 'change_settings', { editorFontSize: 99 })).error).toBe(true);
    expect(yes.asked).toHaveLength(3);
  });

  it('says plainly what it can’t do', async () => {
    const { h, idle } = host();
    expect((await call(h, 'switch_assistant', { assistant: 'copilot' })).text).toMatch(/No assistant is called “copilot”/);
    expect((await call(h, 'switch_assistant', { assistant: 'opencode' })).text).toBe('OpenCode is the assistant already.');
    expect((await call(h, 'set_model', { model: 'gpt-99' })).text).toMatch(/no model like “gpt-99”.*list_models/);
    expect((await call(h, 'set_model', { effort: 'ultra' })).text).toMatch(/levels are default, low, high: “ultra” isn’t one/);
    expect((await call(h, 'set_model', {})).error).toBe(true);
    expect((await call(h, 'set_mode', { mode: 'write' })).text).toBe('The chat is in Write mode already.');
    expect(idle).toEqual([]);
  });

  it('list_models and open_settings', async () => {
    const t = host();
    const models = JSON.parse((await call(t.h, 'list_models', { search: 'sonnet' })).text);
    expect(models).toMatchObject({ assistant: 'OpenCode', current: 'beam-free', models: [{ id: 'claude-sonnet-5' }] });
    expect((await call(t.h, 'open_settings', { page: 'permissions' })).text).toBe('Settings is open at permissions for the author.');
    expect(t.did).toEqual(['settings permissions']);
    expect((await call(t.h, 'open_settings', { page: 'secrets' })).error).toBe(true);
  });
});

describe('the book as the author sees it', () => {
  it('reads pages asked for in any of the usual ways', () => {
    expect(parsePages('41')).toEqual({ pages: [41], asked: 1 });
    expect(parsePages(41)).toEqual({ pages: [41], asked: 1 });
    expect(parsePages('41-42')).toEqual({ pages: [41, 42], asked: 2 });
    expect(parsePages('pages 41 – 42')).toEqual({ pages: [41, 42], asked: 2 });
    expect(parsePages('pp. 12, 30 and 31')).toEqual({ pages: [12, 30, 31], asked: 3 });
    expect(parsePages('12 to 14, 12')).toEqual({ pages: [12, 13, 14], asked: 3 });
    // The first four, and how many it was.
    expect(parsePages('1-745')).toEqual({ pages: [1, 2, 3, 4], asked: 745 });
    for (const bad of ['', 'chapter 3', '0', '9-3', 'last', null]) expect(parsePages(bad), String(bad)).toBeNull();
  });

  it('knows a PNG’s size from its header', () => {
    expect(pngSize(png(660, 990))).toEqual({ width: 660, height: 990 });
    expect(pngSize('bm90IGEgcG5nIGF0IGFsbCwgbm8gc2lyIG5vdCBhdCBhbGw=')).toBeNull();
    expect(pngSize('***')).toBeNull();
  });

  it('view_pages: the pages as images, after what they are', async () => {
    const b = book();
    const r = await callAll(host('allow', 'yes', b).h, 'view_pages', { pages: '41-42' });
    expect(r.error).toBe(false);
    expect(r.text).toBe('Pages 41–42 of 120, as the book is typeset now, in that order.');
    expect(r.images).toEqual([41, 42].map(() => ({ type: 'image', data: png(660, 990), mimeType: 'image/png' })));
    expect(b.drawn).toEqual([{ pages: [41, 42], ppi: 110 }]);
    // Never more than four, and none that aren't there.
    const many = await callAll(host('allow', 'yes', b).h, 'view_pages', { pages: '1-10' });
    expect(many.images).toHaveLength(4);
    expect(many.text).toMatch(/You asked for 10 pages; these are the first 4\. Ask for the others in turn\./);
    const past = await callAll(host('allow', 'yes', b).h, 'view_pages', { pages: '119-122' });
    expect(past.text).toMatch(/^Pages 119–120 of 120.*There's no pages 121–122: the book has 120 pages\./);
    expect(await callAll(host('allow', 'yes', b).h, 'view_pages', { pages: '200' })).toMatchObject({ text: "The book has 120 pages: there's no page 200.", error: true, images: [] });
    expect((await callAll(host().h, 'view_pages', { pages: 'the end' })).text).toMatch(/Give the pages as a number, a range or a list/);
  });

  it('view_pages: draws a big page smaller, and says what the preview shows when it isn’t the book', async () => {
    const poster = book({ pageImages: async (pages, ppi) => ({ total: 1, pages: pages.map((page) => ({ page, data: png(24 * ppi, 36 * ppi) })) }) });
    const big = await callAll(host('allow', 'yes', poster).h, 'view_pages', { pages: '1' });
    expect(pngSize(big.images[0].data!)).toEqual({ width: 1056, height: 1584 });
    const chapter = book({ preview: () => ({ shows: { kind: 'chapter', chapter: '“The Storm” (chapter 1)' }, pages: 30, status: 'ok' }) });
    expect((await callAll(host('allow', 'yes', chapter).h, 'view_pages', { pages: '3' })).text).toBe(
      "Page 3 of 120. The preview shows “The Storm” (chapter 1) alone (the author previews one chapter at a time), so these are that chapter's pages, not the whole book's: its page numbers, and its references to other chapters, are right only in the whole book.",
    );
    expect((await callAll(host('allow', 'yes', chapter).h, 'view_pages', { pages: '31' })).text).toBe("“The Storm” (chapter 1) has 30 pages: there's no page 31.");
    const cover = book({ preview: () => ({ shows: { kind: 'cover' }, pages: 1, status: 'ok' }) });
    expect((await callAll(host('allow', 'yes', cover).h, 'view_pages', { pages: '1' })).text).toMatch(/^Page 1 of 120\. The preview shows the book’s cover now/);
  });

  it('view_pages: with an error, says there are no pages until it’s fixed; and when the typesetting hasn’t caught up', async () => {
    const broken = book({
      preview: () => ({ shows: { kind: 'book' }, pages: 120, status: 'error' }),
      pageImages: async () => {
        throw new Error('ExportTask(0): document is not available for export');
      },
    });
    const r = await callAll(host('allow', 'yes', broken).h, 'view_pages', { pages: '2' });
    expect(r).toMatchObject({ error: true, text: 'Typst has an error just now, so there are no pages to look at until it’s fixed: book_problems lists it. (The preview keeps showing the last pages it could make.)' });
    const slow = book({ settled: async () => false });
    expect((await callAll(host('allow', 'yes', slow).h, 'view_pages', { pages: '2' })).text).toMatch(/still being typeset after the latest change, so this may be from just before it\.$/);
  });

  it('book_outline: each heading’s page and where it’s written, as deep as asked', async () => {
    const r = await call(host().h, 'book_outline');
    expect(r.text).toBe(
      [
        '120 pages, as the book is typeset now.',
        'Each heading’s page, and where it’s written:',
        'p. 7  Preface  (front/preface.typ:1)',
        'p. 11  The Storm  (chapters/one.typ:1)',
        '  p. 12  Before  (chapters/one.typ:9)',
        'p. 40  The Calm  (chapters/two.typ:1)',
      ].join('\n'),
    );
    expect((await call(host().h, 'book_outline', { depth: 3 })).text).toMatch(/\n {4}p\. 13 {2}The harbour$/m);
    expect((await call(host().h, 'book_outline', { depth: 1 })).text).not.toMatch(/Before/);
    const none = book({ outline: () => null });
    expect((await call(host('allow', 'yes', none).h, 'book_outline')).text).toMatch(/hasn’t had the book typeset with its preview open yet.*view_pages still shows any page/);
    const stale = book({ outline: () => ({ headings: [], stale: true }) });
    expect((await call(host('allow', 'yes', stale).h, 'book_outline')).text).toBe('120 pages, as the book is typeset now. This is from just before the latest change, which is still being typeset. It has no headings in its outline.');
  });

  it('book_problems: none, or each with its place', async () => {
    expect((await call(host().h, 'book_problems')).text).toBe('No errors or warnings: the book typesets cleanly.');
    const some = book({
      problems: () => [
        { path: 'chapters/one.typ', line: 12, column: 3, severity: 'error', message: 'unknown variable: sidenote' },
        { path: 'main.typ', line: 4, column: 1, severity: 'warning', message: 'unknown font family: garamond' },
      ],
    });
    const r = await call(host('allow', 'yes', some).h, 'book_problems');
    expect(r.text).toBe('1 error and 1 warning:\n- error at chapters/one.typ:12:3: unknown variable: sidenote\n- warning at main.typ:4:1: unknown font family: garamond');
    expect(describeTool('foreword_book_problems', {}, NO_NAMES, r.text).note).toBe('1 error and 1 warning');
    expect(describeTool('foreword_book_problems', {}, NO_NAMES, 'No errors or warnings: the book typesets cleanly.').note).toBe('none');
  });

  it('review_comments: the open ones, then those waiting for the author, and how to fix them all', async () => {
    expect((await call(host().h, 'review_comments')).text).toBe('The author has no review comments open.');
    const noted = book({
      comments: async () => [
        { id: 'c1', path: 'chapters/one.typ', line: 18, quote: 'The storm broke   at midnight.', text: 'too slow', status: 'open' },
        { id: 'c2', path: 'chapters/two.typ', line: null, quote: 'Calm.', text: 'cut this', status: 'open' },
        { id: 'c3', path: 'chapters/two.typ', line: 4, quote: 'And then', text: 'needs a source', status: 'addressed' },
      ],
    });
    const r = await call(host('allow', 'yes', noted).h, 'review_comments');
    expect(r.text).toMatch(/^2 open comments:\n- c1 at chapters\/one\.typ:18, on “The storm broke at midnight\.”: too slow\n- c2 at chapters\/two\.typ \(its passage has changed since, so it isn’t found\), on “Calm\.”: cut this\n/);
    expect(r.text).toMatch(/1 comment you changed the passage for, waiting for the author to keep or undo:\n- c3 at chapters\/two\.typ:4/);
    expect(r.text).toMatch(/Fix all in Review/);
  });
});

describe('the tools as the assistants name them', () => {
  it('are known by every assistant’s name for them', () => {
    expect(studioToolName('mcp__foreword__set_model')).toBe('set_model');
    expect(studioToolName('foreword_get_settings')).toBe('get_settings');
    expect(studioToolName('foreword.switch_assistant')).toBe('switch_assistant');
    expect(studioToolName('foreword__open_settings')).toBe('open_settings');
    expect(studioToolName('mcp__other__set_model')).toBeNull();
    expect(studioToolName('Read')).toBeNull();
  });

  it('are all of them; OpenCode asks about each by name: those that look are allowed, those that change follow the settings permission', () => {
    expect([...STUDIO_TOOL_NAMES]).toEqual(TOOLS.map((t) => t.name));
    const effect = (preset: keyof typeof PRESETS, t: string) => decide(`foreword_${t}`, ['*'], sessionRules(PRESETS[preset].permissions));
    for (const t of ['get_settings', 'list_models', 'open_settings', 'view_pages', 'book_outline', 'book_problems', 'review_comments'])
      for (const p of ['ask', 'edit', 'readonly'] as const) expect(effect(p, t), `${p} ${t}`).toBe('allow');
    for (const t of ['change_settings', 'set_model', 'switch_assistant', 'set_mode']) {
      expect(effect('ask', t)).toBe('ask');
      expect(effect('edit', t)).toBe('allow');
      // Never: the tool itself refuses, saying why.
      expect(effect('readonly', t)).toBe('allow');
    }
  });

  it('over ACP: the app’s name for them, their arguments, and the same permission', () => {
    const claude = appTool({ toolCallId: 't', title: 'mcp__foreword__change_settings', kind: 'other', rawInput: { editorFontSize: 14 }, _meta: { claudeCode: { toolName: 'mcp__foreword__change_settings' } } });
    expect(claude).toEqual({ name: 'foreword_change_settings', input: { editorFontSize: 14 } });
    const codex = appTool({ toolCallId: 'u', title: 'Tool: foreword/get_settings', kind: 'other', rawInput: { server: 'foreword', tool: 'get_settings', arguments: {} } });
    expect(codex.name).toBe('foreword_get_settings');
    const ask = permissionAsk({ toolCallId: 't', title: 'mcp__foreword__set_model', _meta: { claudeCode: { toolName: 'mcp__foreword__set_model' } } }, '/book');
    expect(ask).toEqual({ action: 'foreword', resources: ['set_model'], patches: [] });
    expect(decide(ask.action, ask.resources, sessionRules(PRESETS.ask.permissions))).toBe('ask');
    expect(decide(ask.action, ask.resources, sessionRules(PRESETS.edit.permissions))).toBe('allow');
    expect(decide(ask.action, ask.resources, sessionRules(PRESETS.readonly.permissions, true))).toBe('allow');
    // Discuss mode is read-only for the book, not for settings the author asked to change.
    expect(decide(ask.action, ask.resources, sessionRules(PRESETS.edit.permissions, true))).toBe('allow');
    const look = permissionAsk({ toolCallId: 'l', title: 'mcp__foreword__get_settings', _meta: { claudeCode: { toolName: 'mcp__foreword__get_settings' } } }, '/book');
    expect(decide(look.action, look.resources, sessionRules(PRESETS.readonly.permissions, true))).toBe('allow');
    expect(describePermission(ask.action, ask.resources, NO_NAMES).what).toBe('change its model or effort');
    expect(describePermission('foreword_change_settings', ['*'], NO_NAMES).what).toBe('change Foreword’s settings');
    // Another server's tool still asks.
    const other = permissionAsk({ toolCallId: 'v', title: 'mcp__github__create_issue', _meta: { claudeCode: { toolName: 'mcp__github__create_issue' } } }, '/book');
    expect(decide(other.action, other.resources, sessionRules(PRESETS.edit.permissions))).toBe('ask');
  });

  it('in words, in the chat', () => {
    expect(describeTool('foreword_change_settings', { editorFontSize: 14, rulers: [80, 120] }, NO_NAMES)).toMatchObject({ done: 'Changed Foreword’s settings', note: 'text size 14 px, rulers at 80, 120' });
    expect(describeTool('mcp__foreword__switch_assistant', { assistant: 'claude' }, NO_NAMES).done).toBe('Switched the assistant to Claude Code');
    expect(describeTool('foreword_set_model', { model: 'sonnet', effort: 'high' }, NO_NAMES).note).toBe('model “sonnet”, effort “high”, when it finishes');
    expect(describeTool('foreword_get_settings', {}, NO_NAMES).running).toBe('Looking at Foreword’s settings');
    expect(describeTool('mcp__foreword__view_pages', { pages: '41-42' }, NO_NAMES).done).toBe('Looked at pages 41–42');
    expect(describeTool('foreword_view_pages', { pages: '7' }, NO_NAMES).running).toBe('Looking at page 7');
    expect(describeTool('foreword_book_outline', {}, NO_NAMES).done).toBe('Looked at where the chapters fall');
    expect(describeTool('foreword_review_comments', {}, NO_NAMES).done).toBe('Read your review comments');
  });
});

describe('the tools’ descriptions', () => {
  it('fit an assistant’s tool list', () => {
    for (const t of TOOLS) expect(t.description.length, t.name).toBeLessThan(700);
  });
});
