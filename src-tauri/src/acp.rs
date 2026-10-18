//! Assistants spoken to over the Agent Client Protocol (ACP): newline-delimited
//! JSON-RPC on an agent program's stdin and stdout. Claude Code, Gemini CLI,
//! Codex and Antigravity run this way, each through its ACP program. The
//! frontend speaks the protocol (src/services/agent/acp.ts); this runs the
//! program in the book's folder and carries its lines.
use std::{
    os::unix::fs::PermissionsExt,
    path::{Path, PathBuf},
    process::Stdio,
    sync::{LazyLock, OnceLock},
    time::{Duration, Instant},
};

use futures_util::StreamExt;

use serde::Serialize;
use tauri::{
    async_runtime::JoinHandle,
    ipc::{Channel, InvokeResponseBody},
};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::{Child, ChildStdin, Command},
};

use crate::{
    Win, children, discover,
    error::{CmdError, CmdResult},
    logs,
};

/// The ACP programs, pinned (a newer one may speak a newer protocol).
pub const CLAUDE_ACP: &str = "@agentclientprotocol/claude-agent-acp@0.93.0";
pub const GEMINI_CLI: &str = "@google/gemini-cli@0.64.0";
pub const CODEX_ACP: &str = "@agentclientprotocol/codex-acp@2.2.2";
/// Google's Antigravity connector (the ACP registry's antigravity-acp). It isn't
/// on npm: Typst Studio downloads Google's build of it, once, when asked.
pub const ANTIGRAVITY_ACP: &str = "1.4.1";
/// Google LLC's Apple Developer ID team, which the downloaded programs must be signed by.
const GOOGLE_TEAM: &str = "EQHXZ8M8AV";

/// Antigravity's download for this Mac, and its size in bytes (as dl.google.com says).
fn antigravity_download() -> (String, u64) {
    let (arch, bytes) = match std::env::consts::ARCH {
        "x86_64" => ("x86_64", 118_349_036),
        _ => ("arm64", 112_737_434),
    };
    (
        format!(
            "https://dl.google.com/agy-extensions/releases/macos/agy-acp-server-{ANTIGRAVITY_ACP}-darwin-{arch}.zip"
        ),
        bytes,
    )
}

static DATA_DIR: OnceLock<PathBuf> = OnceLock::new();

/// Where downloaded connectors go: the app's data folder (set at startup).
pub fn init(data_dir: PathBuf) {
    let _ = DATA_DIR.set(data_dir);
}

/// The folder of downloaded connectors (TYPST_STUDIO_ASSISTANTS_DIR, for self-tests).
fn assistants_dir() -> Option<PathBuf> {
    std::env::var_os("TYPST_STUDIO_ASSISTANTS_DIR")
        .map(PathBuf::from)
        .or_else(|| DATA_DIR.get().map(|d| d.join("assistants")))
}

fn antigravity_dir() -> Option<PathBuf> {
    Some(assistants_dir()?.join(format!("antigravity-acp-{ANTIGRAVITY_ACP}")))
}

/// Antigravity's connector: TYPST_STUDIO_ANTIGRAVITY_ACP, or the copy downloaded.
fn antigravity_program() -> Option<PathBuf> {
    if let Some(p) = std::env::var_os("TYPST_STUDIO_ANTIGRAVITY_ACP").map(PathBuf::from)
        && discover::is_executable(&p)
    {
        return Some(p);
    }
    let p = antigravity_dir()?.join("agy_acp_server.par");
    discover::is_executable(&p).then_some(p)
}

pub struct AcpProcess {
    child: Child,
    stdin: ChildStdin,
    reader: JoinHandle<()>,
}

