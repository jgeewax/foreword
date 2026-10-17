//! Workspace file service: path containment, listing, UTF-8 read, atomic
//! conflict-checked writes, and a filesystem watcher.
use std::{
    fs,
    io::Write,
    path::{Component, Path, PathBuf},
};

use notify::{EventKind, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{State, ipc::Channel};

use crate::{
    AppState,
    error::{CmdError, CmdResult},
};

const MAX_TEXT_BYTES: u64 = 16 * 1024 * 1024;

pub fn hash_bytes(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

/// Resolve a workspace-relative path. Rejects absolute paths, `..`, and paths
/// whose nearest existing ancestor resolves (through symlinks) outside `root`.
/// `root` must already be canonical.
pub fn resolve(root: &Path, rel: &str) -> CmdResult<PathBuf> {
    let rel_path = Path::new(rel);
    if rel.is_empty() || rel_path.is_absolute() {
        return Err(CmdError::Invalid(format!(
            "not a workspace-relative path: {rel:?}"
        )));
    }
    let mut out = root.to_path_buf();
    for c in rel_path.components() {
        match c {
            Component::Normal(part) => out.push(part),
            Component::CurDir => {}
            _ => {
                return Err(CmdError::Invalid(format!(
                    "path escapes the workspace: {rel:?}"
                )));
            }
        }
    }
    let mut probe = out.as_path();
    loop {
        if fs::symlink_metadata(probe).is_ok() {
            let canonical = probe.canonicalize()?;
            if !canonical.starts_with(root) {
                return Err(CmdError::Invalid(format!(
                    "path resolves outside the workspace: {rel:?}"
                )));
            }
            break;
        }
        match probe.parent() {
            Some(parent) => probe = parent,
            None => break,
        }
    }
    Ok(out)
}

fn to_rel(root: &Path, path: &Path) -> Option<String> {
    path.strip_prefix(root)
        .ok()
        .map(|p| p.to_string_lossy().replace('\\', "/"))
}

fn is_internal(rel: &str) -> bool {
    rel == ".git"
        || rel.starts_with(".git/")
        || rel.starts_with("node_modules/")
        || rel.ends_with(".DS_Store")
        || rel.ends_with(".typst-studio.tmp")
}

/// Files under `root`, honouring .gitignore, sorted by path.
pub fn list_files(root: &Path) -> Vec<String> {
    let walker = ignore::WalkBuilder::new(root)
        .hidden(false)
        .git_global(false)
        .require_git(false)
        .filter_entry(|e| !matches!(e.file_name().to_str(), Some(".git" | "node_modules")))
        .build();
    let mut files: Vec<String> = walker
        .flatten()
        .filter(|e| e.file_type().is_some_and(|t| t.is_file()))
        .filter_map(|e| to_rel(root, e.path()))
        .filter(|r| !is_internal(r))
        .collect();
    files.sort();
    files
}

#[derive(Serialize)]
pub struct FileContent {
    pub text: String,
    pub hash: String,
}

pub fn read_text(path: &Path) -> CmdResult<FileContent> {
    let meta = fs::metadata(path)?;
    if meta.len() > MAX_TEXT_BYTES {
        return Err(CmdError::Invalid(format!(
            "file is larger than {} MB",
            MAX_TEXT_BYTES / 1024 / 1024
        )));
    }
    let bytes = fs::read(path)?;
    let hash = hash_bytes(&bytes);
    let text = String::from_utf8(bytes).map_err(|_| {
        CmdError::Invalid("not UTF-8 text; binary files can't be opened in the editor".into())
    })?;
    Ok(FileContent { text, hash })
}

/// Atomically replace `path` with `text`, but only if the file on disk still
/// has `expected_hash` (`None` = the file must not exist yet). Returns the new hash.
pub fn write_text(path: &Path, text: &str, expected_hash: Option<&str>) -> CmdResult<String> {
    let current = match fs::read(path) {
        Ok(bytes) => Some(hash_bytes(&bytes)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(e) => return Err(e.into()),
    };
    match (expected_hash, current.as_deref()) {
        (Some(exp), Some(cur)) if exp != cur => {
            return Err(CmdError::Conflict(
                "the file changed on disk since it was opened".into(),
            ));
        }
        (Some(_), None) => return Err(CmdError::Conflict("the file was deleted on disk".into())),
        (None, Some(_)) => {
            return Err(CmdError::Conflict(
                "a file with this name already exists".into(),
            ));
        }
        _ => {}
    }
    let dir = path
        .parent()
        .ok_or_else(|| CmdError::Invalid("no parent directory".into()))?;
    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("file");
    let tmp = dir.join(format!(
        ".{name}.{}.typst-studio.tmp",
        uuid::Uuid::new_v4().simple()
    ));
    let result = (|| -> std::io::Result<()> {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(text.as_bytes())?;
        f.sync_all()?;
        if let Ok(meta) = fs::metadata(path) {
            fs::set_permissions(&tmp, meta.permissions())?;
        }
        fs::rename(&tmp, path)
    })();
    if let Err(e) = result {
        let _ = fs::remove_file(&tmp);
        return Err(e.into());
    }
    Ok(hash_bytes(text.as_bytes()))
}

// ---- commands -------------------------------------------------------------

#[derive(Deserialize, Default)]
struct StudioSettings {
    #[serde(rename = "entryPoint")]
    entry_point: Option<String>,
}

#[derive(Serialize)]
pub struct WorkspaceInfo {
    root: String,
    name: String,
    entry: Option<String>,
    files: Vec<String>,
}

fn find_entry(root: &Path, files: &[String]) -> Option<String> {
    let configured = fs::read_to_string(root.join(".typst-studio.json"))
        .ok()
        .and_then(|s| serde_json::from_str::<StudioSettings>(&s).ok())
        .and_then(|s| s.entry_point);
    configured
        .filter(|e| files.contains(e))
        .or_else(|| files.iter().find(|f| *f == "main.typ").cloned())
        .or_else(|| files.iter().find(|f| f.ends_with(".typ")).cloned())
}

/// Open a folder as the workspace and start watching it. File-change batches
/// (workspace-relative paths) are delivered on `on_change`.
#[tauri::command]
pub async fn workspace_open(
    state: State<'_, AppState>,
    path: String,
    on_change: Channel<Vec<String>>,
) -> CmdResult<WorkspaceInfo> {
    let root = PathBuf::from(&path).canonicalize()?;
    if !root.is_dir() {
        return Err(CmdError::Invalid(format!("not a folder: {path}")));
    }
    let files = list_files(&root);
    let entry = find_entry(&root, &files);

    let watch_root = root.clone();
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        let Ok(event) = res else { return };
        if matches!(event.kind, EventKind::Access(_)) {
            return;
        }
        let paths: Vec<String> = event
            .paths
            .iter()
            .filter_map(|p| to_rel(&watch_root, p))
            .filter(|r| !r.is_empty() && !is_internal(r))
            .collect();
        if !paths.is_empty() {
            let _ = on_change.send(paths);
        }
    })
    .map_err(|e| CmdError::Io(e.to_string()))?;
    watcher
        .watch(&root, RecursiveMode::Recursive)
        .map_err(|e| CmdError::Io(e.to_string()))?;

    *state.watcher.lock().unwrap() = Some(watcher);
    *state.root.lock().unwrap() = Some(root.clone());
    Ok(WorkspaceInfo {
        name: root
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default(),
        root: root.to_string_lossy().into_owned(),
        entry,
        files,
    })
}

#[tauri::command]
pub async fn workspace_list(state: State<'_, AppState>) -> CmdResult<Vec<String>> {
    Ok(list_files(&state.root()?))
}

#[tauri::command]
pub async fn fs_read(state: State<'_, AppState>, path: String) -> CmdResult<FileContent> {
    read_text(&resolve(&state.root()?, &path)?)
}

/// Hash of the file on disk, or null if it doesn't exist.
#[tauri::command]
pub async fn fs_hash(state: State<'_, AppState>, path: String) -> CmdResult<Option<String>> {
    match fs::read(resolve(&state.root()?, &path)?) {
        Ok(bytes) => Ok(Some(hash_bytes(&bytes))),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.into()),
    }
}

