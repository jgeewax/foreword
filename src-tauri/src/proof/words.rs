//! The words spell checking accepts beyond its dictionaries: the book's
//! (`.foreword/dictionary.txt`, committed with it) and the author's own
//! (`~/.foreword/dictionary.txt`, for every book). One word per line, `#`
//! for comments, kept sorted so diffs and merges stay clean.
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::SystemTime;

use crate::error::CmdResult;

#[derive(Default, Debug)]
pub struct Words {
    /// Entries written in lowercase: any capitalisation of them is right.
    any_case: HashSet<String>,
    /// Entries with capitals ("McAllister"): exactly so, or in capitals.
    exact: HashSet<String>,
    upper: HashSet<String>,
    /// The file's words, in order.
    pub list: Vec<String>,
    /// Its comment lines, kept at the top when it's written.
    header: Vec<String>,
}

impl Words {
    pub fn parse(text: &str) -> Words {
        let mut w = Words::default();
        for line in text.lines().map(str::trim) {
            if line.is_empty() {
                continue;
            }
            if line.starts_with('#') {
                if w.list.is_empty() {
                    w.header.push(line.to_string());
                }
                continue;
            }
            w.add(line);
        }
        w
    }

    fn add(&mut self, word: &str) {
        if self.list.iter().any(|w| w == word) {
            return;
        }
        if word.chars().any(char::is_uppercase) {
            self.exact.insert(word.to_string());
            self.upper.insert(word.to_uppercase());
        } else {
            self.any_case.insert(word.to_string());
        }
        self.list.push(word.to_string());
    }

    /// Whether a word is one of these (or its possessive: "Grevlund's").
    pub fn knows(&self, word: &str) -> bool {
        let word = word.trim_end_matches("'s").trim_end_matches("’s");
        if word.is_empty() {
            return false;
        }
        self.any_case.contains(&word.to_lowercase())
            || self.exact.contains(word)
            || (word.chars().all(|c| !c.is_lowercase()) && self.upper.contains(word))
    }

    /// Entries close to a misspelling (one or two letters off), closest first.
    pub fn near(&self, word: &str, max: usize) -> Vec<String> {
        let lower = word.to_lowercase();
        let limit = if word.chars().count() <= 4 { 1 } else { 2 };
        let mut found: Vec<(usize, &String)> = self
            .list
            .iter()
            .filter_map(|w| {
                let d = distance(&lower, &w.to_lowercase(), limit)?;
                (d > 0).then_some((d, w))
            })
            .collect();
        found.sort();
        found.into_iter().take(max).map(|(_, w)| w.clone()).collect()
    }

    /// The file's text: its comments, then the words, sorted.
    pub fn render(&self, default_header: &str) -> String {
        let mut list = self.list.clone();
        list.sort_by_key(|w| (w.to_lowercase(), w.clone()));
        let header = if self.header.is_empty() { vec![default_header.to_string()] } else { self.header.clone() };
        let mut out = header.join("\n");
        out.push('\n');
        for w in list {
            out.push_str(&w);
            out.push('\n');
        }
        out
    }

    /// With `add` and without `remove`.
    pub fn edited(&self, add: &[String], remove: &[String]) -> Words {
        let mut w = Words { header: self.header.clone(), ..Words::default() };
        for word in self.list.iter().chain(add).map(|s| s.trim()) {
            if !word.is_empty() && !word.starts_with('#') && !remove.iter().any(|r| r == word) {
                w.add(word);
            }
        }
        w
    }
}

/// Edit distance with transpositions ("tset" is one from "test"), if within `limit`.
pub fn distance(a: &str, b: &str, limit: usize) -> Option<usize> {
    let (a, b): (Vec<char>, Vec<char>) = (a.chars().collect(), b.chars().collect());
    if a.len().abs_diff(b.len()) > limit {
        return None;
    }
    let mut rows = vec![vec![0usize; b.len() + 1]; a.len() + 1];
    for (i, row) in rows.iter_mut().enumerate() {
        row[0] = i;
    }
    for (j, cell) in rows[0].iter_mut().enumerate() {
        *cell = j;
    }
    for i in 1..=a.len() {
        for j in 1..=b.len() {
            let cost = usize::from(a[i - 1] != b[j - 1]);
            let mut d = (rows[i - 1][j] + 1).min(rows[i][j - 1] + 1).min(rows[i - 1][j - 1] + cost);
            if i > 1 && j > 1 && a[i - 1] == b[j - 2] && a[i - 2] == b[j - 1] {
                d = d.min(rows[i - 2][j - 2] + 1);
            }
            rows[i][j] = d;
        }
    }
    let d = rows[a.len()][b.len()];
    (d <= limit).then_some(d)
}