impl AcpProcess {
    /// Stop the program and anything it started (npx runs the agent as its child).
    pub fn kill(&mut self) {
        self.reader.abort();
        if let Some(pid) = self.child.id() {
            children::unregister(pid);
            // SAFETY: a plain kill(2) of the process group the child leads.
            unsafe { libc::kill(-(pid as i32), libc::SIGTERM) };
        }
        let _ = self.child.start_kill();
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AcpInfo {
    program: String,
    args: Vec<String>,
}

/// The npm package npx runs for an assistant that isn't installed.
fn package(kind: &str) -> Option<&'static str> {
    match kind {
        "claude" => Some(CLAUDE_ACP),
        "gemini" => Some(GEMINI_CLI),
        "codex" => Some(CODEX_ACP),
        _ => None,
    }
}

/// The assistant's own ACP program, if it's installed.
fn own_program(kind: &str) -> Option<PathBuf> {
    match kind {
        "claude" => discover::find("claude-agent-acp", "TYPST_STUDIO_CLAUDE_ACP"),
        "gemini" => discover::find("gemini", "TYPST_STUDIO_GEMINI"),
        "codex" => discover::find("codex-acp", "TYPST_STUDIO_CODEX_ACP"),
        "antigravity" => antigravity_program(),
        _ => None,
    }
}

fn npx() -> Option<PathBuf> {
    discover::find("npx", "TYPST_STUDIO_NPX")
}

/// How each assistant is started: its own command if it's installed, otherwise
/// its npm package through npx (downloaded the first time). Antigravity's is
/// downloaded from Google beforehand, in Settings ▸ Assistant.
pub fn launch(kind: &str) -> CmdResult<(PathBuf, Vec<String>)> {
    if kind == "antigravity" {
        return antigravity_program()
            .map(|p| (p, vec![]))
            .ok_or_else(|| {
                CmdError::Unavailable(
                    "its connector isn't downloaded yet. Download it from Google in Settings ▸ Assistant."
                        .into(),
                )
            });
    }
    let package =
        package(kind).ok_or_else(|| CmdError::Invalid(format!("unknown assistant {kind}")))?;
    // Gemini CLI is its own ACP program, with --acp.
    let extra: Vec<String> = match kind {
        "gemini" => vec!["--acp".into()],
        _ => vec![],
    };
    if let Some(bin) = own_program(kind) {
        return Ok((bin, extra));
    }
    let npx = npx().ok_or_else(|| {
        CmdError::Unavailable(
            "Node.js isn't installed (it runs the assistant's connector). In Terminal: brew install node"
                .into(),
        )
    })?;
    let mut args = vec!["-y".to_string(), package.to_string()];
    args.extend(extra);
    Ok((npx, args))
}

fn name_of(kind: &str) -> Option<&'static str> {
    match kind {
        "opencode" => Some("OpenCode"),
        "claude" => Some("Claude Code"),
        "gemini" => Some("Gemini CLI"),
        "codex" => Some("Codex"),
        "antigravity" => Some("Antigravity"),
        _ => None,
    }
}

/// Signing in to an assistant, once, in Terminal (each program keeps its login).
struct SignIn {
    /// The command as the author would type it.
    shown: String,
    /// The program and its arguments, as run.
    argv: Vec<String>,
    /// What to do once it's running.
    steps: &'static str,
}

/// The assistant's own command if it's installed, otherwise its npm package
/// through npx. None: neither can run.
fn sign_in(kind: &str) -> Option<SignIn> {
    let text = |p: PathBuf| p.to_string_lossy().into_owned();
    if kind == "opencode" {
        return Some(SignIn {
            shown: "opencode auth login".into(),
            argv: vec![
                text(discover::find_opencode()?),
                "auth".into(),
                "login".into(),
            ],
            steps: "Choose a provider and sign in, or paste its API key. Add as many as you like.",
        });
    }
    let (cli, package, args, steps): (&str, &str, &[&str], &'static str) = match kind {
        "claude" => (
            "claude",
            "@anthropic-ai/claude-code",
            &["auth", "login"],
            "Your browser opens: sign in to your Claude account there.",
        ),
        // Gemini CLI no longer serves personal Google logins (June 2026): a paid key, or a work account.
        "gemini" => (
            "gemini",
            GEMINI_CLI,
            &[],
            "Choose Use Gemini API Key and paste a paid key (or Log in with Google for a Gemini Code Assist work account). Then type /quit.",
        ),
        "codex" => (
            "codex",
            "@openai/codex",
            &["login"],
            "Your browser opens: sign in with ChatGPT there.",
        ),
        _ => return None,
    };
    let args = args.iter().map(|a| a.to_string());
    let (shown, argv) = match discover::on_path(cli) {
        Some(bin) => (
            [cli.to_string()]
                .into_iter()
                .chain(args.clone())
                .collect::<Vec<_>>(),
            [text(bin)].into_iter().chain(args).collect(),
        ),
        None => (
            ["npx".into(), package.into()]
                .into_iter()
                .chain(args.clone())
                .collect(),
            [text(npx()?), "-y".into(), package.into()]
                .into_iter()
                .chain(args)
                .collect(),
        ),
    };
    Some(SignIn {
        shown: shown.join(" "),
        argv,
        steps,
    })
}

