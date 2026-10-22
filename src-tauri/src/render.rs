//! Typst snippets rendered outside the book: formulas and blocks in the chat
//! and in review comments. Each snippet compiles on its own with Tinymist,
//! in a fresh temp folder that is also its Typst root, to SVG. Given the
//! book, that folder holds links to everything in the book's Typst root and
//! the snippet starts with the book's imports, so `$#vect("v")$` is set with
//! the book's own `vect`; the book's files can be read but nothing is written
//! among them (the pictures go to a folder beside it). Without the book, the
//! root is empty: a snippet can't read anything. A timeout and a size cap keep
//! a runaway snippet from holding things up.
use std::{
    path::{Path, PathBuf},
    process::Stdio,
    time::Duration,
};

use serde::{Deserialize, Serialize};
use tokio::process::Command;

use crate::{
    Win, discover,
    error::{CmdError, CmdResult},
    workspace,
};

const MAX_SOURCE: usize = 20 * 1024;
const MAX_PRELUDE: usize = 20 * 1024;
const MAX_SNIPPETS: usize = 40;
const TIMEOUT: Duration = Duration::from_secs(15);
/// The snippet's file in its root (a dot file, so it won't be one of the book's).
const SNIPPET: &str = ".foreword-snippet.typ";

/// The book a snippet is set in.
#[derive(Deserialize)]
pub struct Book {
    /// Its Typst root, relative to the folder opened ("" for the folder itself).
    root: String,
    /// What goes in front of the snippet: the book's imports, root-absolute.
    prelude: String,
}

#[derive(Serialize)]
pub struct Rendered {
    /// One SVG per page (a snippet normally makes one).
    pages: Vec<String>,
    /// The compiler's message, if it failed.
    error: Option<String>,
}

/// `#rrggbb` only: it goes into the preamble.
fn is_hex_color(c: &str) -> bool {
    c.len() == 7 && c.starts_with('#') && c[1..].chars().all(|ch| ch.is_ascii_hexdigit())
}

fn preamble(fill: &str, size_pt: f64) -> String {
    format!(
        "#set page(width: auto, height: auto, margin: (x: 1pt, y: 2pt), fill: none)\n#set text(size: {size_pt}pt, fill: rgb(\"{fill}\"))\n"
    )
}

fn failed(e: String) -> Rendered {
    Rendered {
        pages: Vec::new(),
        error: Some(e),
    }
}

/// A snippet set with the book's imports (`book`: its Typst root and the
/// imports), or alone. If the book's imports stop it (one of the book's files
/// has an error just now), it's set alone, and if that fails too, the error
/// is the one with the book.
async fn render_one(
    bin: &Path,
    source: &str,
    fill: &str,
    size_pt: f64,
    book: Option<(&Path, &str)>,
) -> Rendered {
    if source.len() > MAX_SOURCE {
        return failed("too long to show".into());
    }
    let text = format!("{}{source}\n", preamble(fill, size_pt));
    let Some((root, prelude)) = book else {
        return compile(bin, &text, None).await;
    };
    let with_book = compile(bin, &format!("{prelude}\n{text}"), Some(root)).await;
    if with_book.error.is_none() {
        return with_book;
    }
    let alone = compile(bin, &text, None).await;
    if alone.error.is_none() {
        alone
    } else {
        with_book
    }
}

/// A temp root for one snippet: links to everything in `book` (if any), and the snippet.
fn snippet_root(root: &Path, text: &str, book: Option<&Path>) -> std::io::Result<()> {
    std::fs::create_dir_all(root)?;
    if let Some(book) = book {
        for entry in std::fs::read_dir(book)? {
            let name = entry?.file_name();
            if name != SNIPPET {
                std::os::unix::fs::symlink(book.join(&name), root.join(&name))?;
            }
        }
    }
    std::fs::write(root.join(SNIPPET), text)
}

async fn compile(bin: &Path, text: &str, book: Option<&Path>) -> Rendered {
    let dir = std::env::temp_dir().join(format!(
        "foreword-render-{}",
        uuid::Uuid::new_v4().simple()
    ));
    if let Err(e) = std::fs::create_dir_all(&dir) {
        return failed(e.to_string());
    }
    // The real path (/var is /private/var on macOS): Tinymist checks the entry is inside the root.
    let dir = dir.canonicalize().unwrap_or(dir);
    // The pictures go beside the root, never into it: its links lead into the book.
    let (root, pages): (PathBuf, PathBuf) = (dir.join("root"), dir.join("pages"));
    let result = async {
        snippet_root(&root, text, book).map_err(|e| e.to_string())?;
        std::fs::create_dir_all(&pages).map_err(|e| e.to_string())?;
        let child = Command::new(bin)
            .arg("compile")
            .arg("--root")
            .arg(&root)
            .arg(root.join(SNIPPET))
            .arg(pages.join("page-{0p}.svg"))
            .current_dir(&pages)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .process_group(0)
            .kill_on_drop(true)
            .spawn()
            .map_err(|e| format!("couldn't start tinymist: {e}"))?;
        let pid = child.id();
        let out = match tokio::time::timeout(TIMEOUT, child.wait_with_output()).await {
            Ok(out) => out.map_err(|e| e.to_string())?,
            Err(_) => {
                if let Some(pid) = pid {
                    // SAFETY: killpg only sends a signal; pid is our own child's group.
                    unsafe { libc::killpg(pid as i32, libc::SIGKILL) };
                }
                return Err("took too long to render".into());
            }
        };
        if !out.status.success() {
            let msg = String::from_utf8_lossy(&out.stderr).trim().to_string();
            return Err(if msg.is_empty() {
                "couldn't render".into()
            } else {
                msg
            });
        }
        let mut names: Vec<_> = std::fs::read_dir(&pages)
            .map_err(|e| e.to_string())?
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .filter(|n| n.starts_with("page-") && n.ends_with(".svg"))
            .collect();
        names.sort();
        names
            .iter()
            .map(|n| std::fs::read_to_string(pages.join(n)).map_err(|e| e.to_string()))
            .collect::<Result<Vec<_>, _>>()
    }
    .await;
    // Removes the links themselves, not what they lead to.
    let _ = std::fs::remove_dir_all(&dir);
    match result {
        Ok(pages) => Rendered { pages, error: None },
        Err(e) => failed(e),
    }
}

