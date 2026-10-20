//! EPUB export (the page's src/epub/ puts the book together; this compiles it
//! with Tinymist and writes the file). Two kinds:
//!
//! - Reflowing text, from Typst's HTML export of a copy of the main file with
//!   rules for e-readers (the page writes them). The copy is compiled in a
//!   mirror of the book's folder made of links, with the copy in the main
//!   file's place, so nothing is written in the book (nor seen by History).
//! - Fixed layout: every page as typeset, as SVG, with the chapters' pages
//!   from the PDF's outline.
//!
//! The pieces wait in a temporary folder until the file is written.
use std::{
    io::Write,
    path::{Path, PathBuf},
    process::Stdio,
    time::Duration,
};

use serde::{Deserialize, Serialize};
use tokio::process::Command;

use crate::{
    Win, discover,
    error::{CmdError, CmdResult},
};

/// A whole book can take a while; past this, something is wrong.
const TIMEOUT: Duration = Duration::from_secs(300);
const TEMP_PREFIX: &str = "foreword-epub-";

#[derive(Serialize)]
pub struct HtmlOut {
    /// The HTML, when it compiled.
    html: Option<String>,
    /// The compiler's warnings and errors, one per line of its own.
    warnings: Vec<String>,
    errors: Vec<String>,
}

#[derive(Serialize)]
pub struct PageOut {
    /// In the temporary folder.
    file: String,
    /// In points.
    width: f64,
    height: f64,
}

#[derive(Serialize)]
pub struct TocEntry {
    level: usize,
    title: String,
    /// 1-based.
    page: usize,
}

#[derive(Serialize)]
pub struct PagesOut {
    /// The temporary folder the pages are in (epub_write takes them from there; epub_done removes it).
    dir: String,
    pages: Vec<PageOut>,
    toc: Vec<TocEntry>,
    errors: Vec<String>,
}

/// One file of the EPUB: its text, its bytes (base64), or a file from epub_pages's folder.
#[derive(Deserialize)]
pub struct EpubFile {
    name: String,
    text: Option<String>,
    base64: Option<String>,
    temp: Option<String>,
}

fn temp_dir() -> CmdResult<PathBuf> {
    let dir = std::env::temp_dir().join(format!("{TEMP_PREFIX}{}", uuid::Uuid::new_v4().simple()));
    std::fs::create_dir_all(&dir)?;
    // The real path (/var is /private/var): Tinymist checks the entry is inside the root.
    Ok(dir.canonicalize()?)
}

/// The book's folder, the Typst root and the main file, all absolute; the main file must be inside the root.
fn places(state: &Win, entry: &str, root: Option<&str>) -> CmdResult<(PathBuf, PathBuf)> {
    let folder = state.root()?.canonicalize()?;
    let entry = folder.join(entry).canonicalize()?;
    let root = match root.filter(|r| !r.trim().is_empty()) {
        Some(r) => folder.join(r).canonicalize()?,
        None => entry.parent().unwrap_or(&folder).to_path_buf(),
    };
    if !entry.starts_with(&root) || !entry.starts_with(&folder) {
        return Err(CmdError::Invalid(
            "the main file isn't inside the book".into(),
        ));
    }
    Ok((root, entry))
}

/// A mirror of `root` in `into`: links to everything, except the main file
/// (`source` in its place) and the folders on the way to it (real folders, of links).
fn mirror(root: &Path, entry: &Path, source: &str, into: &Path) -> CmdResult<PathBuf> {
    let rel = entry
        .strip_prefix(root)
        .map_err(|_| CmdError::Invalid("the main file isn't inside the root".into()))?;
    let parts: Vec<_> = rel.components().map(|c| c.as_os_str().to_owned()).collect();
    let (mut real, mut fake) = (root.to_path_buf(), into.to_path_buf());
    for (i, part) in parts.iter().enumerate() {
        for child in std::fs::read_dir(&real)?.flatten() {
            if &child.file_name() == part {
                continue;
            }
            std::os::unix::fs::symlink(child.path(), fake.join(child.file_name()))?;
        }
        if i + 1 == parts.len() {
            std::fs::write(fake.join(part), source)?;
        } else {
            real = real.join(part);
            fake = fake.join(part);
            std::fs::create_dir(&fake)?;
        }
    }
    Ok(into.join(rel))
}