/// A `.command` file for Terminal: says what to do, runs the sign-in, and
/// says to go back. `path` is the search path (Node from fnm or nvm included).
fn sign_in_script(name: &str, sign_in: &SignIn, path: &str) -> String {
    let q = |s: &str| format!("'{}'", s.replace('\'', r"'\''"));
    let argv: Vec<String> = sign_in.argv.iter().map(|a| q(a)).collect();
    format!(
        "#!/bin/zsh\n\
         # Typst Studio (Settings ▸ Assistant): sign in to {name}, once.\n\
         export PATH={path}\n\
         cd ~\n\
         clear\n\
         printf '\\033[1m%s\\033[0m\\n%s\\n\\n' {title} {steps}\n\
         {argv}\n\
         printf '\\n%s\\n' {done}\n",
        path = q(path),
        title = q(&format!("Sign in to {name}, for Typst Studio")),
        steps = q(sign_in.steps),
        argv = argv.join(" "),
        done = q("Signed in? Go back to Typst Studio. You can close this window."),
    )
}

/// Settings ▸ Assistant: sign in in Terminal. Terminal runs a `.command` file
/// that runs the sign-in; the assistant keeps the login.
#[tauri::command]
pub async fn assistant_sign_in(kind: String) -> CmdResult<()> {
    let name =
        name_of(&kind).ok_or_else(|| CmdError::Invalid(format!("unknown assistant {kind}")))?;
    let sign_in = sign_in(&kind).ok_or_else(|| {
        CmdError::Unavailable(match kind.as_str() {
            "opencode" => "OpenCode isn't installed. In Terminal: brew install opencode".into(),
            // It signs in over ACP (authenticate): the chat starts it with Google's sign-in.
            "antigravity" => "Antigravity signs in with Google from Settings ▸ Assistant.".into(),
            _ => format!(
                "{name} needs Node.js, which isn't installed. In Terminal: brew install node"
            ),
        })
    })?;
    let path = discover::search_path();
    let file = std::env::temp_dir().join(format!("Sign in to {name}.command"));
    std::fs::write(
        &file,
        sign_in_script(name, &sign_in, &path.to_string_lossy()),
    )?;
    std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o700))?;
    let status = std::process::Command::new("/usr/bin/open")
        .arg(&file)
        .status()?;
    if !status.success() {
        return Err(CmdError::Io("couldn't open Terminal".into()));
    }
    Ok(())
}

/// Settings ▸ Assistant: how an assistant would run on this Mac, and its sign-in.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Setup {
    /// Its own program, if it's installed (for OpenCode, the copy in use).
    program: Option<String>,
    /// Otherwise the npm package npx runs, downloaded the first time it
    /// starts. None when Node.js isn't installed either.
    package: Option<String>,
    /// What signs in to it, typed in Terminal. None: nothing can run it.
    sign_in: Option<String>,
    /// Whether it's signed in, where that can be told without starting it.
    signed_in: Option<bool>,
    /// The account, in words: "Claude Max", "ChatGPT", "an API key".
    account: Option<String>,
    /// What Settings downloads to run it (Antigravity's connector, from Google).
    download: Option<Download>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Download {
    url: String,
    bytes: u64,
    version: String,
}

#[derive(Serialize)]
pub struct Setups {
    node: bool,
    opencode: Setup,
    claude: Setup,
    gemini: Setup,
    codex: Setup,
    antigravity: Setup,
}

