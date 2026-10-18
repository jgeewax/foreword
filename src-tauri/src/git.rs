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

/// A commit id (or `HEAD`, or `:0` for what's staged), never an option.
fn check_rev(rev: &str) -> CmdResult<&str> {
    let base = rev.strip_suffix('^').unwrap_or(rev);
    if base == "HEAD"
        || rev == ":0"
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
    /// Staged for the next commit (Staged Changes).
    staged: Vec<GitFile>,
    /// Changed and not staged: edits, new files, conflicts (Changes). A file
    /// staged and then changed again is in both.
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
        let Some(rel) = path.strip_prefix(prefix) else {
            continue;
        };
        let file = |status: &str| GitFile {
            path: rel.to_string(),
            status: status.to_string(),
        };
        // X is the staged side, Y the rest.
        match (x, y) {
            ('?', '?') => s.files.push(file("?")),
            ('U', _) | (_, 'U') | ('A', 'A') | ('D', 'D') => s.files.push(file("U")),
            _ => {
                let staged = match x {
                    'M' | 'T' => Some("M"),
                    'A' | 'C' => Some("A"),
                    'D' => Some("D"),
                    'R' => Some("R"),
                    _ => None,
                };
                let changed = match y {
                    'M' | 'T' => Some("M"),
                    'A' => Some("A"),
                    'D' => Some("D"),
                    _ => None,
                };
                s.staged.extend(staged.map(file));
                s.files.extend(changed.map(file));
            }
        }
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

/// A book file as it is in a commit (`HEAD`, a hash, or `hash^`) or staged
/// (`:0`); null if it isn't there.
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

#[derive(Serialize, Debug, PartialEq)]
pub struct GitRef {
    name: String,
    /// "head" (the branch checked out), "branch", "remote" or "tag".
    kind: &'static str,
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
    /// The commits before it that touched the book (none for the first).
    parents: Vec<String>,
    /// The checked-out commit.
    head: bool,
    refs: Vec<GitRef>,
}

/// `%D` with `--decorate=full`: "HEAD -> refs/heads/main, refs/remotes/origin/main, tag: refs/tags/v1".
fn parse_refs(decorations: &str) -> (bool, Vec<GitRef>) {
    let mut head = false;
    let mut refs = Vec::new();
    for d in decorations.split(", ").filter(|d| !d.is_empty()) {
        let d = match d.strip_prefix("HEAD -> ") {
            Some(rest) => {
                head = true;
                if let Some(name) = rest.strip_prefix("refs/heads/") {
                    refs.push(GitRef {
                        name: name.into(),
                        kind: "head",
                    });
                }
                continue;
            }
            None if d == "HEAD" => {
                head = true; // detached
                continue;
            }
            None => d,
        };
        let (name, kind) = if let Some(n) = d.strip_prefix("tag: refs/tags/") {
            (n, "tag")
        } else if let Some(n) = d.strip_prefix("refs/heads/") {
            (n, "branch")
        } else if let Some(n) = d.strip_prefix("refs/remotes/") {
            if n.ends_with("/HEAD") {
                continue;
            }
            (n, "remote")
        } else {
            continue;
        };
        refs.push(GitRef {
            name: name.into(),
            kind,
        });
    }
    (head, refs)
}

/// Recent commits that touched the book, on this branch and its remote
/// (children before parents, for the graph).
#[tauri::command]
pub async fn git_log(state: Win, limit: u32) -> CmdResult<Vec<GitCommit>> {
    read_log(&state.root()?, limit).await
}

async fn read_log(book: &Path, limit: u32) -> CmdResult<Vec<GitCommit>> {
    let n = format!("-n{}", limit.clamp(1, 500));
    let upstream = git(
        book,
        &["rev-parse", "--verify", "-q", "@{upstream}"],
        READ_TIMEOUT,
    )
    .await?
    .status
    .success();
    let mut args = vec![
        "log",
        n.as_str(),
        "--topo-order",
        // Parents are the previous commits that touched the book: a connected graph.
        "--parents",
        "--decorate=full",
        "--format=%H%x1f%h%x1f%s%x1f%an%x1f%at%x1f%P%x1f%D%x1e",
        "HEAD",
    ];
    if upstream {
        args.push("@{upstream}");
    }
    args.extend(["--", "."]);
    let out = match git_ok(book, &args, READ_TIMEOUT).await {
        Ok(out) => out,
        Err(_) => return Ok(Vec::new()), // no commits yet
    };
    Ok(out
        .split('\x1e')
        .filter_map(|rec| {
            let f: Vec<&str> = rec.trim().split('\x1f').collect();
            (f.len() == 7).then(|| {
                let (head, refs) = parse_refs(f[6]);
                GitCommit {
                    hash: f[0].into(),
                    short: f[1].into(),
                    subject: f[2].into(),
                    author: f[3].into(),
                    time: f[4].parse().unwrap_or(0),
                    parents: f[5].split_whitespace().map(String::from).collect(),
                    head,
                    refs,
                }
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

/// Commit with `message`, as VS Code does: what's staged in the book if
/// anything is, otherwise every change in the book's folder (new files too).
#[tauri::command]
pub async fn git_commit(state: Win, message: String) -> CmdResult<String> {
    commit_book(&state.root()?, &message).await
}

async fn commit_book(book: &Path, message: &str) -> CmdResult<String> {
    let message = message.trim();
    if message.is_empty() {
        return Err(CmdError::Invalid("A commit needs a message.".into()));
    }
    let prefix = git_ok(book, &["rev-parse", "--show-prefix"], READ_TIMEOUT).await?;
    let staged = git_ok(
        book,
        &["diff", "--cached", "--name-only", "-z"],
        READ_TIMEOUT,
    )
    .await?;
    let (inside, outside): (Vec<&str>, Vec<&str>) = staged
        .split('\0')
        .filter(|p| !p.is_empty())
        .partition(|p| p.starts_with(prefix.trim()));
    if inside.is_empty() {
        git_ok(book, &["add", "--all", "--", "."], WRITE_TIMEOUT).await?;
        // Only the book's folder, even if other things are staged elsewhere in the repo.
        git_ok(book, &["commit", "-m", message, "--", "."], WRITE_TIMEOUT).await?;
    } else if let Some(other) = outside.first() {
        // A commit of what's staged would take those too.
        return Err(CmdError::Invalid(format!(
            "{other} is staged too, and it isn't in the book. Commit or unstage it in a terminal first."
        )));
    } else {
        git_ok(book, &["commit", "-m", message], WRITE_TIMEOUT).await?;
    }
    Ok(
        git_ok(book, &["rev-parse", "--short", "HEAD"], READ_TIMEOUT)
            .await?
            .trim()
            .to_string(),
    )
}

/// Paths in the book for a command that takes several (`.` is the whole book).
fn book_paths(paths: &[String]) -> CmdResult<Vec<&str>> {
    paths.iter().map(|p| check_path(p)).collect()
}

/// Stage book files for the next commit (`.`: all of them), as `git add`.
#[tauri::command]
pub async fn git_stage(state: Win, paths: Vec<String>) -> CmdResult<()> {
    stage(&state.root()?, &paths).await
}

async fn stage(book: &Path, paths: &[String]) -> CmdResult<()> {
    if paths.is_empty() {
        return Ok(()); // `git add --all` alone would take the whole repository
    }
    let mut args = vec!["--literal-pathspecs", "add", "--all", "--"];
    args.extend(book_paths(paths)?);
    git_ok(book, &args, WRITE_TIMEOUT).await.map(drop)
}

/// Unstage book files (`.`: all of them); their changes stay in the files.
#[tauri::command]
pub async fn git_unstage(state: Win, paths: Vec<String>) -> CmdResult<()> {
    unstage(&state.root()?, &paths).await
}

async fn unstage(book: &Path, paths: &[String]) -> CmdResult<()> {
    if paths.is_empty() {
        return Ok(());
    }
    // Before the first commit there's no HEAD to restore from.
    let head = git(book, &["rev-parse", "--verify", "-q", "HEAD"], READ_TIMEOUT)
        .await?
        .status
        .success();
    let mut args = if head {
        vec!["--literal-pathspecs", "restore", "--staged", "--"]
    } else {
        vec![
            "--literal-pathspecs",
            "rm",
            "--cached",
            "-r",
            "-q",
            "--ignore-unmatch",
            "--",
        ]
    };
    args.extend(book_paths(paths)?);
    git_ok(book, &args, WRITE_TIMEOUT).await.map(drop)
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
        let out = "## main...origin/main [ahead 2, behind 1]\0 M book/ch1.typ\0?? book/new.typ\0A  book/added.typ\0R  book/b.typ\0book/a.typ\0 D book/gone.typ\0UU book/conflict.typ\0MM book/both.typ\0 M other/x.typ\0";
        let s = parse_status(out, "book/");
        assert_eq!(s.branch.as_deref(), Some("main"));
        assert_eq!(s.upstream.as_deref(), Some("origin/main"));
        assert_eq!((s.ahead, s.behind), (2, 1));
        let list = |files: Vec<GitFile>| -> Vec<String> {
            files
                .into_iter()
                .map(|f| format!("{} {}", f.status, f.path))
                .collect()
        };
        // Staged and then changed again: in both lists.
        assert_eq!(list(s.staged), ["A added.typ", "R b.typ", "M both.typ"]);
        assert_eq!(
            list(s.files),
            [
                "M ch1.typ",
                "? new.typ",
                "D gone.typ",
                "U conflict.typ",
                "M both.typ"
            ]
        );
        let fresh = parse_status("## No commits yet on main\0?? main.typ\0", "");
        assert_eq!(fresh.branch.as_deref(), Some("main"));
        assert_eq!(fresh.upstream, None);
    }

    #[test]
    fn reads_branches_remotes_and_tags_on_a_commit() {
        let r = |name: &str, kind| GitRef {
            name: name.into(),
            kind,
        };
        assert_eq!(
            parse_refs(
                "HEAD -> refs/heads/feature/a, refs/remotes/origin/HEAD, refs/remotes/origin/main, refs/heads/main, tag: refs/tags/v1"
            ),
            (
                true,
                vec![
                    r("feature/a", "head"),
                    r("origin/main", "remote"),
                    r("main", "branch"),
                    r("v1", "tag")
                ]
            )
        );
        assert_eq!(parse_refs("HEAD"), (true, vec![]));
        assert_eq!(parse_refs(""), (false, vec![]));
    }

    #[test]
    fn only_commit_ids_and_book_paths_reach_git() {
        assert!(
            check_rev("HEAD").is_ok()
                && check_rev("a1b2c3d").is_ok()
                && check_rev("a1b2c3d^").is_ok()
        );
        assert!(check_rev("--output=x").is_err() && check_rev("main").is_err());
        assert!(check_rev(":0").is_ok() && check_rev(":1").is_err() && check_rev(":0^").is_err());
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
        // A commit outside the book is left out of the log, and the graph
        // still joins the book's commits.
        run(&["add", "README.md"]);
        run(&["commit", "-qm", "Outside"]);
        git_ok(
            &book,
            &["commit", "-qm", "Second", "--", "."],
            WRITE_TIMEOUT,
        )
        .await
        .unwrap();
        let log = read_log(&book, 20).await.unwrap();
        let subjects: Vec<&str> = log.iter().map(|c| c.subject.as_str()).collect();
        assert_eq!(subjects, ["Second", "First"]);
        assert_eq!(log[0].parents, [log[1].hash.clone()]);
        assert!(log[0].head && log[1].parents.is_empty());
        assert_eq!(
            log[0].refs,
            [GitRef {
                name: "main".into(),
                kind: "head"
            }]
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn stages_and_commits_only_whats_staged() {
        if git_bin().is_err() {
            return;
        }
        let dir = std::env::temp_dir().join(format!(
            "typst-studio-stage-{}",
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
        let write = |path: &str, text: &str| std::fs::write(dir.join(path), text).unwrap();
        let status = || async {
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
            let list = |files: Vec<GitFile>| -> Vec<String> {
                files
                    .into_iter()
                    .map(|f| format!("{} {}", f.status, f.path))
                    .collect()
            };
            (list(s.staged), list(s.files))
        };
        let committed = || {
            let out = run(&["show", "--name-only", "--format=", "HEAD"]);
            String::from_utf8_lossy(&out.stdout).trim().to_string()
        };
        write("book/a.typ", "a\n");
        write("book/b.typ", "b\n");
        write("README.md", "outside the book\n");

        // Before the first commit, unstaging has no HEAD to go back to.
        stage(&book, &["a.typ".into()]).await.unwrap();
        assert_eq!(
            status().await,
            (vec!["A a.typ".to_string()], vec!["? b.typ".to_string()])
        );
        unstage(&book, &["a.typ".into()]).await.unwrap();
        assert_eq!(status().await.0, Vec::<String>::new());

        // Nothing staged: every change in the book.
        commit_book(&book, "First").await.unwrap();
        assert_eq!(committed(), "book/a.typ\nbook/b.typ");

        // Something staged: just that, and the rest stays changed.
        write("book/a.typ", "a2\n");
        write("book/b.typ", "b2\n");
        stage(&book, &["a.typ".into()]).await.unwrap();
        commit_book(&book, "Only a").await.unwrap();
        assert_eq!(committed(), "book/a.typ");
        assert_eq!(status().await, (vec![], vec!["M b.typ".to_string()]));

        // Staged outside the book too: refused, so it isn't committed by surprise.
        write("README.md", "changed\n");
        run(&["add", "README.md"]);
        stage(&book, &[".".into()]).await.unwrap();
        let refused = commit_book(&book, "Both").await.unwrap_err();
        assert!(format!("{refused:?}").contains("README.md"), "{refused:?}");
        unstage(&book, &[".".into()]).await.unwrap();
        assert_eq!(status().await, (vec![], vec!["M b.typ".to_string()]));
        let outside = run(&["diff", "--cached", "--name-only"]);
        assert_eq!(
            String::from_utf8_lossy(&outside.stdout).trim(),
            "README.md",
            "outside the book stays staged"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }
}
