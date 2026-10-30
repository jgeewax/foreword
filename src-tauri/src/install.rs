//! The assistants' programs. Foreword runs the author's own copy when it can:
//! OpenCode 2.x, or Claude Code, Codex or Gemini CLI at least as new as the
//! version Foreword pins. Otherwise it installs its own, once, when asked:
//! only into its data folder, never anywhere else on the Mac, and always from
//! the maker's own release. OpenCode from its GitHub releases; Claude Code's,
//! Codex's and Gemini CLI's packages from npm, with Node.js from nodejs.org to
//! run them when the Mac has no Node.js 22 or newer; Antigravity's connector
//! from Google. The versions are pinned, as tried with this release of
//! Foreword: a newer connector may speak a newer protocol.
use std::{
    ffi::OsString,
    path::{Path, PathBuf},
    process::Stdio,
    sync::{LazyLock, OnceLock},
    time::{Duration, Instant},
};

use futures_util::StreamExt;
use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::ipc::Channel;
use tokio::{io::AsyncWriteExt, process::Command};

use crate::{
    discover,
    error::{CmdError, CmdResult},
};

/// OpenCode, from its GitHub releases.
pub const OPENCODE: &str = "2.2.2";
/// The connectors, from npm: the Agent Client Protocol project's for Claude
/// Code and Codex, and Gemini CLI itself.
pub const CLAUDE_ACP: &str = "0.93.0";
pub const CODEX_ACP: &str = "2.2.2";
pub const GEMINI_CLI: &str = "0.64.0";
/// Google's Antigravity connector (the ACP registry's antigravity-acp), from dl.google.com.
pub const ANTIGRAVITY_ACP: &str = "1.4.1";
/// The programs those connectors run: Claude Code as in claude-agent-sdk
/// 0.3.300 (the connector's), and Codex as installed beside its connector. The
/// author's own copy runs in their place when it's at least this new.
pub const CLAUDE_CODE: &str = "2.1.300";
pub const CODEX: &str = "0.160.1";
/// Node.js runs the connectors: the author's when it's 22 or newer (Claude
/// Code's connector needs 22), otherwise this one, from nodejs.org.
pub const NODE: &str = "24.22.2";
const NODE_MAJOR: u64 = 22;
/// Google LLC's Apple Developer ID team, which Antigravity's programs must be signed by.
const GOOGLE_TEAM: &str = "EQHXZ8M8AV";

static DATA_DIR: OnceLock<PathBuf> = OnceLock::new();

/// Where Foreword's own copies go: the app's data folder (set at startup).
pub fn init(data_dir: PathBuf) {
    let _ = DATA_DIR.set(data_dir);
}

/// The folder of Foreword's own copies (FOREWORD_ASSISTANTS_DIR, for self-tests).
pub fn assistants_dir() -> Option<PathBuf> {
    std::env::var_os("FOREWORD_ASSISTANTS_DIR")
        .map(PathBuf::from)
        .or_else(|| DATA_DIR.get().map(|d| d.join("assistants")))
}

fn kept(name: &str) -> Option<PathBuf> {
    Some(assistants_dir()?.join(name))
}

fn executable(p: PathBuf) -> Option<PathBuf> {
    discover::is_executable(&p).then_some(p)
}

/// FOREWORD_ONLY_OURS (self-tests): as on a Mac with none of the author's own installed.
pub fn only_ours() -> bool {
    std::env::var_os("FOREWORD_ONLY_OURS").is_some()
}

fn intel() -> bool {
    std::env::consts::ARCH == "x86_64"
}

/// Whether `version` ("2.1.312") is `floor` or newer, comparing numbers.
fn at_least(version: &str, floor: &str) -> bool {
    let parts =
        |v: &str| -> Vec<u64> { v.split(['.', '-']).map_while(|p| p.parse().ok()).collect() };
    parts(version) >= parts(floor)
}

/// A file Foreword downloads: where from, its size, and the SHA-256 it must have.
pub struct Download {
    pub url: String,
    pub bytes: u64,
    sha256: Option<&'static str>,
}

/// Node.js for this Mac (the SHA-256 from the release's SHASUMS256.txt).
fn node_download() -> Download {
    let (arch, sha256, bytes) = if intel() {
        (
            "x64",
            "6965578fd823e72c1b5387f5ab84cb25368f886e02eb8779e6f0fce6b91c27b7",
            29_283_332,
        )
    } else {
        (
            "arm64",
            "1f5ac075be50bed4780ea3be19a007fda95ea4d527d28d76d0b91de47d915115",
            27_508_812,
        )
    };
    Download {
        url: format!("https://nodejs.org/dist/v{NODE}/node-v{NODE}-darwin-{arch}.tar.xz"),
        bytes,
        sha256: Some(sha256),
    }
}

/// OpenCode for this Mac (the SHA-256 GitHub lists for the release's file).
fn opencode_download() -> Download {
    let (arch, sha256, bytes) = if intel() {
        (
            "x64",
            "898677aa3c686326a37eda1e5875a45c6d1510717ac663236aa200e913b13cff",
            108_489_323,
        )
    } else {
        (
            "arm64",
            "c1c901a6379d667b7a30a3eea5a8f6e93416dba43e889e834771f6fb174f35c9",
            103_297_720,
        )
    };
    Download {
        url: format!(
            "https://github.com/anomalyco/opencode/releases/download/v{OPENCODE}/opencode-darwin-{arch}.zip"
        ),
        bytes,
        sha256: Some(sha256),
    }
}

