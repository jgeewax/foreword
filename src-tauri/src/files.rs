//! File management in the workspace: new folder, rename/move, duplicate and
//! Move to Trash. Every path is workspace-relative and checked by
//! `workspace::resolve`; nothing is ever overwritten, and deleting goes to the
//! macOS Trash (recoverable), never `remove_file`.
use std::{fs, path::Path};

use tauri::State;

use crate::{
    AppState,
    error::{CmdError, CmdResult},
    workspace::resolve,
};

fn not_root(rel: &str) -> CmdResult<()> {
    if rel.trim_matches('/').is_empty() || rel == "." {
        return Err(CmdError::Invalid("that's the book folder itself".into()));
    }
    Ok(())
}

fn ensure_absent(path: &Path, rel: &str) -> CmdResult<()> {
    if fs::symlink_metadata(path).is_ok() {
        return Err(CmdError::Conflict(format!("{rel} already exists")));
    }
    Ok(())
}

#[tauri::command]
pub async fn fs_mkdir(state: State<'_, AppState>, path: String) -> CmdResult<()> {
    not_root(&path)?;
    let target = resolve(&state.root()?, &path)?;
    ensure_absent(&target, &path)?;
    fs::create_dir_all(&target)?;
    Ok(())
}

/// Rename or move a file or folder; refuses if the destination exists.
#[tauri::command]
pub async fn fs_rename(state: State<'_, AppState>, from: String, to: String) -> CmdResult<()> {
    not_root(&from)?;
    not_root(&to)?;
    let root = state.root()?;
    let src = resolve(&root, &from)?;
    let dst = resolve(&root, &to)?;
    if fs::symlink_metadata(&src).is_err() {
        return Err(CmdError::NotFound(format!("{from} doesn't exist")));
    }
    if dst.starts_with(&src) && dst != src {
        return Err(CmdError::Invalid("can't move a folder into itself".into()));
    }
    // Case-only renames on a case-insensitive disk: the "destination" is the source itself.
    let same_file = dst.exists() && src.canonicalize()? == dst.canonicalize()?;
    if !same_file {
        ensure_absent(&dst, &to)?;
    }
    if let Some(dir) = dst.parent() {
        fs::create_dir_all(dir)?;
    }
    fs::rename(&src, &dst)?;
    Ok(())
}

/// Copy a file (not a folder) to a new name.
#[tauri::command]
pub async fn fs_copy(state: State<'_, AppState>, from: String, to: String) -> CmdResult<()> {
    let root = state.root()?;
    let src = resolve(&root, &from)?;
    let dst = resolve(&root, &to)?;
    if !src.is_file() {
        return Err(CmdError::Invalid(format!("{from} isn't a file")));
    }
    ensure_absent(&dst, &to)?;
    let bytes = fs::read(&src)?;
    use std::io::Write;
    fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&dst)?
        .write_all(&bytes)?;
    Ok(())
}

/// Move a file or folder to the Trash (it can be put back from Finder).
#[tauri::command]
pub async fn fs_trash(state: State<'_, AppState>, path: String) -> CmdResult<()> {
    not_root(&path)?;
    let target = resolve(&state.root()?, &path)?;
    if fs::symlink_metadata(&target).is_err() {
        return Err(CmdError::NotFound(format!("{path} doesn't exist")));
    }
    trash(&target)
}

#[cfg(target_os = "macos")]
fn trash(path: &Path) -> CmdResult<()> {
    use objc2_foundation::{NSFileManager, NSString, NSURL};
    let url = NSURL::fileURLWithPath(&NSString::from_str(&path.to_string_lossy()));
    NSFileManager::defaultManager()
        .trashItemAtURL_resultingItemURL_error(&url, None)
        .map_err(|e| {
            CmdError::Io(format!(
                "couldn't move it to the Trash: {}",
                e.localizedDescription()
            ))
        })
}

#[cfg(not(target_os = "macos"))]
fn trash(_path: &Path) -> CmdResult<()> {
    Err(CmdError::Unavailable(
        "Move to Trash is only implemented on macOS".into(),
    ))
}
