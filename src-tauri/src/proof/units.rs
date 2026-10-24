//! A stretch of text to check as the checker sees it (`This is very good` for
//! `This is *very* good`), with the way back to the file's own characters.
use std::fmt;

/// What a unit is checked for.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub enum Check {
    /// Sentences: spelling, grammar and style.
    Prose,
    /// Prose in Markdown (README-like files), read by Harper's Markdown parser.
    Markdown,
    /// Spelling only: comments, words in math.
    Spelling,
    /// Code: its words, and names split at `_` and capitals (`tmie_zone`).
    Code,
}

/// A language, as Typst writes it: `lang: "en", region: "gb"` is en-GB.
#[derive(Clone, PartialEq, Eq, Hash, Debug)]
pub struct Lang {
    /// ISO 639 code, lowercase ("en", "fr").
    pub code: String,
    /// ISO 3166 region, uppercase ("GB"), if given.
    pub region: Option<String>,
}

impl Lang {
    /// "en", "en-GB", "en_gb", "pt-BR"; None for anything else.
    pub fn parse(tag: &str) -> Option<Lang> {
        let mut parts = tag.trim().split(['-', '_']);
        let code = parts.next()?.to_ascii_lowercase();
        if !(2..=3).contains(&code.len()) || !code.bytes().all(|b| b.is_ascii_lowercase()) {
            return None;
        }
        let region = parts
            .next()
            .filter(|r| r.len() == 2 && r.bytes().all(|b| b.is_ascii_alphabetic()))
            .map(|r| r.to_ascii_uppercase());
        Some(Lang { code, region })
    }

    pub fn english() -> Lang {
        Lang { code: "en".into(), region: None }
    }

    pub fn is_english(&self) -> bool {
        self.code == "en"
    }
}

impl fmt::Display for Lang {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match &self.region {
            Some(r) => write!(f, "{}-{r}", self.code),
            None => write!(f, "{}", self.code),
        }
    }
}

/// What stands in for something left out mid-sentence (math, code, a reference),
/// so the sentence around it still reads as one. Issues touching it are dropped.
pub const HOLE: &str = "X";

#[derive(Clone, Debug)]
pub struct Unit {
    pub check: Check,
    pub lang: Lang,
    /// For code, its language (a raw block's tag: "py"), if it has one.
    pub code: Option<String>,
    /// The text as checked.
    pub text: String,
    /// Pieces of `text`, in order, and where each comes from in the file.
    segs: Vec<Seg>,
    /// The stand-ins' byte ranges in `text`.
    pub holes: Vec<(usize, usize)>,
    /// Not a sentence's start: a list item, or text going on after a displayed equation.
    pub fragment: bool,
}

/// `len` bytes of the unit's text at `at`, from `src_len` bytes of the file at
/// `src`; `exact` when they're the same characters (so a fix can replace them).
#[derive(Clone, Copy, Debug)]
struct Seg {
    at: usize,
    len: usize,
    src: usize,
    src_len: usize,
    exact: bool,
}

/// Where a stretch of a unit is in the file.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Place {
    pub start: usize,
    pub end: usize,
    /// The very same characters in one piece, with nothing left out between
    /// them, so the stretch can be replaced there.
    pub exact: bool,
}

impl Unit {
    pub fn new(check: Check, lang: Lang, code: Option<String>) -> Unit {
        Unit { check, lang, code, text: String::new(), segs: Vec::new(), holes: Vec::new(), fragment: false }
    }

    /// A whole stretch of the file, as it is (code files, Markdown paragraphs).
    pub fn verbatim(check: Check, lang: Lang, code: Option<String>, src: &str, start: usize, end: usize) -> Unit {
        let mut unit = Unit::new(check, lang, code);
        unit.push(&src[start..end], start, end - start, true);
        unit
    }

    fn push(&mut self, text: &str, src: usize, src_len: usize, exact: bool) {
        self.segs.push(Seg { at: self.text.len(), len: text.len(), src, src_len, exact });
        self.text.push_str(text);
    }

    /// Where bytes `from..to` of the text are in the file.
    pub fn place(&self, from: usize, to: usize) -> Option<Place> {
        let first = self.segs.iter().position(|s| s.len > 0 && s.at + s.len > from)?;
        let last = self.segs.iter().rposition(|s| s.len > 0 && s.at < to.max(from + 1))?;
        if last < first {
            return None;
        }
        let (a, b) = (&self.segs[first], &self.segs[last]);
        let start = if a.exact { a.src + from.saturating_sub(a.at) } else { a.src };
        let end = if b.exact { b.src + (to - b.at).min(b.len) } else { b.src + b.src_len };
        let pieces = &self.segs[first..=last];
        let exact = pieces.iter().all(|s| s.exact) && pieces.windows(2).all(|w| w[0].src + w[0].src_len == w[1].src);
        Some(Place { start, end: end.max(start), exact })
    }