/// Antigravity's connector for this Mac, as dl.google.com serves it (its
/// programs are checked for Google's signature instead).
pub fn antigravity_download() -> Download {
    let (arch, bytes) = if intel() {
        ("x86_64", 118_349_036)
    } else {
        ("arm64", 112_737_434)
    };
    Download {
        url: format!(
            "https://dl.google.com/agy-extensions/releases/macos/agy-acp-server-{ANTIGRAVITY_ACP}-darwin-{arch}.zip"
        ),
        bytes,
        sha256: None,
    }
}

/// What Foreword installs from npm for an assistant, and where its pieces are
/// inside the folder's node_modules.
struct Package {
    /// Its folder in the assistants folder; other versions share the prefix.
    dir: String,
    prefix: &'static str,
    specs: Vec<String>,
    /// The connector's script, which Node.js runs.
    script: &'static str,
    /// The program inside it (Claude Code, Codex), which the author's own can replace.
    program: Option<String>,
    /// About how much npm downloads: with the program inside, and without it.
    bytes: u64,
    lean_bytes: u64,
}

fn package(kind: &str) -> Option<Package> {
    let arch = if intel() {
        "darwin-x64"
    } else {
        "darwin-arm64"
    };
    let triple = if intel() {
        "x86_64-apple-darwin"
    } else {
        "aarch64-apple-darwin"
    };
    Some(match kind {
        "claude" => Package {
            dir: format!("claude-acp-{CLAUDE_ACP}"),
            prefix: "claude-acp-",
            specs: vec![format!(
                "@agentclientprotocol/claude-agent-acp@{CLAUDE_ACP}"
            )],
            script: "@agentclientprotocol/claude-agent-acp/dist/index.js",
            program: Some(format!("@anthropic-ai/claude-agent-sdk-{arch}/claude")),
            bytes: 153_000_000,
            lean_bytes: 41_000_000,
        },
        "codex" => Package {
            dir: format!("codex-acp-{CODEX_ACP}"),
            prefix: "codex-acp-",
            // Codex itself named too: the connector asks for ^0.160.1, which would take the newest.
            specs: vec![
                format!("@agentclientprotocol/codex-acp@{CODEX_ACP}"),
                format!("@openai/codex@{CODEX}"),
            ],
            script: "@agentclientprotocol/codex-acp/dist/index.js",
            program: Some(format!("@openai/codex-{arch}/vendor/{triple}/bin/codex")),
            bytes: 155_000_000,
            lean_bytes: 27_000_000,
        },
        "gemini" => Package {
            dir: format!("gemini-cli-{GEMINI_CLI}"),
            prefix: "gemini-cli-",
            specs: vec![format!("@google/gemini-cli@{GEMINI_CLI}")],
            script: "@google/gemini-cli/bundle/gemini.js",
            program: None,
            bytes: 25_000_000,
            lean_bytes: 25_000_000,
        },
        _ => return None,
    })
}

fn package_dir(p: &Package) -> Option<PathBuf> {
    kept(&p.dir)
}

fn our_script(kind: &str) -> Option<PathBuf> {
    let p = package(kind)?;
    let f = package_dir(&p)?.join("node_modules").join(p.script);
    f.is_file().then_some(f)
}

fn our_program(kind: &str) -> Option<PathBuf> {
    let p = package(kind)?;
    executable(package_dir(&p)?.join("node_modules").join(p.program?))
}

fn node_dir() -> Option<PathBuf> {
    kept(&format!("node-v{NODE}"))
}

fn our_node() -> Option<PathBuf> {
    executable(node_dir()?.join("bin/node"))
}

fn antigravity_dir() -> Option<PathBuf> {
    kept(&format!("antigravity-acp-{ANTIGRAVITY_ACP}"))
}

/// Antigravity's connector: FOREWORD_ANTIGRAVITY_ACP, or Foreword's copy.
fn antigravity_program() -> Option<PathBuf> {
    if let Some(p) = std::env::var_os("FOREWORD_ANTIGRAVITY_ACP").map(PathBuf::from)
        && discover::is_executable(&p)
    {
        return Some(p);
    }
    executable(antigravity_dir()?.join("agy_acp_server.par"))
}

/// Foreword's own OpenCode, listed after the author's copies (Settings ▸ Tools).
pub fn opencode_copy() -> Option<(PathBuf, String)> {
    let p = executable(kept(&format!("opencode-{OPENCODE}"))?.join("opencode"))?;
    Some((p, "installed by Foreword".into()))
}

/// The author's own Claude Code, Codex or Gemini CLI, when it's new enough to
/// run in place of Foreword's.
pub fn yours(kind: &str) -> Option<PathBuf> {
    if only_ours() {
        return None;
    }
    let (name, var, floor) = match kind {
        "claude" => ("claude", "FOREWORD_CLAUDE", CLAUDE_CODE),
        "codex" => ("codex", "FOREWORD_CODEX", CODEX),
        "gemini" => ("gemini", "FOREWORD_GEMINI", GEMINI_CLI),
        _ => return None,
    };
    discover::find(name, var)
        .filter(|p| discover::version_of(p).is_some_and(|v| at_least(&v, floor)))
}