/// A word list on disk, read again when the file changes (another window, git, by hand).
pub struct WordFile {
    pub path: PathBuf,
    stamp: Option<(SystemTime, u64)>,
    words: Arc<Words>,
}

impl WordFile {
    pub fn new(path: PathBuf) -> WordFile {
        WordFile { path, stamp: None, words: Arc::default() }
    }

    pub fn get(&mut self) -> Arc<Words> {
        let stamp = fs::metadata(&self.path).ok().map(|m| (m.modified().unwrap_or(SystemTime::UNIX_EPOCH), m.len()));
        if stamp != self.stamp {
            self.words = Arc::new(fs::read_to_string(&self.path).map(|t| Words::parse(&t)).unwrap_or_default());
            self.stamp = stamp;
        }
        self.words.clone()
    }

    /// Add and remove words, and write the file (through a temporary one).
    pub fn edit(&mut self, add: &[String], remove: &[String], header: &str) -> CmdResult<Arc<Words>> {
        let next = self.get().edited(add, remove);
        write_atomic(&self.path, &next.render(header))?;
        self.stamp = None;
        Ok(self.get())
    }
}

pub fn write_atomic(path: &Path, text: &str) -> CmdResult<()> {
    use std::io::Write;
    let dir = path.parent().ok_or_else(|| crate::error::CmdError::Invalid("no folder".into()))?;
    fs::create_dir_all(dir)?;
    let tmp = dir.join(format!(".dictionary.{}.foreword.tmp", uuid::Uuid::new_v4().simple()));
    let result = (|| -> std::io::Result<()> {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(text.as_bytes())?;
        f.sync_all()?;
        fs::rename(&tmp, path)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    Ok(result?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lowercase_entries_match_any_case_and_capitals_match_exactly() {
        let w = Words::parse("# Words\ngrevlund\nMcAllister\niPhone\n");
        assert!(w.knows("grevlund") && w.knows("Grevlund") && w.knows("GREVLUND"));
        assert!(w.knows("McAllister") && w.knows("MCALLISTER"));
        assert!(!w.knows("mcallister"));
        assert!(w.knows("iPhone") && !w.knows("Iphone"));
        assert!(w.knows("Grevlund's") && w.knows("McAllister’s"));
    }

    #[test]
    fn near_words_suggest_the_book_s_own() {
        let w = Words::parse("Grevlund\nOstrava\n");
        assert_eq!(w.near("Grevlnud", 3), ["Grevlund"]);
        assert!(w.near("Grevlund", 3).is_empty());
        assert!(w.near("Paris", 3).is_empty());
    }

    #[test]
    fn written_sorted_with_its_comments() {
        let w = Words::parse("# Mine\nzebra\nApple\n").edited(&["mango".into(), "zebra".into()], &["Apple".into()]);
        assert_eq!(w.render("# default"), "# Mine\nmango\nzebra\n");
        assert_eq!(Words::default().edited(&["b".into(), "A".into()], &[]).render("# default"), "# default\nA\nb\n");
    }

    #[test]
    fn a_word_file_reloads_when_it_changes() {
        let dir = std::env::temp_dir().join(format!("foreword-words-{}", uuid::Uuid::new_v4().simple()));
        let path = dir.join(".foreword/dictionary.txt");
        let mut f = WordFile::new(path.clone());
        assert!(f.get().list.is_empty());
        f.edit(&["Grevlund".into()], &[], "# test").unwrap();
        assert!(fs::read_to_string(&path).unwrap().contains("Grevlund"));
        assert!(f.get().knows("Grevlund"));
        std::thread::sleep(std::time::Duration::from_millis(10));
        fs::write(&path, "Ostrava\nOther\n").unwrap();
        assert!(f.get().knows("Ostrava"));
        let _ = fs::remove_dir_all(dir);
    }
}