    /// Whether bytes `from..to` are in the same word as a stand-in ("X-th"),
    /// or, with `next`, the word after is one ("a X": math's own reading decides).
    pub fn near_hole(&self, from: usize, to: usize, next: bool) -> bool {
        let t = self.text.as_bytes();
        let mut a = from;
        while a > 0 && !t[a - 1].is_ascii_whitespace() {
            a -= 1;
        }
        let mut b = to;
        while b < t.len() && !t[b].is_ascii_whitespace() {
            b += 1;
        }
        if next {
            while b < t.len() && t[b].is_ascii_whitespace() {
                b += 1;
            }
            while b < t.len() && !t[b].is_ascii_whitespace() {
                b += 1;
            }
        }
        self.holes.iter().any(|&(h, e)| a <= e && h <= b)
    }

    /// Without the spaces it ends with (a paragraph's last line break).
    fn trim_end(&mut self) {
        while let Some(last) = self.segs.last()
            && self.text[last.at..].chars().all(char::is_whitespace)
        {
            self.text.truncate(last.at);
            self.segs.pop();
        }
    }

    /// Nothing worth checking: only spaces and stand-ins.
    fn is_blank(&self) -> bool {
        let mut rest = self.text.clone();
        for &(a, b) in self.holes.iter().rev() {
            rest.replace_range(a..b, "");
        }
        !rest.chars().any(char::is_alphabetic)
    }
}

/// Builds units from a walk over a file: text goes into the current unit, and
/// a footnote or a comment can be set aside as its own while the sentence around it continues.
pub struct Builder<'a> {
    src: &'a str,
    pub units: Vec<Unit>,
    cur: Option<Unit>,
    outer: Vec<Option<Unit>>,
    /// The next unit is a fragment (see `Unit::fragment`).
    pub fragment_next: bool,
}

impl<'a> Builder<'a> {
    pub fn new(src: &'a str) -> Self {
        Builder { src, units: Vec::new(), cur: None, outer: Vec::new(), fragment_next: false }
    }

    /// Make the current unit one of this kind, ending the one before if it's another.
    pub fn want(&mut self, check: Check, lang: &Lang, code: Option<&str>) {
        if let Some(cur) = &self.cur
            && cur.check == check
            && cur.lang == *lang
            && cur.code.as_deref() == code
        {
            return;
        }
        self.flush();
        let mut unit = Unit::new(check, lang.clone(), code.map(str::to_string));
        unit.fragment = std::mem::take(&mut self.fragment_next);
        self.cur = Some(unit);
    }

    /// The file's own text, `start..end`.
    pub fn exact(&mut self, start: usize, end: usize) {
        if start >= end {
            return;
        }
        let text = &self.src[start..end];
        if let Some(cur) = &mut self.cur {
            cur.push(text, start, end - start, true);
        }
    }

    /// `text` in place of the file's `start..end` (a shorthand, an escape).
    pub fn stand_in(&mut self, text: &str, start: usize, end: usize) {
        if let Some(cur) = &mut self.cur {
            cur.push(text, start, end - start, false);
        }
    }

    /// One space for the file's `start..end`, unless there's one already
    /// (Typst collapses spaces, and a doubled one isn't a mistake there).
    pub fn space(&mut self, start: usize, end: usize) {
        if let Some(cur) = &mut self.cur
            && !cur.text.is_empty()
            && !cur.text.ends_with(char::is_whitespace)
        {
            let exact = &self.src[start..end] == " ";
            cur.push(" ", start, end - start, exact);
        }
    }

    /// A stand-in for something left out mid-sentence.
    pub fn hole(&mut self, start: usize, end: usize) {
        if let Some(cur) = &mut self.cur {
            let at = cur.text.len();
            cur.push(HOLE, start, end - start, false);
            cur.holes.push((at, cur.text.len()));
        }
    }

    pub fn flush(&mut self) {
        if let Some(mut unit) = self.cur.take() {
            unit.trim_end();
            if !unit.is_blank() {
                self.units.push(unit);
            }
        }
    }

    /// Set the current unit aside: what's added until `end` makes units of its own.
    pub fn begin(&mut self) {
        let outer = self.cur.take();
        self.outer.push(outer);
    }

    /// Carry on with the unit set aside by `begin`.
    pub fn end(&mut self) {
        self.flush();
        self.cur = self.outer.pop().flatten();
    }

