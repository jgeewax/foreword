//! What Foreword keeps of a book on this Mac, besides its chats (tasks.rs):
//! the window as the author left it (tabs, where the cursor and the preview
//! were, the task shown), the list of tasks, and the unsaved text of open
//! files. Kept in the app's data folder, per book, so quitting, a crash, a
//! force quit or the Mac going down and opening the book again is the same as
//! never having closed it.
//!
//! Each file is written whole and flushed to the disk before it takes the
//! old one's place (`write_durably`): after any of those, there's either the
//! old copy or the new one, never half of one or none.

use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};

use sha2::{Digest, Sha256};
use tauri::Manager;

use crate::{
    Win,
    error::{CmdError, CmdResult},
};

/// Write `bytes` to `path` through a file of its own beside it, flushed to the
/// disk itself (F_FULLFSYNC on macOS) before the rename, and the folder after.
pub fn write_durably(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    static NEXT: AtomicU64 = AtomicU64::new(0);
    let dir = path
        .parent()
        .ok_or_else(|| std::io::Error::other("no parent folder"))?;
    fs::create_dir_all(dir)?;
    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("file");
    let tmp = dir.join(format!(
        ".{name}.{}-{}.tmp",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    ));
    let result = (|| {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
        fs::rename(&tmp, path)?;
        // The rename is the folder's: flushed too (not every file system lets a folder be).
        if let Ok(d) = fs::File::open(dir) {
            let _ = d.sync_all();
        }
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result
}

/// The book's folder: named for a hash of its path, as its chats' (tasks.rs).
fn book_dir(data: &Path, root: &Path) -> PathBuf {
    let book = hex::encode(Sha256::digest(root.to_string_lossy().as_bytes()));
    data.join("books").join(&book[..16])
}

/// A file's name in it: `session.json`, or in one folder of it (`unsaved/1a2b.json`).
fn checked(name: &str) -> CmdResult<&str> {
    let part = |p: &str| {
        !p.is_empty()
            && !p.starts_with('.')
            && p.chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
    };
    let parts: Vec<&str> = name.split('/').collect();
    if parts.len() <= 2 && parts.iter().all(|p| part(p)) && name.ends_with(".json") {
        Ok(name)
    } else {
        Err(CmdError::Invalid(format!(
            "not a name for the book's state: {name:?}"
        )))
    }
}

/// The path of `name` for the book at `root`, which must be the window's: a
/// write that comes late, after the window went to another book, isn't kept as
/// that book's.
fn state_path(app: &tauri::AppHandle, state: &Win, root: &str, name: &str) -> CmdResult<PathBuf> {
    let open = state.root()?;
    if Path::new(root) != open {
        return Err(CmdError::Invalid(format!(
            "{root} isn't the book open in this window"
        )));
    }
    Ok(book_dir(&app.path().app_data_dir()?, &open).join(checked(name)?))
}

/// A file of the book's state as last kept, or null if there's none.
#[tauri::command]
pub async fn book_state_read(
    app: tauri::AppHandle,
    state: Win,
    root: String,
    name: String,
) -> CmdResult<Option<String>> {
    match fs::read_to_string(state_path(&app, &state, &root, &name)?) {
        Ok(text) => Ok(Some(text)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.into()),
    }
}

#[tauri::command]
pub async fn book_state_write(
    app: tauri::AppHandle,
    state: Win,
    root: String,
    name: String,
    text: String,
) -> CmdResult<()> {
    Ok(write_durably(
        &state_path(&app, &state, &root, &name)?,
        text.as_bytes(),
    )?)
}

#[tauri::command]
pub async fn book_state_remove(
    app: tauri::AppHandle,
    state: Win,
    root: String,
    name: String,
) -> CmdResult<()> {
    match fs::remove_file(state_path(&app, &state, &root, &name)?) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.into()),
        _ => Ok(()),
    }
}

/// Every file in one of the book's folders (`unsaved`), as text.
#[tauri::command]
pub async fn book_state_list(
    app: tauri::AppHandle,
    state: Win,
    root: String,
    folder: String,
) -> CmdResult<Vec<String>> {
    let dir = state_path(&app, &state, &root, &format!("{folder}/x.json"))?
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_default();
    Ok(read_folder(&dir))
}

fn read_folder(dir: &Path) -> Vec<String> {
    let Ok(entries) = fs::read_dir(dir) else {
        return vec![];
    };
    let mut files: Vec<PathBuf> = entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| {
            let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("");
            !name.starts_with('.') && name.ends_with(".json")
        })
        .collect();
    files.sort();
    files
        .iter()
        .filter_map(|p| fs::read_to_string(p).ok())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_stay_in_the_books_folder() {
        assert!(checked("session.json").is_ok());
        assert!(checked("unsaved/0a1b2c.json").is_ok());
        for bad in [
            "../x.json",
            "a/b/c.json",
            "/etc/x.json",
            ".hidden.json",
            "x.txt",
            "unsaved/",
            "",
            "a//b.json",
        ] {
            assert!(checked(bad).is_err(), "{bad:?} was let through");
        }
        let data = Path::new("/data");
        assert_ne!(
            book_dir(data, Path::new("/books/a")),
            book_dir(data, Path::new("/books/b"))
        );
        assert!(book_dir(data, Path::new("/books/a")).starts_with("/data/books/"));
    }

    #[test]
    fn written_whole_and_listed() {
        let dir = std::env::temp_dir().join(format!("foreword-book-state-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        let file = dir.join("unsaved").join("a.json");
        write_durably(&file, b"{\"one\":1}").unwrap();
        write_durably(&file, b"{\"two\":2}").unwrap();
        write_durably(&dir.join("unsaved").join("b.json"), b"{}").unwrap();
        assert_eq!(fs::read_to_string(&file).unwrap(), "{\"two\":2}");
        // Nothing of the writes is left beside them.
        let names: Vec<String> = fs::read_dir(dir.join("unsaved"))
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(names.len(), 2, "{names:?}");
        // A write cut off before its rename (a crash) leaves a file that isn't listed.
        fs::write(dir.join("unsaved").join(".c.json.1-1.tmp"), "{\"half").unwrap();
        assert_eq!(
            read_folder(&dir.join("unsaved")),
            vec!["{\"two\":2}".to_string(), "{}".to_string()]
        );
        assert!(read_folder(&dir.join("missing")).is_empty());
        let _ = fs::remove_dir_all(&dir);
    }
}
