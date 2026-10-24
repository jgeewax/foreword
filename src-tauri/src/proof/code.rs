//! Code, as VS Code's Code Spell Checker (cspell) reads it: every word in it,
//! names split at `_`, digits and capitals (`tmie_zone` is "tmie" and "zone"),
//! each piece of four letters or more looked up in English and in cspell's
//! lists for the language and for software in general.
use std::collections::HashSet;
use std::sync::{LazyLock, OnceLock};

use regex::Regex;

/// cspell's lists (scripts/fetch-proofing-dictionaries.mjs), by name.
const LISTS: &[(&str, &str)] = &[
    ("software", include_str!("dictionaries/software.txt")),
    ("python", include_str!("dictionaries/python.txt")),
    ("typescript", include_str!("dictionaries/typescript.txt")),
    ("rust", include_str!("dictionaries/rust.txt")),
    ("go", include_str!("dictionaries/go.txt")),
    ("cpp", include_str!("dictionaries/cpp.txt")),
    ("csharp", include_str!("dictionaries/csharp.txt")),
    ("dart", include_str!("dictionaries/dart.txt")),
    ("ruby", include_str!("dictionaries/ruby.txt")),
    ("lua", include_str!("dictionaries/lua.txt")),
    ("haskell", include_str!("dictionaries/haskell.txt")),
    ("php", include_str!("dictionaries/php.txt")),
    ("html", include_str!("dictionaries/html.txt")),
    ("css", include_str!("dictionaries/css.txt")),
    ("latex", include_str!("dictionaries/latex.txt")),
];

/// The list for a raw block's tag or a file's extension; None for the rest.
fn list_for(tag: &str) -> Option<&'static str> {
    Some(match tag {
        "py" | "python" | "pyi" | "ipython" => "python",
        "js" | "javascript" | "jsx" | "mjs" | "cjs" | "ts" | "typescript" | "tsx" => "typescript",
        "rs" | "rust" => "rust",
        "go" | "golang" => "go",
        "c" | "h" | "cpp" | "c++" | "cc" | "cxx" | "hpp" | "hh" | "cuda" | "cu" => "cpp",
        "cs" | "csharp" | "c#" => "csharp",
        "dart" => "dart",
        "rb" | "ruby" => "ruby",
        "lua" => "lua",
        "hs" | "haskell" => "haskell",
        "php" => "php",
        "html" | "htm" | "xml" | "svg" => "html",
        "css" | "scss" | "less" => "css",
        "tex" | "latex" | "bib" => "latex",
        _ => return None,
    })
}

/// Files checked as code, by extension.
pub fn is_code_file(ext: &str) -> bool {
    list_for(ext).is_some() || matches!(ext, "sh" | "bash" | "zsh" | "java" | "kt" | "swift" | "jl" | "r" | "m" | "scala" | "ml" | "ex" | "exs" | "clj" | "sql")
}

fn list(name: &str) -> &'static HashSet<String> {
    static SETS: OnceLock<Vec<(&'static str, HashSet<String>)>> = OnceLock::new();
    let sets = SETS.get_or_init(|| LISTS.iter().map(|(n, text)| (*n, text.lines().map(str::to_lowercase).collect())).collect());
    &sets.iter().find(|(n, _)| *n == name).expect("a known list").1
}

/// The lists that apply to code with this tag: software terms, and the
/// language's own, or every language's for code with no tag or an unknown one.
fn lists(tag: &str) -> Vec<&'static HashSet<String>> {
    match list_for(tag) {
        Some(own) => vec![list("software"), list(own)],
        None => LISTS.iter().map(|(n, _)| list(n)).collect(),
    }
}

/// What isn't words: links, e-mail addresses, hex numbers and colours, long encoded runs.
static SKIP: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)\b(?:https?|ftp|file)://[^\s\x22'<>)\]]+|\bwww\.[^\s\x22'<>)\]]+|[\w.+-]+@[\w-]+\.[\w.-]+|\b0x[0-9a-f]+\b|#[0-9a-f]{3,8}\b|\b[a-z0-9+/]{32,}={0,2}").unwrap()
});

/// A word that isn't known, in a unit's text (byte offsets there).
#[derive(Clone, Debug, PartialEq)]
pub struct Piece {
    pub start: usize,
    pub end: usize,
    /// The whole name it's part of (`tmie_zone` for "tmie").
    pub name: String,
}

/// The words of `text` (code tagged `tag`) that aren't known.
/// `knows`: whether English knows a word, in any capitalisation.
pub fn unknown(text: &str, tag: &str, knows: &dyn Fn(&str) -> bool) -> Vec<Piece> {
    let lists = lists(tag);
    let known = |w: &str| {
        let lower = w.to_lowercase();
        knows(w) || lists.iter().any(|l| l.contains(&lower))
    };
    let skipped: Vec<(usize, usize)> = SKIP.find_iter(text).map(|m| (m.start(), m.end())).collect();
    let mut out = Vec::new();
    for (start, end) in tokens(text) {
        if skipped.iter().any(|&(a, b)| start < b && a < end) {
            continue;
        }
        let mut start = start;
        // `\nfoo` in a string: the escape isn't part of the word.
        if start > 0 && text.as_bytes()[start - 1] == b'\\' && matches!(text.as_bytes()[start], b'n' | b't' | b'r' | b'f' | b'b' | b'v') {
            start += 1;
        }
        // `np.linalg.norm`: a library's names, not the author's (unless assigned: `self.tmie = 1`).
        if start > 0 && text.as_bytes()[start - 1] == b'.' && start > 1 && (text.as_bytes()[start - 2].is_ascii_alphanumeric() || matches!(text.as_bytes()[start - 2], b')' | b']' | b'_')) {
            let after = text[end..].trim_start();
            if !(after.starts_with('=') && !after.starts_with("==")) {
                continue;
            }
        }
        let name = &text[start..end];
        if name.chars().count() < 4 || known(name) || known(&name.replace(['_', '\'', '’'], "")) {
            continue;
        }
        for (a, b) in pieces(name) {
            let piece = &name[a..b];
            if piece.chars().count() >= 4 && !known(piece) {
                out.push(Piece { start: start + a, end: start + b, name: name.to_string() });
            }
        }
    }
    out
}

