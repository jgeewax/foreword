//! The author's own Git repository, when the book is in one (Source Control).
//! Unlike History's snapshot repo, this is the author's: their config, hooks,
//! signing and credentials apply. What it does is limited to what a writer
//! needs (status, what changed, commit, pull, push, the log), all scoped to the
//! book's folder. Nothing that throws work away (reset, checkout of files,
//! clean) is offered, and Git never waits on a terminal prompt.
use std::{
    path::{Path, PathBuf},
    process::{Output, Stdio},
    time::Duration,
};

use serde::Serialize;
use tokio::process::Command;

use crate::{
    Win, discover,
    error::{CmdError, CmdResult},
};

const READ_TIMEOUT: Duration = Duration::from_secs(20);
const WRITE_TIMEOUT: Duration = Duration::from_secs(120);

fn git_bin() -> CmdResult<PathBuf> {
    discover::find("git", "TYPST_STUDIO_GIT")
        .ok_or_else(|| CmdError::Unavailable("git was not found".into()))
}

/// `git -C <book> …` with the author's config. No prompts: credentials come
/// from their helper or SSH agent, or the command fails with a message.
async fn git(book: &Path, args: &[&str], timeout: Duration) -> CmdResult<Output> {
    let mut cmd = Command::new(git_bin()?);
    cmd.arg("-C")
        .arg(book)
        .args(["-c", "core.quotePath=false"])
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("PATH", discover::search_path())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    if std::env::var_os("GIT_SSH_COMMAND").is_none() {
        cmd.env("GIT_SSH_COMMAND", "ssh -o BatchMode=yes");
    }
    match tokio::time::timeout(timeout, cmd.output()).await {
        Ok(out) => Ok(out?),
        Err(_) => Err(CmdError::Io(format!(
            "git {} took too long",
            args.first().unwrap_or(&"")
        ))),
    }
}

