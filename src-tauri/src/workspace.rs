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
use tauri::{Manager, ipc::Channel};

use crate::{
    Win,
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
    /// The Typst root ("src" for a book kept in src/), relative to the folder.
    root: Option<String>,
}

#[derive(Serialize)]
pub struct WorkspaceInfo {
    root: String,
    name: String,
    entry: Option<String>,
    files: Vec<String>,
}

/// The main file: the configured one; else `main.typ` in the configured root;
/// else the shallowest `main.typ` (a book kept in src/ of a larger folder);
/// else the shallowest .typ file.
fn find_entry(root: &Path, files: &[String]) -> Option<String> {
    let settings = fs::read_to_string(root.join(".typst-studio.json"))
        .ok()
        .and_then(|s| serde_json::from_str::<StudioSettings>(&s).ok())
        .unwrap_or_default();
    let typst_root = settings
        .root
        .map(|r| {
            r.trim()
                .trim_start_matches("./")
                .trim_end_matches('/')
                .to_string()
        })
        .filter(|r| !r.is_empty() && r != ".");
    let depth = |f: &&String| f.matches('/').count();
    settings
        .entry_point
        .filter(|e| files.contains(e))
        .or_else(|| {
            typst_root
                .map(|r| format!("{r}/main.typ"))
                .filter(|m| files.contains(m))
        })
        .or_else(|| {
            files
                .iter()
                .filter(|f| *f == "main.typ" || f.ends_with("/main.typ"))
                .min_by_key(depth)
                .cloned()
        })
        .or_else(|| {
            files
                .iter()
                .filter(|f| f.ends_with(".typ"))
                .min_by_key(depth)
                .cloned()
        })
}

/// Whether another window has this book open; if so, that window comes to the front.
fn open_elsewhere(app: &tauri::AppHandle, state: &Win, root: &Path) -> bool {
    for (label, other) in app.state::<crate::AppState>().all() {
        if label != state.label() && other.root.lock().unwrap().as_deref() == Some(root) {
            if let Some(w) = app.get_window(&label) {
                let _ = w.set_focus();
            }
            return true;
        }
    }
    false
}

/// Checked before a window lets go of its own book to open `path`.
#[tauri::command]
pub async fn workspace_elsewhere(
    app: tauri::AppHandle,
    state: Win,
    path: String,
) -> CmdResult<bool> {
    let root = PathBuf::from(&path).canonicalize()?;
    Ok(open_elsewhere(&app, &state, &root))
}

