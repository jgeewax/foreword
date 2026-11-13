//! Files attached to a chat message (dropped, pasted or picked). Each is
//! copied into the book under `.foreword/attachments/`, which git ignores, so
//! every assistant can open it with its own tools; a file already in the book
//! is used where it is. Nothing is ever overwritten: a name that's taken gets
//! " 2", " 3"… before its extension.
use std::{
    fs,
    io::{self, Write},
    path::{Path, PathBuf},
};

use serde::Serialize;
use tauri::ipc::{InvokeBody, Request, Response};

use crate::{
    Win,
    error::{CmdError, CmdResult},
    workspace::resolve,
};

/// Where attachments go, in the book.
pub const DIR: &str = ".foreword/attachments";

/// The largest file that can be attached.
const MAX_ATTACH: u64 = 256 * 1024 * 1024;

/// The largest file `fs_read_bytes` reads (a picture to show, or to send with a message).
const MAX_READ: u64 = 64 * 1024 * 1024;

#[derive(Serialize, Debug, PartialEq)]
pub struct Attached {
    /// Book-relative.
    path: String,
    name: String,
    size: u64,
    /// A folder of the book (attached where it is, never copied).
    dir: bool,
}

/// Files from anywhere on the Mac (the message box's file picker, or the
/// book's file tree): one in the book is used where it is, others are copied in.
#[tauri::command]
pub async fn attach_paths(state: Win, paths: Vec<String>) -> CmdResult<Vec<Attached>> {
    let root = state.root()?;
    paths.iter().map(|p| attach_path(&root, Path::new(p))).collect()
}

/// A file the page has only as bytes (dropped from Finder, or pasted): the
/// request's body, named by its `x-name` header (percent-encoded).
#[tauri::command]
pub async fn attach_bytes(state: Win, request: Request<'_>) -> CmdResult<Attached> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err(CmdError::Invalid("expected the file's bytes".into()));
    };
    let name = request
        .headers()
        .get("x-name")
        .and_then(|v| v.to_str().ok())
        .map(percent_decode)
        .unwrap_or_default();
    if bytes.len() as u64 > MAX_ATTACH {
        return Err(too_big(&name));
    }
    let root = state.root()?;
    let (path, mut file) = create_in(&root, &name)?;
    file.write_all(bytes)?;
    Ok(Attached {
        name: base_name(&path),
        path,
        size: bytes.len() as u64,
        dir: false,
    })
}

/// A book file's bytes: a picture to show in the chat, or to send with a message.
#[tauri::command]
pub async fn fs_read_bytes(state: Win, path: String) -> CmdResult<Response> {
    let target = resolve(&state.root()?, &path)?;
    if fs::metadata(&target)?.len() > MAX_READ {
        return Err(CmdError::Invalid(format!(
            "{path} is larger than {} MB",
            MAX_READ / 1024 / 1024
        )));
    }
    Ok(Response::new(fs::read(&target)?))
}

fn attach_path(root: &Path, path: &Path) -> CmdResult<Attached> {
    let real = path
        .canonicalize()
        .map_err(|_| CmdError::NotFound(format!("{} doesn't exist", path.display())))?;
    let meta = fs::metadata(&real)?;
    let name = real
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    // Already in the book (a figure, a chapter, an earlier attachment): the assistant reads it there.
    if let Ok(rel) = real.strip_prefix(root)
        && !rel.as_os_str().is_empty()
    {
        return Ok(Attached {
            path: rel.to_string_lossy().replace('\\', "/"),
            name,
            size: if meta.is_dir() { 0 } else { meta.len() },
            dir: meta.is_dir(),
        });
    }
    if meta.is_dir() {
        return Err(CmdError::Invalid(format!(
            "{name} is a folder: attach the files in it instead"
        )));
    }
    if meta.len() > MAX_ATTACH {
        return Err(too_big(&name));
    }
    let (rel, mut file) = create_in(root, &name)?;
    io::copy(&mut fs::File::open(&real)?, &mut file)?;
    Ok(Attached {
        name: base_name(&rel),
        path: rel,
        size: meta.len(),
        dir: false,
    })
}

fn too_big(name: &str) -> CmdError {
    CmdError::Invalid(format!(
        "{} is larger than {} MB",
        if name.is_empty() { "the file" } else { name },
        MAX_ATTACH / 1024 / 1024
    ))
}

fn base_name(rel: &str) -> String {
    rel.rsplit('/').next().unwrap_or(rel).to_string()
}

