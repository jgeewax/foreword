// Settings for spelling and grammar: what's checked as you type (every book),
// the language a book is checked in, the words each dictionary accepts (the
// book's, committed with it, and your own), and the grammar rules.
import { useEffect, useMemo, useState } from 'react';
import { LANGUAGES, languageName, normalizeLanguage, ruleTitle } from '../app/proofing-core';
import { studio } from '../app/studio';
import { errorMessage, ipc, type ProofRule, type WordScope } from '../lib/ipc';
import { listen } from '@tauri-apps/api/event';
import { useStore } from '../lib/store';
import { Icon } from './icons';
import { Picker, SwitchRow, type PickerRow } from './SettingControls';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="settings-section">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

/** Words shown at once; a search finds the others (Settings' own search reads every page). */
const SHOWN_WORDS = 150;

const BOOK_WORDS_FILE = '.foreword/dictionary.txt';

/** A dictionary's words: add, find, take out, or edit the file as text. */
export function WordList({ scope }: { scope: WordScope }) {
  const [words, setWords] = useState<string[] | null>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const load = () =>
      void ipc
        .proofWords(scope)
        .then(setWords)
        .catch((e) => setError(errorMessage(e)));
    load();
    // Added from the editor (in any window), or the file changed.
    const off = listen('proofing:words', load);
    return () => void off.then((f) => f());
  }, [scope]);
  const edit = async (add: string[], remove: string[]) => {
    try {
      setWords(await ipc.proofWordsEdit(scope, add, remove));
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  const query = text.trim();
  const found = (words ?? []).filter((w) => !query || w.toLowerCase().includes(query.toLowerCase()));
  const canAdd = !!query && !/\s/.test(query) && !(words ?? []).includes(query);
  const add = () => {
    if (!canAdd) return;
    void edit([query], []);
    setText('');
  };
  const editAsText = () => {
    if (scope === 'book') {
      studio.closeSettings();
      void (async () => {
        if (!(words ?? []).length) await edit([], []);
        await studio.openFile(BOOK_WORDS_FILE);
      })();
    } else void ipc.proofWordsOpen().catch((e) => setError(errorMessage(e)));
  };
  return (
    <div className="word-list">
      <div className="settings-row word-list-bar">
        <input
          value={text}
          placeholder="Find or add a word"
          aria-label={scope === 'book' ? 'Find or add a word in the book’s dictionary' : 'Find or add a word in your dictionary'}
          spellCheck={false}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
        />
        <button onClick={add} disabled={!canAdd}>
          Add
        </button>
        <span className="spacer" />
        <span className="muted">{words === null ? 'Reading…' : words.length === 1 ? '1 word' : `${words.length} words`}</span>
        <button className="link" onClick={editAsText}>
          Edit as text
        </button>
      </div>
      {error && <p className="settings-help bad">{error}</p>}
      {words && words.length === 0 && <p className="rule-empty">None yet. “Add to {scope === 'book' ? 'Book' : 'My'} Dictionary” on a misspelling puts a word here.</p>}
      {found.length > 0 && (
        <div className="word-chips">
          {found.slice(0, SHOWN_WORDS).map((w) => (
            <span key={w} className="word-chip">
              <span className="selectable">{w}</span>
              <button className="icon" aria-label={`Remove ${w}`} title="Take it out: it’s flagged again" onClick={() => void edit([], [w])}>
                <Icon name="close" size={10} />
              </button>
            </span>
          ))}
          {found.length > SHOWN_WORDS && <span className="muted">and {found.length - SHOWN_WORDS} more: type to find them</span>}
        </div>
      )}
      {words && words.length > 0 && query && !found.length && <p className="rule-empty">No word here has “{query}” in it.</p>}
    </div>
  );
}

/** The languages a book can be checked in, for a picker. */
function languageRows(current: string | null, pick: (tag: string | null) => void, first: { title: string; detail: string }): PickerRow[] {
  return [
    { key: 'auto', title: first.title, detail: first.detail, selected: current === null, run: () => pick(null) },
    ...LANGUAGES.map((tag) => ({ key: tag, title: languageName(tag), detail: tag, selected: current === tag, section: 'Languages', run: () => pick(tag) })),
  ];
}

/** Harper's rules with the author's choice over each, found by name or description. */
function RulesList({ scope }: { scope: WordScope }) {
  const [rules, setRules] = useState<ProofRule[] | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const mine = useStore(studio.store, (s) => s.settings.proofRules);
  const book = useStore(studio.store, (s) => s.project.settings.proofRules);
  useEffect(() => {
    if (open && !rules) void ipc.proofRules().then(setRules);
  }, [open, rules]);
  const own = scope === 'book' ? (book ?? {}) : mine;
  const on = (r: ProofRule) => own[r.name] ?? (scope === 'book' ? mine[r.name] : undefined) ?? r.default;
  const set = (r: ProofRule, value: boolean) => {
    const next = { ...own };
    // Back to the default: no entry.
    const inherited = (scope === 'book' ? mine[r.name] : undefined) ?? r.default;
    if (value === inherited) delete next[r.name];
    else next[r.name] = value;
    if (scope === 'book') void studio.updateProjectSettings({ proofRules: next });
    else studio.updateSettings({ proofRules: next });
  };
  const changed = Object.keys(own);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (rules ?? []).filter((r) => !q || r.name.toLowerCase().includes(q) || ruleTitle(r.name).toLowerCase().includes(q) || r.description.toLowerCase().includes(q));
  }, [rules, query]);
  return (
    <div className="settings-field">
      {changed.length > 0 && (
        <ul className="rule-list proof-rules">
          {changed.sort().map((name) => (
            <li key={name} className="rule-row">
              <div className="rule-text">
                <div className="rule-title">{ruleTitle(name)}</div>
                <div className="rule-meta">{own[name] ? 'Checked' : 'Not checked'}{scope === 'book' ? ' in this book' : ''}</div>
              </div>
              <button className="link" onClick={() => (scope === 'book' ? void studio.updateProjectSettings({ proofRules: Object.fromEntries(Object.entries(own).filter(([k]) => k !== name)) }) : studio.updateSettings({ proofRules: Object.fromEntries(Object.entries(own).filter(([k]) => k !== name)) }))}>
                {scope === 'book' ? 'As in every book' : 'Back to the default'}
              </button>
            </li>
          ))}
        </ul>
      )}
      {changed.length === 0 && <p className="rule-empty">{scope === 'book' ? 'None: this book checks what every book does.' : 'None changed. “Don’t Check for…” on a grammar mistake turns its rule off.'}</p>}
      {scope === 'user' && (
        <>
          <button className="link" onClick={() => setOpen(!open)}>
            {open ? 'Hide the rules' : 'Every rule…'}
          </button>
          {open && (
            <div className="proof-all-rules">
              <input value={query} placeholder="Find a rule" aria-label="Find a grammar rule" spellCheck={false} onChange={(e) => setQuery(e.target.value)} />
              {!rules && <p className="rule-empty">Reading the rules…</p>}
              {rules && (
                <p className="settings-help">
                  {shown.length} of {rules.length} rules{query ? ` with “${query}”` : ''}.
                </p>
              )}
              <ul className="rule-list">
                {shown.slice(0, 60).map((r) => (
                  <li key={r.name} className="rule-row">
                    <SwitchRow checked={on(r)} onChange={(v) => set(r, v)}>
                      <span className="settings-switch-label">{ruleTitle(r.name)}</span>
                      <span className="settings-help">{r.description.replace(/`([^`]*)`/g, '“$1”')}</span>
                    </SwitchRow>
                  </li>
                ))}
              </ul>
              {shown.length > 60 && <p className="settings-help">And {shown.length - 60} more: type to find them.</p>}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** Settings ▸ Spelling & Grammar: for every book. */
export function SpellingPage() {
  const s = useStore(studio.store, (x) => x.settings);
  const mac = normalizeLanguage(navigator.language) ?? 'en-US';
  const current = normalizeLanguage(s.spellingLanguage);
  return (
    <>
      <Section title="As you type">
        <div className="settings-field">
          <SwitchRow checked={s.checkSpelling} onChange={(checkSpelling) => studio.updateSettings({ checkSpelling })}>
            <span className="settings-switch-label">Check spelling</span>
            <span className="settings-help">A red wavy line under a word the dictionary doesn’t know, once you’ve finished typing it. Click it, or right-click, for suggestions.</span>
          </SwitchRow>
        </div>
        <div className="settings-field">
          <SwitchRow checked={s.checkGrammar} onChange={(checkGrammar) => studio.updateSettings({ checkGrammar })}>
            <span className="settings-switch-label">Check grammar</span>
            <span className="settings-help">A blue wavy line under “an test”, “the the”, “their” for “there” and such. In English; other languages get spelling only.</span>
          </SwitchRow>
        </div>
        <div className="settings-field">
          <SwitchRow checked={s.checkStyle} onChange={(checkStyle) => studio.updateSettings({ checkStyle })}>
            <span className="settings-switch-label">Suggest style</span>
            <span className="settings-help">Dotted purple under wordiness and house-style choices (“non-zero” for “nonzero”, “in order to”): not mistakes, so off unless you want them.</span>
          </SwitchRow>
        </div>
        <div className="settings-field">
          <SwitchRow checked={s.checkCode} onChange={(checkCode) => studio.updateSettings({ checkCode })}>
            <span className="settings-switch-label">Check code</span>
            <span className="settings-help">
              Words in code blocks, inline code and code files, and the names a file defines, split at _ and capitals as VS Code’s Code Spell Checker does: “tmie_zone” suggests “time_zone”.
            </span>
          </SwitchRow>
        </div>
        <p className="settings-help">
          All of it is checked on this Mac, by rules and dictionaries (Harper, Typst’s own parser, cspell’s word lists): nothing is sent anywhere, and the assistant isn’t asked. Math, labels, references,
          links and settings such as fonts aren’t checked. ⌘; goes to the next mistake.
        </p>
      </Section>
      <Section title="Language">
        <div className="settings-field">
          <div className="settings-label">Books that don’t say</div>
          <Picker
            label="Language of books that don't say"
            rows={languageRows(current, (tag) => studio.updateSettings({ spellingLanguage: tag ?? '' }), { title: `As the Mac is: ${languageName(mac)}`, detail: mac })}
            trigger={<span className="picker-value">{current ? languageName(current) : `As the Mac is (${languageName(mac)})`}</span>}
          />
          <p className="settings-help">
            A book is checked in the language its Typst sets (<code>#set text(lang: "en", region: "gb")</code>, in style.typ for Foreword’s templates), or the one chosen in This book ▸ Spelling. Passages in other
            languages follow Typst too: <code>#text(lang: "fr")[…]</code>, or Set Language… on a selection.
          </p>
        </div>
      </Section>
      <Section title="Words to let be">
        <div className="settings-field">
          <SwitchRow checked={s.ignoreUppercase} onChange={(ignoreUppercase) => studio.updateSettings({ ignoreUppercase })}>
            <span className="settings-switch-label">Ignore words in UPPERCASE</span>
            <span className="settings-help">Acronyms such as SVD and BLAS, as Word does.</span>
          </SwitchRow>
        </div>
        <div className="settings-field">
          <SwitchRow checked={s.ignoreNumbers} onChange={(ignoreNumbers) => studio.updateSettings({ ignoreNumbers })}>
            <span className="settings-switch-label">Ignore words that contain numbers</span>
            <span className="settings-help">FP32, 3D, H2O.</span>
          </SwitchRow>
        </div>
      </Section>
      <Section title="My dictionary">
        <p className="settings-help">
          Words every book accepts, kept in <code className="selectable">~/.foreword/dictionary.txt</code>. A book’s own words (its characters, its terms) are better in its dictionary: This book ▸ Spelling.
        </p>
        <WordList scope="user" />
      </Section>
      <Section title="Grammar rules">
        <p className="settings-help">The rules you’ve turned on or off, over Foreword’s choice. A few that misfire on careful prose (“every one” for “everyone”) are off unless you turn them on.</p>
        <RulesList scope="user" />
      </Section>
    </>
  );
}

/** Mistakes the book lets be (Ignore in the editor), with a way to see each again. */
function IgnoredList() {
  const [list, setList] = useState<[string, string][] | null>(null);
  useEffect(() => {
    const load = () => void ipc.proofIgnored().then(setList, () => setList([]));
    load();
    const off = listen('proofing:words', load);
    return () => void off.then((f) => f());
  }, []);
  if (!list) return null;
  if (!list.length) return <p className="rule-empty">None. Ignore on a mistake lets it be in this book, saved in .foreword/ignored.txt.</p>;
  return (
    <ul className="rule-list">
      {list.map(([key, what]) => (
        <li key={key} className="rule-row">
          <div className="rule-text">
            <div className="rule-title">{what || key}</div>
          </div>
          <button className="link" onClick={() => void ipc.proofIgnoredEdit([], [key]).then(setList)}>
            See again
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Settings ▸ This book ▸ Spelling: its language, its dictionary, its rules. */
export function BookSpellingPage() {
  const project = useStore(studio.store, (s) => s.project.settings);
  const unchecked = useStore(studio.store, (s) => [...new Set(Object.values(s.proofing.unchecked).flat())].sort().join(','));
  const current = normalizeLanguage(project.language);
  const [typst, setTypst] = useState<string | null | undefined>(undefined);
  const entry = useStore(studio.store, (s) => s.workspace?.entry ?? null);
  useEffect(() => {
    if (entry) void ipc.proofLanguage(entry).then(setTypst, () => setTypst(null));
  }, [entry]);
  const mismatch = current && typst && current !== typst && current.split('-')[0] !== typst.split('-')[0];
  return (
    <>
      <Section title="Language">
        <div className="settings-field">
          <div className="settings-label">Check this book in</div>
          <Picker
            label="Language of this book"
            rows={languageRows(current, (tag) => void studio.updateProjectSettings({ language: tag ?? undefined }), {
              title: typst ? `As its Typst says: ${languageName(typst)}` : 'As every book (Settings ▸ Spelling & Grammar)',
              detail: typst ? `set text(lang: …) in its files` : 'its Typst doesn’t say',
            })}
            trigger={<span className="picker-value">{current ? languageName(current) : typst ? `As its Typst says (${languageName(typst)})` : 'As every book'}</span>}
          />
          {mismatch && (
            <p className="settings-help warn">
              Its Typst sets {languageName(typst!)}, so the PDF is hyphenated and quoted as that. Change <code>lang:</code> in its <code>#set text(…)</code> too, so they agree.
            </p>
          )}
          <p className="settings-help">
            English gets spelling and grammar. Other languages get spelling from the Mac’s own dictionaries (as Pages and Mail do), in passages marked as that language.
          </p>
          {unchecked && <p className="settings-help warn">Not checked: {unchecked.split(',').map(languageName).join(', ')}. The Mac has no dictionary for it.</p>}
        </div>
      </Section>
      <Section title="Book dictionary">
        <p className="settings-help">
          Words this book accepts: its characters’ names, its places, its terms. Kept in <code className="selectable">{BOOK_WORDS_FILE}</code>, in the book’s folder, so they travel with it (and
          into git).
        </p>
        <WordList scope="book" />
      </Section>
      <Section title="Grammar rules">
        <p className="settings-help">Rules this book checks differently from every book (Settings ▸ Spelling & Grammar ▸ Grammar rules).</p>
        <RulesList scope="book" />
      </Section>
      <Section title="Ignored">
        <p className="settings-help">Mistakes you’ve told it to let be, each in its own sentence: the same words elsewhere are still checked.</p>
        <IgnoredList />
      </Section>
    </>
  );
}