async fn git_ok(book: &Path, args: &[&str], timeout: Duration) -> CmdResult<String> {
    let out = git(book, args, timeout).await?;
    if !out.status.success() {
        let msg = String::from_utf8_lossy(&out.stderr).trim().to_string();
        let msg = if msg.is_empty() {
            String::from_utf8_lossy(&out.stdout).trim().to_string()
        } else {
            msg
        };
        return Err(CmdError::Io(msg));
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

/// A commit id (or `HEAD`), never an option.
fn check_rev(rev: &str) -> CmdResult<&str> {
    let base = rev.strip_suffix('^').unwrap_or(rev);
    if base == "HEAD"
        || ((4..=64).contains(&base.len()) && base.bytes().all(|b| b.is_ascii_hexdigit()))
    {
        Ok(rev)
    } else {
        Err(CmdError::Invalid(format!("not a commit: {rev}")))
    }
}

/// A path inside the book (relative, no `..`).
fn check_path(path: &str) -> CmdResult<&str> {
    if path.is_empty()
        || path.starts_with('/')
        || path.starts_with('-')
        || path.split('/').any(|s| s == "..")
    {
        return Err(CmdError::Invalid(format!("not a path in the book: {path}")));
    }
    Ok(path)
}

#[derive(Serialize, Debug, PartialEq)]
pub struct GitFile {
    /// Relative to the book's folder.
    path: String,
    /// M modified, A added, D deleted, R renamed, ? new (untracked), U conflict.
    status: String,
}

#[derive(Serialize, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct GitStatus {
    /// The repository's top folder.
    root: String,
    /// The book's folder within it ("" when it's the top).
    prefix: String,
    branch: Option<String>,
    upstream: Option<String>,
    ahead: u32,
    behind: u32,
    files: Vec<GitFile>,
}

/// `git status --porcelain=v1 -z --branch` (paths relative to the repo) for the book's folder.
fn parse_status(out: &str, prefix: &str) -> GitStatus {
    let mut s = GitStatus::default();
    let mut entries = out.split('\0').filter(|e| !e.is_empty()).peekable();
    while let Some(e) = entries.next() {
        if let Some(branch) = e.strip_prefix("## ") {
            // "main...origin/main [ahead 1, behind 2]", "No commits yet on main", "HEAD (no branch)"
            let (names, counts) = branch.split_once(" [").unwrap_or((branch, ""));
            let names = names.strip_prefix("No commits yet on ").unwrap_or(names);
            let (local, upstream) = names.split_once("...").unwrap_or((names, ""));
            s.branch = (local != "HEAD (no branch)").then(|| local.to_string());
            s.upstream = (!upstream.is_empty()).then(|| upstream.to_string());
            for part in counts.trim_end_matches(']').split(", ") {
                if let Some(n) = part.strip_prefix("ahead ") {
                    s.ahead = n.parse().unwrap_or(0);
                } else if let Some(n) = part.strip_prefix("behind ") {
                    s.behind = n.parse().unwrap_or(0);
                }
            }
            continue;
        }
        if e.len() < 4 {
            continue;
        }
        let (xy, path) = e.split_at(3);
        let (x, y) = (xy.as_bytes()[0] as char, xy.as_bytes()[1] as char);
        // A rename's entry is followed by its old path.
        if x == 'R' || x == 'C' {
            entries.next();
        }
        let status = match (x, y) {
            ('?', '?') => "?",
            ('U', _) | (_, 'U') | ('A', 'A') | ('D', 'D') => "U",
            ('R', _) => "R",
            ('A', _) => "A",
            ('D', _) | (_, 'D') => "D",
            _ => "M",
        };
        let Some(rel) = path.strip_prefix(prefix) else {
            continue;
        };
        s.files.push(GitFile {
            path: rel.to_string(),
            status: status.to_string(),
        });
    }
    s
}

/// The book's repository and what's changed in the book; null when it isn't in one.
#[tauri::command]
pub async fn git_status(state: Win) -> CmdResult<Option<GitStatus>> {
    let book = state.root()?;
    let top = git(
        &book,
        &["rev-parse", "--show-toplevel", "--show-prefix"],
        READ_TIMEOUT,
    )
    .await?;
    if !top.status.success() {
        return Ok(None); // not a Git repository
    }
    let text = String::from_utf8_lossy(&top.stdout);
    let mut lines = text.lines();
    let root = lines.next().unwrap_or_default().to_string();
    let prefix = lines.next().unwrap_or_default().to_string();
    let out = git_ok(
        &book,
        &[
            "status",
            "--porcelain=v1",
            "-z",
            "--branch",
            "--untracked-files=all",
            "--",
            ".",
        ],
        READ_TIMEOUT,
    )
    .await?;
    let mut status = parse_status(&out, &prefix);
    status.root = root;
    status.prefix = prefix;
    Ok(Some(status))
}

/// A book file as it is in a commit (`HEAD`, a hash, or `hash^`); null if it isn't there.
#[tauri::command]
pub async fn git_file(state: Win, rev: String, path: String) -> CmdResult<Option<String>> {
    let book = state.root()?;
    let spec = format!("{}:./{}", check_rev(&rev)?, check_path(&path)?);
    let out = git(&book, &["show", &spec], READ_TIMEOUT).await?;
    if !out.status.success() {
        return Ok(None);
    }
    String::from_utf8(out.stdout)
        .map(Some)
        .map_err(|_| CmdError::Invalid(format!("{path} isn't a text file")))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommit {
    hash: String,
    short: String,
    subject: String,
    author: String,
    /// Unix seconds.
    time: i64,
    /// Has a parent (the first commit doesn't).
    parent: bool,
}

/// Recent commits that touched the book.
#[tauri::command]
pub async fn git_log(state: Win, limit: u32) -> CmdResult<Vec<GitCommit>> {
    let book = state.root()?;
    let n = format!("-n{}", limit.clamp(1, 200));
    let out = match git_ok(
        &book,
        &[
            "log",
            &n,
            "--format=%H%x1f%h%x1f%s%x1f%an%x1f%at%x1f%P%x1e",
            "--",
            ".",
        ],
        READ_TIMEOUT,
    )
    .await
    {
        Ok(out) => out,
        Err(_) => return Ok(Vec::new()), // no commits yet
    };
    Ok(out
        .split('\x1e')
        .filter_map(|rec| {
            let f: Vec<&str> = rec.trim().split('\x1f').collect();
            (f.len() == 6).then(|| GitCommit {
                hash: f[0].into(),
                short: f[1].into(),
                subject: f[2].into(),
                author: f[3].into(),
                time: f[4].parse().unwrap_or(0),
                parent: !f[5].trim().is_empty(),
            })
        })
        .collect())
}

/// The book files a commit changed.
#[tauri::command]
pub async fn git_commit_files(state: Win, hash: String) -> CmdResult<Vec<GitFile>> {
    let book = state.root()?;
    let hash = check_rev(&hash)?;
    let prefix = git_ok(&book, &["rev-parse", "--show-prefix"], READ_TIMEOUT)
        .await?
        .trim()
        .to_string();
    let out = git_ok(
        &book,
        &[
            "show",
            "--name-status",
            "--format=",
            "-z",
            "--root",
            hash,
            "--",
            ".",
        ],
        READ_TIMEOUT,
    )
    .await?;
    let mut parts = out.split('\0').filter(|p| !p.is_empty());
    let mut files = Vec::new();
    while let Some(status) = parts.next() {
        // Renames and copies list the old path, then the new.
        let path = if status.starts_with('R') || status.starts_with('C') {
            parts.next();
            parts.next()
        } else {
            parts.next()
        };
        if let Some(rel) = path.and_then(|p| p.strip_prefix(&prefix)) {
            files.push(GitFile {
                path: rel.to_string(),
                status: status[..1].to_string(),
            });
        }
    }
    Ok(files)
}

/// Commit every change in the book's folder (new files too) with `message`.
#[tauri::command]
pub async fn git_commit(state: Win, message: String) -> CmdResult<String> {
    let book = state.root()?;
    let message = message.trim();
    if message.is_empty() {
        return Err(CmdError::Invalid("A commit needs a message.".into()));
    }
    git_ok(&book, &["add", "--all", "--", "."], WRITE_TIMEOUT).await?;
    // Only the book's folder, even if other things are staged elsewhere in the repo.
    git_ok(&book, &["commit", "-m", message, "--", "."], WRITE_TIMEOUT).await?;
    Ok(
        git_ok(&book, &["rev-parse", "--short", "HEAD"], READ_TIMEOUT)
            .await?
            .trim()
            .to_string(),
    )
}

/// Bring in commits from the remote, only when that needs no merge.
#[tauri::command]
pub async fn git_pull(state: Win) -> CmdResult<String> {
    let book = state.root()?;
    git_ok(&book, &["pull", "--ff-only"], WRITE_TIMEOUT)
        .await
        .map_err(|e| CmdError::Io(format!("Couldn't pull: {e}")))
}

/// Send commits to the remote (setting the upstream on a branch's first push to origin).
#[tauri::command]
pub async fn git_push(state: Win) -> CmdResult<String> {
    let book = state.root()?;
    let has_upstream = git(
        &book,
        &["rev-parse", "--abbrev-ref", "@{upstream}"],
        READ_TIMEOUT,
    )
    .await?
    .status
    .success();
    let args: &[&str] = if has_upstream {
        &["push"]
    } else {
        &["push", "--set-upstream", "origin", "HEAD"]
    };
    let out = git(&book, args, WRITE_TIMEOUT).await?;
    let text = format!(
        "{}{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    if out.status.success() {
        Ok(text.trim().to_string())
    } else {
        Err(CmdError::Io(format!("Couldn't push: {}", text.trim())))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_status_with_branch_and_paths_in_the_book() {
        let out = "## main...origin/main [ahead 2, behind 1]\0 M book/ch1.typ\0?? book/new.typ\0A  book/added.typ\0R  book/b.typ\0book/a.typ\0 D book/gone.typ\0UU book/conflict.typ\0 M other/x.typ\0";
        let s = parse_status(out, "book/");
        assert_eq!(s.branch.as_deref(), Some("main"));
        assert_eq!(s.upstream.as_deref(), Some("origin/main"));
        assert_eq!((s.ahead, s.behind), (2, 1));
        let files: Vec<(String, String)> =
            s.files.into_iter().map(|f| (f.path, f.status)).collect();
        assert_eq!(
            files,
            [
                ("ch1.typ", "M"),
                ("new.typ", "?"),
                ("added.typ", "A"),
                ("b.typ", "R"),
                ("gone.typ", "D"),
                ("conflict.typ", "U")
            ]
            .map(|(p, s)| (p.to_string(), s.to_string()))
        );
        let fresh = parse_status("## No commits yet on main\0?? main.typ\0", "");
        assert_eq!(fresh.branch.as_deref(), Some("main"));
        assert_eq!(fresh.upstream, None);
    }

    #[test]
    fn only_commit_ids_and_book_paths_reach_git() {
        assert!(
            check_rev("HEAD").is_ok()
                && check_rev("a1b2c3d").is_ok()
                && check_rev("a1b2c3d^").is_ok()
        );
        assert!(check_rev("--output=x").is_err() && check_rev("main").is_err());
        assert!(check_path("chapters/a.typ").is_ok());
        assert!(
            check_path("../x").is_err()
                && check_path("/etc/hosts").is_err()
                && check_path("-x").is_err()
        );
    }

    #[tokio::test]
    async fn commits_the_book_and_shows_it() {
        if git_bin().is_err() {
            return;
        }
        let dir = std::env::temp_dir().join(format!(
            "typst-studio-git-{}",
            uuid::Uuid::new_v4().simple()
        ));
        let book = dir.join("book");
        std::fs::create_dir_all(&book).unwrap();
        let run = |args: &[&str]| {
            std::process::Command::new("git")
                .arg("-C")
                .arg(&dir)
                .args(args)
                .output()
                .unwrap()
        };
        run(&["init", "-q", "-b", "main"]);
        run(&["config", "user.email", "test@example.invalid"]);
        run(&["config", "user.name", "Test"]);
        run(&["config", "commit.gpgSign", "false"]);
        std::fs::write(book.join("main.typ"), "= One\n").unwrap();
        std::fs::write(dir.join("README.md"), "outside the book\n").unwrap();
        // Through the same calls the commands make.
        git_ok(&book, &["add", "--all", "--", "."], WRITE_TIMEOUT)
            .await
            .unwrap();
        git_ok(&book, &["commit", "-m", "First", "--", "."], WRITE_TIMEOUT)
            .await
            .unwrap();
        let tracked = git_ok(&dir, &["ls-files"], READ_TIMEOUT).await.unwrap();
        assert_eq!(
            tracked.trim(),
            "book/main.typ",
            "only the book's folder is committed"
        );
        std::fs::write(book.join("main.typ"), "= One\n\nMore.\n").unwrap();
        let out = git_ok(
            &book,
            &[
                "status",
                "--porcelain=v1",
                "-z",
                "--branch",
                "--untracked-files=all",
                "--",
                ".",
            ],
            READ_TIMEOUT,
        )
        .await
        .unwrap();
        let s = parse_status(&out, "book/");
        assert_eq!(
            s.files,
            vec![GitFile {
                path: "main.typ".into(),
                status: "M".into()
            }]
        );
        let _ = std::fs::remove_dir_all(&dir);
    }
}
