//! Spelling and grammar, offline and rule-based, as Word and Google Docs do it:
//! Harper for English, cspell's word lists for code, Typst's own parser to tell
//! prose from markup, math and code. The editor asks for a file's issues a
//! moment after typing stops; paragraphs it has seen before come from a cache,
//! so only the edited one is checked again.
mod code;
mod english;
#[cfg(target_os = "macos")]
mod mac;
mod typst;
mod units;
mod words;

use std::collections::{BTreeSet, HashMap};
use std::hash::{DefaultHasher, Hash, Hasher};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager};

use crate::error::{CmdError, CmdResult};
use crate::Win;
use english::{English, Found, Kind, Rules};
use units::{Check, Lang, Unit, Utf16};
use words::{Ignored, IgnoredFile, WordFile, Words};

const BOOK_WORDS: &str = ".foreword/dictionary.txt";
const BOOK_IGNORED: &str = ".foreword/ignored.txt";
const BOOK_HEADER: &str = "# Words spell checking accepts in this book, one per line (Foreword keeps them sorted).";
const USER_HEADER: &str = "# Words spell checking accepts in every book, one per line (Foreword keeps them sorted).";

/// Harper's rules Foreword turns off for books, unless the author turns them on:
/// they misfire on careful prose ("every one of them" isn't "everyone", "be
/// thinking" isn't "bethinking") or are house style rather than mistakes.
const BOOK_RULES: &[(&str, bool)] = &[
    ("Everyone", false),
    ("CompoundNouns", false),
    ("MassNouns", false),
    ("OrthographicConsistency", false),
    ("OkToOkay", false),
    ("ExpandMemoryShorthands", false),
    ("ExpandTimeShorthands", false),
    ("WrongNegative", false),
];

/// The rules to run: Harper's, Foreword's for books, then the author's.
fn rules(options: &Options) -> Rules {
    let mut rules: Rules = BOOK_RULES.iter().map(|(r, on)| (r.to_string(), *on)).collect();
    rules.extend(options.rules.clone());
    rules
}

/// Paragraphs' mistakes kept from one check to the next.
const CACHE_MAX: usize = 40_000;

