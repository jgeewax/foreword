//! OpenCode headless server: process lifecycle plus an app-managed HTTP/SSE
//! bridge. The webview never talks to OpenCode directly, so there is no CORS
//! exposure and the per-launch server password never leaves Rust.
use std::{process::Stdio, time::Duration};

use futures_util::StreamExt;
use serde::Serialize;
use serde_json::Value;
use tauri::{
    async_runtime::JoinHandle,
    ipc::{Channel, InvokeResponseBody},
};
use tokio::{
    io::{AsyncBufReadExt, BufReader},
    process::{Child, Command},
};

use crate::{
    Win, children, discover,
    error::{CmdError, CmdResult},
    logs,
};

pub struct AgentServer {
    child: Child,
    info: AgentInfo,
    password: String,
    client: reqwest::Client,
    events: Option<JoinHandle<()>>,
}

impl AgentServer {
    pub fn kill(&mut self) {
        if let Some(task) = self.events.take() {
            task.abort();
        }
        if let Some(pid) = self.child.id() {
            children::unregister(pid);
        }
        let _ = self.child.start_kill();
    }

    fn request(&self, method: reqwest::Method, path: &str) -> reqwest::RequestBuilder {
        self.client
            .request(method, format!("{}{}", self.info.base_url, path))
            .basic_auth("opencode", Some(&self.password))
    }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AgentInfo {
    base_url: String,
    bin: String,
}

fn free_port() -> std::io::Result<u16> {
    Ok(std::net::TcpListener::bind("127.0.0.1:0")?
        .local_addr()?
        .port())
}

/// Start `opencode serve` for the workspace (no-op if already running).
#[tauri::command]
pub async fn agent_start(state: Win) -> CmdResult<AgentInfo> {
    let root = state.root()?;
    let mut guard = state.agent.lock().await;
    if let Some(server) = guard.as_mut()
        && server.child.try_wait().ok().flatten().is_none()
    {
        return Ok(server.info.clone());
    }
    let bin = discover::find_opencode().ok_or_else(|| {
        CmdError::Unavailable(
            "opencode not found (brew install opencode, or choose it in Settings ▸ Tools)".into(),
        )
    })?;
    let port = free_port()?;
    let password = uuid::Uuid::new_v4().simple().to_string();
    let mut child = Command::new(&bin)
        .args([
            "serve",
            "--hostname",
            "127.0.0.1",
            "--port",
            &port.to_string(),
        ])
        .current_dir(&root)
        .env("PATH", discover::search_path())
        .env("OPENCODE_SERVER_PASSWORD", &password)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| CmdError::Unavailable(format!("failed to start {}: {e}", bin.display())))?;
    if let Some(pid) = child.id() {
        children::register(pid, format!("serve --hostname 127.0.0.1 --port {port}"));
    }
    logs::pipe("opencode", child.stderr.take().expect("piped stderr"));

    let mut lines = BufReader::new(child.stdout.take().expect("piped stdout")).lines();
    let deadline = tokio::time::Instant::now() + Duration::from_secs(30);
    let base_url = loop {
        match tokio::time::timeout_at(deadline, lines.next_line()).await {
            Ok(Ok(Some(line))) => {
                if line.starts_with("server password") {
                    continue; // never log secrets
                }
                logs::push("opencode", line.clone());
                if let Some(url) = line.strip_prefix("server listening on ") {
                    break url.trim().trim_end_matches('/').to_string();
                }
            }
            Ok(_) => {
                return Err(CmdError::Unavailable(
                    "opencode exited during startup; see logs".into(),
                ));
            }
            Err(_) => {
                let _ = child.start_kill();
                return Err(CmdError::Unavailable(
                    "opencode did not start within 30 s".into(),
                ));
            }
        }
    };
    tauri::async_runtime::spawn(async move {
        while let Ok(Some(line)) = lines.next_line().await {
            if !line.starts_with("server password") {
                logs::push("opencode", line);
            }
        }
    });

    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(5))
        .build()?;
    let info = AgentInfo {
        base_url,
        bin: bin.to_string_lossy().into_owned(),
    };
    let server = AgentServer {
        child,
        info: info.clone(),
        password,
        client,
        events: None,
    };
    let probe = server
        .request(reqwest::Method::GET, "/api/location")
        .send()
        .await?;
    if !probe.status().is_success() {
        return Err(CmdError::Unavailable(format!(
            "opencode API check failed: HTTP {}",
            probe.status()
        )));
    }
    *guard = Some(server);
    Ok(info)
}

#[derive(Serialize)]
pub struct AgentResponse {
    status: u16,
    body: Value,
}