/// `claude auth status --json`: `{"loggedIn": true, "subscriptionType": "max", …}`.
fn claude_account(said: &str) -> Option<(bool, Option<String>)> {
    let json = said.get(said.find('{')?..=said.rfind('}')?)?;
    let v: serde_json::Value = serde_json::from_str(json).ok()?;
    let signed_in = v.get("loggedIn")?.as_bool()?;
    let field = |k: &str| v.get(k).and_then(|x| x.as_str()).filter(|s| !s.is_empty());
    let how = match (
        field("subscriptionType"),
        field("apiProvider"),
        field("authMethod"),
    ) {
        (Some(plan), _, _) => {
            let mut c = plan.chars();
            c.next()
                .map(|f| format!("Claude {}{}", f.to_uppercase(), c.as_str()))
        }
        // Amazon Bedrock, Google Vertex AI…
        (_, Some(p), _) if p != "firstParty" => Some(p.to_string()),
        (_, _, Some(m)) if m.to_lowercase().contains("key") => Some("an API key".into()),
        _ => None,
    };
    Some((signed_in, how.filter(|_| signed_in)))
}

/// Codex keeps its login in `$CODEX_HOME/auth.json` (`~/.codex`), with how it signed in.
fn codex_account(auth: &str) -> (bool, Option<String>) {
    let mode = serde_json::from_str::<serde_json::Value>(auth)
        .ok()
        .and_then(|v| v.get("auth_mode")?.as_str().map(str::to_lowercase));
    let how = match mode.as_deref() {
        Some("chatgpt") => Some("ChatGPT".into()),
        Some(m) if m.contains("key") => Some("an API key".into()),
        _ => None,
    };
    (true, how)
}

/// Antigravity's connector saves the sign-in method chosen as `auth.type` in its
/// settings.json (the login itself is in the keychain), and removes it on
/// logout. No file, or no method: not signed in. A file it can't read: unknown.
fn antigravity_account(settings: Option<&str>) -> Option<(bool, Option<String>)> {
    let Some(text) = settings else {
        return Some((false, None));
    };
    let v: serde_json::Value = serde_json::from_str(text).ok()?;
    let how = v
        .pointer("/auth/type")
        .or_else(|| v.get("auth.type"))
        .and_then(|t| t.as_str())
        .filter(|t| !t.is_empty());
    Some(match how {
        None => (false, None),
        Some(t) => (
            true,
            Some(match t {
                "oauth-personal" => "a Google account".into(),
                "oauth-business" => "Gemini Enterprise".into(),
                "gemini-api-key" => "a Gemini API key".into(),
                "agent-platform" | "vertex-ai" => "Google Cloud".into(),
                "gateway" => "an AI gateway".into(),
                other => other.to_string(),
            }),
        ),
    })
}

/// Whether an assistant is signed in, where its own command or files say so
/// without starting it. Unknown (None) otherwise: a start tells.
fn account(kind: &str) -> Option<(bool, Option<String>)> {
    let home = discover::home()?;
    match kind {
        "claude" => claude_account(&discover::output(
            &discover::on_path("claude")?,
            &["auth", "status", "--json"],
        )?),
        "codex" => {
            let dir = std::env::var_os("CODEX_HOME")
                .map(PathBuf::from)
                .unwrap_or_else(|| home.join(".codex"));
            Some(codex_account(
                &std::fs::read_to_string(dir.join("auth.json")).ok()?,
            ))
        }
        // A Google login, or an API key in Gemini's .env or the environment.
        "gemini" => {
            let dir = home.join(".gemini");
            if dir.join("oauth_creds.json").is_file() {
                return Some((true, Some("a Google account".into())));
            }
            let env_file = std::fs::read_to_string(dir.join(".env")).unwrap_or_default();
            let key = ["GEMINI_API_KEY", "GOOGLE_API_KEY"].iter().any(|k| {
                std::env::var_os(k).is_some()
                    || env_file.lines().any(|l| {
                        l.trim_start()
                            .trim_start_matches("export ")
                            .starts_with(&format!("{k}="))
                    })
            });
            key.then(|| (true, Some("an API key".into())))
        }
        "antigravity" => {
            let dir = std::env::var_os("GEMINI_HOME")
                .map(PathBuf::from)
                .unwrap_or_else(|| home.join(".gemini"));
            antigravity_account(
                std::fs::read_to_string(dir.join("antigravity-acp").join("settings.json"))
                    .ok()
                    .as_deref(),
            )
        }
        _ => None,
    }
}

