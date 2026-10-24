//! What's prose in a Typst file, and in which language: paragraphs, headings
//! and captions to check as sentences; comments and words in math for spelling;
//! raw blocks and the names a file defines as code. Math, labels, references,
//! links and most strings (fonts, paths, colours) aren't checked at all.
use std::collections::HashMap;

use typst_syntax::{SyntaxKind as K, SyntaxNode};

use super::units::{Builder, Check, Lang, Unit};

/// Calls whose content runs on in the sentence around them.
const INLINE: &[&str] = &[
    "emph", "strong", "text", "underline", "overline", "strike", "smallcaps", "highlight", "sub",
    "super", "upper", "lower", "link", "box", "quote", "smartquote", "linebreak", "h",
];

/// Calls whose content stands on its own (a footnote doesn't split its sentence).
const BLOCK: &[&str] = &[
    "footnote", "figure", "block", "align", "pad", "place", "table", "grid", "stack", "columns",
    "page", "heading", "list", "enum", "terms", "par", "rect", "square", "circle", "ellipse",
    "move", "rotate", "scale", "hide", "colbreak", "pagebreak", "outline", "bibliography",
    "image", "v", "cell", "caption", "header", "footer", "layout", "repeat", "title",
];

/// Calls whose content isn't in the running text (an index entry): checked on its own, no stand-in.
const ASIDE: &[&str] = &["index", "idx", "index-main", "metadata", "hide"];

/// Named arguments whose strings are prose (`caption: "…"`); any other string isn't.
const PROSE_NAMED: &[&str] = &["caption", "title", "subtitle", "alt", "description", "supplement", "abstract", "summary"];

/// Calls whose first string is prose (`#emph("word")`).
const PROSE_STRING: &[&str] = &[
    "text", "emph", "strong", "heading", "quote", "smallcaps", "upper", "lower", "underline",
    "overline", "strike", "highlight", "footnote",
];

/// Tags a comment can start with (comment-tags.ts): not words to check.
const TAGS: &[&str] = &["TODO", "FIXME", "XXX", "HACK", "WARNING", "WARN", "NOTE", "IDEA", "QUESTION"];

/// The units of a Typst file whose language, unless it says otherwise, is `lang`.
/// `code`: also check raw blocks and the names the file defines.
pub fn units(src: &str, lang: &Lang, code: bool) -> Vec<Unit> {
    let root = typst_syntax::parse(src);
    let mut aliases = HashMap::new();
    find_aliases(&root, &mut aliases);
    let mut w = Walker { src, b: Builder::new(src), aliases, code };
    let mut lang = lang.clone();
    w.markup(&root, 0, &mut lang);
    w.b.finish()
}

/// What a file says of its language: the first `set text(lang: …)` with a
/// literal language, anywhere in it (templates set it inside their function),
/// and the files it imports or includes, to look in next.
pub fn declared_language(src: &str) -> (Option<Lang>, Vec<String>) {
    fn find(node: &SyntaxNode, lang: &mut Option<Lang>, files: &mut Vec<String>) {
        match node.kind() {
            K::SetRule if lang.is_none() => {
                let target = node.children().find(|c| matches!(c.kind(), K::Ident | K::FieldAccess)).and_then(call_name);
                if target.as_deref() == Some("text")
                    && let Some(args) = child(node, K::Args)
                    && args.children().any(|a| a.kind() == K::Named && child(a, K::Ident).is_some_and(|n| n.leaf_text() == "lang"))
                {
                    *lang = lang_args(args, &Lang { code: String::new(), region: None });
                }
            }
            K::ModuleImport | K::ModuleInclude => {
                if let Some(path) = node.children().find(|c| c.kind() == K::Str).and_then(str_text)
                    && path.ends_with(".typ")
                {
                    files.push(path.to_string());
                }
            }
            _ => {}
        }
        for c in node.children() {
            find(c, lang, files);
        }
    }
    let (mut lang, mut files) = (None, Vec::new());
    find(&typst_syntax::parse(src), &mut lang, &mut files);
    (lang, files)
}

struct Walker<'a> {
    src: &'a str,
    b: Builder<'a>,
    /// Functions defined in the file that set a language: `#let fr(body) = text(lang: "fr", body)`.
    aliases: HashMap<String, Lang>,
    code: bool,
}

