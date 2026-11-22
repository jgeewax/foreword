//! Each task's chat, as Foreword keeps it. A task can go from one assistant
//! to another (as a chat goes from one model to another), and each assistant
//! keeps only its own conversation, so the chat the author sees is kept here:
//! in the app's data folder, per book, whichever assistant runs.

use std::{
    fs,
    path::{Path, PathBuf},
};

use sha2::{Digest, Sha256};
use tauri::Manager;

use crate::{Win, book_state::write_durably, error::CmdResult};

/// A task's file: in its book's folder, named for a hash of its id (an
/// assistant's session id, whatever characters that has).
fn chat_file(data: &Path, root: &Path, id: &str) -> PathBuf {
    let book = hex::encode(Sha256::digest(root.to_string_lossy().as_bytes()));
    let task = hex::encode(Sha256::digest(id.as_bytes()));
    data.join("tasks")
        .join(&book[..16])
        .join(format!("{}.json", &task[..32]))
}

fn chat_path(app: &tauri::AppHandle, state: &Win, id: &str) -> CmdResult<PathBuf> {
    Ok(chat_file(&app.path().app_data_dir()?, &state.root()?, id))
}

/// The task's chat as last kept (JSON, the app's own), or null if none is.
#[tauri::command]
pub async fn task_chat_read(
    app: tauri::AppHandle,
    state: Win,
    id: String,
) -> CmdResult<Option<String>> {
    match fs::read_to_string(chat_path(&app, &state, &id)?) {
        Ok(text) => Ok(Some(text)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.into()),
    }
}

/// Written whole, through a file of its own beside it, and flushed to the disk
/// before it replaces the last (book_state.rs), so a crash, a force quit or
/// the Mac going down never leaves half a chat, or none.
#[tauri::command]
pub async fn task_chat_write(
    app: tauri::AppHandle,
    state: Win,
    id: String,
    text: String,
) -> CmdResult<()> {
    let path = chat_path(&app, &state, &id)?;
    Ok(write_durably(&path, text.as_bytes())?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn each_book_and_task_has_its_own_file() {
        let data = Path::new("/data");
        let a = chat_file(data, Path::new("/books/a"), "ses_1");
        assert_eq!(a, chat_file(data, Path::new("/books/a"), "ses_1"));
        assert_ne!(a, chat_file(data, Path::new("/books/a"), "ses_2"));
        assert_ne!(a.parent(), chat_file(data, Path::new("/books/b"), "ses_1").parent());
        // Whatever the id holds, the name is a plain one.
        let odd = chat_file(data, Path::new("/books/a"), "../../etc/passwd");
        assert!(odd.starts_with("/data/tasks/"));
        assert!(odd.file_name().unwrap().to_str().unwrap().ends_with(".json"));
    }
}