/// What the author asked for (Settings), sent with each check.
#[derive(Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Options {
    pub spelling: bool,
    pub grammar: bool,
    pub style: bool,
    /// Code too: raw blocks, names, code files.
    pub code: bool,
    pub ignore_uppercase: bool,
    pub ignore_numbers: bool,
    /// The book's language ("en-GB").
    pub language: String,
    /// Harper's rules turned on or off, over its defaults.
    pub rules: Rules,
    /// Issues ignored this session (their keys).
    pub ignored: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckRequest {
    /// The file, relative to the book.
    pub path: String,
    /// The editor's version of its text, given back with the result.
    pub version: i64,
    /// Its text, if it's open (unsaved changes); else it's read from disk.
    pub text: Option<String>,
    pub options: Options,
    /// A check for the whole-book view, behind the editor's own.
    #[serde(default)]
    pub scan: bool,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Issue {
    /// UTF-16 offsets in the text, as the editor counts.
    pub start: usize,
    pub end: usize,
    pub kind: Kind,
    pub rule: String,
    pub message: String,
    /// The text flagged.
    pub word: String,
    /// What could go in its place, best first.
    pub fixes: Vec<String>,
    /// Whether a fix can replace the flagged text where it is (not across markup).
    pub fixable: bool,
    pub lang: String,
    /// For "Ignore": the same mistake in the same sentence.
    pub key: String,
    /// In code: the name the word is part of.
    pub name: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Checked {
    pub version: i64,
    pub issues: Vec<Issue>,
    /// A newer check of the file is on its way: this one was skipped.
    pub stale: bool,
    /// Languages in the file that aren't checked.
    pub unchecked: Vec<String>,
    /// Words flagged here are spelled as in another English ("colour", "theatre"): perhaps the book is in it.
    pub dialect: Option<DialectHint>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DialectHint {
    /// "en-GB".
    pub tag: String,
    /// A few of the words.
    pub words: Vec<String>,
}

/// What a check found in a file.
pub struct Report {
    pub issues: Vec<Issue>,
    pub unchecked: Vec<String>,
    pub dialect: Option<DialectHint>,
}

/// How many words spelled as in another English make it worth asking.
const DIALECT_HINT_MIN: usize = 3;

#[derive(Default)]
struct Cache {
    map: HashMap<u64, (Arc<Vec<Found>>, u64)>,
    tick: u64,
}

impl Cache {
    fn get(&mut self, key: u64) -> Option<Arc<Vec<Found>>> {
        self.tick += 1;
        let tick = self.tick;
        self.map.get_mut(&key).map(|(v, t)| {
            *t = tick;
            v.clone()
        })
    }

    fn put(&mut self, key: u64, value: Arc<Vec<Found>>) {
        self.tick += 1;
        if self.map.len() >= CACHE_MAX {
            let cutoff = self.tick.saturating_sub(CACHE_MAX as u64 / 2);
            self.map.retain(|_, (_, t)| *t >= cutoff);
        }
        self.map.insert(key, (value, self.tick));
    }
}

/// Spell checking for every window: one checker for typing, another for the
/// whole-book view (so a scan never holds up the editor), and the word lists.
pub struct ProofState {
    typing: Mutex<Option<English>>,
    scan: Mutex<Option<English>>,
    cache: Mutex<Cache>,
    user: Mutex<WordFile>,
    books: Mutex<HashMap<PathBuf, WordFile>>,
    ignored: Mutex<HashMap<PathBuf, IgnoredFile>>,
    /// The newest version asked for, by window and file.
    latest: Mutex<HashMap<(String, String), i64>>,
}

impl Default for ProofState {
    fn default() -> Self {
        ProofState {
            typing: Mutex::default(),
            scan: Mutex::default(),
            cache: Mutex::default(),
            user: Mutex::new(WordFile::new(crate::config::config_dir().join("dictionary.txt"))),
            books: Mutex::default(),
            ignored: Mutex::default(),
            latest: Mutex::default(),
        }
    }
}

impl ProofState {
    fn book_words(&self, root: &Path) -> Arc<Words> {
        self.books.lock().unwrap().entry(root.to_path_buf()).or_insert_with(|| WordFile::new(root.join(BOOK_WORDS))).get()
    }

    fn book_ignored(&self, root: &Path) -> Arc<Ignored> {
        self.ignored.lock().unwrap().entry(root.to_path_buf()).or_insert_with(|| IgnoredFile::new(root.join(BOOK_IGNORED))).get()
    }
}

fn hash(parts: impl Hash) -> u64 {
    let mut h = DefaultHasher::new();
    parts.hash(&mut h);
    h.finish()
}

/// What names a mistake for Ignore: its rule, its words and its sentence, so it
/// stays ignored through edits elsewhere and across versions (it's saved in the book).
fn ignore_key(rule: &str, word: &str, sentence: &str) -> String {
    use sha2::{Digest, Sha256};
    let digest = Sha256::new().chain_update(rule).chain_update([0]).chain_update(word).chain_update([0]).chain_update(sentence).finalize();
    hex::encode(&digest[..8])
}

/// The units of a file, by its kind.
fn units_of(path: &str, text: &str, book: &Lang, options: &Options) -> Vec<Unit> {
    let ext = Path::new(path).extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
    match ext.as_str() {
        "typ" => typst::units(text, book, options.code),
        "md" | "markdown" => paragraphs(text, Check::Markdown, book),
        "txt" => paragraphs(text, Check::Prose, book),
        e if options.code && code::is_code_file(e) => vec![Unit::verbatim(Check::Code, book.clone(), Some(ext.clone()), text, 0, text.len())],
        _ => Vec::new(),
    }
}

/// Paragraphs (between blank lines; a Markdown code fence stays whole).
fn paragraphs(text: &str, check: Check, lang: &Lang) -> Vec<Unit> {
    let mut out = Vec::new();
    let (mut start, mut at, mut fenced) = (None::<usize>, 0, false);
    for line in text.split_inclusive('\n') {
        if line.trim_start().starts_with("```") {
            fenced = !fenced;
        }
        if line.trim().is_empty() && !fenced {
            if let Some(s) = start.take() {
                out.push(Unit::verbatim(check, lang.clone(), None, text, s, at));
            }
        } else if start.is_none() {
            start = Some(at);
        }
        at += line.len();
    }
    if let Some(s) = start {
        out.push(Unit::verbatim(check, lang.clone(), None, text, s, text.len()));
    }
    out
}

/// `check_ignoring` with nothing ignored, for tests.
#[cfg(test)]
fn check(english: &mut English, cache: &Mutex<Cache>, user: &Words, book_words: &Words, path: &str, text: &str, options: &Options) -> Report {
    check_ignoring(english, cache, user, book_words, &Ignored::default(), path, text, options)
}

/// A file's issues: each unit checked (or taken from the cache), then the
/// author's words, the book's ignored mistakes and the author's choices
/// applied, and placed in the file.
#[allow(clippy::too_many_arguments)]
fn check_ignoring(english: &mut English, cache: &Mutex<Cache>, user: &Words, book_words: &Words, ignored: &Ignored, path: &str, text: &str, options: &Options) -> Report {
    let book = Lang::parse(&options.language).unwrap_or_else(Lang::english);
    let utf16 = Utf16::new(text);
    let mut issues = Vec::new();
    let mut unchecked = BTreeSet::new();
    let all = options.grammar || options.style;
    let rules = rules(options);
    let mut dialects: HashMap<&'static str, Vec<String>> = HashMap::new();
    for unit in units_of(path, text, &book, options) {
        let dialect = english::dialect(&unit.lang, &book);
        // Another language: the Mac's own spell checker, if it has the language.
        let other = unit.check != Check::Code && !unit.lang.is_english();
        let mac_lang = if other { system_language(&unit.lang) } else { None };
        if other && mac_lang.is_none() {
            unchecked.insert(unit.lang.to_string());
            continue;
        }
        let prose = matches!(unit.check, Check::Prose | Check::Markdown);
        let key = hash((unit.check, &unit.lang, &unit.code, dialect as u8, prose && all, if prose && all { Some(&rules) } else { None }, &unit.text));
        let cached = cache.lock().unwrap().get(key);
        let found = match cached {
            Some(f) => f,
            None => {
                let f = Arc::new(match (&unit.check, &mac_lang) {
                    (Check::Code, _) => code_found(english, &unit, dialect),
                    (_, Some(lang)) => system_found(&unit, lang),
                    _ => english.check(&unit.text, dialect, prose && all, unit.check == Check::Markdown, &rules),
                });
                cache.lock().unwrap().put(key, f.clone());
                f
            }
        };
        for f in found.iter() {
            let on = match f.kind {
                Kind::Spelling => options.spelling,
                Kind::Grammar => options.grammar,
                Kind::Style => options.style,
            };
            if !on || unit.near_hole(f.start, f.end, f.kind != Kind::Spelling) {
                continue;
            }
            let word = &unit.text[f.start..f.end];
            if !plausible(&unit, f, word, options) {
                continue;
            }
            let mut fixes = f.fixes.clone();
            if f.kind == Kind::Spelling {
                if user.knows(word) || book_words.knows(word) {
                    continue;
                }
                // English the Mac knows: a term Harper's dictionary lacks, or a word the author taught it.
                if matches!(f.rule.as_str(), "SpellCheck" | "CodeSpelling") && unit.lang.is_english() && system_knows(word, dialect) {
                    continue;
                }
                if f.rule == "SpellCheck" {
                    for d in english.other_dialects(word, dialect) {
                        let seen = dialects.entry(english::dialect_tag(d)).or_default();
                        if !seen.iter().any(|w| w.eq_ignore_ascii_case(word)) {
                            seen.push(word.to_string());
                        }
                    }
                }
                // The book's own words first: a mistyped name suggests the name.
                let mut own: Vec<String> = book_words.near(word, 3).into_iter().chain(user.near(word, 3)).map(|w| code::recase(&w, word)).collect();
                own.retain(|w| !fixes.contains(w));
                fixes.splice(0..0, own);
                fixes.truncate(6);
            }
            let issue_key = ignore_key(&f.rule, word, &unit.text);
            if options.ignored.contains(&issue_key) || ignored.has(&issue_key) {
                continue;
            }
            let Some(place) = unit.place(f.start, f.end) else { continue };
            issues.push(Issue {
                start: utf16.at(text, place.start),
                end: utf16.at(text, place.end),
                kind: f.kind,
                rule: f.rule.clone(),
                message: f.message.clone(),
                word: word.to_string(),
                fixes,
                fixable: place.exact,
                lang: unit.lang.to_string(),
                key: issue_key,
                name: f.name.clone().filter(|n| n != word),
            });
        }
    }
    issues.sort_by_key(|i| (i.start, i.end));
    issues.dedup_by(|a, b| a.start == b.start && a.end == b.end && a.kind == b.kind);
    // The other English most of them are in (British first, when it's a tie).
    let order = ["en-GB", "en-US", "en-CA", "en-AU", "en-IN"];
    let dialect = order
        .iter()
        .filter_map(|t| dialects.remove(t).map(|w| (*t, w)))
        .filter(|(_, w)| w.len() >= DIALECT_HINT_MIN)
        .max_by_key(|(t, w)| (w.len(), std::cmp::Reverse(order.iter().position(|o| o == t))))
        .map(|(tag, mut words)| {
            words.truncate(3);
            DialectHint { tag: tag.to_string(), words }
        });
    Report { issues, unchecked: unchecked.into_iter().collect(), dialect }
}

/// What Harper (or the code lists) flags that isn't a mistake in a book, or that the author said to let be.
fn plausible(unit: &Unit, f: &Found, word: &str, options: &Options) -> bool {
    let t = &unit.text;
    let before = t[..f.start].chars().next_back();
    let before2 = t[..f.start].chars().rev().nth(1);
    let after = t[f.end..].chars().next();
    if f.kind == Kind::Spelling {
        let letters: Vec<char> = word.chars().filter(|c| c.is_alphabetic()).collect();
        // A letter alone ("w", "r") is a variable, an initial or a label; in a comment, two ("np").
        if letters.len() <= 1 || (unit.check == Check::Spelling && letters.len() <= 2) {
            return false;
        }
        // Word's "Ignore words in UPPERCASE" (SVD, BLAS): acronyms.
        if options.ignore_uppercase && letters.len() > 1 && letters.iter().all(|c| c.is_uppercase()) {
            return false;
        }
        // Word's "Ignore words that contain numbers" (FP32, 3D).
        if options.ignore_numbers && (word.chars().any(|c| c.is_ascii_digit()) || before.is_some_and(|c| c.is_ascii_digit())) {
            return false;
        }
        // A file's extension: `main.typ`, `ch02.typ`.
        if before == Some('.') && before2.is_some_and(char::is_alphanumeric) && !after.is_some_and(char::is_alphabetic) {
            return false;
        }
        // Ordinals after a letter or a number: n-th, 2nd.
        if matches!(word, "th" | "st" | "nd" | "rd") && matches!(before, Some('-')) {
            return false;
        }
    }
    // A sentence's capital: not in a list item, a table cell or a caption that isn't one.
    if f.rule == "SentenceCapitalization" && f.start == 0 && (unit.fragment || !t.trim_end_matches(['"', '\'', '”', '’', ')', ']']).ends_with(['.', '!', '?'])) {
        return false;
    }
    // "House A", "color B": labels, not articles.
    if f.rule == "AnA" && word == "A" && f.start > 0 {
        return false;
    }
    true
}

/// Whether the Mac's English dictionary (in the dialect) knows a word Harper doesn't.
fn system_knows(word: &str, dialect: harper_core::Dialect) -> bool {
    #[cfg(target_os = "macos")]
    return mac::knows(word, &english::dialect_tag(dialect).replace('-', "_").replace("en_US", "en"));
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (word, dialect);
        false
    }
}

/// The Mac's name for a language it can check ("fr", "pt_BR").
fn system_language(lang: &Lang) -> Option<String> {
    #[cfg(target_os = "macos")]
    return mac::language(lang);
    #[cfg(not(target_os = "macos"))]
    {
        let _ = lang;
        None
    }
}

/// Misspellings in a unit in another language, from the Mac's spell checker.
fn system_found(unit: &Unit, lang: &str) -> Vec<Found> {
    #[cfg(target_os = "macos")]
    return mac::misspelled(&unit.text, lang)
        .into_iter()
        .map(|(start, end, fixes)| Found { start, end, kind: Kind::Spelling, rule: "MacSpelling".into(), message: String::new(), fixes, name: None })
        .collect();
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (unit, lang);
        Vec::new()
    }
}

/// A unit of code's unknown words, with spellings for each in its own case.
fn code_found(english: &English, unit: &Unit, dialect: harper_core::Dialect) -> Vec<Found> {
    let tag = unit.code.as_deref().unwrap_or("");
    code::unknown(&unit.text, tag, &|w| english.knows(w))
        .into_iter()
        .map(|p| {
            let word = &unit.text[p.start..p.end];
            let fixes = english.suggest(&word.to_lowercase(), dialect, 5).iter().map(|s| code::recase(s, word)).collect();
            let message = format!("“{word}” isn’t a word the dictionary knows, in “{}”.", p.name);
            Found { start: p.start, end: p.end, kind: Kind::Spelling, rule: "CodeSpelling".into(), message, fixes, name: Some(p.name) }
        })
        .collect()
}

#[tauri::command]
pub async fn proof_check(app: tauri::AppHandle, state: Win, request: CheckRequest) -> CmdResult<Checked> {
    let root = state.root()?;
    let file = crate::workspace::resolve(&root, &request.path)?;
    let key = (state.label().to_string(), request.path.clone());
    if !request.scan {
        state_latest(&app, key.clone(), request.version);
    }
    tauri::async_runtime::spawn_blocking(move || {
        let proof = app.state::<ProofState>();
        let stale = || !request.scan && proof.latest.lock().unwrap().get(&key).is_some_and(|v| *v > request.version);
        let skipped = Checked { version: request.version, issues: Vec::new(), stale: true, unchecked: Vec::new(), dialect: None };
        if stale() {
            return Ok(skipped);
        }
        let text = match request.text {
            Some(t) => t,
            None => crate::workspace::read_text(&file)?.text,
        };
        let o = &request.options;
        if !(o.spelling || o.grammar || o.style) {
            return Ok(Checked { version: request.version, issues: Vec::new(), stale: false, unchecked: Vec::new(), dialect: None });
        }
        let user = proof.user.lock().unwrap().get();
        let book = proof.book_words(&root);
        let ignored = proof.book_ignored(&root);
        let mut engine = if request.scan { proof.scan.lock().unwrap() } else { proof.typing.lock().unwrap() };
        // Typed on while this one waited its turn.
        if stale() {
            return Ok(skipped);
        }
        let english = engine.get_or_insert_with(English::default);
        let r = check_ignoring(english, &proof.cache, &user, &book, &ignored, &request.path, &text, o);
        Ok(Checked { version: request.version, issues: r.issues, stale: false, unchecked: r.unchecked, dialect: r.dialect })
    })
    .await
    .map_err(|e| CmdError::Io(e.to_string()))?
}

fn state_latest(app: &tauri::AppHandle, key: (String, String), version: i64) {
    let proof = app.state::<ProofState>();
    let mut latest = proof.latest.lock().unwrap();
    let v = latest.entry(key).or_insert(version);
    *v = (*v).max(version);
}

/// A word list: "book" (this window's book) or "user" (the author's, for every book).
fn with_words<T>(proof: &ProofState, state: &Win, scope: &str, f: impl FnOnce(&mut WordFile, &str) -> CmdResult<T>) -> CmdResult<T> {
    match scope {
        "user" => f(&mut proof.user.lock().unwrap(), USER_HEADER),
        "book" => {
            let root = state.root()?;
            let mut books = proof.books.lock().unwrap();
            f(books.entry(root.clone()).or_insert_with(|| WordFile::new(root.join(BOOK_WORDS))), BOOK_HEADER)
        }
        _ => Err(CmdError::Invalid(format!("no word list {scope:?}"))),
    }
}

#[tauri::command]
pub async fn proof_words(app: tauri::AppHandle, state: Win, scope: String) -> CmdResult<Vec<String>> {
    with_words(&app.state::<ProofState>(), &state, &scope, |file, _| Ok(file.get().list.clone()))
}

/// Open the author's own list in their text editor (TextEdit unless they chose another).
#[tauri::command]
pub async fn proof_words_open(app: tauri::AppHandle) -> CmdResult<()> {
    let path = app.state::<ProofState>().user.lock().unwrap().path.clone();
    if !path.is_file() {
        words::write_atomic(&path, &format!("{USER_HEADER}\n"))?;
    }
    let status = std::process::Command::new("/usr/bin/open").arg("-t").arg(&path).status()?;
    if !status.success() {
        return Err(CmdError::Io("couldn't open the dictionary".into()));
    }
    Ok(())
}

/// Add words to a list and take others out; every window checks again.
#[tauri::command]
pub async fn proof_words_edit(app: tauri::AppHandle, state: Win, scope: String, add: Vec<String>, remove: Vec<String>) -> CmdResult<Vec<String>> {
    let list = with_words(&app.state::<ProofState>(), &state, &scope, |file, header| Ok(file.edit(&add, &remove, header)?.list.clone()))?;
    let _ = app.emit("proofing:words", &scope);
    Ok(list)
}

/// The language the book's Typst sets (`set text(lang: "en", region: "gb")`):
/// the first in the main file or the files it imports and includes, in order.
#[tauri::command]
pub async fn proof_language(state: Win, entry: String) -> CmdResult<Option<String>> {
    let root = state.root()?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut queue = std::collections::VecDeque::from([entry]);
        let mut seen = std::collections::HashSet::new();
        while let Some(rel) = queue.pop_front() {
            if !seen.insert(rel.clone()) || seen.len() > 40 {
                continue;
            }
            let Ok(file) = crate::workspace::resolve(&root, &rel) else { continue };
            let Ok(text) = std::fs::read_to_string(&file) else { continue };
            let (lang, files) = typst::declared_language(&text);
            if let Some(lang) = lang {
                return Some(lang.to_string());
            }
            let dir = Path::new(&rel).parent().unwrap_or(Path::new(""));
            for f in files {
                // "/style.typ" is from the book's root; others from the file's folder.
                let next = match f.strip_prefix('/') {
                    Some(abs) => PathBuf::from(abs),
                    None => dir.join(&f),
                };
                queue.push_back(normalize(&next));
            }
        }
        None
    })
    .await
    .map_err(|e| CmdError::Io(e.to_string()))
}