/// Node.js to run the connectors: the author's if it's 22 or newer, else Foreword's.
pub fn node() -> Option<PathBuf> {
    let major = |p: &PathBuf| {
        discover::version_of(p)
            .and_then(|v| v.split('.').next()?.parse::<u64>().ok())
            .is_some_and(|m| m >= NODE_MAJOR)
    };
    (!only_ours())
        .then(|| discover::find("node", "FOREWORD_NODE"))
        .flatten()
        .filter(major)
        .or_else(our_node)
}

/// npm as it comes with a Node.js: `<prefix>/lib/node_modules/npm/bin/npm-cli.js`.
fn npm_cli(node: &Path) -> Option<PathBuf> {
    let real = node.canonicalize().ok()?;
    let cli = real
        .parent()?
        .parent()?
        .join("lib/node_modules/npm/bin/npm-cli.js");
    cli.is_file().then_some(cli)
}

/// Node.js and its npm, to install a connector with: the author's (new
/// enough, with its npm beside it) or Foreword's.
fn node_and_npm() -> Option<(PathBuf, PathBuf)> {
    let with_npm = |n: PathBuf| npm_cli(&n).map(|cli| (n, cli));
    node()
        .and_then(with_npm)
        .or_else(|| our_node().and_then(with_npm))
}

/// The search path for a program run by `node`: Node.js's folder first, so
/// what the program starts with `node` is the same one.
pub fn path_with(node: &Path) -> OsString {
    let mut dirs: Vec<PathBuf> = node.parent().map(Path::to_path_buf).into_iter().collect();
    dirs.extend(std::env::split_paths(&discover::search_path()));
    std::env::join_paths(dirs).unwrap_or_else(|_| discover::search_path())
}

/// The assistant's own program in use: the author's when it's new enough,
/// otherwise Foreword's copy (for Gemini CLI, its script, which Node.js runs).
pub fn program(kind: &str) -> Option<PathBuf> {
    match kind {
        "opencode" => discover::find_opencode(),
        "antigravity" => antigravity_program(),
        "claude" | "codex" => yours(kind).or_else(|| our_program(kind)),
        "gemini" => yours(kind).or_else(|| our_script(kind)),
        _ => None,
    }
}

/// `program` is Foreword's own copy, not the author's.
pub fn is_ours(program: &Path) -> bool {
    assistants_dir().is_some_and(|d| program.starts_with(d))
}

/// The version of an assistant's program: as pinned, for Foreword's copy.
pub fn version(kind: &str, program: &Path) -> Option<String> {
    if !is_ours(program) {
        return discover::version_of(program);
    }
    Some(
        match kind {
            "opencode" => OPENCODE,
            "claude" => CLAUDE_CODE,
            "codex" => CODEX,
            "gemini" => GEMINI_CLI,
            _ => ANTIGRAVITY_ACP,
        }
        .into(),
    )
}

/// How an ACP assistant starts: the program, its arguments, what to add to
/// its environment, and its search path.
pub struct Launch {
    pub program: PathBuf,
    pub args: Vec<String>,
    pub env: Vec<(&'static str, PathBuf)>,
    pub path: OsString,
}

fn not_installed(kind: &str) -> CmdError {
    let name = match kind {
        "claude" => "Claude Code",
        "codex" => "Codex",
        "gemini" => "Gemini CLI",
        "antigravity" => "Antigravity",
        _ => "OpenCode",
    };
    CmdError::NotInstalled(format!(
        "{name} isn't installed yet: Foreword can install its own copy (Settings ▸ Assistant)."
    ))
}

/// Start Claude Code, Codex, Gemini CLI or Antigravity: the connector, run by
/// Node.js, with the assistant's program (the author's or Foreword's).
pub fn launch(kind: &str) -> CmdResult<Launch> {
    let missing = || not_installed(kind);
    match kind {
        "antigravity" => Ok(Launch {
            program: antigravity_program().ok_or_else(missing)?,
            args: vec![],
            env: vec![],
            path: discover::search_path(),
        }),
        // Gemini CLI is its own ACP program, with --acp.
        "gemini" => match yours(kind) {
            Some(gemini) => Ok(Launch {
                program: gemini,
                args: vec!["--acp".into()],
                env: vec![],
                path: discover::search_path(),
            }),
            None => {
                let script = our_script(kind).ok_or_else(missing)?;
                let node = node().ok_or_else(missing)?;
                Ok(Launch {
                    path: path_with(&node),
                    program: node,
                    args: vec![script.to_string_lossy().into_owned(), "--acp".into()],
                    env: vec![],
                })
            }
        },
        "claude" | "codex" => {
            let (var, over) = match kind {
                "claude" => ("CLAUDE_CODE_EXECUTABLE", "FOREWORD_CLAUDE_ACP"),
                _ => ("CODEX_PATH", "FOREWORD_CODEX_ACP"),
            };
            // A connector given by hand (probes and tests), as it is.
            if let Some(p) = std::env::var_os(over).map(PathBuf::from)
                && discover::is_executable(&p)
            {
                return Ok(Launch {
                    program: p,
                    args: vec![],
                    env: vec![],
                    path: discover::search_path(),
                });
            }
            let script = our_script(kind).ok_or_else(missing)?;
            let program = program(kind).ok_or_else(missing)?;
            let node = node().ok_or_else(missing)?;
            Ok(Launch {
                path: path_with(&node),
                program: node,
                args: vec![script.to_string_lossy().into_owned()],
                env: vec![(var, program)],
            })
        }
        _ => Err(CmdError::Invalid(format!("unknown assistant {kind}"))),
    }
}

/// What installing an assistant would fetch, shown before it's asked for.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Plan {
    /// Where from: "github" (OpenCode's releases), "npm" or "google".
    source: &'static str,
    version: String,
    /// About how much it downloads, Node.js included.
    bytes: u64,
    /// Node.js comes too: the Mac has none new enough.
    node: bool,
    /// The author's own program it runs, in place of the one in the connector.
    yours: Option<String>,
    /// Foreword has an older copy of its own: this replaces it.
    update: bool,
}

