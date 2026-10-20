//! Executable discovery. Apps launched from Finder get a minimal PATH
//! (/usr/bin:/bin:/usr/sbin:/sbin), so well-known install locations are added
//! both for lookup and for the PATH handed to child processes.
use std::{
    collections::HashSet,
    env,
    ffi::OsString,
    os::unix::fs::PermissionsExt,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::{Duration, Instant},
};

use serde::Serialize;

pub fn home() -> Option<PathBuf> {
    env::var_os("HOME").map(PathBuf::from)
}

fn extra_dirs() -> Vec<PathBuf> {
    let mut dirs = vec![
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/usr/local/bin"),
    ];
    if let Some(h) = home() {
        for d in [
            ".cargo/bin",
            ".local/bin",
            ".opencode/bin",
            ".bun/bin",
            ".volta/bin",
        ] {
            dirs.push(h.join(d));
        }
        // Node.js from version managers, which only put it on a shell's PATH:
        // fnm's default version, and nvm's newest.
        for d in [
            ".local/share/fnm/aliases/default/bin",
            "Library/Application Support/fnm/aliases/default/bin",
        ] {
            dirs.push(h.join(d));
        }
        dirs.extend(newest_version(&h.join(".nvm/versions/node")).map(|v| v.join("bin")));
    }
    dirs
}

/// The folder in `dir` named for the highest version ("v24.15.0" over "v9.1.0").
fn newest_version(dir: &Path) -> Option<PathBuf> {
    let version = |p: &PathBuf| -> Vec<u64> {
        let name = p
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned();
        name.trim_start_matches('v')
            .split('.')
            .map(|n| n.parse().unwrap_or(0))
            .collect()
    };
    std::fs::read_dir(dir)
        .ok()?
        .flatten()
        .map(|e| e.path())
        .max_by_key(version)
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

pub fn is_executable(p: &Path) -> bool {
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
    on_path(name)
}

/// `name` on the search path.
pub fn on_path(name: &str) -> Option<PathBuf> {
    env::split_paths(&search_path())
        .map(|d| d.join(name))
        .find(|p| is_executable(p))
}

/// The programs Foreword runs itself. Settings ▸ Tools can choose each one.
#[derive(Clone, Copy)]
pub enum Tool {
    Tinymist,
    OpenCode,
    Git,
}

impl Tool {
    /// Its key under `toolPaths` in the settings file, and its program's name.
    fn key(self) -> &'static str {
        match self {
            Tool::Tinymist => "tinymist",
            Tool::OpenCode => "opencode",
            Tool::Git => "git",
        }
    }

    fn env_var(self) -> &'static str {
        match self {
            Tool::Tinymist => "TINYMIST_PATH",
            Tool::OpenCode => "OPENCODE_PATH",
            Tool::Git => "FOREWORD_GIT",
        }
    }

    pub fn parse(key: &str) -> Option<Tool> {
        [Tool::Tinymist, Tool::OpenCode, Tool::Git]
            .into_iter()
            .find(|t| t.key() == key)
    }

    /// Found without the settings: the first of its copies.
    fn automatic(self) -> Option<PathBuf> {
        copies(self).into_iter().next().map(|c| c.0)
    }
}

/// Where a copy was found, in words.
fn source_of(dir: &Path) -> String {
    let home = home().unwrap_or_default();
    let d = dir.to_string_lossy();
    match () {
        _ if d.starts_with("/opt/homebrew/") || d.starts_with("/usr/local/") => "Homebrew".into(),
        _ if dir == Path::new("/usr/bin") => "macOS".into(),
        _ if dir == home.join(".cargo/bin") => "Cargo".into(),
        _ if dir == home.join(".opencode/bin") => "OpenCode's installer".into(),
        _ if dir == home.join(".bun/bin") => "Bun".into(),
        _ => match dir.strip_prefix(&home) {
            Ok(rest) => format!("~/{}", rest.display()),
            Err(_) => d.into_owned(),
        },
    }
}