    /// Build what `f` adds as units of their own, then carry on with the current one.
    pub fn isolate(&mut self, f: impl FnOnce(&mut Self)) {
        self.begin();
        f(self);
        self.end();
    }

    pub fn finish(mut self) -> Vec<Unit> {
        self.flush();
        self.units
    }
}

/// UTF-16 offsets (what the editor counts) for byte offsets of one text.
pub struct Utf16 {
    /// (byte, UTF-16 offset) at char boundaries, every so often.
    marks: Vec<(usize, usize)>,
}

impl Utf16 {
    const STEP: usize = 256;

    pub fn new(text: &str) -> Utf16 {
        let mut marks = vec![(0, 0)];
        let (mut units, mut last) = (0, 0);
        for (i, c) in text.char_indices() {
            if i - last >= Self::STEP {
                marks.push((i, units));
                last = i;
            }
            units += c.len_utf16();
        }
        Utf16 { marks }
    }

    pub fn at(&self, text: &str, byte: usize) -> usize {
        let byte = byte.min(text.len());
        let i = self.marks.partition_point(|m| m.0 <= byte) - 1;
        let (b, u) = self.marks[i];
        u + text[b..byte].encode_utf16().count()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn langs_parse_as_typst_and_bcp47_write_them() {
        assert_eq!(Lang::parse("en-gb").unwrap().to_string(), "en-GB");
        assert_eq!(Lang::parse("fr").unwrap().to_string(), "fr");
        assert_eq!(Lang::parse("pt_BR").unwrap().to_string(), "pt-BR");
        assert!(Lang::parse("english").is_none());
        assert!(Lang::parse("").is_none());
    }

    #[test]
    fn a_unit_maps_back_to_the_file() {
        let src = "This is *very* good";
        let mut b = Builder::new(src);
        let en = Lang::english();
        b.want(Check::Prose, &en, None);
        b.exact(0, 4);
        b.space(4, 5);
        b.exact(5, 7);
        b.space(7, 8);
        b.exact(9, 13);
        b.space(14, 15);
        b.exact(15, 19);
        let units = b.finish();
        let u = &units[0];
        assert_eq!(u.text, "This is very good");
        // "very": the same characters, in one piece.
        assert_eq!(u.place(8, 12), Some(Place { start: 9, end: 13, exact: true }));
        // "is very": the star between them isn't in the text, so it can't be replaced as one.
        assert_eq!(u.place(5, 12), Some(Place { start: 5, end: 13, exact: false }));
    }

    #[test]
    fn spaces_collapse_and_holes_are_known() {
        let src = "of  $x$ is";
        let mut b = Builder::new(src);
        let en = Lang::english();
        b.want(Check::Prose, &en, None);
        b.exact(0, 2);
        b.space(2, 4);
        b.hole(4, 7);
        b.space(7, 8);
        b.space(7, 8);
        b.exact(8, 10);
        let units = b.finish();
        assert_eq!(units[0].text, "of X is");
        assert!(units[0].near_hole(3, 4, false));
        assert!(!units[0].near_hole(5, 7, false));
        // "of" before X: with the next word.
        assert!(!units[0].near_hole(0, 2, false));
        assert!(units[0].near_hole(0, 2, true));
        assert_eq!(units[0].place(3, 4), Some(Place { start: 4, end: 7, exact: false }));
    }

    #[test]
    fn isolated_units_leave_the_sentence_whole() {
        let src = "true#footnote[A note.] and";
        let mut b = Builder::new(src);
        let en = Lang::english();
        b.want(Check::Prose, &en, None);
        b.exact(0, 4);
        b.isolate(|b| {
            b.want(Check::Prose, &en, None);
            b.exact(14, 21);
        });
        b.space(22, 23);
        b.exact(23, 26);
        let units = b.finish();
        let texts: Vec<_> = units.iter().map(|u| u.text.as_str()).collect();
        assert_eq!(texts, ["A note.", "true and"]);
    }

    #[test]
    fn blank_units_are_dropped() {
        let src = "$x$";
        let mut b = Builder::new(src);
        b.want(Check::Prose, &Lang::english(), None);
        b.hole(0, 3);
        assert!(b.finish().is_empty());
    }

    #[test]
    fn utf16_offsets_count_surrogate_pairs() {
        let text = format!("{}é😀x", "a".repeat(600));
        let u = Utf16::new(&text);
        let x = text.find('x').unwrap();
        assert_eq!(u.at(&text, x), 600 + 1 + 2);
        assert_eq!(u.at(&text, 0), 0);
        assert_eq!(u.at(&text, text.len()), 604);
    }
}