/// Another version of Foreword's own copy (`prefix`…), from an earlier release.
fn older_copy(prefix: &str, current: &str) -> bool {
    assistants_dir().is_some_and(|dir| older_copy_in(&dir, prefix, current))
}

fn older_copy_in(dir: &Path, prefix: &str, current: &str) -> bool {
    std::fs::read_dir(dir).is_ok_and(|entries| {
        entries.flatten().any(|e| {
            let name = e.file_name().to_string_lossy().into_owned();
            name.starts_with(prefix) && name != current && !name.ends_with(".part")
        })
    })
}

/// What installing `kind` would fetch; None when it can run as it is.
pub fn plan(kind: &str) -> Option<Plan> {
    let text = |p: PathBuf| p.to_string_lossy().into_owned();
    match kind {
        "opencode" => discover::find_opencode().is_none().then(|| Plan {
            source: "github",
            version: OPENCODE.into(),
            bytes: opencode_download().bytes,
            node: false,
            yours: None,
            update: older_copy("opencode-", &format!("opencode-{OPENCODE}")),
        }),
        "antigravity" => antigravity_program().is_none().then(|| Plan {
            source: "google",
            version: ANTIGRAVITY_ACP.into(),
            bytes: antigravity_download().bytes,
            node: false,
            yours: None,
            update: older_copy(
                "antigravity-acp-",
                &format!("antigravity-acp-{ANTIGRAVITY_ACP}"),
            ),
        }),
        "claude" | "codex" | "gemini" => {
            if launch(kind).is_ok() {
                return None;
            }
            let p = package(kind)?;
            let theirs = yours(kind).filter(|_| p.program.is_some());
            let missing = our_script(kind).is_none() || program(kind).is_none();
            let node = if missing {
                node_and_npm().is_none()
            } else {
                node().is_none()
            };
            let package_bytes = match (missing, theirs.is_some()) {
                (false, _) => 0,
                (true, true) => p.lean_bytes,
                (true, false) => p.bytes,
            };
            Some(Plan {
                source: "npm",
                version: p.specs[0].rsplit('@').next().unwrap_or_default().into(),
                bytes: package_bytes + if node { node_download().bytes } else { 0 },
                node,
                yours: theirs.map(text),
                update: older_copy(p.prefix, &p.dir),
            })
        }
        _ => None,
    }
}

/// What installing `kind` would fetch, for one assistant (its start failed:
/// is it an update, to install without asking?).
#[tauri::command]
pub async fn assistant_plan(kind: String) -> CmdResult<Option<Plan>> {
    Ok(tauri::async_runtime::spawn_blocking(move || plan(&kind)).await?)
}

static INSTALLING: LazyLock<tokio::sync::Mutex<()>> = LazyLock::new(|| tokio::sync::Mutex::new(()));

fn say(on_progress: &Channel<serde_json::Value>, step: &str, received: u64, total: Option<u64>) {
    let _ =
        on_progress.send(serde_json::json!({ "step": step, "received": received, "total": total }));
}