/// Tinymist's compile; its messages split into warnings and errors (the first line of each).
async fn compile(
    root: &Path,
    entry: &Path,
    out: &Path,
    format: &str,
    font_paths: &[String],
) -> CmdResult<(bool, Vec<String>, Vec<String>)> {
    let bin = discover::find_tinymist()
        .ok_or_else(|| CmdError::Unavailable("Tinymist isn't installed".into()))?;
    let mut cmd = Command::new(bin);
    cmd.arg("compile")
        .arg("--root")
        .arg(root)
        .arg("--format")
        .arg(format);
    for f in font_paths {
        cmd.arg("--font-path").arg(f);
    }
    let child = cmd
        .arg(entry)
        .arg(out)
        .current_dir(root)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .process_group(0)
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| CmdError::Unavailable(format!("couldn't start Tinymist: {e}")))?;
    let pid = child.id();
    let output = match tokio::time::timeout(TIMEOUT, child.wait_with_output()).await {
        Ok(o) => o?,
        Err(_) => {
            if let Some(pid) = pid {
                // SAFETY: killpg only sends a signal; pid is our own child's group.
                unsafe { libc::killpg(pid as i32, libc::SIGKILL) };
            }
            return Err(CmdError::Unavailable("Tinymist took too long".into()));
        }
    };
    // Without colours (a copy of Tinymist may add them), one message per "warning:" or "error:" line.
    let text = strip_ansi(&String::from_utf8_lossy(&output.stderr));
    let messages = |kind: &str| -> Vec<String> {
        text.lines()
            .filter_map(|l| l.trim_start().strip_prefix(kind))
            .map(|m| m.trim().to_string())
            .collect()
    };
    let ok = output.status.success();
    let mut errors = messages("error:");
    if !ok && errors.is_empty() {
        // It stopped without saying why in the usual way: its last words, then.
        let lines: Vec<&str> = text
            .lines()
            .map(str::trim)
            .filter(|l| !l.is_empty())
            .collect();
        let tail = lines[lines.len().saturating_sub(3)..].join(" ");
        errors.push(if tail.is_empty() {
            format!("Tinymist stopped ({})", output.status)
        } else {
            tail
        });
    }
    Ok((ok, messages("warning:"), errors))
}

/// Text without terminal colour codes.
fn strip_ansi(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\u{1b}' && chars.peek() == Some(&'[') {
            chars.next();
            for c in chars.by_ref() {
                if c.is_ascii_alphabetic() {
                    break;
                }
            }
        } else {
            out.push(c);
        }
    }
    out
}

/// Reflowing text: `source` (the main file, with rules for e-readers) compiled to HTML, in a mirror of the book.
#[tauri::command]
pub async fn epub_html(
    state: Win,
    entry: String,
    source: String,
    root: Option<String>,
    font_paths: Vec<String>,
) -> CmdResult<HtmlOut> {
    let (root, entry) = places(&state, &entry, root.as_deref())?;
    let dir = temp_dir()?;
    let result = async {
        let book = dir.join("book");
        std::fs::create_dir(&book)?;
        let copy = mirror(&root, &entry, &source, &book)?;
        // Not "book.html": Tinymist names its task after the output without its extension, and book/ is the mirror.
        let out = dir.join("epub.html");
        let (ok, warnings, errors) = compile(&book, &copy, &out, "html", &font_paths).await?;
        let html = if ok {
            Some(std::fs::read_to_string(&out)?)
        } else {
            None
        };
        Ok(HtmlOut {
            html,
            warnings,
            errors,
        })
    }
    .await;
    let _ = std::fs::remove_dir_all(&dir);
    result
}

