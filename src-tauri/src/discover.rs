//! Executable discovery. Apps launched from Finder get a minimal PATH
//! (/usr/bin:/bin:/usr/sbin:/sbin), so well-known install locations are added
//! both for lookup and for the PATH handed to child processes.
use std::{
    collections::HashSet,
    env,
    ffi::OsString,
    os::unix::fs::PermissionsExt,
    path::{Path, PathBuf},
    process::Command,
};

use serde::Serialize;

fn home() -> Option<PathBuf> {
    env::var_os("HOME").map(PathBuf::from)
}

fn extra_dirs() -> Vec<PathBuf> {
    let mut dirs = vec![
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/usr/local/bin"),
    ];
    if let Some(h) = home() {
        for d in [".cargo/bin", ".local/bin", ".opencode/bin", ".bun/bin"] {
            dirs.push(h.join(d));
        }
    }
    dirs
}

/// PATH for child processes: the inherited PATH plus well-known install dirs.
pub fn search_path() -> OsString {
    let mut seen = HashSet::new();
    let inherited = env::var_os("PATH").unwrap_or_default();
    let dirs: Vec<PathBuf> = env::split_paths(&inherited)
        .chain(extra_dirs())
        .filter(|d| seen.insert(d.clone()))
        .collect();
    env::join_paths(dirs).unwrap_or(inherited)
}

fn is_executable(p: &Path) -> bool {
    p.metadata()
        .map(|m| m.is_file() && m.permissions().mode() & 0o111 != 0)
        .unwrap_or(false)
}

/// `$ENV_VAR` override, then the search path.
pub fn find(name: &str, env_var: &str) -> Option<PathBuf> {
    if let Some(p) = env::var_os(env_var).map(PathBuf::from)
        && is_executable(&p)
    {
        return Some(p);
    }
    env::split_paths(&search_path())
        .map(|d| d.join(name))
        .find(|p| is_executable(p))
}

/// Tinymist: override, search path, then the binary bundled with the VS Code extension.
pub fn find_tinymist() -> Option<PathBuf> {
    find("tinymist", "TINYMIST_PATH").or_else(|| {
        let ext = home()?.join(".vscode/extensions");
        let mut candidates: Vec<PathBuf> = std::fs::read_dir(ext)
            .ok()?
            .flatten()
            .filter(|e| {
                e.file_name()
                    .to_string_lossy()
                    .starts_with("myriad-dreamin.tinymist-")
            })
            .map(|e| e.path().join("out/tinymist"))
            .filter(|p| is_executable(p))
            .collect();
        candidates.sort();
        candidates.pop()
    })
}

pub fn find_opencode() -> Option<PathBuf> {
    find("opencode", "OPENCODE_PATH")
}

/// Git, for History and Source Control.
pub fn find_git() -> Option<PathBuf> {
    find("git", "TYPST_STUDIO_GIT")
}

#[derive(Serialize)]
pub struct ToolInfo {
    pub path: Option<String>,
    pub version: Option<String>,
}

fn version_of(bin: &Path) -> Option<String> {
    let out = Command::new(bin)
        .arg("--version")
        .env("PATH", search_path())
        .output()
        .ok()?;
    clean_version(&String::from_utf8_lossy(&out.stdout))
        // Homebrew's tinymist doesn't know its own version; its Cellar path does.
        .or_else(|| bin.canonicalize().ok().and_then(|p| cellar_version(&p)))
}

/// "0.15.8" from `--version` output: tinymist prints a block with
/// "Build Git Describe:  v0.15.8", others one line like "opencode v2.0.20".
fn clean_version(text: &str) -> Option<String> {
    let raw = text
        .lines()
        .find_map(|l| l.strip_prefix("Build Git Describe:"))
        .or_else(|| text.lines().map(str::trim).find(|l| !l.is_empty()))?;
    raw.split_whitespace()
        .map(|w| w.trim_start_matches('v'))
        .find(|w| w.starts_with(|c: char| c.is_ascii_digit()) && w.contains('.'))
        .map(String::from)
}

/// `/opt/homebrew/Cellar/<name>/<version>/bin/<name>` → `<version>`.
fn cellar_version(path: &Path) -> Option<String> {
    let parts: Vec<_> = path
        .components()
        .map(|c| c.as_os_str().to_string_lossy())
        .collect();
    let i = parts.iter().position(|p| p == "Cellar")?;
    parts.get(i + 2).map(|v| v.to_string())
}

pub fn tool_info(bin: Option<PathBuf>) -> ToolInfo {
    ToolInfo {
        version: bin.as_deref().and_then(version_of),
        path: bin.map(|p| p.to_string_lossy().into_owned()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn versions_are_cleaned_up() {
        assert_eq!(
            clean_version("opencode v2.0.20\n").as_deref(),
            Some("2.0.20")
        );
        assert_eq!(
            clean_version("typst 0.15.1 (unknown commit)").as_deref(),
            Some("0.15.1")
        );
        assert_eq!(
            clean_version("git version 2.50.1 (Apple Git-155)\n").as_deref(),
            Some("2.50.1")
        );
        assert_eq!(
            clean_version("tinymist \nBuild Git Describe:  v0.15.8\n").as_deref(),
            Some("0.15.8")
        );
        assert_eq!(
            clean_version("tinymist \nBuild Git Describe:  VERGEN_IDEMPOTENT_OUTPUT\n"),
            None
        );
        assert_eq!(
            cellar_version(Path::new(
                "/opt/homebrew/Cellar/tinymist/0.15.8/bin/tinymist"
            ))
            .as_deref(),
            Some("0.15.8")
        );
        assert_eq!(cellar_version(Path::new("/usr/local/bin/tinymist")), None);
    }
}