/// Runs of letters, digits, `_` and apostrophes between letters.
fn tokens(text: &str) -> Vec<(usize, usize)> {
    let mut out = Vec::new();
    let mut start: Option<usize> = None;
    let chars: Vec<(usize, char)> = text.char_indices().collect();
    for (i, &(at, c)) in chars.iter().enumerate() {
        let apostrophe = matches!(c, '\'' | '’')
            && start.is_some()
            && i > 0
            && chars[i - 1].1.is_alphabetic()
            && chars.get(i + 1).is_some_and(|n| n.1.is_alphabetic());
        if c.is_alphanumeric() || c == '_' || apostrophe {
            start.get_or_insert(at);
        } else if let Some(s) = start.take() {
            out.push((s, at));
        }
    }
    if let Some(s) = start {
        out.push((s, text.len()));
    }
    out
}

/// A name's pieces: split at `_`, digits, apostrophes and capitals
/// (`tmieZone`, `HTMLInput` is HTML and Input, `URLs` stays whole).
fn pieces(name: &str) -> Vec<(usize, usize)> {
    let chars: Vec<(usize, char)> = name.char_indices().collect();
    let mut out = Vec::new();
    let mut start: Option<usize> = None;
    for (i, &(at, c)) in chars.iter().enumerate() {
        if !c.is_alphabetic() {
            if let Some(s) = start.take() {
                out.push((s, at));
            }
            continue;
        }
        if let Some(s) = start {
            let prev = chars[i - 1].1;
            let next = chars.get(i + 1).map(|n| n.1);
            let lower_to_upper = prev.is_lowercase() && c.is_uppercase();
            // HTMLInput: a capital starting a word after capitals, unless only a plural or -ed/-ing follows.
            let caps_to_word = prev.is_uppercase() && c.is_uppercase() && next.is_some_and(char::is_lowercase) && {
                let tail: String = chars[i + 1..].iter().map(|c| c.1).take_while(|c| c.is_lowercase()).collect();
                !matches!(tail.as_str(), "s" | "es" | "ed" | "ing")
            };
            if lower_to_upper || caps_to_word {
                out.push((s, at));
                start = Some(at);
            }
        } else {
            start = Some(at);
        }
    }
    if let Some(s) = start {
        out.push((s, name.len()));
    }
    out
}

/// `fix` written the way `like` is: lowercase, Capitalised or ALL CAPS.
pub fn recase(fix: &str, like: &str) -> String {
    let letters: Vec<char> = like.chars().filter(|c| c.is_alphabetic()).collect();
    if letters.len() > 1 && letters.iter().all(|c| c.is_uppercase()) {
        fix.to_uppercase()
    } else if letters.first().is_some_and(|c| c.is_uppercase()) {
        let mut cs = fix.chars();
        cs.next().map(|f| f.to_uppercase().chain(cs).collect()).unwrap_or_default()
    } else {
        fix.to_lowercase()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn english(w: &str) -> bool {
        ["time", "zone", "this", "test", "comment", "result", "value", "data", "compute", "hello", "world", "import", "return", "input", "print", "urls", "user", "name", "array"].contains(&w.to_lowercase().as_str())
    }

    fn words(text: &str, tag: &str) -> Vec<String> {
        unknown(text, tag, &english).into_iter().map(|p| text[p.start..p.end].to_string()).collect()
    }

    #[test]
    fn names_split_at_underscores_and_capitals() {
        assert_eq!(words("tmie_zone = 1", "py"), ["tmie"]);
        assert_eq!(words("let tmieZone = HelloWrld;", "js"), ["tmie", "Wrld"]);
        assert_eq!(pieces("HTMLInput").len(), 2);
        assert_eq!(pieces("URLs").len(), 1);
        assert_eq!(pieces("user2name").len(), 2);
    }

    #[test]
    fn language_lists_know_their_libraries() {
        assert!(words("import numpy as np\nx = np.array(data)", "py").is_empty());
        assert_eq!(words("# this is a tset", "py"), ["tset"]);
        // With no tag, every language's words count.
        assert!(words("numpy.array", "").is_empty());
    }

    #[test]
    fn links_numbers_and_escapes_are_not_words() {
        assert!(words("see https://example.com/qwzx and 0xdeadbeef #ff00aa", "").is_empty());
        assert!(words(r#"print("\nhello")"#, "py").is_empty());
        assert!(words("idx = 3", "py").is_empty());
        // A library's names after a dot aren't the author's; an assigned one is.
        assert!(words("np.linalg.norm(v)", "py").is_empty());
        assert_eq!(words("self.tmie = 1", "py"), ["tmie"]);
    }

    #[test]
    fn fixes_keep_the_case() {
        assert_eq!(recase("time", "Tmie"), "Time");
        assert_eq!(recase("time", "TMIE"), "TIME");
        assert_eq!(recase("time", "tmie"), "time");
    }
}
