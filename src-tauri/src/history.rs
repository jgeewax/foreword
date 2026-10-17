//! Book history: automatic snapshots of the workspace, stored in an app-owned
//! Git repository under the app data dir (one per workspace). The book folder
//! is only its work tree: the author's own `.git` is never read or written,
//! and nothing here writes to the work tree; restores go through the
//! frontend's conflict-checked file writes.
use std::{
    path::{Path, PathBuf},
    process::Output,
};

use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::{Manager, State};
use tokio::process::Command;

use crate::{
    AppState, discover,
    error::{CmdError, CmdResult},
    workspace,
};

const KIND_TRAILER: &str = "Studio-Kind";
/// In a snapshot label, replaced by the names of the files that changed.
const FILES_PLACEHOLDER: &str = "{files}";

/// Always excluded from snapshots (on top of the book's own .gitignore files).
const BASE_EXCLUDES: &[&str] = &[".DS_Store", "*.typst-studio.tmp"];

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Version {
    pub id: String,
    pub parent: Option<String>,
    /// Unix seconds.
    pub time: i64,
    pub label: String,
    /// `save`, `agent`, `before-agent`, `milestone`, `restore`, `opened`, …
    pub kind: String,
    pub files: u32,
    pub added: u32,
    pub deleted: u32,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FileChange {
    pub path: String,
    /// `A`dded, `M`odified or `D`eleted.
    pub status: String,
    /// Line counts; null for binary files.
    pub added: Option<u32>,
    pub deleted: Option<u32>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryInfo {
    pub git_dir: String,
    pub git: String,
}

fn git_bin() -> CmdResult<PathBuf> {
    discover::find("git", "TYPST_STUDIO_GIT")
        .ok_or_else(|| CmdError::Unavailable("git was not found; history is off".into()))
}

fn git_dir_for(app: &tauri::AppHandle, root: &Path) -> CmdResult<PathBuf> {
    let key = hex::encode(Sha256::digest(root.to_string_lossy().as_bytes()));
    Ok(app
        .path()
        .app_data_dir()?
        .join("history")
        .join(format!("{}.git", &key[..16])))
}

/// `git` against the history repo, isolated from the author's Git config,
/// hooks and environment.
async fn git(git_dir: &Path, root: &Path, args: &[&str]) -> CmdResult<Output> {
    let out = Command::new(git_bin()?)
        .arg("--git-dir")
        .arg(git_dir)
        .arg("--work-tree")
        .arg(root)
        .args([
            "-c",
            "core.hooksPath=/dev/null",
            "-c",
            "commit.gpgSign=false",
            "-c",
            "core.autocrlf=false",
            "-c",
            "core.quotePath=false",
            "-c",
            "user.name=Typst Studio",
            "-c",
            "user.email=history@typst-studio.invalid",
        ])
        .args(args)
        .current_dir(root)
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .env("PATH", discover::search_path())
        .env_remove("GIT_DIR")
        .env_remove("GIT_WORK_TREE")
        .env_remove("GIT_INDEX_FILE")
        .env_remove("GIT_OBJECT_DIRECTORY")
        .kill_on_drop(true)
        .output()
        .await
        .map_err(|e| CmdError::Unavailable(format!("couldn't run git: {e}")))?;
    Ok(out)
}

async fn git_ok(git_dir: &Path, root: &Path, args: &[&str]) -> CmdResult<String> {
    let out = git(git_dir, root, args).await?;
    if !out.status.success() {
        return Err(CmdError::Io(format!(
            "git {}: {}",
            args.first().unwrap_or(&""),
            String::from_utf8_lossy(&out.stderr).trim()
        )));
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

/// Commit ids only: never let a value from the frontend reach git as an option.
fn check_id(id: &str) -> CmdResult<&str> {
    if (4..=64).contains(&id.len()) && id.bytes().all(|b| b.is_ascii_hexdigit()) {
        Ok(id)
    } else {
        Err(CmdError::Invalid(format!("not a version id: {id}")))
    }
}

struct Repo {
    git_dir: PathBuf,
    root: PathBuf,
}

async fn repo(app: &tauri::AppHandle, state: &AppState) -> CmdResult<Repo> {
    let root = state.root()?;
    let git_dir = git_dir_for(app, &root)?;
    if !git_dir.join("HEAD").exists() {
        return Err(CmdError::Unavailable(
            "history isn't set up for this folder".into(),
        ));
    }
    Ok(Repo { git_dir, root })
}

/// Show the open book's history repo in Finder. It's in the app's data folder;
/// the path is worked out here, not taken from the page.
#[tauri::command]
pub async fn history_reveal(app: tauri::AppHandle, state: State<'_, AppState>) -> CmdResult<()> {
    let r = repo(&app, &state).await?;
    let status = std::process::Command::new("/usr/bin/open")
        .arg("-R")
        .arg(&r.git_dir)
        .status()?;
    if !status.success() {
        return Err(CmdError::Io(format!(
            "couldn't reveal {}",
            r.git_dir.display()
        )));
    }
    Ok(())
}

/// Create (or update) the history repo for the open workspace. `exclude` adds
/// patterns such as the PDF output folder.
#[tauri::command]
pub async fn history_init(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    exclude: Vec<String>,
) -> CmdResult<HistoryInfo> {
    let _guard = state.history.lock().await;
    let root = state.root()?;
    let git_dir = git_dir_for(&app, &root)?;
    init(
        &Repo {
            git_dir: git_dir.clone(),
            root,
        },
        &exclude,
    )
    .await?;
    Ok(HistoryInfo {
        git_dir: git_dir.to_string_lossy().into_owned(),
        git: git_bin()?.to_string_lossy().into_owned(),
    })
}

async fn init(r: &Repo, exclude: &[String]) -> CmdResult<()> {
    if !r.git_dir.join("HEAD").exists() {
        std::fs::create_dir_all(&r.git_dir)?;
        git_ok(&r.git_dir, &r.root, &["init", "--quiet"]).await?;
    }
    let mut patterns: Vec<&str> = BASE_EXCLUDES.to_vec();
    patterns.extend(
        exclude
            .iter()
            .map(String::as_str)
            .filter(|p| !p.trim().is_empty() && !p.contains('\n')),
    );
    std::fs::create_dir_all(r.git_dir.join("info"))?;
    std::fs::write(r.git_dir.join("info/exclude"), patterns.join("\n") + "\n")?;
    // For people inspecting the app data dir.
    std::fs::write(
        r.git_dir.join("typst-studio-workspace"),
        r.root.to_string_lossy().as_bytes(),
    )?;
    Ok(())
}

/// Record the current state of the book. Returns null when nothing changed
/// since the last version (unless `allow_empty`, used for named versions).
#[tauri::command]
pub async fn history_snapshot(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    kind: String,
    label: String,
    allow_empty: bool,
) -> CmdResult<Option<Version>> {
    let _guard = state.history.lock().await;
    snapshot(&repo(&app, &state).await?, &kind, &label, allow_empty).await
}

async fn has_head(r: &Repo) -> CmdResult<bool> {
    Ok(git(
        &r.git_dir,
        &r.root,
        &["rev-parse", "--verify", "--quiet", "HEAD"],
    )
    .await?
    .status
    .success())
}

async fn snapshot(
    r: &Repo,
    kind: &str,
    label: &str,
    allow_empty: bool,
) -> CmdResult<Option<Version>> {
    git_ok(
        &r.git_dir,
        &r.root,
        &["add", "--all", "--ignore-errors", "."],
    )
    .await?;
    let changed = !has_head(r).await?
        || !git(&r.git_dir, &r.root, &["diff", "--cached", "--quiet"])
            .await?
            .status
            .success();
    if !changed && !allow_empty {
        return Ok(None);
    }
    let mut label = one_line(label);
    if label.contains(FILES_PLACEHOLDER) {
        let names = if has_head(r).await? {
            git_ok(
                &r.git_dir,
                &r.root,
                &["diff", "--cached", "--name-only", "-z", "--no-renames"],
            )
            .await?
        } else {
            git_ok(&r.git_dir, &r.root, &["ls-files", "-z"]).await?
        };
        label = label.replace(FILES_PLACEHOLDER, &describe_files(&names));
    }
    let trailer = format!("{KIND_TRAILER}: {}", one_line(kind));
    let mut args = vec![
        "commit",
        "--quiet",
        "--no-verify",
        "-m",
        &label,
        "-m",
        &trailer,
    ];
    if !changed {
        args.push("--allow-empty");
    }
    git_ok(&r.git_dir, &r.root, &args).await?;
    Ok(list(r, 1).await?.into_iter().next())
}

/// "ch1.typ", "ch1.typ and ch2.typ", "ch1.typ and 3 more files" from `-z` output.
fn describe_files(z: &str) -> String {
    let names: Vec<&str> = z
        .split('\0')
        .filter(|p| !p.is_empty())
        .map(|p| p.rsplit('/').next().unwrap_or(p))
        .collect();
    match names.as_slice() {
        [] => "nothing".into(),
        [one] => one.to_string(),
        [a, b] => format!("{a} and {b}"),
        [a, rest @ ..] => format!("{a} and {} more files", rest.len()),
    }
}

fn one_line(s: &str) -> String {
    let line = s.split_whitespace().collect::<Vec<_>>().join(" ");
    let mut out: String = line.chars().take(200).collect();
    if out.is_empty() {
        out = "Snapshot".into();
    }
    out
}

async fn list(r: &Repo, limit: u32) -> CmdResult<Vec<Version>> {
    list_for(r, limit, None).await
}

/// Versions, newest first; with `path`, only those that changed that file
/// (and their counts are for that file).
async fn list_for(r: &Repo, limit: u32, path: Option<&str>) -> CmdResult<Vec<Version>> {
    if !has_head(r).await? {
        return Ok(vec![]);
    }
    let n = format!("-n{limit}");
    let format = format!(
        "--format=%x1e%H%x1f%P%x1f%ct%x1f%s%x1f%(trailers:key={KIND_TRAILER},valueonly,separator=%x2C)"
    );
    let mut args = vec!["log", &n, &format, "--numstat", "--no-renames", "HEAD"];
    if let Some(p) = path {
        // A literal path, not a pattern.
        args.extend(["--", p]);
    }
    let out = git_ok(&r.git_dir, &r.root, &args).await?;
    Ok(parse_log(&out))
}

fn parse_log(out: &str) -> Vec<Version> {
    out.split('\x1e')
        .filter(|r| !r.trim().is_empty())
        .filter_map(|record| {
            let mut lines = record.lines();
            let header: Vec<&str> = lines.next()?.split('\x1f').collect();
            if header.len() < 5 {
                return None;
            }
            let (mut files, mut added, mut deleted) = (0, 0, 0);
            for l in lines.filter(|l| !l.trim().is_empty()) {
                let mut parts = l.splitn(3, '\t');
                let (a, d) = (parts.next()?, parts.next()?);
                files += 1;
                added += a.parse::<u32>().unwrap_or(0);
                deleted += d.parse::<u32>().unwrap_or(0);
            }
            Some(Version {
                id: header[0].to_string(),
                parent: header[1].split_whitespace().next().map(str::to_string),
                time: header[2].parse().unwrap_or(0),
                label: header[3].to_string(),
                kind: header[4].trim().to_string(),
                files,
                added,
                deleted,
            })
        })
        .collect()
}

#[tauri::command]
pub async fn history_list(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    limit: u32,
    path: Option<String>,
) -> CmdResult<Vec<Version>> {
    let _guard = state.history.lock().await;
    let r = repo(&app, &state).await?;
    let path = match path.as_deref() {
        Some(p) => {
            // Validates the path stays inside the workspace.
            workspace::resolve(&r.root, p)?;
            Some(format!(":(literal){}", p.trim_start_matches("./")))
        }
        None => None,
    };
    list_for(&r, limit.clamp(1, 5000), path.as_deref()).await
}

/// Files that differ between two versions; `from` null = the version's parent.
#[tauri::command]
pub async fn history_changes(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    from: Option<String>,
    to: String,
) -> CmdResult<Vec<FileChange>> {
    let _guard = state.history.lock().await;
    let r = repo(&app, &state).await?;
    let to = check_id(&to)?;
    let mut args = vec!["diff-tree", "-r", "-z", "--no-renames", "--no-commit-id"];
    if let Some(from) = from.as_deref() {
        args.push(check_id(from)?);
    } else {
        args.push("--root");
    }
    args.push(to);
    let mut status_args = args.clone();
    status_args.insert(1, "--name-status");
    let mut num_args = args;
    num_args.insert(1, "--numstat");
    let statuses = git_ok(&r.git_dir, &r.root, &status_args).await?;
    let numstat = git_ok(&r.git_dir, &r.root, &num_args).await?;
    Ok(parse_changes(&statuses, &numstat))
}

/// `--name-status -z` is `S\0path\0…`; `--numstat -z` is `a\td\tpath\0…`.
fn parse_changes(statuses: &str, numstat: &str) -> Vec<FileChange> {
    let counts: std::collections::HashMap<&str, (Option<u32>, Option<u32>)> = numstat
        .split('\0')
        .filter_map(|rec| {
            let mut p = rec.splitn(3, '\t');
            let (a, d, path) = (p.next()?, p.next()?, p.next()?);
            Some((path, (a.parse().ok(), d.parse().ok())))
        })
        .collect();
    let fields: Vec<&str> = statuses.split('\0').filter(|s| !s.is_empty()).collect();
    fields
        .chunks(2)
        .filter(|c| c.len() == 2)
        .map(|c| {
            let (added, deleted) = counts.get(c[1]).copied().unwrap_or((None, None));
            FileChange {
                path: c[1].to_string(),
                status: c[0].chars().next().unwrap_or('M').to_string(),
                added,
                deleted,
            }
        })
        .collect()
}

/// A file's text at a version; null if it didn't exist then.
#[tauri::command]
pub async fn history_file(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    id: String,
    path: String,
) -> CmdResult<Option<String>> {
    let _guard = state.history.lock().await;
    let r = repo(&app, &state).await?;
    let id = check_id(&id)?;
    // Validates the path stays inside the workspace.
    workspace::resolve(&r.root, &path)?;
    let rel = path.trim_start_matches("./");
    let spec = format!("{id}:{rel}");
    let exists = git(&r.git_dir, &r.root, &["cat-file", "-e", &spec])
        .await?
        .status
        .success();
    if !exists {
        return Ok(None);
    }
    let out = git(&r.git_dir, &r.root, &["cat-file", "blob", &spec]).await?;
    if !out.status.success() {
        return Err(CmdError::Io(
            String::from_utf8_lossy(&out.stderr).trim().to_string(),
        ));
    }
    if out.stdout.contains(&0) {
        return Err(CmdError::Invalid(format!("{rel} is not a text file")));
    }
    String::from_utf8(out.stdout)
        .map(Some)
        .map_err(|_| CmdError::Invalid(format!("{rel} is not UTF-8 text")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_log_records_with_numstat() {
        let out = "\x1eaaa\x1fbbb\x1f1700000000\x1fAgent: tighten intro\x1fagent\n\n3\t1\tchapters/ch1.typ\n-\t-\tfigures/a.png\n\x1ebbb\x1f\x1f1690000000\x1fOpened\x1fopened\n\n10\t0\tmain.typ\n";
        let v = parse_log(out);
        assert_eq!(v.len(), 2);
        assert_eq!(
            v[0],
            Version {
                id: "aaa".into(),
                parent: Some("bbb".into()),
                time: 1700000000,
                label: "Agent: tighten intro".into(),
                kind: "agent".into(),
                files: 2,
                added: 3,
                deleted: 1,
            }
        );
        assert_eq!(v[1].parent, None);
        assert_eq!(v[1].files, 1);
    }

    #[test]
    fn parses_changes_with_binary_and_spaces() {
        let statuses = "M\0chapters/ch 1.typ\0A\0figures/a.png\0D\0old.typ\0";
        let numstat = "3\t1\tchapters/ch 1.typ\0-\t-\tfigures/a.png\x000\t7\told.typ\0";
        let c = parse_changes(statuses, numstat);
        assert_eq!(c.len(), 3);
        assert_eq!(c[0].path, "chapters/ch 1.typ");
        assert_eq!((c[0].added, c[0].deleted), (Some(3), Some(1)));
        assert_eq!((c[1].status.as_str(), c[1].added), ("A", None));
        assert_eq!((c[2].status.as_str(), c[2].deleted), ("D", Some(7)));
    }

    #[test]
    fn rejects_non_hex_ids() {
        assert!(check_id("--output=/tmp/x").is_err());
        assert!(check_id("HEAD").is_err());
        assert!(check_id("0123abcd").is_ok());
    }

    /// Real git: the book's own repo and ignored files are left alone, and the
    /// author's global Git config (hooks, signing) doesn't apply.
    #[tokio::test]
    async fn snapshots_leave_the_books_own_git_alone() {
        if git_bin().is_err() {
            return;
        }
        let base = std::env::temp_dir().join(format!(
            "typst-studio-history-{}",
            uuid::Uuid::new_v4().simple()
        ));
        let root = base.join("book");
        std::fs::create_dir_all(root.join("chapters")).unwrap();
        std::fs::create_dir_all(root.join(".git")).unwrap();
        std::fs::write(root.join(".git/HEAD"), "ref: refs/heads/main\n").unwrap();
        std::fs::write(root.join(".gitignore"), "build/\n").unwrap();
        std::fs::create_dir_all(root.join("build")).unwrap();
        std::fs::write(root.join("build/out.pdf"), "pdf").unwrap();
        std::fs::create_dir_all(root.join("dist")).unwrap();
        std::fs::write(root.join("dist/book.pdf"), "pdf").unwrap();
        std::fs::write(root.join("main.typ"), "= Book\n").unwrap();
        std::fs::write(root.join("chapters/ch1.typ"), "Hello\n").unwrap();
        let r = Repo {
            git_dir: base.join("history.git"),
            root: root.clone(),
        };
        init(&r, &["/dist/".into()]).await.unwrap();

        let v1 = snapshot(&r, "opened", "Started", false)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(
            (v1.kind.as_str(), v1.label.as_str(), v1.parent.clone()),
            ("opened", "Started", None)
        );
        assert!(
            snapshot(&r, "save", "Nothing", false)
                .await
                .unwrap()
                .is_none()
        );

        std::fs::write(root.join("chapters/ch1.typ"), "Hello, world\n").unwrap();
        let v2 = snapshot(&r, "save", "Edited {files}", false)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(v2.parent.as_deref(), Some(v1.id.as_str()));
        assert_eq!(v2.label, "Edited ch1.typ");
        assert_eq!((v2.files, v2.added, v2.deleted), (1, 1, 1));

        let all: Vec<String> = git_ok(
            &r.git_dir,
            &r.root,
            &["ls-tree", "-r", "--name-only", "HEAD"],
        )
        .await
        .unwrap()
        .lines()
        .map(str::to_string)
        .collect();
        assert_eq!(all, [".gitignore", "chapters/ch1.typ", "main.typ"]);
        assert_eq!(
            std::fs::read_to_string(root.join(".git/HEAD")).unwrap(),
            "ref: refs/heads/main\n"
        );
        assert_eq!(std::fs::read_dir(root.join(".git")).unwrap().count(), 1);

        let milestone = snapshot(&r, "milestone", "Draft 1", true)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(milestone.files, 0);
        assert_eq!(list(&r, 10).await.unwrap().len(), 3);

        // One file's history: only the versions that changed it, with its counts.
        std::fs::write(root.join("main.typ"), "= Book\n= More\n").unwrap();
        snapshot(&r, "agent", "Agent: more", false)
            .await
            .unwrap()
            .unwrap();
        let ch1: Vec<(String, u32)> = list_for(&r, 10, Some(":(literal)chapters/ch1.typ"))
            .await
            .unwrap()
            .into_iter()
            .map(|v| (v.label, v.added))
            .collect();
        assert_eq!(
            ch1,
            [
                ("Edited ch1.typ".to_string(), 1),
                ("Started".to_string(), 1)
            ]
        );
        let main = list_for(&r, 10, Some(":(literal)main.typ")).await.unwrap();
        assert_eq!((main[0].kind.as_str(), main[0].files), ("agent", 1));
        std::fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn describes_changed_files() {
        assert_eq!(describe_files("chapters/ch1.typ\0"), "ch1.typ");
        assert_eq!(describe_files("a.typ\0b/c.typ\0"), "a.typ and c.typ");
        assert_eq!(
            describe_files("a.typ\0b.typ\0c.typ\0"),
            "a.typ and 2 more files"
        );
    }

    #[test]
    fn labels_are_single_line() {
        assert_eq!(
            one_line("  Agent:\n make it\tshorter "),
            "Agent: make it shorter"
        );
        assert_eq!(one_line(""), "Snapshot");
    }
}
