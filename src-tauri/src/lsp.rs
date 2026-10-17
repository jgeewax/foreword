//! Tinymist process bridge. Rust owns the process and the LSP framing; the
//! protocol itself (initialize, didChange, preview commands) lives in the
//! frontend's TypstService. Messages from the server are forwarded verbatim.
use std::{path::PathBuf, process::Stdio};

use serde::Serialize;
use tauri::ipc::{Channel, InvokeResponseBody};
use tokio::{
    io::{AsyncBufRead, AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader},
    process::{Child, Command},
    sync::mpsc,
};

use crate::{
    Win, discover,
    error::{CmdError, CmdResult},
    logs,
};

pub struct LspProcess {
    child: Child,
}

impl LspProcess {
    pub fn kill(&mut self) {
        let _ = self.child.start_kill();
    }
}

/// Read one `Content-Length`-framed message. `Ok(None)` on clean EOF.
pub async fn read_message<R: AsyncBufRead + Unpin>(
    reader: &mut R,
) -> std::io::Result<Option<String>> {
    let mut content_length: Option<usize> = None;
    let mut line = String::new();
    loop {
        line.clear();
        if reader.read_line(&mut line).await? == 0 {
            return Ok(None);
        }
        let header = line.trim_end();
        if header.is_empty() {
            if content_length.is_some() {
                break;
            }
            continue;
        }
        if let Some((name, value)) = header.split_once(':')
            && name.eq_ignore_ascii_case("content-length")
        {
            content_length = value.trim().parse().ok();
        }
    }
    let len = content_length.unwrap_or(0);
    let mut body = vec![0; len];
    reader.read_exact(&mut body).await?;
    String::from_utf8(body)
        .map(Some)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))
}

pub fn frame(message: &str) -> Vec<u8> {
    let mut out = format!("Content-Length: {}\r\n\r\n", message.len()).into_bytes();
    out.extend_from_slice(message.as_bytes());
    out
}

#[derive(Serialize)]
pub struct TypstStarted {
    bin: String,
    pid: Option<u32>,
}

/// Start (or restart) `tinymist lsp` in the workspace root. Every server
/// message is sent on `on_message` as JSON; `{"$closed": true}` marks exit.
#[tauri::command]
pub async fn typst_start(
    state: Win,
    on_message: Channel<InvokeResponseBody>,
) -> CmdResult<TypstStarted> {
    let root = state.root()?;
    let bin: PathBuf = discover::find_tinymist().ok_or_else(|| {
        CmdError::Unavailable(
            "tinymist not found (brew install tinymist, or set TINYMIST_PATH)".into(),
        )
    })?;

    let mut guard = state.typst.lock().await;
    if let Some(mut old) = guard.take() {
        old.kill();
    }

    let mut child = Command::new(&bin)
        .arg("lsp")
        .current_dir(&root)
        .env("PATH", discover::search_path())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| CmdError::Unavailable(format!("failed to start {}: {e}", bin.display())))?;
    let pid = child.id();
    let mut stdin = child.stdin.take().expect("piped stdin");
    let stdout = child.stdout.take().expect("piped stdout");
    let stderr = child.stderr.take().expect("piped stderr");

    let (tx, mut rx) = mpsc::unbounded_channel::<Vec<u8>>();
    tauri::async_runtime::spawn(async move {
        while let Some(buf) = rx.recv().await {
            if stdin.write_all(&buf).await.is_err() || stdin.flush().await.is_err() {
                break;
            }
        }
    });
    tauri::async_runtime::spawn(async move {
        let mut reader = BufReader::new(stdout);
        loop {
            match read_message(&mut reader).await {
                Ok(Some(body)) => {
                    if on_message.send(InvokeResponseBody::Json(body)).is_err() {
                        break;
                    }
                }
                Ok(None) => break,
                Err(e) => {
                    logs::push("tinymist", format!("bad message from server: {e}"));
                    break;
                }
            }
        }
        let _ = on_message.send(InvokeResponseBody::Json(r#"{"$closed":true}"#.into()));
    });
    logs::pipe("tinymist", stderr);

    *guard = Some(LspProcess { child });
    *state.typst_tx.lock().unwrap() = Some(tx);
    Ok(TypstStarted {
        bin: bin.to_string_lossy().into_owned(),
        pid,
    })
}

/// Send one JSON-RPC message (already serialized) to Tinymist.
///
/// Deliberately synchronous: sync commands run in the order the webview sent
/// them, which keeps `didChange` notifications ordered. (Async commands run
/// concurrently and could reorder edits.)
#[tauri::command]
pub fn typst_send(state: Win, message: String) -> CmdResult<()> {
    let guard = state.typst_tx.lock().unwrap();
    let tx = guard
        .as_ref()
        .ok_or_else(|| CmdError::Unavailable("tinymist is not running".into()))?;
    tx.send(frame(&message))
        .map_err(|_| CmdError::Unavailable("tinymist stdin closed".into()))
}

#[tauri::command]
pub async fn typst_stop(state: Win) -> CmdResult<()> {
    state.typst_tx.lock().unwrap().take();
    if let Some(mut lsp) = state.typst.lock().await.take() {
        lsp.kill();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn reads_framed_messages_including_multibyte() {
        let a = r#"{"jsonrpc":"2.0","method":"x","params":"λ→✓"}"#;
        let b = r#"{"id":1}"#;
        let mut wire = frame(a);
        wire.extend(b"Content-Type: application/vscode-jsonrpc; charset=utf-8\r\n");
        wire.extend(frame(b));
        let mut reader = BufReader::new(&wire[..]);
        assert_eq!(read_message(&mut reader).await.unwrap().as_deref(), Some(a));
        assert_eq!(read_message(&mut reader).await.unwrap().as_deref(), Some(b));
        assert_eq!(read_message(&mut reader).await.unwrap(), None);
    }
}