/// Each child with its offset in the file.
fn children(node: &SyntaxNode, off: usize) -> impl Iterator<Item = (&SyntaxNode, usize)> {
    node.children().scan(off, |at, c| {
        let here = *at;
        *at += c.len();
        Some((c, here))
    })
}

fn child(node: &SyntaxNode, kind: K) -> Option<&SyntaxNode> {
    node.children().find(|c| c.kind() == kind)
}

/// A call's name: `emph` for `emph`, `std.emph` and `emph.with`.
fn call_name(callee: &SyntaxNode) -> Option<String> {
    match callee.kind() {
        K::Ident => Some(callee.leaf_text().to_string()),
        K::FieldAccess => {
            let idents: Vec<_> = callee.children().filter(|c| c.kind() == K::Ident).collect();
            let last = idents.last()?.leaf_text().as_str();
            let name = if last == "with" && idents.len() >= 2 { idents[idents.len() - 2] } else { *idents.last()? };
            match name.kind() {
                K::Ident => Some(name.leaf_text().to_string()),
                _ => call_name(name),
            }
        }
        _ => None,
    }
}

/// A string literal's text, without its quotes.
fn str_text(node: &SyntaxNode) -> Option<&str> {
    let t = node.leaf_text().as_str();
    t.strip_prefix('"')?.strip_suffix('"')
}

/// `lang:` and `region:` in a call's (or set rule's) arguments, applied to `lang`.
/// A new language drops the region before it (French in a US book isn't fr-US).
fn lang_args(args: &SyntaxNode, lang: &Lang) -> Option<Lang> {
    let (mut code, mut region) = (None, None);
    for named in args.children().filter(|c| c.kind() == K::Named) {
        let Some(name) = child(named, K::Ident) else { continue };
        let Some(value) = named.children().find(|c| c.kind() == K::Str).and_then(str_text) else { continue };
        match name.leaf_text().as_str() {
            "lang" => code = Lang::parse(value).map(|l| l.code),
            "region" if value.len() == 2 => region = Some(value.to_ascii_uppercase()),
            _ => {}
        }
    }
    let mut out = lang.clone();
    match (code, region) {
        (None, None) => return None,
        (Some(c), r) => {
            if c != out.code {
                out.region = None;
            }
            out.code = c;
            out.region = r.or(out.region);
        }
        (None, r) => out.region = r,
    }
    (out != *lang).then_some(out)
}

/// `#let fr(body) = text(lang: "fr", body)` and `#let fr = text.with(lang: "fr")`, anywhere in the file.
fn find_aliases(node: &SyntaxNode, out: &mut HashMap<String, Lang>) {
    if node.kind() == K::LetBinding {
        let (name, value) = match node.children().find(|c| matches!(c.kind(), K::Closure | K::Ident)) {
            Some(c) if c.kind() == K::Closure => (child(c, K::Ident), c.children().last()),
            Some(c) => (Some(c), node.children().last()),
            None => (None, None),
        };
        if let (Some(name), Some(value)) = (name, value)
            && value.kind() == K::FuncCall
            && let Some(callee) = value.children().next()
            && call_name(callee).as_deref() == Some("text")
            && let Some(args) = child(value, K::Args)
            && let Some(lang) = lang_args(args, &Lang::english())
        {
            out.insert(name.leaf_text().to_string(), lang);
        }
    }
    for c in node.children() {
        find_aliases(c, out);
    }
}