/// The size of an SVG page Typst wrote, in points (its `width="…pt"`).
fn svg_size(svg: &str) -> (f64, f64) {
    let head = &svg[..svg.len().min(600)];
    let attr = |name: &str| -> f64 {
        head.find(&format!(" {name}=\""))
            .and_then(|i| {
                let rest = &head[i + name.len() + 3..];
                rest[..rest.find('"')?].trim_end_matches("pt").parse().ok()
            })
            .unwrap_or(0.0)
    };
    (attr("width"), attr("height"))
}

/// Fixed layout: every page as SVG, and the chapters' pages from the PDF's outline.
#[tauri::command]
pub async fn epub_pages(
    state: Win,
    entry: String,
    root: Option<String>,
    font_paths: Vec<String>,
) -> CmdResult<PagesOut> {
    let (root, entry) = places(&state, &entry, root.as_deref())?;
    let dir = temp_dir()?;
    let (ok, _, mut errors) = compile(
        &root,
        &entry,
        &dir.join("page-{0p}.svg"),
        "svg",
        &font_paths,
    )
    .await?;
    let mut pages = Vec::new();
    let mut toc = Vec::new();
    if ok {
        let mut names: Vec<_> = std::fs::read_dir(&dir)?
            .flatten()
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .filter(|n| n.starts_with("page-") && n.ends_with(".svg"))
            .collect();
        names.sort();
        for n in names {
            let (width, height) = svg_size(&std::fs::read_to_string(dir.join(&n))?);
            pages.push(PageOut {
                file: dir.join(n).to_string_lossy().into_owned(),
                width,
                height,
            });
        }
        let pdf = dir.join("book.pdf");
        let (pdf_ok, _, pdf_errors) = compile(&root, &entry, &pdf, "pdf", &font_paths).await?;
        errors.extend(pdf_errors);
        if pdf_ok
            && let Ok(doc) = lopdf::Document::load(&pdf)
            && let Ok(t) = doc.get_toc()
        {
            toc = t
                .toc
                .into_iter()
                .map(|e| TocEntry {
                    level: e.level,
                    title: e.title,
                    page: e.page,
                })
                .collect();
        }
        let _ = std::fs::remove_file(&pdf);
    }
    Ok(PagesOut {
        dir: dir.to_string_lossy().into_owned(),
        pages,
        toc,
        errors,
    })
}

/// A file epub_pages left in a temporary folder of ours, and nothing else.
fn our_temp(path: &str) -> CmdResult<PathBuf> {
    let p = PathBuf::from(path).canonicalize()?;
    let base = std::env::temp_dir().canonicalize()?;
    let ours = p
        .strip_prefix(&base)
        .ok()
        .and_then(|r| r.components().next())
        .is_some_and(|c| c.as_os_str().to_string_lossy().starts_with(TEMP_PREFIX));
    if ours {
        Ok(p)
    } else {
        Err(CmdError::Invalid(
            "not one of the export's own files".into(),
        ))
    }
}

/// Write the EPUB: `mimetype` first and stored, as the format asks, the rest compressed; atomically.
#[tauri::command]
pub async fn epub_write(path: String, files: Vec<EpubFile>) -> CmdResult<String> {
    use base64::Engine;
    let target = PathBuf::from(&path);
    if target.extension().and_then(|e| e.to_str()) != Some("epub") {
        return Err(CmdError::Invalid("an EPUB's name ends in .epub".into()));
    }
    let tmp = target.with_extension("epub.foreword.tmp");
    let result = (|| -> CmdResult<()> {
        let mut zip = zip::ZipWriter::new(std::fs::File::create(&tmp)?);
        let stored = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Stored);
        let deflated = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);
        let err = |e: zip::result::ZipError| CmdError::Io(e.to_string());
        zip.start_file("mimetype", stored).map_err(err)?;
        zip.write_all(b"application/epub+zip")?;
        for f in &files {
            if f.name == "mimetype"
                || f.name.starts_with('/')
                || f.name.split('/').any(|p| p == "..")
            {
                continue;
            }
            let bytes = match (&f.text, &f.base64, &f.temp) {
                (Some(t), _, _) => t.clone().into_bytes(),
                (_, Some(b), _) => base64::engine::general_purpose::STANDARD
                    .decode(b)
                    .map_err(|e| CmdError::Invalid(format!("{}: {e}", f.name)))?,
                (_, _, Some(p)) => std::fs::read(our_temp(p)?)?,
                _ => continue,
            };
            zip.start_file(f.name.as_str(), deflated).map_err(err)?;
            zip.write_all(&bytes)?;
        }
        zip.finish().map_err(err)?;
        Ok(())
    })();
    if let Err(e) = result {
        let _ = std::fs::remove_file(&tmp);
        return Err(e);
    }
    std::fs::rename(&tmp, &target)?;
    Ok(target.to_string_lossy().into_owned())
}

