//! English: Harper (Automattic's offline grammar checker) for spelling, grammar
//! and style, in the five dialects it knows.
use std::collections::{BTreeMap, HashMap};
use std::sync::Arc;

use harper_core::linting::{LintGroup, LintKind, Suggestion};
use harper_core::parsers::{Markdown, MarkdownOptions, PlainEnglish};
use harper_core::spell::{Dictionary, FstDictionary, suggest_correct_spelling_str};
use harper_core::{Dialect, Document};

use super::units::Lang;

/// What kind of mistake: red, blue or purple in the editor.
#[derive(Clone, Copy, PartialEq, Eq, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Kind {
    Spelling,
    Grammar,
    Style,
}

/// A mistake in a unit's text (byte offsets there), before it's placed in the file.
#[derive(Clone, Debug)]
pub struct Found {
    pub start: usize,
    pub end: usize,
    pub kind: Kind,
    pub rule: String,
    pub message: String,
    /// What could go in its place, best first ("" removes it).
    pub fixes: Vec<String>,
    /// In code: the name the word is part of (`tmie_zone` for "tmie").
    pub name: Option<String>,
}

pub fn kind_of(kind: LintKind) -> Kind {
    match kind {
        LintKind::Spelling | LintKind::Typo => Kind::Spelling,
        LintKind::Style | LintKind::Enhancement | LintKind::Readability | LintKind::Redundancy | LintKind::Formatting => Kind::Style,
        _ => Kind::Grammar,
    }
}

/// A dialect as a language tag ("en-GB").
pub fn dialect_tag(d: Dialect) -> &'static str {
    match d {
        Dialect::British => "en-GB",
        Dialect::Canadian => "en-CA",
        Dialect::Australian => "en-AU",
        Dialect::Indian => "en-IN",
        _ => "en-US",
    }
}

/// The dialect for a language: its region, else the book's, else American.
pub fn dialect(lang: &Lang, book: &Lang) -> Dialect {
    let region = lang.region.as_deref().or(book.region.as_deref().filter(|_| book.is_english()));
    match region {
        Some("GB" | "UK" | "IE" | "NZ" | "ZA") => Dialect::British,
        Some("AU") => Dialect::Australian,
        Some("CA") => Dialect::Canadian,
        Some("IN") => Dialect::Indian,
        _ => Dialect::American,
    }
}

/// Rules turned on or off by the author, over Harper's own defaults.
pub type Rules = BTreeMap<String, bool>;

pub struct English {
    dict: Arc<FstDictionary>,
    /// Every rule, by dialect, and the rules last set on it.
    full: HashMap<Dialect, (LintGroup, Option<Rules>)>,
    /// Spelling alone (comments, words in math).
    spelling: HashMap<Dialect, LintGroup>,
}

impl Default for English {
    fn default() -> Self {
        English { dict: FstDictionary::curated(), full: HashMap::new(), spelling: HashMap::new() }
    }
}

impl English {
    /// Mistakes in `text`. `all`: grammar and style too, not spelling alone.
    pub fn check(&mut self, text: &str, dialect: Dialect, all: bool, markdown: bool, rules: &Rules) -> Vec<Found> {
        let doc = if markdown {
            Document::new(text, &Markdown::new(MarkdownOptions::default()), &*self.dict)
        } else {
            Document::new(text, &PlainEnglish, &*self.dict)
        };
        let dict = self.dict.clone();
        let organized = if all {
            let (group, set) = self.full.entry(dialect).or_insert_with(|| (LintGroup::new_curated(dict, dialect), None));
            if set.as_ref() != Some(rules) {
                group.config = harper_core::linting::FlatConfig::new_curated();
                for (rule, on) in rules {
                    group.config.set_rule_enabled(rule, *on);
                }
                *set = Some(rules.clone());
            }
            group.organized_lints(&doc)
        } else {
            let group = self.spelling.entry(dialect).or_insert_with(|| {
                let mut g = LintGroup::new_curated(dict, dialect);
                g.config.clear();
                g.config.set_rule_enabled("SpellCheck", true);
                g
            });
            group.organized_lints(&doc)
        };
        let chars: Vec<(usize, char)> = text.char_indices().collect();
        let byte = |i: usize| chars.get(i).map_or(text.len(), |c| c.0);
        let mut out: Vec<Found> = Vec::new();
        for (rule, lints) in organized {
            for lint in lints {
                let (start, end) = (byte(lint.span.start), byte(lint.span.end));
                let here = &text[start..end];
                let fixes = lint
                    .suggestions
                    .iter()
                    .map(|s| match s {
                        Suggestion::ReplaceWith(c) => c.iter().collect(),
                        Suggestion::InsertAfter(c) => format!("{here}{}", c.iter().collect::<String>()),
                        Suggestion::Remove => String::new(),
                    })
                    .collect::<Vec<String>>();
                let kind = match rule.as_str() {
                    // "non-zero" for "nonzero": a house style, not a misspelling.
                    "DisjointPrefixes" => Kind::Style,
                    _ => kind_of(lint.lint_kind),
                };
                // The same word flagged twice ("teh": SpellCheck and The): once, with both's fixes.
                if let Some(same) = out.iter_mut().find(|f| f.start == start && f.end == end && f.kind == kind) {
                    for f in fixes {
                        if !same.fixes.contains(&f) {
                            same.fixes.push(f);
                        }
                    }
                    continue;
                }
                out.push(Found { start, end, kind, rule: rule.clone(), message: lint.message.clone(), fixes, name: None });
            }
        }
        out.sort_by_key(|f| (f.start, f.end));
        out
    }

