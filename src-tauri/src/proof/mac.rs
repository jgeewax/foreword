//! Spelling in languages other than English: macOS's own spell checker (what
//! Pages, Mail and TextEdit use), with the dictionaries the Mac ships for 40-odd
//! languages, so nothing is downloaded. In English, a second opinion on
//! Harper's: its dictionary knows more terms ("invertible", "eigenvector"), and
//! the words the author taught the Mac (Learn Spelling, in any app). One call
//! at a time, from any thread.
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

use objc2_app_kit::NSSpellChecker;
use objc2_foundation::{NSRange, NSString};

use super::units::Lang;

/// NSSpellChecker is one shared object: the typing and the book-wide checkers take turns.
static TURN: Mutex<()> = Mutex::new(());

/// The Mac's languages, as it names them ("fr", "pt_BR").
fn available() -> &'static [String] {
    static LANGS: OnceLock<Vec<String>> = OnceLock::new();
    LANGS.get_or_init(|| {
        let _turn = TURN.lock().unwrap();
        NSSpellChecker::sharedSpellChecker().availableLanguages().iter().map(|l| l.to_string()).collect()
    })
}

/// The Mac's name for a language it can check: with the region if it has that
/// one ("pt_BR"), else the language alone ("de" for de-AT).
pub fn language(lang: &Lang) -> Option<String> {
    let langs = available();
    let with_region = lang.region.as_ref().map(|r| format!("{}_{r}", lang.code));
    if let Some(l) = with_region.filter(|l| langs.contains(l)) {
        return Some(l);
    }
    if langs.contains(&lang.code) {
        return Some(lang.code.clone());
    }
    // pt alone: the Mac has pt_BR and pt_PT.
    langs.iter().find(|l| l.split('_').next() == Some(lang.code.as_str())).cloned()
}

/// Whether the Mac's dictionary for `language` knows a word (remembered: the same words come back).
pub fn knows(word: &str, language: &str) -> bool {
    static SEEN: OnceLock<Mutex<HashMap<(String, String), bool>>> = OnceLock::new();
    let seen = SEEN.get_or_init(Mutex::default);
    let key = (language.to_string(), word.to_string());
    if let Some(k) = seen.lock().unwrap().get(&key) {
        return *k;
    }
    let known = {
        let _turn = TURN.lock().unwrap();
        // SAFETY: the word count pointer may be null.
        let r = unsafe {
            NSSpellChecker::sharedSpellChecker().checkSpellingOfString_startingAt_language_wrap_inSpellDocumentWithTag_wordCount(&NSString::from_str(word), 0, Some(&NSString::from_str(language)), false, 0, std::ptr::null_mut())
        };
        r.length == 0
    };
    let mut seen = seen.lock().unwrap();
    if seen.len() > 50_000 {
        seen.clear();
    }
    seen.insert(key, known);
    known
}

/// The misspelled words of `text` in `language` (one of `language`'s): byte ranges, with guesses.
pub fn misspelled(text: &str, language: &str) -> Vec<(usize, usize, Vec<String>)> {
    let units: Vec<u16> = text.encode_utf16().collect();
    // UTF-16 offset to byte offset.
    let mut bytes = Vec::with_capacity(units.len() + 1);
    for (i, c) in text.char_indices() {
        for _ in 0..c.len_utf16() {
            bytes.push(i);
        }
    }
    bytes.push(text.len());
    let s = NSString::from_str(text);
    let l = NSString::from_str(language);
    let _turn = TURN.lock().unwrap();
    let checker = NSSpellChecker::sharedSpellChecker();
    let mut out = Vec::new();
    let mut at = 0usize;
    while at < units.len() {
        // SAFETY: the word count pointer may be null.
        let r: NSRange = unsafe { checker.checkSpellingOfString_startingAt_language_wrap_inSpellDocumentWithTag_wordCount(&s, at as isize, Some(&l), false, 0, std::ptr::null_mut()) };
        if r.location == usize::MAX || r.length == 0 || r.location < at || r.location + r.length > units.len() {
            break;
        }
        let guesses = checker
            .guessesForWordRange_inString_language_inSpellDocumentWithTag(r, &s, Some(&l), 0)
            .map(|a| a.iter().take(5).map(|g| g.to_string()).collect())
            .unwrap_or_default();
        out.push((bytes[r.location], bytes[r.location + r.length], guesses));
        at = r.location + r.length;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn french_and_german_misspellings_with_guesses() {
        let Some(fr) = language(&Lang::parse("fr").unwrap()) else { return };
        let text = "Ceci est une phrse avec un mott.";
        let found: Vec<_> = misspelled(text, &fr).into_iter().map(|(a, b, g)| (text[a..b].to_string(), g)).collect();
        assert_eq!(found.iter().map(|f| f.0.as_str()).collect::<Vec<_>>(), ["phrse", "mott"]);
        assert!(found[0].1.contains(&"phrase".to_string()));
        if let Some(de) = language(&Lang::parse("de-AT").unwrap()) {
            let text = "Größe und ein Fehlr.";
            let found: Vec<_> = misspelled(text, &de).into_iter().map(|(a, b, _)| &text[a..b]).collect();
            assert_eq!(found, ["Fehlr"]);
        }
    }

    #[test]
    fn the_mac_knows_terms_harper_doesn_t_and_still_flags_typos() {
        if !available().iter().any(|l| l == "en") {
            return;
        }
        assert!(knows("invertible", "en") && knows("eigenvector", "en"));
        assert!(!knows("teh", "en") && !knows("recieve", "en") && !knows("tmie", "en"));
        assert!(!knows("colour", "en") && knows("colour", "en_GB"));
    }

    #[test]
    fn languages_by_the_mac_s_names() {
        if available().is_empty() {
            return;
        }
        assert_eq!(language(&Lang::parse("pt-BR").unwrap()).as_deref(), Some("pt_BR"));
        assert!(language(&Lang::parse("xx").unwrap()).is_none());
    }
}