/// Open a folder as the workspace and start watching it. File-change batches
/// (workspace-relative paths) are delivered on `on_change`.
#[tauri::command]
pub async fn workspace_open(
    app: tauri::AppHandle,
    state: Win,
    path: String,
    on_change: Channel<Vec<String>>,
) -> CmdResult<WorkspaceInfo> {
    let root = PathBuf::from(&path).canonicalize()?;
    if !root.is_dir() {
        return Err(CmdError::Invalid(format!("not a folder: {path}")));
    }
    // One window per book: two would fight over its files, History and helpers.
    if open_elsewhere(&app, &state, &root) {
        return Err(CmdError::Invalid(
            "This book is open in another window.".into(),
        ));
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
    // The window's title is its book, so Window ▸ tells windows apart.
    if let (Some(w), Some(name)) = (app.get_window(state.label()), root.file_name()) {
        let _ = w.set_title(&name.to_string_lossy());
    }
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
pub async fn workspace_list(state: Win) -> CmdResult<Vec<String>> {
    Ok(list_files(&state.root()?))
}

#[tauri::command]
pub async fn fs_read(state: Win, path: String) -> CmdResult<FileContent> {
    read_text(&resolve(&state.root()?, &path)?)
}

/// Hash of the file on disk, or null if it doesn't exist.
#[tauri::command]
pub async fn fs_hash(state: Win, path: String) -> CmdResult<Option<String>> {
    match fs::read(resolve(&state.root()?, &path)?) {
        Ok(bytes) => Ok(Some(hash_bytes(&bytes))),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.into()),
    }
}

#[tauri::command]
pub async fn fs_write(
    state: Win,
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

/// Show a workspace file or folder in Finder.
#[tauri::command]
pub async fn reveal_in_finder(state: Win, path: String) -> CmdResult<()> {
    let root = state.root()?;
    let target = if path.is_empty() || path == "." {
        root
    } else {
        resolve(&root, &path)?
    };
    let status = std::process::Command::new("/usr/bin/open")
        .arg("-R")
        .arg(&target)
        .status()?;
    if !status.success() {
        return Err(CmdError::Io(format!(
            "couldn't reveal {}",
            target.display()
        )));
    }
    Ok(())
}

#[derive(Deserialize)]
pub struct NewFile {
    path: String,
    text: String,
}

/// (path, bytes) pairs for [`create_project_bytes`].
pub fn new_file_parts(files: Vec<NewFile>) -> Vec<(String, Vec<u8>)> {
    files
        .into_iter()
        .map(|f| (f.path, f.text.into_bytes()))
        .collect()
}

/// New book from a template: create `parent/name` and write `files` into it.
/// Only ever writes inside a folder it has just created (refuses an existing
/// one, never overwrites); on failure that new folder is removed again.
pub fn create_project(parent: &Path, name: &str, files: &[NewFile]) -> CmdResult<PathBuf> {
    let bytes: Vec<(String, Vec<u8>)> = files
        .iter()
        .map(|f| (f.path.clone(), f.text.clone().into_bytes()))
        .collect();
    create_project_bytes(parent, name, &bytes)
}

/// [`create_project`] with arbitrary (binary) file contents.
pub fn create_project_bytes(
    parent: &Path,
    name: &str,
    files: &[(String, Vec<u8>)],
) -> CmdResult<PathBuf> {
    if !parent.is_absolute() || !parent.is_dir() {
        return Err(CmdError::Invalid(format!(
            "not a folder: {}",
            parent.display()
        )));
    }
    let valid_name = !name.trim().is_empty()
        && name.len() <= 255
        && !name.starts_with('.')
        && !name.contains(['/', '\0', ':']);
    if !valid_name {
        return Err(CmdError::Invalid(format!(
            "not a usable folder name: {name:?}"
        )));
    }
    let root = parent.canonicalize()?.join(name);
    fs::create_dir(&root).map_err(|e| match e.kind() {
        std::io::ErrorKind::AlreadyExists => {
            CmdError::Conflict(format!("{name} already exists in that folder"))
        }
        _ => e.into(),
    })?;
    let written = (|| -> CmdResult<()> {
        for (rel_path, contents) in files {
            let rel = Path::new(rel_path);
            if rel_path.is_empty() || !rel.components().all(|c| matches!(c, Component::Normal(_))) {
                return Err(CmdError::Invalid(format!(
                    "bad template path: {rel_path:?}"
                )));
            }
            let path = root.join(rel);
            if let Some(dir) = path.parent() {
                fs::create_dir_all(dir)?;
            }
            fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&path)?
                .write_all(contents)?;
        }
        Ok(())
    })();
    if let Err(e) = written {
        let _ = fs::remove_dir_all(&root);
        return Err(e);
    }
    Ok(root)
}

/// The sample books that come with the app: the repo's samples/ folder in a
/// dev build, the app's resources in a bundled one.
fn samples_dir(app: &tauri::AppHandle) -> CmdResult<PathBuf> {
    let dir = if cfg!(debug_assertions) {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../samples")
    } else {
        app.path()
            .resource_dir()
            .map_err(|e| CmdError::Unavailable(e.to_string()))?
            .join("samples")
    };
    if dir.is_dir() {
        Ok(dir)
    } else {
        Err(CmdError::Unavailable(
            "the sample books aren't there".into(),
        ))
    }
}

/// Every regular file under `dir` (no links, no .DS_Store), as (relative path, bytes).
fn read_tree(dir: &Path, prefix: &str, out: &mut Vec<(String, Vec<u8>)>) -> CmdResult<()> {
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().into_owned();
        let rel = if prefix.is_empty() {
            name.clone()
        } else {
            format!("{prefix}/{name}")
        };
        let kind = entry.file_type()?;
        if kind.is_dir() {
            read_tree(&entry.path(), &rel, out)?;
        } else if kind.is_file() && name != ".DS_Store" {
            out.push((rel, fs::read(entry.path())?));
        }
    }
    Ok(())
}

/// A copy of sample book `id` in `parent/name` (folders made as needed), to
/// change as the author likes; if that copy exists already, it's kept as it is.
pub fn copy_sample(samples: &Path, id: &str, parent: &Path, name: &str) -> CmdResult<PathBuf> {
    if id.is_empty()
        || !id
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
    {
        return Err(CmdError::Invalid(format!("not a sample: {id:?}")));
    }
    let src = samples.join(id);
    if !src.is_dir() {
        return Err(CmdError::NotFound(format!("no sample called {id}")));
    }
    fs::create_dir_all(parent)?;
    let existing = parent.join(name);
    if existing.is_dir() && !name.is_empty() && !name.contains(['/', '\0']) {
        return Ok(existing.canonicalize()?);
    }
    let mut files = vec![];
    read_tree(&src, "", &mut files)?;
    create_project_bytes(parent, name, &files)
}