impl Walker<'_> {
    fn prose(&mut self, lang: &Lang) {
        self.b.want(Check::Prose, lang, None);
    }

    /// Markup: the running text of a file, a content block, a heading.
    fn markup(&mut self, node: &SyntaxNode, off: usize, lang: &mut Lang) {
        let kids: Vec<_> = children(node, off).collect();
        for (i, &(c, at)) in kids.iter().enumerate() {
            let end = at + c.len();
            match c.kind() {
                K::Text | K::SmartQuote => {
                    self.prose(lang);
                    self.b.exact(at, end);
                }
                K::Space => self.b.space(at, end),
                K::Linebreak => self.b.space(at, end),
                K::Parbreak => self.b.flush(),
                K::Escape => {
                    self.prose(lang);
                    let t = c.leaf_text().as_str();
                    let ch = if t.starts_with("\\u{") { "X" } else { &t[1..] };
                    self.b.stand_in(ch, at, end);
                }
                K::Shorthand => {
                    self.prose(lang);
                    let to = match c.leaf_text().as_str() {
                        "~" => " ",
                        "--" => "–",
                        "---" => "—",
                        "..." => "…",
                        "-?" => "",
                        "-" => "−",
                        _ => "X",
                    };
                    self.b.stand_in(to, at, end);
                }
                K::Strong | K::Emph => {
                    for (m, m_at) in children(c, at).filter(|(m, _)| m.kind() == K::Markup) {
                        self.markup(m, m_at, &mut lang.clone());
                    }
                }
                K::Heading | K::ListItem | K::EnumItem | K::TermItem => {
                    self.b.flush();
                    for (m, m_at) in children(c, at).filter(|(m, _)| m.kind() == K::Markup) {
                        self.b.fragment_next = c.kind() != K::Heading;
                        self.markup(m, m_at, &mut lang.clone());
                        // A term and its description are each their own.
                        self.b.flush();
                    }
                }
                K::Raw => self.raw(c, at, lang),
                K::Link | K::Ref => {
                    self.prose(lang);
                    self.b.hole(at, end);
                    // A reference's own words: `@fig[the figure]`.
                    for (m, m_at) in children(c, at).filter(|(m, _)| m.kind() == K::ContentBlock) {
                        self.content_alone(m, m_at, lang);
                    }
                }
                K::Equation => {
                    self.equation(c, at, lang, true);
                    // After a displayed equation, the text goes on with the sentence (", where…").
                    if c.children().nth(1).is_some_and(|s| s.kind() == K::Space) {
                        self.b.flush();
                        self.b.fragment_next = true;
                    }
                }
                K::LineComment | K::BlockComment => self.comment(c, at, lang, false),
                K::Markup => self.markup(c, at, lang),
                K::Hash | K::Label | K::Error => {}
                _ => {
                    // Code embedded with `#`.
                    let alone = standalone(&kids, i);
                    self.embedded(c, at, lang, alone);
                }
            }
        }
    }

    /// An expression after `#` in markup.
    fn embedded(&mut self, c: &SyntaxNode, at: usize, lang: &mut Lang, alone: bool) {
        match c.kind() {
            // An inline call alone on its line is still in the sentence (a hard-wrapped paragraph).
            K::FuncCall => {
                let inline = c.children().next().and_then(call_name).is_some_and(|n| INLINE.contains(&n.as_str()));
                self.call(c, at, lang, inline || !alone)
            }
            K::SetRule => self.set_rule(c, at, lang),
            K::LetBinding => self.let_binding(c, at, lang),
            K::ContentBlock => {
                for (m, m_at) in children(c, at).filter(|(m, _)| m.kind() == K::Markup) {
                    self.markup(m, m_at, &mut lang.clone());
                }
            }
            K::CodeBlock => self.code(c, at, &mut lang.clone()),
            K::ShowRule | K::Conditional | K::ForLoop | K::WhileLoop | K::Contextual => self.code(c, at, &mut lang.clone()),
            K::ModuleImport | K::ModuleInclude => {}
            // A value in the sentence: `#title`, `#sym.arrow`, `#(1 + 2)`.
            _ => {
                self.prose(lang);
                self.b.hole(at, at + c.len());
            }
        }
    }

    /// Code: a template's body, a `#{ … }` block, a call's arguments.
    fn code(&mut self, node: &SyntaxNode, off: usize, lang: &mut Lang) {
        for (c, at) in children(node, off) {
            match c.kind() {
                K::ContentBlock => self.content_alone(c, at, lang),
                K::FuncCall => self.call(c, at, lang, false),
                K::SetRule => self.set_rule(c, at, lang),
                K::LetBinding => self.let_binding(c, at, lang),
                K::Raw => self.raw(c, at, lang),
                K::Equation => self.equation(c, at, lang, false),
                K::LineComment | K::BlockComment => self.comment(c, at, lang, true),
                K::Closure => self.closure(c, at, lang),
                K::CodeBlock => self.code(c, at, &mut lang.clone()),
                K::Str | K::Ident => {}
                _ => self.code(c, at, lang),
            }
        }
    }

    /// A content block as units of its own (a caption, a table cell).
    fn content_alone(&mut self, c: &SyntaxNode, at: usize, lang: &Lang) {
        self.b.begin();
        for (m, m_at) in children(c, at).filter(|(m, _)| m.kind() == K::Markup) {
            self.markup(m, m_at, &mut lang.clone());
        }
        self.b.end();
    }

    /// A content block's text checked as code words.
    fn verbatim_code(&mut self, c: &SyntaxNode, at: usize, lang: &Lang) {
        if !self.code {
            return;
        }
        if let Some((m, m_at)) = children(c, at).find(|(m, _)| m.kind() == K::Markup) {
            self.b.isolate(|b| {
                b.want(Check::Code, lang, Some(""));
                b.exact(m_at, m_at + m.len());
            });
        }
    }

    /// A string that's prose, as a unit of its own.
    fn string_alone(&mut self, c: &SyntaxNode, at: usize, lang: &Lang) {
        if str_text(c).is_none() {
            return;
        }
        self.b.isolate(|b| {
            b.want(Check::Prose, lang, None);
            b.exact(at + 1, at + c.len() - 1);
        });
    }

    /// A call. `inline`: in a sentence, so content of an inline call runs on in it.
    fn call(&mut self, node: &SyntaxNode, off: usize, lang: &mut Lang, inline: bool) {
        let mut kids = children(node, off);
        let Some((callee, callee_at)) = kids.next() else { return };
        let name = call_name(callee).unwrap_or_default();
        let Some((args, args_at)) = kids.find(|(c, _)| c.kind() == K::Args) else {
            return self.code(callee, callee_at, lang);
        };
        let mut body = lang.clone();
        if name == "text"
            && let Some(l) = lang_args(args, lang)
        {
            body = l;
        } else if let Some(l) = self.aliases.get(&name) {
            body = l.clone();
        }
        if name == "raw" {
            return self.raw_call(args, args_at, lang, inline);
        }
        let block = BLOCK.contains(&name.as_str())
            || (name == "quote" && args.children().any(|a| a.kind() == K::Named && child(a, K::Ident).is_some_and(|n| n.leaf_text() == "block")));
        // Content runs on in the sentence for the calls known to style text;
        // another function's is its own unit, with a stand-in where it was.
        let known_inline = INLINE.contains(&name.as_str());
        let aside = ASIDE.contains(&name.as_str());
        let flows = inline && !block && known_inline;
        let stands_in = inline && !block && !aside;
        let mut said = false;
        let mut said_hole = false;
        let mut first_string = true;
        for (a, a_at) in children(args, args_at) {
            match a.kind() {
                K::ContentBlock => {
                    said = true;
                    if flows && body == *lang {
                        for (m, m_at) in children(a, a_at).filter(|(m, _)| m.kind() == K::Markup) {
                            self.markup(m, m_at, &mut body.clone());
                        }
                    } else {
                        if stands_in && !said_hole {
                            self.prose(lang);
                            self.b.hole(off, off + node.len());
                            said_hole = true;
                        }
                        if aside {
                            // An index entry's terms (`NumPy!np.linalg.norm`): words, not sentences.
                            self.verbatim_code(a, a_at, &body);
                        } else {
                            self.content_alone(a, a_at, &body);
                        }
                    }
                }
                K::Named => {
                    let key = child(a, K::Ident).map(|n| n.leaf_text().to_string()).unwrap_or_default();
                    for (v, v_at) in children(a, a_at).skip_while(|(v, _)| v.kind() != K::Colon).skip(1) {
                        match v.kind() {
                            K::ContentBlock => self.content_alone(v, v_at, &body),
                            K::Str if PROSE_NAMED.contains(&key.as_str()) => self.string_alone(v, v_at, &body),
                            K::Space | K::Str => {}
                            _ => self.code_value(v, v_at, &mut body.clone()),
                        }
                    }
                }
                K::Str => {
                    if first_string && PROSE_STRING.contains(&name.as_str()) {
                        said = true;
                        if flows && body == *lang && str_text(a).is_some() {
                            self.prose(lang);
                            self.b.exact(a_at + 1, a_at + a.len() - 1);
                        } else {
                            self.string_alone(a, a_at, &body);
                        }
                    }
                    first_string = false;
                }
                K::LeftParen | K::RightParen | K::Comma | K::Space => {}
                _ => self.code_value(a, a_at, &mut body.clone()),
            }
        }
        // `#lorem(5)`, `#counter(page).display()`: something in the sentence.
        if stands_in && !said && !said_hole {
            self.prose(lang);
            self.b.hole(off, off + node.len());
        }
    }

    /// One expression in code: walked as code, whatever its kind.
    fn code_value(&mut self, v: &SyntaxNode, at: usize, lang: &mut Lang) {
        match v.kind() {
            K::FuncCall => self.call(v, at, lang, false),
            K::ContentBlock => self.content_alone(v, at, lang),
            K::Closure => self.closure(v, at, lang),
            K::Raw => self.raw(v, at, lang),
            K::Str | K::Ident => {}
            _ => self.code(v, at, lang),
        }
    }

    /// `set text(lang: "fr")`: the language from here to the end of the block.
    fn set_rule(&mut self, node: &SyntaxNode, off: usize, lang: &mut Lang) {
        let mut target = String::new();
        for (c, at) in children(node, off) {
            match c.kind() {
                K::Ident | K::FieldAccess if target.is_empty() => target = call_name(c).unwrap_or_default(),
                K::Args => {
                    if target == "text"
                        && let Some(l) = lang_args(c, lang)
                    {
                        *lang = l;
                    }
                    // `set figure(supplement: [Fig.])`: its prose, as any call's.
                    for (a, a_at) in children(c, at).filter(|(a, _)| a.kind() == K::Named) {
                        let key = child(a, K::Ident).map(|n| n.leaf_text().to_string()).unwrap_or_default();
                        for (v, v_at) in children(a, a_at).skip_while(|(v, _)| v.kind() != K::Colon).skip(1) {
                            match v.kind() {
                                K::ContentBlock => self.content_alone(v, v_at, lang),
                                K::Str if PROSE_NAMED.contains(&key.as_str()) => self.string_alone(v, v_at, lang),
                                _ => {}
                            }
                        }
                    }
                }
                _ => {}
            }
        }
    }

    fn let_binding(&mut self, node: &SyntaxNode, off: usize, lang: &mut Lang) {
        let mut past_eq = false;
        for (c, at) in children(node, off) {
            match c.kind() {
                K::Closure => self.closure(c, at, lang),
                K::Ident if !past_eq => self.name(c, at, lang),
                K::Destructuring if !past_eq => self.names(c, at, lang),
                K::Eq => past_eq = true,
                _ if past_eq => self.code_value(c, at, &mut lang.clone()),
                _ => {}
            }
        }
    }

    /// `f(x, y: 1) = body`: the names it defines, then its body.
    fn closure(&mut self, node: &SyntaxNode, off: usize, lang: &mut Lang) {
        let mut past_eq = false;
        for (c, at) in children(node, off) {
            match c.kind() {
                K::Ident if !past_eq => self.name(c, at, lang),
                K::Params => self.names(c, at, lang),
                K::Eq | K::Arrow => past_eq = true,
                _ if past_eq => self.code_value(c, at, &mut lang.clone()),
                _ => {}
            }
        }
    }

    /// The names defined in a pattern or parameter list (not their defaults).
    fn names(&mut self, node: &SyntaxNode, off: usize, lang: &Lang) {
        for (c, at) in children(node, off) {
            match c.kind() {
                K::Ident => self.name(c, at, lang),
                K::Named => {
                    if let Some((n, n_at)) = children(c, at).find(|(n, _)| n.kind() == K::Ident) {
                        self.name(n, n_at, lang);
                    }
                }
                K::Destructuring | K::Spread => self.names(c, at, lang),
                _ => {}
            }
        }
    }

    /// A name the file defines (`tmie_zone`), checked as code.
    fn name(&mut self, c: &SyntaxNode, at: usize, lang: &Lang) {
        if !self.code {
            return;
        }
        self.b.isolate(|b| {
            b.want(Check::Code, lang, Some("typst"));
            b.exact(at, at + c.len());
        });
    }

    /// Raw text: code in a sentence (a stand-in there) and a unit of code.
    fn raw(&mut self, node: &SyntaxNode, off: usize, lang: &Lang) {
        // A block (``` over lines) ends the paragraph; inline code is a stand-in in its sentence.
        let block = node.children().next().is_some_and(|d| d.len() >= 3) && node.children().any(|c| c.kind() == K::RawTrimmed && c.leaf_text().contains('\n'));
        if block {
            self.b.flush();
        } else {
            self.prose(lang);
            self.b.hole(off, off + node.len());
        }
        if !self.code {
            return;
        }
        let tag = child(node, K::RawLang).map(|t| t.leaf_text().to_ascii_lowercase());
        let lines: Vec<_> = children(node, off).filter(|(c, _)| c.kind() == K::Text).collect();
        let indent = if block {
            lines
                .iter()
                .filter(|(c, _)| !c.leaf_text().trim().is_empty())
                .map(|(c, _)| c.leaf_text().len() - c.leaf_text().trim_start().len())
                .min()
                .unwrap_or(0)
        } else {
            0
        };
        self.b.isolate(|b| {
            b.want(Check::Code, lang, tag.as_deref().or(Some("")));
            for (i, (c, at)) in lines.iter().enumerate() {
                if i > 0 {
                    b.stand_in("\n", *at, *at);
                }
                let skip = indent.min(c.len());
                b.exact(at + skip, at + c.len());
            }
        });
    }

    /// `raw("print(1)", lang: "py")`.
    fn raw_call(&mut self, args: &SyntaxNode, off: usize, lang: &Lang, inline: bool) {
        if inline {
            self.prose(lang);
            self.b.hole(off, off + args.len());
        }
        if !self.code {
            return;
        }
        let tag = args
            .children()
            .filter(|a| a.kind() == K::Named && child(a, K::Ident).is_some_and(|n| n.leaf_text() == "lang"))
            .find_map(|a| child(a, K::Str).and_then(str_text))
            .map(str::to_ascii_lowercase);
        if let Some((s, at)) = children(args, off).find(|(c, _)| c.kind() == K::Str)
            && str_text(s).is_some()
        {
            self.b.isolate(|b| {
                b.want(Check::Code, lang, tag.as_deref().or(Some("")));
                b.exact(at + 1, at + s.len() - 1);
            });
        }
    }

    /// Math: a stand-in in the sentence; its `"quoted words"` checked for spelling.
    fn equation(&mut self, node: &SyntaxNode, off: usize, lang: &Lang, in_markup: bool) {
        if in_markup {
            self.prose(lang);
            self.b.hole(off, off + node.len());
        }
        self.math_strings(node, off, lang);
    }

    /// `"if"` in `$x "if" y$` is text; `#vect("w")` and `bold("MB")` are a call's arguments.
    fn math_strings(&mut self, node: &SyntaxNode, off: usize, lang: &Lang) {
        for (c, at) in children(node, off) {
            match c.kind() {
                // `"Cov"(x, y)`: an operator's name, not a word.
                K::Str if str_text(c).is_some() && !self.src[at + c.len()..].starts_with('(') => self.b.isolate(|b| {
                    b.want(Check::Spelling, lang, None);
                    b.exact(at + 1, at + c.len() - 1);
                }),
                K::FuncCall | K::MathCall | K::Args | K::MathArgs => {}
                _ => self.math_strings(c, at, lang),
            }
        }
    }

    /// A comment: spelling only; in code, or commented-out code (`// #set …`), as code.
    fn comment(&mut self, node: &SyntaxNode, off: usize, lang: &Lang, in_code: bool) {
        let text = node.leaf_text().as_str();
        let (start, end) = match node.kind() {
            K::LineComment => (off + 2, off + text.len()),
            _ => (off + 2, off + text.len() - if text.ends_with("*/") { 2 } else { 0 }),
        };
        if start >= end {
            return;
        }
        let body = &self.src[start..end];
        let mut rest = body.trim_start();
        let first = rest.split(|c: char| !c.is_alphanumeric()).next().unwrap_or("");
        if TAGS.contains(&first) {
            rest = rest[first.len()..].trim_start_matches(':').trim_start();
        }
        let from = start + (body.len() - rest.len());
        let end = from + rest.trim_end().len();
        let body = rest;
        let code = in_code || body.trim_start().starts_with('#');
        if code && !self.code {
            return;
        }
        self.b.isolate(|b| {
            if code {
                b.want(Check::Code, lang, Some("typst"));
            } else {
                b.want(Check::Spelling, lang, None);
            }
            b.exact(from, end);
        });
    }
}