/// Render snippets (Typst markup; math is `$…$`) in `fill` colour at `size_pt`,
/// with the open book's imports if `book` is given.
#[tauri::command]
pub async fn typst_render(
    state: Win,
    sources: Vec<String>,
    fill: String,
    size_pt: f64,
    book: Option<Book>,
) -> CmdResult<Vec<Rendered>> {
    if !is_hex_color(&fill) {
        return Err(CmdError::Invalid(format!("not a colour: {fill}")));
    }
    if sources.len() > MAX_SNIPPETS {
        return Err(CmdError::Invalid("too many snippets at once".into()));
    }
    let size_pt = size_pt.clamp(6.0, 32.0);
    let bin = discover::find_tinymist()
        .ok_or_else(|| CmdError::Unavailable("tinymist not found".into()))?;
    // The book's Typst root, inside the folder opened; without one, snippets are set alone.
    let book = book
        .filter(|b| b.prelude.len() <= MAX_PRELUDE)
        .and_then(|b| {
            let opened = state.root().ok()?;
            let root = if b.root.is_empty() {
                opened
            } else {
                workspace::resolve(&opened, &b.root).ok()?
            };
            root.is_dir().then_some((root, b.prelude))
        });
    let book = book
        .as_ref()
        .map(|(root, prelude)| (root.as_path(), prelude.as_str()));
    let jobs = sources
        .iter()
        .map(|s| render_one(&bin, s, &fill, size_pt, book));
    Ok(futures_util::future::join_all(jobs).await)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_plain_hex_colours_reach_the_preamble() {
        assert!(is_hex_color("#d4d4d4"));
        assert!(!is_hex_color("#d4d4d4\")\n#read(\"x\""));
        assert!(!is_hex_color("red"));
        assert!(preamble("#112233", 11.0).contains("rgb(\"#112233\")"));
    }

    #[tokio::test]
    async fn renders_math_and_reports_errors() {
        let Some(bin) = discover::find_tinymist() else {
            return; // no tinymist on this machine
        };
        let ok = render_one(&bin, "$ x^2 + y^2 $", "#000000", 11.0, None).await;
        assert!(ok.error.is_none(), "{:?}", ok.error);
        assert_eq!(ok.pages.len(), 1);
        assert!(ok.pages[0].starts_with("<svg"));
        let bad = render_one(&bin, "$ frac(1 $", "#000000", 11.0, None).await;
        assert!(bad.pages.is_empty() && bad.error.is_some());
        // The snippet's root is its own temp folder: the book's files are out of reach.
        let outside = render_one(&bin, "#read(\"/etc/hosts\")", "#000000", 11.0, None).await;
        assert!(outside.error.is_some());
    }

    #[tokio::test]
    async fn sets_snippets_with_the_books_definitions() {
        let Some(bin) = discover::find_tinymist() else {
            return;
        };
        let book = std::env::temp_dir().join(format!(
            "foreword-render-book-{}",
            uuid::Uuid::new_v4().simple()
        ));
        std::fs::create_dir_all(book.join("template")).unwrap();
        let book = book.canonicalize().unwrap();
        std::fs::write(book.join("template/lib.typ"), "#import \"math.typ\": *\n").unwrap();
        std::fs::write(
            book.join("template/math.typ"),
            "#let vect(x) = math.bold(math.italic(x))\n",
        )
        .unwrap();
        // A file where a snippet's pictures would land if they went into the root.
        std::fs::write(book.join("page-1.svg"), "the book's own").unwrap();
        let before: Vec<_> = std::fs::read_dir(&book)
            .unwrap()
            .map(|e| e.unwrap().file_name())
            .collect();
        let prelude = "#import \"/template/lib.typ\": *";
        let with = render_one(
            &bin,
            "$#vect(\"v\")_1$",
            "#000000",
            11.0,
            Some((&book, prelude)),
        )
        .await;
        assert!(with.error.is_none(), "{:?}", with.error);
        assert_eq!(with.pages.len(), 1);
        let alone = render_one(&bin, "$#vect(\"v\")_1$", "#000000", 11.0, None).await;
        assert!(alone.error.unwrap().contains("vect"));
        // A broken import doesn't stop a snippet that doesn't need it.
        let broken = render_one(
            &bin,
            "$x^2$",
            "#000000",
            11.0,
            Some((&book, "#import \"/missing.typ\": *")),
        )
        .await;
        assert!(broken.error.is_none(), "{:?}", broken.error);
        // Nothing was written in the book, and its files are all still there.
        let after: Vec<_> = std::fs::read_dir(&book)
            .unwrap()
            .map(|e| e.unwrap().file_name())
            .collect();
        assert_eq!(before.len(), after.len());
        assert_eq!(
            std::fs::read_to_string(book.join("page-1.svg")).unwrap(),
            "the book's own"
        );
        assert!(book.join("template/math.typ").exists());
        let _ = std::fs::remove_dir_all(&book);
    }
}