/// Editors that bundle Tinymist in their Typst extension.
const EDITOR_EXTENSIONS: &[(&str, &str)] = &[
    (".vscode/extensions", "VS Code"),
    (".vscode-insiders/extensions", "VS Code Insiders"),
    (".cursor/extensions", "Cursor"),
    (".windsurf/extensions", "Windsurf"),
    (".vscode-oss/extensions", "VSCodium"),
];

/// Tinymist in editors' Typst extensions, newest first.
fn editor_tinymists() -> Vec<(PathBuf, String)> {
    let Some(home) = home() else { return vec![] };
    let mut found = vec![];
    for (dir, editor) in EDITOR_EXTENSIONS {
        let Ok(entries) = std::fs::read_dir(home.join(dir)) else {
            continue;
        };
        let mut here: Vec<PathBuf> = entries
            .flatten()
            .filter(|e| {
                e.file_name()
                    .to_string_lossy()
                    .starts_with("myriad-dreamin.tinymist-")
            })
            .map(|e| e.path().join("out/tinymist"))
            .filter(|p| is_executable(p))
            .collect();
        here.sort();
        found.extend(
            here.into_iter()
                .rev()
                .map(|p| (p, format!("{editor}'s Typst extension"))),
        );
    }
    found
}

/// A program in the app's own Resources (`Contents/Resources/<name>/<name>`),
/// which `npm run app:build` puts there (scripts/bundle-opencode.mjs and
/// scripts/bundle-tinymist.mjs): found only after every other copy.
fn bundled(name: &str) -> Vec<(PathBuf, String)> {
    let found = env::current_exe().ok().and_then(|exe| {
        let p = exe
            .parent()?
            .parent()?
            .join("Resources")
            .join(name)
            .join(name);
        is_executable(&p).then_some(p)
    });
    found
        .map(|p| (p, "bundled with Foreword".to_string()))
        .into_iter()
        .collect()
}

/// Every copy of `tool` on this Mac, each once, in the order the automatic
/// choice takes them: `$ENV_VAR`, the search path, then other known places.
pub fn copies(tool: Tool) -> Vec<(PathBuf, String)> {
    let mut all = vec![];
    if let Some(p) = env::var_os(tool.env_var()).map(PathBuf::from)
        && is_executable(&p)
    {
        all.push((p, tool.env_var().to_string()));
    }
    for dir in env::split_paths(&search_path()) {
        let p = dir.join(tool.key());
        if is_executable(&p) {
            all.push((p, source_of(&dir)));
        }
    }
    match tool {
        Tool::Tinymist => {
            all.extend(editor_tinymists());
            all.extend(bundled("tinymist"));
        }
        Tool::Git => {
            for (p, source) in [
                (
                    "/Library/Developer/CommandLineTools/usr/bin/git",
                    "Command Line Tools",
                ),
                (
                    "/Applications/Xcode.app/Contents/Developer/usr/bin/git",
                    "Xcode",
                ),
                (
                    "/Applications/GitHub Desktop.app/Contents/Resources/app/git/bin/git",
                    "GitHub Desktop",
                ),
            ] {
                if is_executable(Path::new(p)) {
                    all.push((PathBuf::from(p), source.to_string()));
                }
            }
        }
        // A copy inside the app (a release build bundles one): only when nothing else is found.
        Tool::OpenCode => all.extend(bundled("opencode")),
    }
    let mut seen = HashSet::new();
    all.retain(|(p, _)| seen.insert(p.canonicalize().unwrap_or_else(|_| p.clone())));
    all
}

/// The path the author chose for `tool` (`toolPaths` in the settings file),
/// with `~` expanded; read each time, so a change applies to the next start.
fn configured(tool: Tool) -> Option<PathBuf> {
    let text = crate::config::read_at(&crate::config::config_file()).ok()??;
    configured_in(&text, tool)
}

fn configured_in(settings: &str, tool: Tool) -> Option<PathBuf> {
    let value: serde_json::Value = serde_json::from_str(settings).ok()?;
    expand(value.get("toolPaths")?.get(tool.key())?.as_str()?)
}