/// `chapters/../style.typ` as `style.typ`.
fn normalize(p: &Path) -> String {
    let mut parts: Vec<&str> = Vec::new();
    for c in p.components() {
        match c {
            std::path::Component::ParentDir => {
                parts.pop();
            }
            std::path::Component::Normal(n) => parts.push(n.to_str().unwrap_or("")),
            _ => {}
        }
    }
    parts.join("/")
}

/// The book's ignored mistakes: key, and what it was.
#[tauri::command]
pub async fn proof_ignored(app: tauri::AppHandle, state: Win) -> CmdResult<Vec<(String, String)>> {
    Ok(app.state::<ProofState>().book_ignored(&state.root()?).list.clone())
}

/// Let mistakes be in this book (Ignore), or see them again; every window checks again.
#[tauri::command]
pub async fn proof_ignored_edit(app: tauri::AppHandle, state: Win, add: Vec<(String, String)>, remove: Vec<String>) -> CmdResult<Vec<(String, String)>> {
    let root = state.root()?;
    let list = {
        let proof = app.state::<ProofState>();
        let mut files = proof.ignored.lock().unwrap();
        files.entry(root.clone()).or_insert_with(|| IgnoredFile::new(root.join(BOOK_IGNORED))).edit(&add, &remove)?.list.clone()
    };
    let _ = app.emit("proofing:words", "ignored");
    Ok(list)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Rule {
    pub name: String,
    pub description: String,
    /// On unless the author says: Harper's choice, or Foreword's for books (BOOK_RULES).
    pub default: bool,
}

/// Harper's rules, for Settings.
#[tauri::command]
pub async fn proof_rules(app: tauri::AppHandle) -> CmdResult<Vec<Rule>> {
    tauri::async_runtime::spawn_blocking(move || {
        let proof = app.state::<ProofState>();
        let mut engine = proof.scan.lock().unwrap();
        let english = engine.get_or_insert_with(English::default);
        english
            .rules()
            .into_iter()
            .map(|(name, description, harper)| {
                let default = BOOK_RULES.iter().find(|(r, _)| *r == name).map_or(harper, |(_, on)| *on);
                Rule { name, description, default }
            })
            .collect()
    })
    .await
    .map_err(|e| CmdError::Io(e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn options() -> Options {
        Options { spelling: true, grammar: true, code: true, language: "en-US".into(), ..Options::default() }
    }

    fn run(path: &str, text: &str, options: &Options, book: &Words) -> Vec<Issue> {
        let mut english = English::default();
        check(&mut english, &Mutex::default(), &Words::default(), book, path, text, options).issues
    }

    fn flagged(path: &str, text: &str) -> Vec<String> {
        run(path, text, &options(), &Words::default()).into_iter().map(|i| i.word).collect()
    }

    #[test]
    fn a_typst_file_s_issues_are_placed_in_it() {
        let text = "= A Titel\nThis is an test of *teh* system, with $x$ and `tmie_zone`.\n#let speling = 1";
        let issues = run("ch.typ", text, &options(), &Words::default());
        let words: Vec<_> = issues.iter().map(|i| i.word.as_str()).collect();
        for w in ["Titel", "an", "teh", "tmie", "speling"] {
            assert!(words.contains(&w), "{w} in {words:?}");
        }
        let teh = issues.iter().find(|i| i.word == "teh").unwrap();
        assert_eq!(&text[teh.start..teh.end], "teh");
        assert!(teh.fixable);
        assert_eq!(teh.fixes[0], "the");
        let tmie = issues.iter().find(|i| i.word == "tmie").unwrap();
        assert_eq!(tmie.name.as_deref(), Some("tmie_zone"));
        assert_eq!(tmie.fixes[0], "time");
    }

    #[test]
    fn utf16_offsets_after_wide_characters() {
        let text = "😀 Café is teh best.";
        let issues = run("a.typ", text, &options(), &Words::default());
        let teh = issues.iter().find(|i| i.word == "teh").unwrap();
        let units: Vec<u16> = text.encode_utf16().collect();
        assert_eq!(String::from_utf16(&units[teh.start..teh.end]).unwrap(), "teh");
    }

    #[test]
    fn the_book_s_words_are_accepted_and_suggested() {
        let book = Words::parse("Grevlund\n");
        let issues = run("a.typ", "Grevlund met Grevlnud.", &options(), &book);
        assert_eq!(issues.len(), 1, "{issues:?}");
        assert_eq!(issues[0].word, "Grevlnud");
        assert_eq!(issues[0].fixes[0], "Grevlund");
    }

    #[test]
    fn the_author_s_choices_apply() {
        let mut o = options();
        o.grammar = false;
        assert!(!run("a.typ", "This is an test.", &o, &Words::default()).iter().any(|i| i.word == "an"));
        o.ignore_uppercase = true;
        assert!(run("a.typ", "The QWZX module.", &o, &Words::default()).is_empty());
        let key = run("a.typ", "A tset.", &options(), &Words::default())[0].key.clone();
        let mut o = options();
        o.ignored = vec![key];
        assert!(run("a.typ", "A tset.", &o, &Words::default()).is_empty());
        // Elsewhere, the same word is flagged again.
        assert!(!run("a.typ", "Another tset.", &o, &Words::default()).is_empty());
    }

    #[test]
    fn other_languages_are_spelled_by_the_mac_or_left_unchecked() {
        let mut english = English::default();
        let r = check(&mut english, &Mutex::default(), &Words::default(), &Words::default(), "a.typ", "Hello.\n\n#set text(lang: \"fr\")\nCeci est une phrse.", &options());
        if system_language(&Lang::parse("fr").unwrap()).is_some() {
            assert_eq!(r.issues.iter().map(|i| (i.word.as_str(), i.lang.as_str())).collect::<Vec<_>>(), [("phrse", "fr")]);
            assert!(r.issues[0].fixes.contains(&"phrase".to_string()));
            assert!(r.unchecked.is_empty());
        }
        // A language the Mac has no dictionary for: not checked, never all red.
        let r = check(&mut english, &Mutex::default(), &Words::default(), &Words::default(), "a.typ", "#set text(lang: \"tlh\")\nnuqneH qaStaH.", &options());
        assert!(r.issues.is_empty(), "{:?}", r.issues);
        assert_eq!(r.unchecked, ["tlh"]);
    }

    #[test]
    fn british_spellings_in_an_american_check_suggest_british() {
        let mut english = English::default();
        let text = "The colour of the theatre was the favourite of the neighbourhood.";
        let r = check(&mut english, &Mutex::default(), &Words::default(), &Words::default(), "a.typ", text, &options());
        let hint = r.dialect.expect("a hint");
        assert_eq!(hint.tag, "en-GB");
        assert_eq!(hint.words.len(), 3);
        let mut o = options();
        o.language = "en-GB".into();
        let r = check(&mut english, &Mutex::default(), &Words::default(), &Words::default(), "a.typ", text, &o);
        assert!(r.issues.is_empty() && r.dialect.is_none(), "{:?}", r.issues);
    }

    #[test]
    fn fixes_across_markup_are_not_offered_as_replacements() {
        let text = "It is *is* fine.";
        let issues = run("a.typ", text, &options(), &Words::default());
        let repeated = issues.iter().find(|i| i.kind == Kind::Grammar).expect("the repeated word");
        assert_eq!(&text[repeated.start..repeated.end], "is *is");
        assert!(!repeated.fixable);
    }

    #[test]
    fn code_and_text_files() {
        assert_eq!(flagged("x.py", "def compute(tmie_zone):\n    return tmie_zone  # a tset\n"), ["tmie", "tmie", "tset"]);
        assert!(flagged("x.png", "teh").is_empty());
        assert_eq!(flagged("notes.txt", "First teh.\n\nSecond paragrah."), ["teh", "paragrah"]);
        assert_eq!(flagged("README.md", "# Title\n\nA paragrah.\n\n```\nnot checked teh\n```\n"), ["paragrah"]);
    }

    #[test]
    fn markdown_paragraphs_keep_fences_whole() {
        let p = paragraphs("a\n\n```\nx\n\ny\n```\n\nb", Check::Markdown, &Lang::english());
        assert_eq!(p.len(), 3);
    }

    /// Timing on a real book: `FOREWORD_PROOF_BENCH=<book folder> cargo test
    /// --release --lib proof::tests::bench -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn bench() {
        use std::time::Instant;
        let Ok(dir) = std::env::var("FOREWORD_PROOF_BENCH") else { return };
        let files: Vec<_> = crate::workspace::list_files(Path::new(&dir)).into_iter().filter(|f| f.ends_with(".typ")).collect();
        let (mut english, cache) = (English::default(), Mutex::default());
        let o = Options { style: false, ignore_uppercase: true, ignore_numbers: true, ..options() };
        let (mut cold, mut warm, mut edit) = (Vec::new(), Vec::new(), Vec::new());
        let mut words: HashMap<String, usize> = HashMap::new();
        let (mut bytes, mut kinds) = (0, HashMap::<String, usize>::new());
        let mut samples: HashMap<String, Vec<String>> = HashMap::new();
        let start = Instant::now();
        for f in &files {
            let text = std::fs::read_to_string(Path::new(&dir).join(f)).unwrap();
            bytes += text.len();
            let t = Instant::now();
            let issues = check(&mut english, &cache, &Words::default(), &Words::default(), f, &text, &o).issues;
            cold.push((t.elapsed().as_secs_f64() * 1000.0, text.len(), f.clone()));
            let t = Instant::now();
            check(&mut english, &cache, &Words::default(), &Words::default(), f, &text, &o);
            warm.push(t.elapsed().as_secs_f64() * 1000.0);
            // One paragraph changed, as typing does.
            if let Some(at) = text[text.len() / 2..].find(". ").map(|i| i + text.len() / 2) {
                let edited = format!("{} indeed{}", &text[..at], &text[at..]);
                let t = Instant::now();
                check(&mut english, &cache, &Words::default(), &Words::default(), f, &edited, &o);
                edit.push(t.elapsed().as_secs_f64() * 1000.0);
            }
            let wanted = std::env::var("FOREWORD_PROOF_SAMPLES").unwrap_or_default();
            for i in &issues {
                let key = if i.kind == Kind::Spelling { i.word.clone() } else { i.rule.clone() };
                if wanted.split(',').any(|w| w == key) && samples.entry(key.clone()).or_default().len() < 4 {
                    let units: Vec<u16> = text.encode_utf16().collect();
                    let a = i.start.saturating_sub(50);
                    let b = (i.end + 50).min(units.len());
                    let ctx = format!("{}[[{}]]{}", String::from_utf16_lossy(&units[a..i.start]), String::from_utf16_lossy(&units[i.start..i.end]), String::from_utf16_lossy(&units[i.end..b])).replace('\n', "⏎");
                    samples.get_mut(&key).unwrap().push(format!("{} | {}", i.message, ctx));
                }
            }
            for i in issues {
                *kinds.entry(format!("{:?}/{}", i.kind, i.rule)).or_default() += 1;
                if i.kind == Kind::Spelling {
                    *words.entry(i.word).or_default() += 1;
                }
            }
        }
        let total = start.elapsed().as_secs_f64();
        let p = |v: &mut Vec<f64>, q: f64| {
            v.sort_by(|a, b| a.partial_cmp(b).unwrap());
            v.get(((v.len() as f64 - 1.0) * q) as usize).copied().unwrap_or(0.0)
        };
        cold.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap());
        println!("{} files, {} KB, all checks {total:.1} s", files.len(), bytes / 1000);
        println!("slowest cold: {:?}", &cold[..cold.len().min(3)]);
        println!("warm p50 {:.2} ms p95 {:.2} ms; one paragraph edited p50 {:.2} ms p95 {:.2} ms max {:.2} ms", p(&mut warm, 0.5), p(&mut warm, 0.95), p(&mut edit, 0.5), p(&mut edit, 0.95), p(&mut edit, 1.0));
        let mut kinds: Vec<_> = kinds.into_iter().collect();
        kinds.sort_by(|a, b| b.1.cmp(&a.1));
        println!("issues by rule: {kinds:?}");
        let mut words: Vec<_> = words.into_iter().collect();
        words.sort_by(|a, b| b.1.cmp(&a.1));
        println!("unknown words: {}", words.len());
        println!("most frequent: {:?}", &words[..words.len().min(60)]);
        for (k, v) in samples {
            println!("== {k}");
            for s in v {
                println!("   {s}");
            }
        }
    }
}