/// An exported EPUB: shown in Finder, or opened (in Books, or whatever opens EPUBs).
#[tauri::command]
pub fn epub_reveal(path: String, open: bool) -> CmdResult<()> {
    let p = PathBuf::from(&path);
    if p.extension().and_then(|e| e.to_str()) != Some("epub") || !p.is_file() {
        return Err(CmdError::Invalid("not an exported EPUB".into()));
    }
    let mut cmd = std::process::Command::new("/usr/bin/open");
    if !open {
        cmd.arg("-R");
    }
    let status = cmd.arg(&p).status()?;
    if status.success() {
        Ok(())
    } else {
        Err(CmdError::Io("open failed".into()))
    }
}

/// The export is over: its temporary folder goes.
#[tauri::command]
pub fn epub_done(dir: String) -> CmdResult<()> {
    let p = our_temp(&dir)?;
    std::fs::remove_dir_all(p)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn takes_colours_out_of_messages() {
        assert_eq!(
            strip_ansi("\u{1b}[1;31merror\u{1b}[0m: label `<x>` does not exist"),
            "error: label `<x>` does not exist"
        );
    }

    #[test]
    fn reads_typst_svg_sizes() {
        assert_eq!(
            svg_size(
                r#"<svg class="typst-doc" viewBox="0 0 432 648" width="432pt" height="648pt" xmlns="http://www.w3.org/2000/svg">"#
            ),
            (432.0, 648.0)
        );
        assert_eq!(svg_size("<svg>"), (0.0, 0.0));
    }

    #[test]
    fn mirrors_a_book_with_links_and_the_main_file_replaced() {
        let base =
            std::env::temp_dir().join(format!("foreword-mirror-test-{}", std::process::id()));
        let book = base.join("book");
        std::fs::create_dir_all(book.join("src/chapters")).unwrap();
        std::fs::write(book.join("src/main.typ"), "original").unwrap();
        std::fs::write(book.join("src/chapters/one.typ"), "one").unwrap();
        std::fs::write(book.join("refs.bib"), "bib").unwrap();
        let into = base.join("mirror");
        std::fs::create_dir_all(&into).unwrap();
        let entry = mirror(&book, &book.join("src/main.typ"), "copy", &into).unwrap();
        assert_eq!(entry, into.join("src/main.typ"));
        assert_eq!(std::fs::read_to_string(&entry).unwrap(), "copy");
        assert_eq!(
            std::fs::read_to_string(book.join("src/main.typ")).unwrap(),
            "original"
        );
        assert_eq!(
            std::fs::read_to_string(into.join("src/chapters/one.typ")).unwrap(),
            "one"
        );
        assert!(
            std::fs::symlink_metadata(into.join("refs.bib"))
                .unwrap()
                .file_type()
                .is_symlink()
        );
        assert!(
            !std::fs::symlink_metadata(into.join("src"))
                .unwrap()
                .file_type()
                .is_symlink()
        );
        std::fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn takes_temporary_files_only_from_its_own_folders() {
        assert!(our_temp("/etc/hosts").is_err());
        let dir = temp_dir().unwrap();
        std::fs::write(dir.join("page-1.svg"), "<svg/>").unwrap();
        assert!(our_temp(&dir.join("page-1.svg").to_string_lossy()).is_ok());
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
