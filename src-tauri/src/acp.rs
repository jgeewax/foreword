//! Assistants spoken to over the Agent Client Protocol (ACP): newline-delimited
//! JSON-RPC on an agent program's stdin and stdout. Claude Code, Gemini CLI and
//! Codex run this way, each through its ACP program. The frontend speaks the
//! protocol (src/services/agent/acp.ts); this runs the program in the book's
//! folder and carries its lines.
use std::{path::PathBuf, process::Stdio};

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

/// How each assistant is started: its own command if it's installed, otherwise
/// its npm package through npx (downloaded the first time).
pub fn launch(kind: &str) -> CmdResult<(PathBuf, Vec<String>)> {
    let npx = |package: &str, extra: &[&str]| -> CmdResult<(PathBuf, Vec<String>)> {
        let npx = discover::find("npx", "TYPST_STUDIO_NPX").ok_or_else(|| {
            CmdError::Unavailable(
                "Node.js isn't installed (it runs the assistant's connector). In Terminal: brew install node"
                    .into(),
            )
        })?;
        let mut args = vec!["-y".to_string(), package.to_string()];
        args.extend(extra.iter().map(|s| s.to_string()));
        Ok((npx, args))
    };
    match kind {
        "claude" => match discover::find("claude-agent-acp", "TYPST_STUDIO_CLAUDE_ACP") {
            Some(bin) => Ok((bin, vec![])),
            None => npx(CLAUDE_ACP, &[]),
        },
        "gemini" => match discover::find("gemini", "TYPST_STUDIO_GEMINI") {
            Some(bin) => Ok((bin, vec!["--acp".into()])),
            None => npx(GEMINI_CLI, &["--acp"]),
        },
        "codex" => match discover::find("codex-acp", "TYPST_STUDIO_CODEX_ACP") {
            Some(bin) => Ok((bin, vec![])),
            None => npx(CODEX_ACP, &[]),
        },
        _ => Err(CmdError::Invalid(format!("unknown assistant {kind}"))),
    }
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
