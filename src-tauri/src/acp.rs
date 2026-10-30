//! Assistants spoken to over the Agent Client Protocol (ACP): newline-delimited
//! JSON-RPC on an agent program's stdin and stdout. Claude Code, Gemini CLI,
//! Codex and Antigravity run this way, each through its ACP program. The
//! frontend speaks the protocol (src/services/agent/acp.ts); this runs the
//! program in the book's folder and carries its lines.
use std::{
    os::unix::fs::PermissionsExt,
    path::{Path, PathBuf},
    process::Stdio,
};

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
    install, logs,
};

pub struct AcpProcess {
    child: Child,
    stdin: ChildStdin,
    reader: JoinHandle<()>,
}

impl AcpProcess {
    /// Stop the program and anything it started (the connector runs the assistant as its child).
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
    /// Its system prompt is the app's (`system`) in place of its own: Codex's
    /// `model_instructions_file`, Gemini CLI's `GEMINI_SYSTEM_MD`.
    own_prompt: bool,
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

/// A word as typed in Terminal: quoted when it needs to be.
fn typed(word: &str) -> String {
    if !word.is_empty()
        && word
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "/._-~@+=:".contains(c))
    {
        word.into()
    } else {
        format!("'{}'", word.replace('\'', r"'\''"))
    }
}

/// Signing in with the assistant's program in use: the author's own, or
/// Foreword's copy. None: it isn't installed yet.
fn sign_in(kind: &str) -> Option<SignIn> {
    let text = |p: &Path| p.to_string_lossy().into_owned();
    let (name, args, steps): (&str, &[&str], &'static str) = match kind {
        "opencode" => (
            "opencode",
            &["auth", "login"],
            "Choose a provider and sign in, or paste its API key. Add as many as you like.",
        ),
        "claude" => (
            "claude",
            &["auth", "login"],
            "Your browser opens: sign in to your Claude account there.",
        ),
        // Gemini CLI no longer serves personal Google logins (June 2026): a paid key, or a work account.
        "gemini" => (
            "gemini",
            &[],
            "Choose Use Gemini API Key and paste a paid key (or Log in with Google for a Gemini Code Assist work account). Then type /quit.",
        ),
        "codex" => (
            "codex",
            &["login"],
            "Your browser opens: sign in with ChatGPT there.",
        ),
        _ => return None,
    };
    let program = install::program(kind)?;
    // Foreword's Gemini CLI is a script, which Node.js runs.
    let mut argv = match kind == "gemini" && install::is_ours(&program) {
        true => vec![text(&install::node()?), text(&program)],
        false => vec![text(&program)],
    };
    argv.extend(args.iter().map(|a| a.to_string()));
    // As the author would type it: by name when that's the one on their PATH.
    let same = |p: &Path| p.canonicalize().ok() == program.canonicalize().ok();
    let shown: Vec<String> = match discover::on_path(name).is_some_and(|p| same(&p)) {
        true => [name].iter().chain(args).map(|a| a.to_string()).collect(),
        false => argv.iter().map(|a| typed(a)).collect(),
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
         # Foreword (Settings ▸ Assistant): sign in to {name}, once.\n\
         export PATH={path}\n\
         cd ~\n\
         clear\n\
         printf '\\033[1m%s\\033[0m\\n%s\\n\\n' {title} {steps}\n\
         {argv}\n\
         printf '\\n%s\\n' {done}\n",
        path = q(path),
        title = q(&format!("Sign in to {name}, for Foreword")),
        steps = q(sign_in.steps),
        argv = argv.join(" "),
        done = q("Signed in? Go back to Foreword. You can close this window."),
    )
}

/// Settings ▸ Assistant: sign in in Terminal. Terminal runs a `.command` file
/// that runs the sign-in; the assistant keeps the login.
#[tauri::command]
pub async fn assistant_sign_in(kind: String) -> CmdResult<()> {
    let name =
        name_of(&kind).ok_or_else(|| CmdError::Invalid(format!("unknown assistant {kind}")))?;
    let sign_in = sign_in(&kind).ok_or_else(|| match kind.as_str() {
        // It signs in over ACP (authenticate): the chat starts it with Google's sign-in.
        "antigravity" => CmdError::Unavailable(
            "Antigravity signs in with Google from Settings ▸ Assistant.".into(),
        ),
        _ => CmdError::NotInstalled(format!(
            "{name} isn't installed yet: install it from Settings ▸ Assistant first."
        )),
    })?;
    let path = install::path_with(Path::new(&sign_in.argv[0]));
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
    /// Its own program in use, if it can run: the author's, or Foreword's copy
    /// (for OpenCode, the copy in use; for Antigravity, Google's connector).
    program: Option<String>,
    /// `program` is Foreword's own copy, not the author's.
    ours: bool,
    version: Option<String>,
    /// What installing it would fetch, while it can't run (install.rs).
    install: Option<install::Plan>,
    /// What signs in to it, typed in Terminal. None: it isn't installed yet.
    sign_in: Option<String>,
    /// Whether it's signed in, where that can be told without starting it.
    signed_in: Option<bool>,
    /// The account, in words: "Claude Max", "ChatGPT", "an API key".
    account: Option<String>,
}