fn setup(kind: &str, node: bool) -> Setup {
    let text = |p: PathBuf| p.to_string_lossy().into_owned();
    let program = match kind {
        "opencode" => discover::find_opencode(),
        _ => own_program(kind),
    };
    let (signed_in, account) = account(kind).map_or((None, None), |(s, a)| (Some(s), a));
    Setup {
        package: package(kind)
            .filter(|_| program.is_none() && node)
            .map(String::from),
        program: program.map(text),
        sign_in: sign_in(kind).map(|s| s.shown),
        signed_in,
        account,
        download: (kind == "antigravity").then(|| {
            let (url, bytes) = antigravity_download();
            Download {
                url,
                bytes,
                version: ANTIGRAVITY_ACP.into(),
            }
        }),
    }
}

/// Settings ▸ Assistant: each assistant's setup on this Mac.
#[tauri::command]
pub async fn assistants_status() -> CmdResult<Setups> {
    Ok(tauri::async_runtime::spawn_blocking(|| {
        let node = npx().is_some();
        Setups {
            node,
            opencode: setup("opencode", node),
            claude: setup("claude", node),
            gemini: setup("gemini", node),
            codex: setup("codex", node),
            antigravity: setup("antigravity", node),
        }
    })
    .await?)
}

/// One download at a time, whichever window asks.
static DOWNLOADING: LazyLock<tokio::sync::Mutex<()>> =
    LazyLock::new(|| tokio::sync::Mutex::new(()));

/// Settings ▸ Assistant: download Antigravity's connector from Google, once.
/// Progress goes to `on_progress` as `{"received", "total"}` (bytes), then
/// `"unpacking": true`. Both programs in it must be signed by Google, or
/// nothing is kept. Returns the connector's path.
#[tauri::command]
pub async fn assistant_download(
    kind: String,
    on_progress: Channel<serde_json::Value>,
) -> CmdResult<String> {
    if kind != "antigravity" {
        return Err(CmdError::Invalid(format!("{kind} isn't downloaded")));
    }
    let _one = DOWNLOADING.lock().await;
    if let Some(p) = antigravity_program() {
        return Ok(p.to_string_lossy().into_owned());
    }
    let dir = antigravity_dir()
        .ok_or_else(|| CmdError::Unavailable("there's no folder to download it to".into()))?;
    let parent = dir
        .parent()
        .expect("in the assistants folder")
        .to_path_buf();
    tokio::fs::create_dir_all(&parent).await?;
    let zip = parent.join(format!("antigravity-acp-{ANTIGRAVITY_ACP}.zip.part"));
    let unpacked = parent.join(format!("antigravity-acp-{ANTIGRAVITY_ACP}.part"));
    let fetched = fetch_and_unpack(&antigravity_download().0, &zip, &unpacked, &on_progress).await;
    let _ = tokio::fs::remove_file(&zip).await;
    if let Err(e) = fetched {
        let _ = tokio::fs::remove_dir_all(&unpacked).await;
        return Err(e);
    }
    let _ = tokio::fs::remove_dir_all(&dir).await;
    tokio::fs::rename(&unpacked, &dir).await?;
    // Other versions' copies won't run again.
    if let Ok(mut entries) = tokio::fs::read_dir(&parent).await {
        while let Ok(Some(e)) = entries.next_entry().await {
            if e.file_name()
                .to_string_lossy()
                .starts_with("antigravity-acp-")
                && e.path() != dir
            {
                let _ = tokio::fs::remove_dir_all(e.path()).await;
            }
        }
    }
    antigravity_program()
        .map(|p| p.to_string_lossy().into_owned())
        .ok_or_else(|| {
            CmdError::Io("the download didn't have Antigravity's connector in it".into())
        })
}