/// A call alone on its lines (not in a sentence): `#note[…]` between paragraphs.
fn standalone(kids: &[(&SyntaxNode, usize)], i: usize) -> bool {
    let breaks = |n: &SyntaxNode| n.kind() == K::Parbreak || (n.kind() == K::Space && n.leaf_text().contains('\n'));
    // Skip the `#` before it.
    let before = kids[..i].iter().rev().find(|(n, _)| n.kind() != K::Hash);
    let after = kids.get(i + 1);
    before.is_none_or(|(n, _)| breaks(n)) && after.is_none_or(|(n, _)| breaks(n))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn texts(src: &str) -> Vec<(Check, String, String)> {
        units(src, &Lang::english(), true).into_iter().map(|u| (u.check, u.lang.to_string(), u.text)).collect()
    }

    fn prose(src: &str) -> Vec<String> {
        texts(src).into_iter().filter(|(c, _, _)| *c == Check::Prose).map(|(_, _, t)| t).collect()
    }

    #[test]
    fn markup_reads_as_sentences() {
        assert_eq!(prose("This is *very* good, I don't -- see @fig and $x$.\nIt wraps."), ["This is very good, I don't – see X and X. It wraps."]);
        assert_eq!(prose("= A Title <intro>\nBody text.\n\nNext one."), ["A Title", "Body text.", "Next one."]);
        assert_eq!(prose("- one\n- two\n/ Term: what it means"), ["one", "two", "Term", "what it means"]);
        assert_eq!(prose("end~here\\\nand a \\# sign."), ["end here and a # sign."]);
    }

    #[test]
    fn inline_calls_run_on_and_block_calls_stand_alone() {
        assert_eq!(prose("A #emph[very] good #link(\"https://x.y\")[site] here."), ["A very good site here."]);
        assert_eq!(prose("It is true#footnote[A note.] and more."), ["A note.", "It is true and more."]);
        assert_eq!(prose("#figure(image(\"a.png\"), caption: [A capton])"), ["A capton"]);
        assert_eq!(prose("Some #lorem(3) words."), ["Some X words."]);
        assert_eq!(prose("Before.\n\n#note[A boxed aside.]\n\nAfter."), ["Before.", "A boxed aside.", "After."]);
        // Another function's content in a sentence: its own, with a stand-in.
        assert_eq!(prose("The #term[vector] is here."), ["vector", "The X is here."]);
        // An index entry isn't in the text at all.
        assert_eq!(prose("#index[vector!arrow]What does it mean?"), ["What does it mean?"]);
        assert!(texts("#index[vector!arrow]").contains(&(Check::Code, "en".into(), "vector!arrow".into())));
    }

    #[test]
    fn only_prose_strings_are_checked() {
        let t = prose("#set text(font: \"Libertinus Serif\", lang: \"en\")\n#figure(image(\"x.png\"), caption: \"A capton\")\n#show: book.with(title: \"My Boook\", paper: \"a5\")");
        assert_eq!(t, ["A capton", "My Boook"]);
        assert_eq!(prose("#text(size: 9pt, \"Hello there\")"), ["Hello there"]);
    }

    #[test]
    fn math_is_skipped_but_its_words_are_spelled() {
        let t = texts("$ x \"if\" y $");
        assert_eq!(t, [(Check::Spelling, "en".into(), "if".into())]);
        assert!(texts("$#vect(\"w\") + bold(\"600 MB\")$").is_empty());
        assert!(texts("$\"Cov\"(x, y)$").is_empty());
    }

    #[test]
    fn languages_follow_set_rules_calls_and_aliases() {
        let t = texts("Hello.\n\n#set text(lang: \"fr\")\nBonjour.");
        assert_eq!(t, [(Check::Prose, "en".into(), "Hello.".into()), (Check::Prose, "fr".into(), "Bonjour.".into())]);
        let t = texts("He said #text(lang: \"de\")[Guten Tag] to me.");
        assert_eq!(t, [(Check::Prose, "de".into(), "Guten Tag".into()), (Check::Prose, "en".into(), "He said X to me.".into())]);
        let t = texts("#let fr(body) = text(lang: \"fr\", body)\nShe said #fr[merci beaucoup].");
        assert!(t.contains(&(Check::Prose, "fr".into(), "merci beaucoup".into())), "{t:?}");
        let t = texts("#let de = text.with(lang: \"de\", region: \"at\")\n#de[Servus]");
        assert!(t.contains(&(Check::Prose, "de-AT".into(), "Servus".into())), "{t:?}");
        // A block keeps its set rules to itself.
        let t = texts("#[#set text(lang: \"fr\")\nOui.]\nYes.");
        assert_eq!(t, [(Check::Prose, "fr".into(), "Oui.".into()), (Check::Prose, "en".into(), "Yes.".into())]);
        let t = texts("#set text(region: \"gb\")\nColour.");
        assert_eq!(t, [(Check::Prose, "en-GB".into(), "Colour.".into())]);
    }

    #[test]
    fn list_items_and_text_after_display_math_are_fragments() {
        let u = units("Where\n$ x = 1 $\nand so on.\n\n- an item", &Lang::english(), true);
        let frag: Vec<_> = u.iter().map(|u| (u.text.as_str(), u.fragment)).collect();
        assert_eq!(frag, [("Where X", false), ("and so on.", true), ("an item", true)]);
    }

    #[test]
    fn code_is_its_own_unit() {
        let t = texts("Use `tmie_zone` here.\n```py\n  # a tset\n  x = 1\n```");
        assert_eq!(t[0], (Check::Code, "en".into(), "tmie_zone".into()));
        assert_eq!(t[1], (Check::Prose, "en".into(), "Use X here.".into()));
        assert_eq!(t[2], (Check::Code, "en".into(), "# a tset\nx = 1".into()));
        let u = units("```py\n  # a tset\n```", &Lang::english(), true);
        assert_eq!(u[0].code.as_deref(), Some("py"));
        // Off, code leaves only its stand-in.
        assert_eq!(units("Use `x` here.", &Lang::english(), false).len(), 1);
    }

    #[test]
    fn names_are_checked_where_theyre_defined() {
        let t = texts("#let tmie_zone = 1\n#let title-page(titel: \"\", author: none) = [Page]\n#tmie_zone");
        let code: Vec<_> = t.iter().filter(|(c, _, _)| *c == Check::Code).map(|(_, _, t)| t.as_str()).collect();
        assert_eq!(code, ["tmie_zone", "title-page", "titel", "author"]);
        assert!(t.contains(&(Check::Prose, "en".into(), "Page".into())));
    }

    #[test]
    fn comments_are_spelled_without_their_tags() {
        let t = texts("Text. // TODO: fix this commnet\n/* a blok */");
        assert!(t.contains(&(Check::Spelling, "en".into(), "fix this commnet".into())), "{t:?}");
        assert!(t.contains(&(Check::Spelling, "en".into(), "a blok".into())), "{t:?}");
        assert!(t.contains(&(Check::Prose, "en".into(), "Text.".into())), "{t:?}");
        let t = texts("// #set text(lang: \"fr\")");
        assert_eq!(t[0].0, Check::Code);
        let t = texts("#{\n  // line((cx, cy))\n}");
        assert_eq!(t[0].0, Check::Code);
    }

    #[test]
    fn templates_set_language_inside_their_function() {
        let src = "#let book(title: \"\", body) = {\n  set text(font: \"Libertinus Serif\", size: 11pt, lang: \"en\", hyphenate: true)\n  show heading.where(level: 1): it => {\n    block[#text(size: 9pt, upper[Chapter #counter(heading).display(\"1\")])]\n  }\n  body\n}";
        let t = prose(src);
        assert_eq!(t, ["Chapter X"]);
    }

    #[test]
    fn a_book_s_language_is_its_first_literal_set_rule() {
        let (lang, files) = declared_language("#import \"style.typ\": *\n#include \"chapters/one.typ\"\n#import \"@preview/cetz:0.3.0\"");
        assert!(lang.is_none());
        assert_eq!(files, ["style.typ", "chapters/one.typ"]);
        let (lang, _) = declared_language("#let book(body) = {\n  set text(font: \"x\", lang: \"en\", region: \"gb\")\n  body\n}");
        assert_eq!(lang.unwrap().to_string(), "en-GB");
        assert!(declared_language("#set text(size: 11pt)").0.is_none());
    }

    #[test]
    fn places_map_back_through_markup() {
        let src = "A #emph[tset] here.";
        let u = &units(src, &Lang::english(), true)[0];
        let at = u.text.find("tset").unwrap();
        let p = u.place(at, at + 4).unwrap();
        assert_eq!(&src[p.start..p.end], "tset");
        assert!(p.exact);
    }
}