/// A new file for `name` in the attachments folder (made, with its
/// `.gitignore`, the first time): its book-relative path, open for writing.
fn create_in(root: &Path, name: &str) -> CmdResult<(String, fs::File)> {
    let dir = resolve(root, DIR)?;
    fs::create_dir_all(&dir)?;
    let ignore = dir.join(".gitignore");
    if !ignore.exists() {
        // Everything in the folder, this file too: none of it is the book's.
        fs::write(
            &ignore,
            "# Files attached to the assistant's chat (Foreword); not part of the book.\n*\n",
        )?;
    }
    let name = safe_name(name);
    let (stem, ext) = match name.rfind('.') {
        Some(i) if i > 0 => (&name[..i], &name[i..]),
        _ => (name.as_str(), ""),
    };
    for n in 1..10_000 {
        let candidate = if n == 1 {
            name.clone()
        } else {
            format!("{stem} {n}{ext}")
        };
        let rel = format!("{DIR}/{candidate}");
        let path: PathBuf = resolve(root, &rel)?;
        match fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
        {
            Ok(file) => return Ok((rel, file)),
            Err(e) if e.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(e.into()),
        }
    }
    Err(CmdError::Conflict(format!("too many attachments named {name}")))
}

/// A file name that's safe to make: no folders, no hidden or control
/// characters, at most 120 characters (its extension kept).
fn safe_name(name: &str) -> String {
    let base = name.rsplit(['/', '\\']).next().unwrap_or("");
    let cleaned: String = base
        .chars()
        .map(|c| if c.is_control() || c == ':' { '-' } else { c })
        .collect();
    let cleaned = cleaned.trim().trim_start_matches('.').trim();
    if cleaned.is_empty() {
        return "attachment".into();
    }
    if cleaned.chars().count() <= 120 {
        return cleaned.to_string();
    }
    let ext = cleaned
        .rfind('.')
        .map(|i| &cleaned[i..])
        .filter(|e| e.chars().count() <= 10)
        .unwrap_or("");
    let keep = 120 - ext.chars().count();
    format!("{}{ext}", cleaned.chars().take(keep).collect::<String>())
}

/// `encodeURIComponent` undone (a header carries only ASCII).
fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%'
            && i + 2 < b.len()
            && let Ok(hex) = std::str::from_utf8(&b[i + 1..i + 3])
            && let Ok(v) = u8::from_str_radix(hex, 16)
        {
            out.push(v);
            i += 3;
        } else {
            out.push(b[i]);
            i += 1;
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn book() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("foreword-attach-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(dir.join("figures")).unwrap();
        // Canonical (/var is /private/var), as a book's root is.
        dir.canonicalize().unwrap()
    }

    #[test]
    fn names_are_made_safe() {
        assert_eq!(safe_name("photo.png"), "photo.png");
        assert_eq!(safe_name("../../etc/passwd"), "passwd");
        assert_eq!(safe_name(".hidden"), "hidden");
        assert_eq!(safe_name("a:b\u{7}.pdf"), "a-b-.pdf");
        assert_eq!(safe_name("  "), "attachment");
        let long = format!("{}.pdf", "x".repeat(200));
        assert_eq!(safe_name(&long).chars().count(), 120);
        assert!(safe_name(&long).ends_with(".pdf"));
    }

    #[test]
    fn percent_decodes_utf8() {
        assert_eq!(percent_decode("Caf%C3%A9%20menu.pdf"), "Café menu.pdf");
        assert_eq!(percent_decode("100%"), "100%");
        assert_eq!(percent_decode("a%2"), "a%2");
    }

    #[test]
    fn copies_in_with_new_names_and_ignores_the_folder() {
        let root = book();
        let (first, _) = create_in(&root, "shot.png").unwrap();
        let (second, _) = create_in(&root, "shot.png").unwrap();
        let (bare, _) = create_in(&root, "README").unwrap();
        assert_eq!(first, ".foreword/attachments/shot.png");
        assert_eq!(second, ".foreword/attachments/shot 2.png");
        assert_eq!(bare, ".foreword/attachments/README");
        let ignore = fs::read_to_string(root.join(DIR).join(".gitignore")).unwrap();
        assert!(ignore.lines().any(|l| l == "*"));
        // The book's file list leaves them out.
        assert!(
            crate::workspace::list_files(&root)
                .iter()
                .all(|f| !f.starts_with(DIR))
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_file_in_the_book_is_used_where_it_is() {
        let root = book();
        fs::write(root.join("figures/map.png"), b"png").unwrap();
        let outside =
            std::env::temp_dir().join(format!("foreword-outside-{}.pdf", uuid::Uuid::new_v4()));
        fs::write(&outside, b"%PDF").unwrap();

        let here = attach_path(&root, &root.join("figures/map.png")).unwrap();
        assert_eq!(
            here,
            Attached {
                path: "figures/map.png".into(),
                name: "map.png".into(),
                size: 3,
                dir: false
            }
        );
        let folder = attach_path(&root, &root.join("figures")).unwrap();
        assert!(folder.dir);

        let copied = attach_path(&root, &outside).unwrap();
        assert!(copied.path.starts_with(".foreword/attachments/foreword-outside-"));
        assert_eq!(fs::read(root.join(&copied.path)).unwrap(), b"%PDF");
        assert!(
            attach_path(&root, &std::env::temp_dir()).is_err(),
            "a folder outside the book isn't copied"
        );

        fs::remove_file(outside).unwrap();
        fs::remove_dir_all(root).unwrap();
    }
}