/// Proxy one JSON request to the OpenCode API (`/api/...` only).
#[tauri::command]
pub async fn agent_request(
    state: Win,
    method: String,
    path: String,
    body: Option<Value>,
) -> CmdResult<AgentResponse> {
    if !path.starts_with("/api/") || path.contains("..") {
        return Err(CmdError::Invalid(format!(
            "not an OpenCode API path: {path}"
        )));
    }
    let method = reqwest::Method::from_bytes(method.as_bytes())
        .map_err(|e| CmdError::Invalid(e.to_string()))?;
    let request = {
        let guard = state.agent.lock().await;
        let server = guard
            .as_ref()
            .ok_or_else(|| CmdError::Unavailable("agent server is not running".into()))?;
        let mut request = server
            .request(method, &path)
            .timeout(Duration::from_secs(120));
        if let Some(body) = body {
            request = request.json(&body);
        }
        request
    };
    let response = request.send().await?;
    let status = response.status().as_u16();
    let text = response.text().await?;
    let body = if text.is_empty() {
        Value::Null
    } else {
        serde_json::from_str(&text).unwrap_or(Value::String(text))
    };
    Ok(AgentResponse { status, body })
}

/// Parse complete SSE blocks out of `buf`, returning each block's `data` payload.
pub fn drain_sse(buf: &mut String) -> Vec<String> {
    let mut out = Vec::new();
    while let Some(end) = buf.find("\n\n") {
        let block: String = buf.drain(..end + 2).collect();
        let data: Vec<&str> = block
            .lines()
            .filter_map(|l| l.strip_prefix("data:"))
            .map(|d| d.strip_prefix(' ').unwrap_or(d))
            .collect();
        if !data.is_empty() {
            out.push(data.join("\n"));
        }
    }
    out
}

/// Stream OpenCode's `/api/event` SSE feed to the frontend, reconnecting on
/// failure. Connection changes arrive as `{"$connection": "open" | "lost"}`.
#[tauri::command]
pub async fn agent_subscribe(state: Win, on_event: Channel<InvokeResponseBody>) -> CmdResult<()> {
    let mut guard = state.agent.lock().await;
    let server = guard
        .as_mut()
        .ok_or_else(|| CmdError::Unavailable("agent server is not running".into()))?;
    if let Some(task) = server.events.take() {
        task.abort();
    }
    let request = server
        .request(reqwest::Method::GET, "/api/event")
        .header("accept", "text/event-stream");
    server.events = Some(tauri::async_runtime::spawn(async move {
        loop {
            let Some(attempt) = request.try_clone() else {
                break;
            };
            match attempt.send().await {
                Ok(response) if response.status().is_success() => {
                    let _ =
                        on_event.send(InvokeResponseBody::Json(r#"{"$connection":"open"}"#.into()));
                    let mut stream = response.bytes_stream();
                    let mut buf = String::new();
                    let mut partial: Vec<u8> = Vec::new(); // a UTF-8 sequence split across chunks
                    while let Some(Ok(chunk)) = stream.next().await {
                        partial.extend_from_slice(&chunk);
                        let valid = match std::str::from_utf8(&partial) {
                            Ok(s) => s.len(),
                            Err(e) => e.valid_up_to(),
                        };
                        buf.push_str(
                            &std::str::from_utf8(&partial[..valid])
                                .unwrap_or_default()
                                .replace('\r', ""),
                        );
                        partial.drain(..valid);
                        for data in drain_sse(&mut buf) {
                            if serde_json::from_str::<serde::de::IgnoredAny>(&data).is_ok()
                                && on_event.send(InvokeResponseBody::Json(data)).is_err()
                            {
                                return;
                            }
                        }
                    }
                }
                Ok(response) => logs::push(
                    "opencode",
                    format!("event stream HTTP {}", response.status()),
                ),
                Err(e) => logs::push("opencode", format!("event stream error: {e}")),
            }
            if on_event
                .send(InvokeResponseBody::Json(r#"{"$connection":"lost"}"#.into()))
                .is_err()
            {
                return;
            }
            tokio::time::sleep(Duration::from_secs(1)).await;
        }
    }));
    Ok(())
}

#[tauri::command]
pub async fn agent_stop(state: Win) -> CmdResult<()> {
    if let Some(mut server) = state.agent.lock().await.take() {
        server.kill();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::drain_sse;

    #[test]
    fn sse_blocks_split_and_partial_blocks_kept() {
        let mut buf = String::from(
            "data: {\"a\":1}\n\nid: 7\ndata: {\"b\":\ndata: 2}\n\n: heartbeat\n\ndata: {\"c\"",
        );
        assert_eq!(
            drain_sse(&mut buf),
            vec!["{\"a\":1}".to_string(), "{\"b\":\n2}".to_string()]
        );
        assert_eq!(buf, "data: {\"c\"");
    }
}