/// Settings ▸ Assistant, or the chat: install Foreword's own copy of an
/// assistant, once. Progress goes to `on_progress` as `{"step", "received",
/// "total"}` (bytes): step "node" while Node.js downloads, "download" for the
/// assistant, "checking" while it's checked and unpacked. Nothing half-done is
/// ever used: each copy goes in under a temporary name, and is renamed when
/// it's whole. Other versions of Foreword's copy are removed after.
#[tauri::command]
pub async fn assistant_install(
    kind: String,
    on_progress: Channel<serde_json::Value>,
) -> CmdResult<()> {
    let _one = INSTALLING.lock().await;
    let dir = assistants_dir()
        .ok_or_else(|| CmdError::Unavailable("there's no folder to install it in".into()))?;
    tokio::fs::create_dir_all(&dir).await?;
    let k = kind.clone();
    let planned = tauri::async_runtime::spawn_blocking(move || plan(&k).is_some()).await?;
    if !planned {
        return Ok(());
    }
    match kind.as_str() {
        "opencode" => install_opencode(&dir, &on_progress).await?,
        "antigravity" => install_antigravity(&dir, &on_progress).await?,
        "claude" | "codex" | "gemini" => {
            let has_npm = tauri::async_runtime::spawn_blocking(|| node_and_npm().is_some()).await?;
            if !has_npm {
                install_node(&dir, &on_progress).await?;
            }
            let k = kind.clone();
            let has_package = tauri::async_runtime::spawn_blocking(move || {
                our_script(&k).is_some() && program(&k).is_some()
            })
            .await?;
            if !has_package {
                install_package(&kind, &dir, &on_progress).await?;
            }
        }
        _ => return Err(CmdError::Invalid(format!("unknown assistant {kind}"))),
    }
    let k = kind.clone();
    match tauri::async_runtime::spawn_blocking(move || plan(&k).is_none()).await? {
        true => Ok(()),
        false => Err(CmdError::Io(format!(
            "{kind} was installed, but it doesn't run"
        ))),
    }
}

/// Download `d` to `to`, saying how far it's got, then check its SHA-256.
async fn fetch(
    d: &Download,
    to: &Path,
    step: &str,
    on_progress: &Channel<serde_json::Value>,
) -> CmdResult<()> {
    let res = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(30))
        .build()?
        .get(&d.url)
        .send()
        .await?;
    if !res.status().is_success() {
        return Err(CmdError::Unavailable(format!(
            "{}: HTTP {}",
            d.url,
            res.status()
        )));
    }
    let total = res.content_length().or(Some(d.bytes));
    let mut file = tokio::fs::File::create(to).await?;
    let mut hash = Sha256::new();
    let mut received = 0u64;
    let mut said = Instant::now();
    let mut body = res.bytes_stream();
    while let Some(chunk) = body.next().await {
        let chunk = chunk?;
        file.write_all(&chunk).await?;
        hash.update(&chunk);
        received += chunk.len() as u64;
        if said.elapsed() >= Duration::from_millis(150) {
            said = Instant::now();
            say(on_progress, step, received, total);
        }
    }
    file.flush().await?;
    drop(file);
    say(on_progress, "checking", received, total);
    if let Some(want) = d.sha256
        && hex::encode(hash.finalize()) != want
    {
        let _ = tokio::fs::remove_file(to).await;
        return Err(CmdError::Invalid(format!(
            "{} isn't the file that was published (its checksum is different), so it wasn't kept",
            d.url
        )));
    }
    Ok(())
}

/// Unpack an archive into a new, empty `dest`: a zip with ditto, or a .tar.xz
/// (its top folder left out) with tar.
async fn unpack(archive: &Path, dest: &Path) -> CmdResult<()> {
    let _ = tokio::fs::remove_dir_all(dest).await;
    tokio::fs::create_dir_all(dest).await?;
    let mut command = if archive.to_string_lossy().contains(".tar.xz") {
        let mut c = Command::new("/usr/bin/tar");
        c.arg("-xJf")
            .arg(archive)
            .arg("-C")
            .arg(dest)
            .arg("--strip-components")
            .arg("1");
        c
    } else {
        let mut c = Command::new("/usr/bin/ditto");
        c.args(["-x", "-k"]).arg(archive).arg(dest);
        c
    };
    if !command.status().await?.success() {
        return Err(CmdError::Io("couldn't unpack the download".into()));
    }
    Ok(())
}

/// Put a whole copy in its place (`part` → `dest`), then remove the copies of
/// other versions (named `prefix`…), which won't run again.
async fn keep(part: &Path, dest: &Path, prefix: &str) -> CmdResult<()> {
    let _ = tokio::fs::remove_dir_all(dest).await;
    tokio::fs::rename(part, dest).await?;
    let (Some(dir), Some(name)) = (dest.parent(), dest.file_name()) else {
        return Ok(());
    };
    if let Ok(mut entries) = tokio::fs::read_dir(dir).await {
        while let Ok(Some(e)) = entries.next_entry().await {
            let other = e.file_name();
            if other.to_string_lossy().starts_with(prefix) && other != name {
                let _ = tokio::fs::remove_dir_all(e.path()).await;
            }
        }
    }
    Ok(())
}

/// Download, check and unpack `d` as `dir/name`, through `name.part`.
async fn install_download(
    dir: &Path,
    name: &str,
    archive_ext: &str,
    d: &Download,
    step: &str,
    on_progress: &Channel<serde_json::Value>,
) -> CmdResult<PathBuf> {
    let archive = dir.join(format!("{name}{archive_ext}.part"));
    let part = dir.join(format!("{name}.part"));
    let fetched = fetch(d, &archive, step, on_progress).await;
    let unpacked = match fetched {
        Ok(()) => unpack(&archive, &part).await,
        Err(e) => Err(e),
    };
    let _ = tokio::fs::remove_file(&archive).await;
    if let Err(e) = unpacked {
        let _ = tokio::fs::remove_dir_all(&part).await;
        return Err(e);
    }
    Ok(part)
}