/// Open a sample book: a copy of it in `parent`, made the first time.
#[tauri::command]
pub async fn sample_create(
    app: tauri::AppHandle,
    id: String,
    parent: String,
    name: String,
) -> CmdResult<String> {
    if !Path::new(&parent).is_absolute() {
        return Err(CmdError::Invalid(format!("not a folder: {parent}")));
    }
    Ok(
        copy_sample(&samples_dir(&app)?, &id, Path::new(&parent), &name)?
            .to_string_lossy()
            .into_owned(),
    )
}

#[tauri::command]
pub async fn project_create(
    parent: String,
    name: String,
    files: Vec<NewFile>,
) -> CmdResult<String> {
    Ok(create_project(Path::new(&parent), &name, &files)?
        .to_string_lossy()
        .into_owned())
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

    fn file(path: &str, text: &str) -> NewFile {
        NewFile {
            path: path.into(),
            text: text.into(),
        }
    }

    #[test]
    fn create_project_writes_files_into_a_new_folder_only() {
        let parent = temp_root();
        let root = create_project(
            &parent,
            "My Novel",
            &[
                file("main.typ", "= Hi"),
                file("chapters/01.typ", "x"),
                file(".typst-studio.json", "{}"),
            ],
        )
        .unwrap();
        assert_eq!(root, parent.join("My Novel"));
        assert_eq!(
            fs::read_to_string(root.join("chapters/01.typ")).unwrap(),
            "x"
        );
        assert!(root.join(".typst-studio.json").exists());
        // Never into an existing folder.
        let again = create_project(&parent, "My Novel", &[file("main.typ", "other")]);
        assert!(matches!(again, Err(CmdError::Conflict(_))));
        assert_eq!(fs::read_to_string(root.join("main.typ")).unwrap(), "= Hi");
    }

    #[test]
    fn create_project_rejects_escapes_and_cleans_up() {
        let parent = temp_root();
        for bad in ["../evil.typ", "/etc/x", "a/../../b"] {
            let r = create_project(&parent, "Book", &[file("ok.typ", ""), file(bad, "x")]);
            assert!(matches!(r, Err(CmdError::Invalid(_))), "{bad}");
            assert!(!parent.join("Book").exists(), "{bad} left a folder behind");
        }
        assert!(!parent.join("evil.typ").exists());
        for name in ["", ".hidden", "a/b", "  "] {
            assert!(create_project(&parent, name, &[]).is_err(), "{name:?}");
        }
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
    fn samples_are_copied_once_with_their_pictures() {
        let samples = temp_root();
        fs::create_dir_all(samples.join("tale/illustrations")).unwrap();
        fs::write(samples.join("tale/main.typ"), "= Hello").unwrap();
        fs::write(
            samples.join("tale/illustrations/01.jpg"),
            [0xff, 0xd8, 0x00, 0x01],
        )
        .unwrap();
        fs::write(samples.join("tale/.DS_Store"), "x").unwrap();
        let parent = temp_root().join("Typst Studio Samples");
        let copy = copy_sample(&samples, "tale", &parent, "The Tale").unwrap();
        assert_eq!(
            fs::read(copy.join("illustrations/01.jpg")).unwrap(),
            [0xff, 0xd8, 0x00, 0x01]
        );
        assert!(!copy.join(".DS_Store").exists());
        // The second time, the author's copy is opened as it is.
        fs::write(copy.join("main.typ"), "= Changed").unwrap();
        assert_eq!(
            copy_sample(&samples, "tale", &parent, "The Tale").unwrap(),
            copy
        );
        assert_eq!(
            fs::read_to_string(copy.join("main.typ")).unwrap(),
            "= Changed"
        );
        assert!(copy_sample(&samples, "../tale", &parent, "X").is_err());
        assert!(copy_sample(&samples, "nope", &parent, "X").is_err());
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

    #[test]
    fn entry_point_finds_a_book_in_a_subfolder() {
        let root = temp_root();
        // No configuration: the shallowest main.typ, not the first .typ file.
        let files = vec![
            "docs/notes.typ".to_string(),
            "src/chapters/a.typ".to_string(),
            "src/main.typ".to_string(),
            "templates/x/main.typ".to_string(),
        ];
        assert_eq!(find_entry(&root, &files).as_deref(), Some("src/main.typ"));
        // A configured root picks its main.typ.
        fs::write(
            root.join(".typst-studio.json"),
            r#"{"root":"templates/x/"}"#,
        )
        .unwrap();
        assert_eq!(
            find_entry(&root, &files).as_deref(),
            Some("templates/x/main.typ")
        );
        // Without any main.typ, the shallowest .typ file.
        let others = vec!["b/c/deep.typ".to_string(), "a/top.typ".to_string()];
        fs::write(root.join(".typst-studio.json"), "{}").unwrap();
        assert_eq!(find_entry(&root, &others).as_deref(), Some("a/top.typ"));
    }
}