async fn fetch_and_unpack(
    url: &str,
    zip: &Path,
    unpacked: &Path,
    on_progress: &Channel<serde_json::Value>,
) -> CmdResult<()> {
    let res = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(30))
        .build()?
        .get(url)
        .send()
        .await?;
    if !res.status().is_success() {
        return Err(CmdError::Unavailable(format!(
            "{url}: HTTP {}",
            res.status()
        )));
    }
    let total = res.content_length();
    let mut file = tokio::fs::File::create(zip).await?;
    let mut received = 0u64;
    let mut said = Instant::now();
    let mut body = res.bytes_stream();
    while let Some(chunk) = body.next().await {
        let chunk = chunk?;
        file.write_all(&chunk).await?;
        received += chunk.len() as u64;
        if said.elapsed() >= Duration::from_millis(150) {
            said = Instant::now();
            let _ = on_progress.send(serde_json::json!({ "received": received, "total": total }));
        }
    }
    file.flush().await?;
    drop(file);
    let _ = on_progress
        .send(serde_json::json!({ "received": received, "total": total, "unpacking": true }));
    let _ = tokio::fs::remove_dir_all(unpacked).await;
    let unzipped = Command::new("/usr/bin/ditto")
        .args(["-x", "-k"])
        .arg(zip)
        .arg(unpacked)
        .status()
        .await?;
    if !unzipped.success() {
        return Err(CmdError::Io("couldn't unpack the download".into()));
    }
    for name in ["agy_acp_server.par", "localharness_external"] {
        if !signed_by_google(&unpacked.join(name)).await {
            return Err(CmdError::Invalid(format!(
                "{name} in the download isn't signed by Google, so it wasn't kept"
            )));
        }
    }
    Ok(())
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