/// Whether `program --version` runs and names `version`.
async fn runs_as(program: &Path, version: &str) -> bool {
    Command::new(program)
        .arg("--version")
        .stdin(Stdio::null())
        .output()
        .await
        .is_ok_and(|o| String::from_utf8_lossy(&o.stdout).contains(version))
}

async fn install_node(dir: &Path, on_progress: &Channel<serde_json::Value>) -> CmdResult<()> {
    let name = format!("node-v{NODE}");
    let part =
        install_download(dir, &name, ".tar.xz", &node_download(), "node", on_progress).await?;
    if !runs_as(&part.join("bin/node"), NODE).await {
        let _ = tokio::fs::remove_dir_all(&part).await;
        return Err(CmdError::Io("the Node.js downloaded doesn't run".into()));
    }
    keep(&part, &dir.join(name), "node-v").await
}

async fn install_opencode(dir: &Path, on_progress: &Channel<serde_json::Value>) -> CmdResult<()> {
    let name = format!("opencode-{OPENCODE}");
    let part = install_download(
        dir,
        &name,
        ".zip",
        &opencode_download(),
        "download",
        on_progress,
    )
    .await?;
    if !runs_as(&part.join("opencode"), OPENCODE).await {
        let _ = tokio::fs::remove_dir_all(&part).await;
        return Err(CmdError::Io("the OpenCode downloaded doesn't run".into()));
    }
    keep(&part, &dir.join(name), "opencode-").await
}

/// Antigravity's connector isn't on npm: Google's build of it, kept only if
/// both programs in it are signed by Google.
async fn install_antigravity(
    dir: &Path,
    on_progress: &Channel<serde_json::Value>,
) -> CmdResult<()> {
    let name = format!("antigravity-acp-{ANTIGRAVITY_ACP}");
    let part = install_download(
        dir,
        &name,
        ".zip",
        &antigravity_download(),
        "download",
        on_progress,
    )
    .await?;
    for program in ["agy_acp_server.par", "localharness_external"] {
        if !signed_by_google(&part.join(program)).await {
            let _ = tokio::fs::remove_dir_all(&part).await;
            return Err(CmdError::Invalid(format!(
                "{program} in the download isn't signed by Google, so it wasn't kept"
            )));
        }
    }
    keep(&part, &dir.join(name), "antigravity-acp-").await
}

/// Whether macOS finds a program intact and signed with Google's Developer ID.
async fn signed_by_google(path: &Path) -> bool {
    let intact = Command::new("/usr/bin/codesign")
        .args(["--verify", "--strict"])
        .arg(path)
        .status()
        .await
        .is_ok_and(|s| s.success());
    let team = format!("TeamIdentifier={GOOGLE_TEAM}");
    let google = Command::new("/usr/bin/codesign")
        .arg("-dv")
        .arg(path)
        .output()
        .await
        .is_ok_and(|o| {
            String::from_utf8_lossy(&o.stderr)
                .lines()
                .any(|l| l.trim() == team)
        });
    intact && google
}

/// How much is in a folder, in bytes (npm's download so far, in its cache).
fn size_of(dir: &Path) -> u64 {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return 0;
    };
    entries
        .flatten()
        .map(|e| match e.file_type() {
            Ok(t) if t.is_dir() => size_of(&e.path()),
            _ => e.metadata().map(|m| m.len()).unwrap_or(0),
        })
        .sum()
}

/// npm's arguments to install `specs` into `prefix`, from the npm registry
/// itself, whatever the author's npm settings say: its own cache and empty
/// settings files, no install scripts (none of these packages has any), and,
/// when the author's own program runs in place of the one inside (`lean`),
/// without the optional packages that carry it.
fn npm_args(
    prefix: &Path,
    cache: &Path,
    user_rc: &Path,
    global_rc: &Path,
    lean: bool,
    specs: &[String],
) -> Vec<OsString> {
    let mut args: Vec<OsString> = vec!["install".into(), "--prefix".into(), prefix.into()];
    args.extend(["--cache".into(), cache.into()]);
    args.extend(["--userconfig".into(), user_rc.into()]);
    args.extend(["--globalconfig".into(), global_rc.into()]);
    for flag in [
        "--registry=https://registry.npmjs.org/",
        "--no-audit",
        "--no-fund",
        "--no-update-notifier",
        "--ignore-scripts",
        "--no-save",
        "--loglevel=error",
    ] {
        args.push(flag.into());
    }
    if lean {
        args.push("--omit=optional".into());
    }
    args.extend(specs.iter().map(OsString::from));
    args
}