/// A path as typed: trimmed, `~/` for the home folder.
fn expand(raw: &str) -> Option<PathBuf> {
    let raw = raw.trim();
    match raw.strip_prefix("~/") {
        _ if raw.is_empty() => None,
        Some(rest) => Some(home()?.join(rest)),
        None => Some(PathBuf::from(raw)),
    }
}

/// The chosen program if it can run, otherwise the one found automatically.
pub fn locate(tool: Tool) -> Option<PathBuf> {
    configured(tool)
        .filter(|p| is_executable(p))
        .or_else(|| tool.automatic())
}

pub fn find_tinymist() -> Option<PathBuf> {
    locate(Tool::Tinymist)
}

pub fn find_opencode() -> Option<PathBuf> {
    locate(Tool::OpenCode)
}

/// Git, for History and Source Control.
pub fn find_git() -> Option<PathBuf> {
    locate(Tool::Git)
}

/// One copy of a tool found on this Mac.
#[derive(Serialize)]
pub struct Copy {
    pub path: String,
    pub version: Option<String>,
    /// Where it was found, in words ("Homebrew", "VS Code's Typst extension").
    pub source: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolInfo {
    /// The program in use, if any.
    pub path: Option<String>,
    pub version: Option<String>,
    /// The path chosen in Settings, if any, whether or not it can run.
    pub configured: Option<String>,
    /// `path` is the chosen one (not found automatically).
    pub from_settings: bool,
    /// What would be used without a choice.
    pub automatic: Option<String>,
    /// Every copy found, the automatic one first.
    pub copies: Vec<Copy>,
}

/// `bin --version`'s output (stdout, then stderr), or None if it fails or
/// takes more than 3 seconds (a program chosen by mistake may wait for input).
fn version_output(bin: &Path) -> Option<String> {
    output(bin, &["--version"])
}

/// What `bin args…` prints (stdout, then stderr), or None if it can't run or
/// takes more than 3 seconds.
pub fn output(bin: &Path, args: &[&str]) -> Option<String> {
    let mut child = Command::new(bin)
        .args(args)
        .env("PATH", search_path())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .ok()?;
    let deadline = Instant::now() + Duration::from_secs(3);
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(20)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
        }
    }
    let out = child.wait_with_output().ok()?;
    Some(format!(
        "{}{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    ))
}

fn version_of(bin: &Path) -> Option<String> {
    version_output(bin)
        .and_then(|text| clean_version(&text))
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

pub fn tool_info(tool: Tool) -> ToolInfo {
    let text = |p: &Path| p.to_string_lossy().into_owned();
    let copies: Vec<Copy> = copies(tool)
        .into_iter()
        .map(|(p, source)| Copy {
            version: version_of(&p),
            path: text(&p),
            source,
        })
        .collect();
    let configured = configured(tool);
    let chosen = configured.clone().filter(|p| is_executable(p));
    let from_settings = chosen.is_some();
    let automatic = copies.first();
    let (path, version) = match &chosen {
        Some(p) => (Some(text(p)), version_of(p)),
        None => (
            automatic.map(|c| c.path.clone()),
            automatic.and_then(|c| c.version.clone()),
        ),
    };
    ToolInfo {
        path,
        version,
        configured: configured.as_deref().map(text),
        from_settings,
        automatic: automatic.map(|c| c.path.clone()),
        copies,
    }
}

/// What a path typed or pasted for `tool` holds: its version if it's that
/// program, or why it can't be used.
#[derive(Serialize)]
pub struct Probe {
    /// The path with `~` expanded.
    pub path: String,
    pub version: Option<String>,
    pub problem: Option<String>,
}

pub fn probe(tool: Tool, raw: &str) -> Probe {
    let Some(p) = expand(raw) else {
        return Probe {
            path: String::new(),
            version: None,
            problem: Some("No path".into()),
        };
    };
    let problem = |text: &str| Probe {
        path: p.to_string_lossy().into_owned(),
        version: None,
        problem: Some(text.into()),
    };
    if !p.is_absolute() {
        return problem("Give the whole path, starting with / or ~/");
    }
    let Ok(meta) = p.metadata() else {
        return problem("There's nothing at this path");
    };
    if p.extension().is_some_and(|e| e == "app") {
        return problem("That's an app; choose the program inside it");
    }
    if meta.is_dir() {
        return problem("That's a folder, not a program");
    }
    if !is_executable(&p) {
        return problem("That file isn't a program (it can't be run)");
    }
    let said = version_output(&p).unwrap_or_default();
    if !said.to_lowercase().contains(tool.key()) {
        let first = said.lines().map(str::trim).find(|l| !l.is_empty());
        return problem(&match first {
            Some(line) => format!("That isn't {}: it says “{line}”", tool.key()),
            None => format!("That doesn't seem to be {}", tool.key()),
        });
    }
    Probe {
        path: p.to_string_lossy().into_owned(),
        version: clean_version(&said)
            .or_else(|| p.canonicalize().ok().and_then(|c| cellar_version(&c))),
        problem: None,
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

    #[test]
    fn copies_are_listed_once_each_and_probed() {
        // git is on every Mac this runs on (/usr/bin/git at least).
        let all = copies(Tool::Git);
        assert!(!all.is_empty());
        let mut canonical: Vec<_> = all.iter().map(|(p, _)| p.canonicalize().unwrap()).collect();
        canonical.dedup();
        assert_eq!(canonical.len(), all.len());
        assert_eq!(Tool::Git.automatic(), Some(all[0].0.clone()));
        let git = probe(Tool::Git, &all[0].0.to_string_lossy());
        assert!(
            git.problem.is_none() && git.version.is_some(),
            "{:?}",
            git.problem
        );
        // git isn't tinymist; a folder, nothing and a non-program aren't programs.
        assert!(
            probe(Tool::Tinymist, &all[0].0.to_string_lossy())
                .problem
                .unwrap()
                .starts_with("That isn't tinymist")
        );
        assert_eq!(
            probe(Tool::Git, "/usr").problem.as_deref(),
            Some("That's a folder, not a program")
        );
        assert_eq!(
            probe(Tool::Git, "/nowhere/git").problem.as_deref(),
            Some("There's nothing at this path")
        );
        assert_eq!(
            probe(Tool::Git, "/etc/hosts").problem.as_deref(),
            Some("That file isn't a program (it can't be run)")
        );
        assert_eq!(
            probe(Tool::Git, "bin/git").problem.as_deref(),
            Some("Give the whole path, starting with / or ~/")
        );
        assert_eq!(source_of(Path::new("/opt/homebrew/bin")), "Homebrew");
        assert_eq!(source_of(&home().unwrap().join("tools/bin")), "~/tools/bin");
    }

    #[test]
    fn newest_node_version_wins() {
        let dir = std::env::temp_dir().join(format!("foreword-nvm-{}", std::process::id()));
        for v in ["v9.11.2", "v24.15.0", "v18.20.1"] {
            std::fs::create_dir_all(dir.join(v)).unwrap();
        }
        assert_eq!(newest_version(&dir), Some(dir.join("v24.15.0")));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn chosen_paths_come_from_the_settings_file() {
        let settings = r#"{ "toolPaths": { "tinymist": " /opt/tm/tinymist ", "git": "~/bin/git", "opencode": "" } }"#;
        assert_eq!(
            configured_in(settings, Tool::Tinymist),
            Some(PathBuf::from("/opt/tm/tinymist"))
        );
        assert_eq!(
            configured_in(settings, Tool::Git),
            Some(home().unwrap().join("bin/git"))
        );
        assert_eq!(configured_in(settings, Tool::OpenCode), None);
        assert_eq!(configured_in(r#"{ "sendKey": "enter" }"#, Tool::Git), None);
        assert_eq!(
            configured_in(r#"{ "toolPaths": { "git": 3 } }"#, Tool::Git),
            None
        );
        assert_eq!(configured_in("{ not json", Tool::Git), None);
    }
}