    /// The dialects other than `dialect` that spell a word this way ("colour": British, Canadian, Australian).
    pub fn other_dialects(&self, word: &str, dialect: Dialect) -> Vec<Dialect> {
        let Some(meta) = self.dict.get_word_metadata_str(word) else { return Vec::new() };
        [Dialect::British, Dialect::American, Dialect::Canadian, Dialect::Australian, Dialect::Indian]
            .into_iter()
            .filter(|d| *d != dialect && meta.dialects.is_dialect_enabled_strict(*d))
            .collect()
    }

    /// Whether Harper's dictionary knows a word, in any capitalisation.
    pub fn knows(&self, word: &str) -> bool {
        self.dict.contains_word_str(word)
    }

    /// Spellings close to `word`, in the dialect, best first: fewest edits
    /// (two letters swapped count as one, so "tmie" is "time" before "tie"),
    /// then the same length, then Harper's own order.
    pub fn suggest(&self, word: &str, dialect: Dialect, max: usize) -> Vec<String> {
        let lower = word.to_lowercase();
        for dist in 2..4 {
            let mut found: Vec<(usize, bool, usize, String)> = suggest_correct_spelling_str(word, 200, dist, &*self.dict)
                .into_iter()
                .filter(|s| self.dict.get_word_metadata_str(s).is_none_or(|m| m.dialects.is_dialect_enabled(dialect)))
                .enumerate()
                .map(|(i, s)| {
                    let d = super::words::distance(&lower, &s.to_lowercase(), 3).unwrap_or(9);
                    (d, s.chars().count() != word.chars().count(), i, s)
                })
                .collect();
            found.sort();
            if !found.is_empty() {
                return found.into_iter().map(|f| f.3).take(max).collect();
            }
        }
        Vec::new()
    }

    /// Every rule Harper has: name, description, whether it's on unless the author says.
    pub fn rules(&self) -> Vec<(String, String, bool)> {
        let group = LintGroup::new_curated(self.dict.clone(), Dialect::American);
        let defaults = harper_core::linting::FlatConfig::new_curated();
        let mut out: Vec<_> = group
            .all_descriptions()
            .into_iter()
            .map(|(name, about)| (name.to_string(), about.to_string(), defaults.is_rule_enabled(name)))
            .collect();
        out.sort();
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn check(text: &str) -> Vec<(Kind, String, Vec<String>)> {
        let mut e = English::default();
        e.check(text, Dialect::American, true, false, &Rules::new())
            .into_iter()
            .map(|f| (f.kind, text[f.start..f.end].to_string(), f.fixes))
            .collect()
    }

    #[test]
    fn spelling_and_grammar() {
        let found = check("This is an test of teh system.");
        assert!(found.iter().any(|(k, w, _)| *k == Kind::Grammar && w == "an"), "{found:?}");
        let teh: Vec<_> = found.iter().filter(|(_, w, _)| w == "teh").collect();
        assert_eq!(teh.len(), 1, "{found:?}");
        assert_eq!(teh[0].0, Kind::Spelling);
        assert_eq!(teh[0].2[0], "the");
    }

    #[test]
    fn offsets_are_bytes() {
        let found = check("Café was teh best.");
        assert!(found.iter().any(|(_, w, _)| w == "teh"), "{found:?}");
    }

    #[test]
    fn dialects_follow_the_region() {
        let gb = Lang::parse("en-GB").unwrap();
        assert_eq!(dialect(&Lang::english(), &gb), Dialect::British);
        assert_eq!(dialect(&Lang::parse("en-AU").unwrap(), &gb), Dialect::Australian);
        assert_eq!(dialect(&Lang::english(), &Lang::english()), Dialect::American);
    }

    #[test]
    fn rules_can_be_turned_off() {
        let mut e = English::default();
        let text = "This is an test.";
        let mut rules = Rules::new();
        assert!(!e.check(text, Dialect::American, true, false, &rules).is_empty());
        rules.insert("AnA".into(), false);
        assert!(e.check(text, Dialect::American, true, false, &rules).is_empty());
    }

    #[test]
    fn british_spellings_are_known_to_be_british() {
        let e = English::default();
        assert_eq!(e.other_dialects("colour", Dialect::American)[0], Dialect::British);
        assert!(e.other_dialects("tset", Dialect::American).is_empty());
    }

    #[test]
    fn suggestions_rank_the_likely_word_first() {
        let e = English::default();
        assert_eq!(e.suggest("recieve", Dialect::American, 3)[0], "receive");
        assert_eq!(e.suggest("tmie", Dialect::American, 5)[0], "time");
        assert_eq!(e.suggest("tset", Dialect::American, 5)[0], "test");
    }
}