async fn install_package(
    kind: &str,
    dir: &Path,
    on_progress: &Channel<serde_json::Value>,
) -> CmdResult<()> {
    let p = package(kind).ok_or_else(|| CmdError::Invalid(format!("unknown assistant {kind}")))?;
    let k = kind.to_string();
    let (found, lean) = tauri::async_runtime::spawn_blocking(move || {
        let lean = package(&k).is_some_and(|p| p.program.is_some()) && yours(&k).is_some();
        (node_and_npm(), lean)
    })
    .await?;
    let (node, npm) = found
        .ok_or_else(|| CmdError::Unavailable("Node.js isn't there to install it with".into()))?;
    let part = dir.join(format!("{}.part", p.dir));
    let cache = dir.join("npm-cache.part");
    let (user_rc, global_rc) = (dir.join("npm-user.rc"), dir.join("npm-global.rc"));
    let log = dir.join("npm.log");
    let _ = tokio::fs::remove_dir_all(&part).await;
    let _ = tokio::fs::remove_dir_all(&cache).await;
    tokio::fs::write(&user_rc, "").await?;
    tokio::fs::write(&global_rc, "").await?;
    let total = if lean { p.lean_bytes } else { p.bytes };
    let mut child = Command::new(&node)
        .arg(&npm)
        .args(npm_args(
            &part, &cache, &user_rc, &global_rc, lean, &p.specs,
        ))
        .current_dir(dir)
        .env("PATH", path_with(&node))
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(std::fs::File::create(&log)?)
        .kill_on_drop(true)
        .spawn()?;
    let status = loop {
        tokio::select! {
            status = child.wait() => break status?,
            _ = tokio::time::sleep(Duration::from_millis(300)) => {
                say(on_progress, "download", size_of(&cache).min(total), Some(total));
            }
        }
    };
    let _ = tokio::fs::remove_dir_all(&cache).await;
    let said = tokio::fs::read_to_string(&log).await.unwrap_or_default();
    let _ = tokio::fs::remove_file(&log).await;
    let script = part.join("node_modules").join(p.script);
    let program = p
        .program
        .as_ref()
        .map(|prog| part.join("node_modules").join(prog));
    let whole = status.success()
        && script.is_file()
        && (lean || program.as_deref().is_none_or(discover::is_executable));
    if !whole {
        let _ = tokio::fs::remove_dir_all(&part).await;
        let why = said
            .lines()
            .rev()
            .find(|l| !l.trim().is_empty())
            .unwrap_or("it stopped without saying why");
        return Err(CmdError::Unavailable(format!(
            "npm couldn't install it: {why}"
        )));
    }
    say(on_progress, "checking", total, Some(total));
    keep(&part, &dir.join(&p.dir), p.prefix).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn versions_compare_as_numbers() {
        assert!(at_least("2.1.312", "2.1.300"));
        assert!(at_least("2.1.300", "2.1.300"));
        assert!(!at_least("2.1.270", "2.1.300"));
        assert!(at_least("0.166.0", "0.160.1"));
        assert!(!at_least("0.64.0-nightly", "0.66.0"));
        assert!(at_least("24.15.0", "22"));
        assert!(!at_least("garbage", "1.0"));
    }

    #[test]
    fn downloads_are_the_makers_own_and_pinned() {
        let node = node_download();
        assert!(
            node.url
                .starts_with("https://nodejs.org/dist/v24.22.2/node-v24.22.2-darwin-"),
            "{}",
            node.url
        );
        assert_eq!(node.sha256.map(str::len), Some(64));
        let opencode = opencode_download();
        assert!(
            opencode.url.starts_with(
                "https://github.com/anomalyco/opencode/releases/download/v2.2.2/opencode-darwin-"
            ),
            "{}",
            opencode.url
        );
        assert_eq!(opencode.sha256.map(str::len), Some(64));
        assert!(opencode.bytes > 100_000_000);
        let google = antigravity_download();
        assert!(
            google.url.starts_with(
                "https://dl.google.com/agy-extensions/releases/macos/agy-acp-server-1.4.1-darwin-"
            ),
            "{}",
            google.url
        );
        // From npm, each at the version tried with this release.
        let claude = package("claude").unwrap();
        assert_eq!(
            claude.specs,
            ["@agentclientprotocol/claude-agent-acp@0.93.0"]
        );
        assert!(claude.program.unwrap().ends_with("/claude"));
        let codex = package("codex").unwrap();
        assert_eq!(
            codex.specs,
            [
                "@agentclientprotocol/codex-acp@2.2.2",
                "@openai/codex@0.160.1"
            ]
        );
        assert_eq!(
            package("gemini").unwrap().specs,
            ["@google/gemini-cli@0.64.0"]
        );
        assert!(package("opencode").is_none());
    }

    #[test]
    fn npm_takes_nothing_from_the_authors_settings() {
        let p = Path::new("/a/claude-acp-0.93.0.part");
        let args = npm_args(
            p,
            Path::new("/a/cache"),
            Path::new("/a/u.rc"),
            Path::new("/a/g.rc"),
            true,
            &["x@1".into()],
        );
        let args: Vec<String> = args
            .iter()
            .map(|a| a.to_string_lossy().into_owned())
            .collect();
        let at = |flag: &str| {
            args.iter()
                .position(|a| a == flag)
                .map(|i| args[i + 1].as_str())
        };
        assert_eq!(args[0], "install");
        assert_eq!(at("--prefix"), Some("/a/claude-acp-0.93.0.part"));
        assert_eq!(at("--cache"), Some("/a/cache"));
        assert_eq!(at("--userconfig"), Some("/a/u.rc"));
        assert_eq!(at("--globalconfig"), Some("/a/g.rc"));
        for flag in [
            "--registry=https://registry.npmjs.org/",
            "--ignore-scripts",
            "--omit=optional",
        ] {
            assert!(args.iter().any(|a| a == flag), "{flag} in {args:?}");
        }
        assert_eq!(args.last().map(String::as_str), Some("x@1"));
        let full = npm_args(p, p, p, p, false, &[]);
        assert!(!full.iter().any(|a| a == "--omit=optional"));
    }

    #[test]
    fn an_earlier_releases_copy_is_an_update() {
        let dir = std::env::temp_dir().join(format!(
            "foreword-install-{}",
            uuid::Uuid::new_v4().simple()
        ));
        std::fs::create_dir_all(dir.join("claude-acp-0.93.0.part")).unwrap();
        assert!(!older_copy_in(&dir, "claude-acp-", "claude-acp-0.93.0"));
        std::fs::create_dir_all(dir.join("claude-acp-0.93.0")).unwrap();
        assert!(!older_copy_in(&dir, "claude-acp-", "claude-acp-0.93.0"));
        std::fs::create_dir_all(dir.join("claude-acp-0.80.0")).unwrap();
        assert!(older_copy_in(&dir, "claude-acp-", "claude-acp-0.93.0"));
        assert!(!older_copy_in(&dir, "codex-acp-", "codex-acp-2.2.2"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Installs every assistant for real, as on a Mac with none of them, into
    /// a scratch folder; then starts each connector and checks it answers
    /// ACP's initialize. Downloads about 580 MB: run it by hand when the pins
    /// change, alone: `cargo test installs_for_real -- --ignored --nocapture`
    /// (FOREWORD_KEEP_INSTALLS=1 keeps the folder, to try them further).
    #[test]
    #[ignore]
    fn installs_for_real() {
        use std::io::{BufRead, Write};
        let dir = std::env::temp_dir().join(format!(
            "foreword-installs-{}",
            uuid::Uuid::new_v4().simple()
        ));
        // SAFETY: run alone, as above; nothing else reads these meanwhile.
        unsafe {
            std::env::set_var("FOREWORD_ASSISTANTS_DIR", &dir);
            std::env::set_var("FOREWORD_ONLY_OURS", "1");
        }
        for kind in ["opencode", "gemini", "claude", "codex", "antigravity"] {
            assert!(plan(kind).is_some(), "{kind} shouldn't be there yet");
            let steps = std::sync::Arc::new(std::sync::Mutex::new(Vec::<String>::new()));
            let seen = steps.clone();
            let channel = Channel::new(move |body| {
                if let tauri::ipc::InvokeResponseBody::Json(j) = body {
                    let v: serde_json::Value = serde_json::from_str(&j).unwrap_or_default();
                    let step = v["step"].as_str().unwrap_or("?").to_string();
                    let mut s = seen.lock().unwrap();
                    if s.last() != Some(&step) {
                        s.push(step);
                    }
                }
                Ok(())
            });
            let t0 = Instant::now();
            tauri::async_runtime::block_on(assistant_install(kind.into(), channel))
                .unwrap_or_else(|e| panic!("{kind}: {e}"));
            assert!(plan(kind).is_none(), "{kind} still needs installing");
            let program = program(kind).unwrap();
            assert!(is_ours(&program), "{kind}: {}", program.display());
            eprintln!(
                "{kind}: {}s, steps {:?}, {}",
                t0.elapsed().as_secs(),
                steps.lock().unwrap(),
                program.display()
            );
        }
        assert!(our_node().is_some(), "Node.js came too");
        assert!(
            discover::version_of(&program("claude").unwrap()).is_some_and(|v| v == CLAUDE_CODE)
        );
        assert!(discover::version_of(&program("codex").unwrap()).is_some_and(|v| v == CODEX));
        // Each connector starts and answers initialize.
        for kind in ["gemini", "claude", "codex", "antigravity"] {
            let l = launch(kind).unwrap();
            let mut child = std::process::Command::new(&l.program)
                .args(&l.args)
                .envs(l.env)
                .env("PATH", &l.path)
                .current_dir(&dir)
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::null())
                .spawn()
                .unwrap_or_else(|e| panic!("{kind}: {e}"));
            let mut stdin = child.stdin.take().unwrap();
            writeln!(
                stdin,
                r#"{{"jsonrpc":"2.0","id":1,"method":"initialize","params":{{"protocolVersion":1,"clientCapabilities":{{}}}}}}"#
            )
            .unwrap();
            let stdout = child.stdout.take().unwrap();
            let (tx, rx) = std::sync::mpsc::channel();
            std::thread::spawn(move || {
                for line in std::io::BufReader::new(stdout)
                    .lines()
                    .map_while(Result::ok)
                {
                    if line.contains(r#""id":1"#) {
                        let _ = tx.send(line);
                        return;
                    }
                }
            });
            let answer = rx.recv_timeout(Duration::from_secs(90));
            let _ = child.kill();
            let answer = answer.unwrap_or_else(|_| panic!("{kind} didn't answer initialize"));
            assert!(answer.contains(r#""result""#), "{kind}: {answer}");
            eprintln!("{kind} answers: {}…", &answer[..answer.len().min(120)]);
        }
        if std::env::var_os("FOREWORD_KEEP_INSTALLS").is_some() {
            eprintln!("kept in {}", dir.display());
        } else {
            let _ = std::fs::remove_dir_all(&dir);
        }
    }
}