#[derive(Serialize)]
pub struct Setups {
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
            &install::program("claude")?,
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

fn setup(kind: &str) -> Setup {
    let program = install::program(kind);
    let (signed_in, account) = account(kind).map_or((None, None), |(s, a)| (Some(s), a));
    Setup {
        ours: program.as_deref().is_some_and(install::is_ours),
        version: program.as_deref().and_then(|p| install::version(kind, p)),
        program: program.map(|p| p.to_string_lossy().into_owned()),
        install: install::plan(kind),
        sign_in: sign_in(kind).map(|s| s.shown),
        signed_in,
        account,
    }
}

/// Settings ▸ Assistant: each assistant's setup on this Mac.
#[tauri::command]
pub async fn assistants_status() -> CmdResult<Setups> {
    Ok(tauri::async_runtime::spawn_blocking(|| Setups {
        opencode: setup("opencode"),
        claude: setup("claude"),
        gemini: setup("gemini"),
        codex: setup("codex"),
        antigravity: setup("antigravity"),
    })
    .await?)
}

/// A file where an assistant keeps rules of its own, and what's in it.
#[derive(Serialize)]
pub struct RuleFile {
    path: String,
    text: String,
}

/// Where an assistant keeps rules of its own outside the book (Claude Code's
/// settings in ~/.claude, Codex's rules in $CODEX_HOME/rules): rules that let
/// it run commands without asking Foreword.
fn rule_paths(kind: &str) -> Vec<PathBuf> {
    let Some(home) = discover::home() else {
        return vec![];
    };
    match kind {
        "claude" => {
            let dir = std::env::var_os("CLAUDE_CONFIG_DIR")
                .map(PathBuf::from)
                .unwrap_or_else(|| home.join(".claude"));
            vec![dir.join("settings.json"), dir.join("settings.local.json")]
        }
        "codex" => {
            let dir = std::env::var_os("CODEX_HOME")
                .map(PathBuf::from)
                .unwrap_or_else(|| home.join(".codex"))
                .join("rules");
            let mut files: Vec<PathBuf> = std::fs::read_dir(&dir)
                .map(|d| {
                    d.filter_map(|e| e.ok().map(|e| e.path()))
                        .filter(|p| p.extension().is_some_and(|x| x == "rules"))
                        .collect()
                })
                .unwrap_or_default();
            files.sort();
            files
        }
        _ => vec![],
    }
}

/// Settings ▸ Permissions: an assistant's own rule files, to show (read only).
#[tauri::command]
pub async fn assistant_rule_files(kind: String) -> CmdResult<Vec<RuleFile>> {
    Ok(tauri::async_runtime::spawn_blocking(move || {
        rule_paths(&kind)
            .into_iter()
            .filter_map(|p| {
                let text = std::fs::read_to_string(&p).ok()?;
                (text.len() < 1_000_000).then(|| RuleFile {
                    path: p.to_string_lossy().into_owned(),
                    text,
                })
            })
            .take(20)
            .collect()
    })
    .await?)
}

/// Show one of an assistant's rule files in Finder.
#[tauri::command]
pub async fn assistant_rule_reveal(kind: String, path: String) -> CmdResult<()> {
    let p = PathBuf::from(&path);
    if !rule_paths(&kind).contains(&p) {
        return Err(CmdError::Invalid(format!(
            "not one of {kind}'s rule files: {path}"
        )));
    }
    std::process::Command::new("/usr/bin/open")
        .arg("-R")
        .arg(&p)
        .status()?;
    Ok(())
}

/// One download at a time, whichever window asks.
/// Settings for Codex's connector (codex-acp's `CODEX_CONFIG`, on top of the
/// author's own config.toml). Codex offers its question tool
/// (request_user_input, which the chat shows as its question panel) only in
/// Plan mode unless this feature is on. `model_instructions_file` takes the
/// place of its own prompt, a coding agent's (17,000 characters with 0.160).
fn codex_config(prompt_file: Option<&Path>) -> String {
    let mut config = serde_json::json!({ "features": { "default_mode_request_user_input": true } });
    if let Some(file) = prompt_file {
        config["model_instructions_file"] = file.to_string_lossy().into();
    }
    config.to_string()
}

/// The app's system prompt as a file, for the programs that read theirs from
/// one (Codex, Gemini CLI). Written whole through a temporary file, so another
/// window's program never reads half of it. None: it couldn't be written.
fn write_prompt_file(text: &str) -> Option<PathBuf> {
    let dir = install::assistants_dir().unwrap_or_else(std::env::temp_dir);
    std::fs::create_dir_all(&dir).ok()?;
    let path = dir.join("foreword-prompt.md");
    let tmp = dir.join(format!(".foreword-prompt-{}.md", uuid::Uuid::new_v4().simple()));
    std::fs::write(&tmp, text).ok()?;
    if std::fs::rename(&tmp, &path).is_err() {
        let _ = std::fs::remove_file(&tmp);
        return None;
    }
    Some(path)
}

/// Start an assistant in the book's folder. Its stdout lines (JSON-RPC
/// messages) go to `on_message`; when it exits, `{"$exit": <code>}`.
/// `system`: the app's system prompt, for a program that takes one in place
/// of its own (Codex, Gemini CLI; Claude Code takes it with each conversation).
#[tauri::command]
pub async fn acp_start(
    state: Win,
    kind: String,
    on_message: Channel<InvokeResponseBody>,
    system: Option<String>,
) -> CmdResult<AcpInfo> {
    let root = state.root()?;
    let install::Launch {
        program,
        args,
        env,
        path,
    } = install::launch(&kind)?;
    let mut guard = state.acp.lock().await;
    if let Some(mut old) = guard.take() {
        old.kill();
    }
    let prompt_file = match (kind.as_str(), system.as_deref()) {
        ("codex" | "gemini", Some(text)) => write_prompt_file(text),
        _ => None,
    };
    let mut command = Command::new(&program);
    // The assistant's program for its connector (CLAUDE_CODE_EXECUTABLE, CODEX_PATH).
    command.envs(env);
    if kind == "codex" {
        command.env("CODEX_CONFIG", codex_config(prompt_file.as_deref()));
    }
    if let (Some(file), "gemini") = (&prompt_file, kind.as_str()) {
        command.env("GEMINI_SYSTEM_MD", file);
    }
    let mut child = command
        .args(&args)
        .current_dir(&root)
        .env("PATH", path)
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
        own_prompt: prompt_file.is_some(),
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
    fn codex_takes_the_prompt_file_in_place_of_its_own() {
        let plain: serde_json::Value = serde_json::from_str(&codex_config(None)).unwrap();
        assert_eq!(
            plain,
            serde_json::json!({ "features": { "default_mode_request_user_input": true } })
        );
        let file = Path::new("/Users/ada/Library/Application Support/x/foreword-prompt.md");
        let own: serde_json::Value = serde_json::from_str(&codex_config(Some(file))).unwrap();
        assert_eq!(own["model_instructions_file"], file.to_string_lossy().as_ref());
        assert_eq!(own["features"]["default_mode_request_user_input"], true);
    }

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
            script.contains("'Sign in to Claude Code, for Foreword' 'Your browser opens.'"),
            "{script}"
        );
    }

    #[test]
    fn signing_in_uses_the_program_in_use() {
        assert!(sign_in("nobody").is_none());
        // Antigravity signs in over ACP, not in Terminal.
        assert!(sign_in("antigravity").is_none());
        // Foreword's own copy is shown by its path, quoted where it has a space.
        assert_eq!(
            typed("/Users/a/Library/Application Support/x/claude"),
            "'/Users/a/Library/Application Support/x/claude'"
        );
        assert_eq!(
            typed("/opt/homebrew/bin/opencode"),
            "/opt/homebrew/bin/opencode"
        );
        assert_eq!(typed("it's"), r"'it'\''s'");
        for kind in ["claude", "gemini", "codex", "opencode"] {
            if let Some(s) = sign_in(kind) {
                assert!(s.argv[0].starts_with('/'), "{:?}", s.argv);
            }
        }
    }
}