#[tauri::command]
pub async fn fs_write(
    state: State<'_, AppState>,
    path: String,
    text: String,
    expected_hash: Option<String>,
) -> CmdResult<String> {
    write_text(
        &resolve(&state.root()?, &path)?,
        &text,
        expected_hash.as_deref(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root() -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "typst-studio-test-{}",
            uuid::Uuid::new_v4().simple()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir.canonicalize().unwrap()
    }

    #[test]
    fn resolve_accepts_nested_relative_paths() {
        let root = temp_root();
        assert_eq!(
            resolve(&root, "chapters/ch1.typ").unwrap(),
            root.join("chapters/ch1.typ")
        );
        assert_eq!(resolve(&root, "./main.typ").unwrap(), root.join("main.typ"));
    }

    #[test]
    fn resolve_rejects_escapes() {
        let root = temp_root();
        for bad in ["", "/etc/passwd", "../x", "a/../../x", "a/../b"] {
            assert!(
                matches!(resolve(&root, bad), Err(CmdError::Invalid(_))),
                "{bad} should be rejected"
            );
        }
    }

    #[test]
    fn resolve_rejects_symlink_out_of_workspace() {
        let root = temp_root();
        let outside = temp_root();
        std::os::unix::fs::symlink(&outside, root.join("link")).unwrap();
        assert!(matches!(
            resolve(&root, "link/secret.txt"),
            Err(CmdError::Invalid(_))
        ));
    }

    #[test]
    fn write_is_conflict_checked_and_round_trips() {
        let root = temp_root();
        let p = root.join("a.typ");
        let h1 = write_text(&p, "one\r\nline two\n", None).unwrap();
        let read = read_text(&p).unwrap();
        assert_eq!(read.text, "one\r\nline two\n", "line endings preserved");
        assert_eq!(read.hash, h1);

        assert!(
            matches!(write_text(&p, "x", None), Err(CmdError::Conflict(_))),
            "won't clobber unknown file"
        );
        let h2 = write_text(&p, "two", Some(&h1)).unwrap();
        assert!(
            matches!(
                write_text(&p, "three", Some(&h1)),
                Err(CmdError::Conflict(_))
            ),
            "stale hash rejected"
        );
        assert_eq!(read_text(&p).unwrap().text, "two");
        write_text(&p, "three", Some(&h2)).unwrap();
        let leftovers: Vec<_> = fs::read_dir(&root)
            .unwrap()
            .flatten()
            .filter(|e| e.file_name().to_string_lossy().ends_with(".tmp"))
            .collect();
        assert!(leftovers.is_empty(), "no temp files left behind");
    }

    #[test]
    fn list_respects_gitignore_and_skips_git() {
        let root = temp_root();
        fs::create_dir_all(root.join(".git")).unwrap();
        fs::write(root.join(".git/HEAD"), "x").unwrap();
        fs::create_dir_all(root.join("dist")).unwrap();
        fs::write(root.join("dist/out.pdf"), "x").unwrap();
        fs::write(root.join(".gitignore"), "dist/\n").unwrap();
        fs::write(root.join("main.typ"), "x").unwrap();
        assert_eq!(
            list_files(&root),
            vec![".gitignore".to_string(), "main.typ".to_string()]
        );
    }

    #[test]
    fn entry_point_prefers_settings_then_main() {
        let root = temp_root();
        let files = vec!["book.typ".to_string(), "main.typ".to_string()];
        assert_eq!(find_entry(&root, &files).as_deref(), Some("main.typ"));
        fs::write(
            root.join(".typst-studio.json"),
            r#"{"entryPoint":"book.typ"}"#,
        )
        .unwrap();
        assert_eq!(find_entry(&root, &files).as_deref(), Some("book.typ"));
    }
}