/// Start an assistant in the book's folder. Its stdout lines (JSON-RPC
/// messages) go to `on_message`; when it exits, `{"$exit": <code>}`.
#[tauri::command]
pub async fn acp_start(
    state: Win,
    kind: String,
    on_message: Channel<InvokeResponseBody>,
) -> CmdResult<AcpInfo> {
    let root = state.root()?;
    let (program, args) = launch(&kind)?;
    let mut guard = state.acp.lock().await;
    if let Some(mut old) = guard.take() {
        old.kill();
    }
    let mut child = Command::new(&program)
        .args(&args)
        .current_dir(&root)
        .env("PATH", discover::search_path())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .process_group(0)
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| CmdError::Unavailable(format!("couldn't start {}: {e}", program.display())))?;
    if let Some(pid) = child.id() {
        // Matched against its command line to clean up after a crash: never empty.
        let signature = match args.is_empty() {
            true => program
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .into_owned(),
            false => args.join(" "),
        };
        children::register(pid, signature);
    }
    logs::pipe("acp", child.stderr.take().expect("piped stderr"));
    let stdin = child.stdin.take().expect("piped stdin");
    let mut lines = BufReader::new(child.stdout.take().expect("piped stdout")).lines();
    let reader = tauri::async_runtime::spawn(async move {
        loop {
            match lines.next_line().await {
                Ok(Some(line)) => {
                    // Only JSON goes to the page; anything else is the program talking.
                    if serde_json::from_str::<serde::de::IgnoredAny>(&line).is_ok() {
                        if on_message.send(InvokeResponseBody::Json(line)).is_err() {
                            return;
                        }
                    } else if !line.trim().is_empty() {
                        logs::push("acp", line);
                    }
                }
                _ => break,
            }
        }
        let _ = on_message.send(InvokeResponseBody::Json(r#"{"$exit":true}"#.into()));
    });
    *guard = Some(AcpProcess {
        child,
        stdin,
        reader,
    });
    Ok(AcpInfo {
        program: program.to_string_lossy().into_owned(),
        args,
    })
}

/// Send one JSON-RPC message (a line) to the assistant.
#[tauri::command]
pub async fn acp_send(state: Win, line: String) -> CmdResult<()> {
    if line.contains('\n') {
        return Err(CmdError::Invalid("a message is one line".into()));
    }
    let mut guard = state.acp.lock().await;
    let process = guard
        .as_mut()
        .ok_or_else(|| CmdError::Unavailable("the assistant isn't running".into()))?;
    process.stdin.write_all(line.as_bytes()).await?;
    process.stdin.write_all(b"\n").await?;
    process.stdin.flush().await?;
    Ok(())
}

#[tauri::command]
pub async fn acp_stop(state: Win) -> CmdResult<()> {
    if let Some(mut process) = state.acp.lock().await.take() {
        process.kill();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accounts_are_read_from_what_the_programs_say() {
        let said = r#"{"loggedIn": true, "authMethod": "claude.ai", "apiProvider": "firstParty", "subscriptionType": "max", "email": "a@b.c"}"#;
        assert_eq!(
            claude_account(said),
            Some((true, Some("Claude Max".into())))
        );
        // A warning before the JSON is fine; signed out has no account.
        assert_eq!(
            claude_account(
                "warning: something\n{\"loggedIn\": false, \"subscriptionType\": \"pro\"}\n"
            ),
            Some((false, None))
        );
        assert_eq!(
            claude_account(
                r#"{"loggedIn": true, "authMethod": "api_key", "apiProvider": "firstParty"}"#
            ),
            Some((true, Some("an API key".into())))
        );
        assert_eq!(
            claude_account(r#"{"loggedIn": true, "apiProvider": "bedrock"}"#),
            Some((true, Some("bedrock".into())))
        );
        assert_eq!(claude_account("command not found"), None);
        assert_eq!(
            codex_account(r#"{"auth_mode": "chatgpt", "tokens": {}}"#),
            (true, Some("ChatGPT".into()))
        );
        assert_eq!(
            codex_account(r#"{"auth_mode": "apikey"}"#),
            (true, Some("an API key".into()))
        );
        assert_eq!(codex_account("{}"), (true, None));
        // Antigravity: the method its connector saved, or none.
        assert_eq!(antigravity_account(None), Some((false, None)));
        assert_eq!(
            antigravity_account(Some(r#"{"auth": {"type": "oauth-personal"}, "gcp": {}}"#)),
            Some((true, Some("a Google account".into())))
        );
        assert_eq!(
            antigravity_account(Some(r#"{"auth": {"type": "gemini-api-key"}}"#)),
            Some((true, Some("a Gemini API key".into())))
        );
        assert_eq!(
            antigravity_account(Some(r#"{"gcp": {"project": "p"}}"#)),
            Some((false, None))
        );
        // Hjson with comments: unknown, a start tells.
        assert_eq!(
            antigravity_account(Some("// mine\n{auth: {type: oauth-personal}}")),
            None
        );
    }

    #[test]
    fn the_sign_in_script_quotes_everything() {
        let sign_in = SignIn {
            shown: "claude auth login".into(),
            argv: vec![
                "/Users/o'neil/bin/claude".into(),
                "auth".into(),
                "login".into(),
            ],
            steps: "Your browser opens.",
        };
        let script = sign_in_script("Claude Code", &sign_in, "/opt/homebrew/bin:/usr/bin");
        assert!(script.starts_with("#!/bin/zsh\n"), "{script}");
        assert!(
            script.contains("\nexport PATH='/opt/homebrew/bin:/usr/bin'\n"),
            "{script}"
        );
        assert!(
            script.contains("\n'/Users/o'\\''neil/bin/claude' 'auth' 'login'\n"),
            "{script}"
        );
        assert!(
            script.contains("'Sign in to Claude Code, for Typst Studio' 'Your browser opens.'"),
            "{script}"
        );
    }

    #[test]
    fn assistants_run_their_own_program_or_npx() {
        assert!(launch("nobody").is_err());
        assert!(sign_in("nobody").is_none());
        // Antigravity signs in over ACP, not in Terminal; its download is Google's, for this Mac.
        assert!(sign_in("antigravity").is_none());
        let (url, bytes) = antigravity_download();
        assert!(
            url.starts_with(
                "https://dl.google.com/agy-extensions/releases/macos/agy-acp-server-1.4.1-darwin-"
            ),
            "{url}"
        );
        assert!(bytes > 100_000_000);
        // The shown command never carries a path: it's what the author would type.
        for kind in ["claude", "gemini", "codex"] {
            if let Some(s) = sign_in(kind) {
                assert!(
                    !s.shown.contains('/') || s.shown.starts_with("npx @"),
                    "{}",
                    s.shown
                );
                assert!(s.argv[0].starts_with('/'), "{:?}", s.argv);
            }
        }
    }
}
