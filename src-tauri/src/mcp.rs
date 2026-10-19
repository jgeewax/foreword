//! Typst Studio's own tools for the writing assistant: what the app is set to,
//! and changing it (the assistant, its model and effort, the app's
//! preferences). They're an MCP server over HTTP on 127.0.0.1, "streamable
//! HTTP" with JSON replies only. Each window has its own address, a secret
//! path its assistant is given (ACP's mcpServers, OpenCode's MCP servers);
//! a request is handed to that window's page, which answers it
//! (src/app/studio-tools.ts). This side only carries the JSON-RPC.

use std::{
    collections::HashMap,
    convert::Infallible,
    net::SocketAddr,
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
    },
    time::Duration,
};

use http_body_util::{BodyExt, Full, Limited};
use hyper::{
    Method, Request, Response, StatusCode,
    body::{Bytes, Incoming},
    server::conn::http1,
    service::service_fn,
};
use hyper_util::rt::TokioIo;
use serde_json::{Value, json};
use tauri::{Manager, ipc::Channel};
use tokio::sync::oneshot;

use crate::{
    Win,
    error::{CmdError, CmdResult},
};

/// A request bigger than this isn't one of ours.
const MAX_BODY: usize = 1 << 20;
/// How long the page has to answer (a tool never waits for the author).
const ANSWER_WITHIN: Duration = Duration::from_secs(120);

#[derive(Default)]
pub struct McpState {
    port: tokio::sync::OnceCell<u16>,
    inner: Arc<Inner>,
}

#[derive(Default)]
struct Inner {
    /// Secret path → the window that answers there.
    routes: Mutex<HashMap<String, Route>>,
    /// Requests waiting for their page's answer (None: a notification, no answer).
    waiting: Mutex<HashMap<u64, oneshot::Sender<Option<String>>>>,
    next: AtomicU64,
}

struct Route {
    window: String,
    page: Channel<Value>,
}

/// Start the server (once), and give this window an address of its own.
/// Its page gets `{ id, body }` for each request and answers with `mcp_reply`.
#[tauri::command]
pub async fn mcp_serve(
    state: Win,
    mcp: tauri::State<'_, McpState>,
    page: Channel<Value>,
) -> CmdResult<String> {
    let inner = mcp.inner.clone();
    let port = *mcp
        .port
        .get_or_try_init(|| async move { listen(inner).await })
        .await?;
    let token = uuid::Uuid::new_v4().simple().to_string();
    let mut routes = mcp.inner.routes.lock().unwrap();
    // One address per window: a page loaded again replaces its old one.
    routes.retain(|_, r| r.window != state.label());
    routes.insert(
        token.clone(),
        Route {
            window: state.label().to_string(),
            page,
        },
    );
    Ok(format!("http://127.0.0.1:{port}/mcp/{token}"))
}

/// The page's answer to request `id` (None: nothing to send back).
#[tauri::command]
pub fn mcp_reply(mcp: tauri::State<'_, McpState>, id: u64, body: Option<String>) {
    if let Some(tx) = mcp.inner.waiting.lock().unwrap().remove(&id) {
        let _ = tx.send(body);
    }
}

/// A closed window's address goes with it.
pub fn forget(app: &tauri::AppHandle, window: &str) {
    if let Some(mcp) = app.try_state::<McpState>() {
        mcp.inner
            .routes
            .lock()
            .unwrap()
            .retain(|_, r| r.window != window);
    }
}

async fn listen(inner: Arc<Inner>) -> CmdResult<u16> {
    let listener = tokio::net::TcpListener::bind(SocketAddr::from(([127, 0, 0, 1], 0)))
        .await
        .map_err(|e| CmdError::Unavailable(format!("the assistant's tools can't listen: {e}")))?;
    let port = listener.local_addr()?.port();
    tauri::async_runtime::spawn(async move {
        loop {
            let Ok((stream, _)) = listener.accept().await else {
                continue;
            };
            let inner = inner.clone();
            tauri::async_runtime::spawn(async move {
                let service = service_fn(move |req| handle(inner.clone(), req));
                let _ = http1::Builder::new()
                    .serve_connection(TokioIo::new(stream), service)
                    .await;
            });
        }
    });
    Ok(port)
}

fn reply(status: StatusCode, body: &str) -> Response<Full<Bytes>> {
    let mut res = Response::new(Full::new(Bytes::from(body.to_string())));
    *res.status_mut() = status;
    if !body.is_empty() {
        res.headers_mut().insert(
            hyper::header::CONTENT_TYPE,
            hyper::header::HeaderValue::from_static("application/json"),
        );
    }
    res
}

async fn handle(
    inner: Arc<Inner>,
    req: Request<Incoming>,
) -> Result<Response<Full<Bytes>>, Infallible> {
    // A web page can reach 127.0.0.1 too: those come with an Origin; the assistants' don't.
    if req.headers().contains_key(hyper::header::ORIGIN) {
        return Ok(reply(StatusCode::FORBIDDEN, ""));
    }
    let Some(token) = req.uri().path().strip_prefix("/mcp/").map(str::to_string) else {
        return Ok(reply(StatusCode::NOT_FOUND, ""));
    };
    let page = match inner.routes.lock().unwrap().get(&token) {
        Some(route) => route.page.clone(),
        None => return Ok(reply(StatusCode::NOT_FOUND, "")),
    };
    match *req.method() {
        Method::POST => {}
        // No server-to-client stream (MCP allows saying so); nothing to close.
        Method::GET => return Ok(reply(StatusCode::METHOD_NOT_ALLOWED, "")),
        Method::DELETE => return Ok(reply(StatusCode::OK, "")),
        _ => return Ok(reply(StatusCode::METHOD_NOT_ALLOWED, "")),
    }
    let body = match Limited::new(req.into_body(), MAX_BODY).collect().await {
        Ok(b) => String::from_utf8_lossy(&b.to_bytes()).into_owned(),
        Err(_) => return Ok(reply(StatusCode::PAYLOAD_TOO_LARGE, "")),
    };
    let id = inner.next.fetch_add(1, Ordering::Relaxed);
    let (tx, rx) = oneshot::channel();
    inner.waiting.lock().unwrap().insert(id, tx);
    if page.send(json!({ "id": id, "body": body })).is_err() {
        inner.waiting.lock().unwrap().remove(&id);
        return Ok(reply(StatusCode::SERVICE_UNAVAILABLE, ""));
    }
    match tokio::time::timeout(ANSWER_WITHIN, rx).await {
        Ok(Ok(Some(answer))) => Ok(reply(StatusCode::OK, &answer)),
        Ok(Ok(None)) => Ok(reply(StatusCode::ACCEPTED, "")),
        _ => {
            inner.waiting.lock().unwrap().remove(&id);
            Ok(reply(StatusCode::GATEWAY_TIMEOUT, ""))
        }
    }
}
