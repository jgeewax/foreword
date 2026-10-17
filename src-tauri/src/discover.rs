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
    let text = String::from_utf8_lossy(&out.stdout);
    // tinymist prints a block with "Build Git Describe:  v0.15.8"; others print one line.
    text.lines()
        .find_map(|l| {
            l.strip_prefix("Build Git Describe:")
                .map(|v| v.trim().to_string())
        })
        .or_else(|| {
            text.lines()
                .map(str::trim)
                .find(|l| !l.is_empty())
                .map(String::from)
        })
}

pub fn tool_info(bin: Option<PathBuf>) -> ToolInfo {
    ToolInfo {
        version: bin.as_deref().and_then(version_of),
        path: bin.map(|p| p.to_string_lossy().into_owned()),
    }
}
