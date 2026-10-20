//! The Typst preview lives in its own child webview (a separate WKWebView and
//! web content process) so preview rendering can never block the editor's
//! main thread. The frontend keeps it positioned over the preview pane.
use serde::Deserialize;
use tauri::{
    AppHandle, Emitter, EventTarget, LogicalPosition, LogicalSize, Manager, Rect, Url, WebviewUrl,
    webview::WebviewBuilder,
};

use crate::{
    Win,
    error::{CmdError, CmdResult},
    preview_label,
};

/// WebKit workarounds for Tinymist's preview renderer (typst.ts). Off-screen
/// pages are drawn as canvas previews inside `<foreignObject>`:
///
/// 1. WebKit paints composited HTML inside a foreignObject without the parent
///    group's `translate`, so those pages landed on top of page 1 ("title page
///    missing, starts with References"). Two things make the content composited:
///    the CSS `transform: scale()` on the canvas wrapper, and GPU-accelerated
///    canvases. Size the canvas with CSS instead of a transform, and ask for
///    software canvases (`willReadFrequently`).
/// 2. Canvas previews are painted via `requestIdleCallback`, and the renderer
///    waits for that pass before any other update. In this WKWebView idle
///    callbacks can stall until the user interacts, which left pages blank until
///    a click. Schedule them as ordinary tasks instead.
const WEBKIT_FIX_SCRIPT: &str = r#"
(() => {
  window.requestIdleCallback = (cb) => setTimeout(() => cb({ didTimeout: false, timeRemaining: () => 12 }), 1);
  window.cancelIdleCallback = (id) => clearTimeout(id);

  const getContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, attrs) {
    if (type === '2d') attrs = Object.assign({}, attrs, { willReadFrequently: true });
    return getContext.call(this, type, attrs);
  };

  // The renderer waits 500 ms after the last scroll event before drawing newly
  // visible pages; after a long jump those pages are blank until then. Its
  // window-resize handler redraws immediately, so nudge it 120 ms after
  // scrolling stops. (`scroll` doesn't bubble; capture it on the document.)
  let settle;
  document.addEventListener('scroll', () => {
    clearTimeout(settle);
    settle = setTimeout(() => window.dispatchEvent(new Event('resize')), 120);
  }, true);

  // Back from another app or desktop, the pages on screen were sometimes blank
  // (the gaps between them drawn) until something made the renderer redraw,
  // like a click in the editor (its jump). Redraw them on return.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') window.dispatchEvent(new Event('resize'));
  });

  const add = () => {
    const style = document.createElement('style');
    style.textContent =
      '.typst-svg-mixin-canvas .typst-page-canvas { transform: none !important; }' +
      '.typst-svg-mixin-canvas .typst-page-canvas > canvas { width: 100% !important; height: 100% !important; display: block; }';
    (document.head || document.documentElement).appendChild(style);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', add); else add();
})();
"#;

/// Tells the app when Tinymist makes the preview jump (source → preview sync),
/// so it can stop trying fallback positions after the first one that works.
/// Wraps WebSocket before the preview's own scripts run.
const JUMP_SCRIPT: &str = r#"
(() => {
  const Native = window.WebSocket;
  const isJump = (d) => {
    if (typeof d === 'string') return d.startsWith('jump,');
    if (!(d instanceof ArrayBuffer) || d.byteLength < 5) return false;
    const b = new Uint8Array(d, 0, 5);
    return b[0] === 106 && b[1] === 117 && b[2] === 109 && b[3] === 112 && b[4] === 44; // "jump,"
  };
  window.WebSocket = class extends Native {
    constructor(...args) {
      super(...args);
      this.addEventListener('message', (e) => {
        if (!isJump(e.data)) return;
        try { window.__TAURI_INTERNALS__.invoke('preview_report', { report: { tag: 'jump' } }); } catch (_) {}
      });
    }
  };
  // Jumps made while the author types follow the cursor without a ripple (the
  // app sets this class for a moment). Hidden, not removed: the ripple's
  // animation still ends, and Tinymist takes it away.
  const add = () => {
    const style = document.createElement('style');
    style.textContent = '.studio-quiet-jump .typst-jump-ripple { visibility: hidden !important; }';
    (document.head || document.documentElement).appendChild(style);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', add); else add();
})();
"#;

/// Right-click in the preview: suppress WebKit's menu (its Reload would break
/// the preview) and let the app show its own, at the same spot. Option-click
/// keeps WebKit's menu for debugging.
const CONTEXT_MENU_SCRIPT: &str = r#"
window.addEventListener('contextmenu', (e) => {
  if (e.altKey) return;
  e.preventDefault();
  const selection = String(window.getSelection() || '').slice(0, 4000);
  try {
    window.__TAURI_INTERNALS__.invoke('preview_report', { report: { tag: 'contextmenu', x: e.clientX, y: e.clientY, selection } });
  } catch (_) {}
}, true);
"#;

/// Text selected in the preview (Tinymist's text layer holds the real
/// characters): once the selection settles, mark its first and last text runs
/// (so the app can click them to find the source) and report the text.
const SELECTION_SCRIPT: &str = r#"
(() => {
  let timer = 0, last = '';
  const report = (r) => { try { window.__TAURI_INTERNALS__.invoke('preview_report', { report: r }); } catch (_) {} };
  const run = (node) => (node && (node.nodeType === 1 ? node : node.parentElement))?.closest?.('.typst-text');
  const settle = () => {
    const sel = window.getSelection();
    const text = sel ? String(sel).trim() : '';
    if (text === last) return;
    last = text;
    document.querySelectorAll('[data-studio-sel]').forEach((e) => e.removeAttribute('data-studio-sel'));
    if (!text || !sel.rangeCount) return report({ tag: 'selection', text: '' });
    const range = sel.getRangeAt(0);
    const start = run(range.startContainer), end = run(range.endContainer);
    if (start) start.setAttribute('data-studio-sel', 'start');
    if (end && end !== start) end.setAttribute('data-studio-sel', 'end');
    report({ tag: 'selection', text: text.slice(0, 20000), start: !!start, end: !!end && end !== start });
  };
  document.addEventListener('selectionchange', () => { clearTimeout(timer); timer = setTimeout(settle, 350); });
})();
"#;

/// Reports each preview DOM update (as painted) back to the app for the
/// keystroke → preview latency HUD. Runs on every page load in the preview.
const PERF_SCRIPT: &str = r#"
(() => {
  if (window.__studioPerf) return;
  window.__studioPerf = true;
  const clock = () => performance.timeOrigin + performance.now();
  let scheduled = false, pending = [];
  const flush = () => {
    const samples = pending; pending = [];
    try { window.__TAURI_INTERNALS__.invoke('perf_report', { samples }); } catch (_) {}
  };
  const start = () => new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      const ch = new MessageChannel();
      ch.port1.onmessage = () => {
        scheduled = false;
        pending.push(clock());
        if (pending.length === 1) setTimeout(flush, 30);
      };
      ch.port2.postMessage(0);
    });
  }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
"#;

#[derive(Deserialize, Clone, Copy)]
pub struct Bounds {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

impl From<Bounds> for Rect {
    fn from(b: Bounds) -> Self {
        Rect {
            position: LogicalPosition::new(b.x, b.y).into(),
            size: LogicalSize::new(b.width.max(1.0), b.height.max(1.0)).into(),
        }
    }
}

fn is_local_preview(url: &Url) -> bool {
    url.scheme() == "http" && url.host_str() == Some("127.0.0.1")
}

/// The calling window's preview webview (each window has its own).
fn preview_webview(app: &AppHandle, state: &Win) -> CmdResult<tauri::Webview> {
    app.get_webview(&preview_label(state.label()))
        .ok_or_else(|| CmdError::Unavailable("preview is not open".into()))
}

#[tauri::command]
pub async fn preview_open(
    app: AppHandle,
    state: Win,
    url: String,
    bounds: Bounds,
) -> CmdResult<()> {
    let url = Url::parse(&url).map_err(|e| CmdError::Invalid(e.to_string()))?;
    if !is_local_preview(&url) {
        return Err(CmdError::Invalid(
            "preview must be served from 127.0.0.1".into(),
        ));
    }
    let label = preview_label(state.label());
    if let Some(webview) = app.get_webview(&label) {
        webview.navigate(url)?;
        webview.set_bounds(bounds.into())?;
        webview.show()?;
        return Ok(());
    }
    let window = app
        .get_window(state.label())
        .ok_or_else(|| CmdError::Unavailable("window missing".into()))?;
    let builder = WebviewBuilder::new(&label, WebviewUrl::External(url))
        .initialization_script(WEBKIT_FIX_SCRIPT)
        .initialization_script(JUMP_SCRIPT)
        .initialization_script(PERF_SCRIPT)
        .initialization_script(CONTEXT_MENU_SCRIPT)
        .initialization_script(SELECTION_SCRIPT)
        .focused(false)
        .on_navigation(is_local_preview);
    window.add_child(
        builder,
        LogicalPosition::new(bounds.x, bounds.y),
        LogicalSize::new(bounds.width, bounds.height),
    )?;
    Ok(())
}

#[tauri::command]
pub fn preview_set_bounds(app: AppHandle, state: Win, bounds: Bounds) -> CmdResult<()> {
    if let Some(webview) = app.get_webview(&preview_label(state.label())) {
        webview.set_bounds(bounds.into())?;
    }
    Ok(())
}

#[tauri::command]
pub fn preview_set_visible(app: AppHandle, state: Win, visible: bool) -> CmdResult<()> {
    if let Some(webview) = app.get_webview(&preview_label(state.label())) {
        if visible {
            webview.show()?
        } else {
            webview.hide()?
        }
    }
    Ok(())
}

#[tauri::command]
pub fn preview_close(app: AppHandle, state: Win) -> CmdResult<()> {
    if let Some(webview) = app.get_webview(&preview_label(state.label())) {
        webview.close()?;
    }
    Ok(())
}

/// Run a script in the preview page (main webview only; used by the self-test).
#[tauri::command]
pub fn preview_eval(app: AppHandle, state: Win, js: String) -> CmdResult<()> {
    preview_webview(&app, &state)?.eval(js)?;
    Ok(())
}

/// Self-test only: save a PNG of a webview (`target`: "preview", the default,
/// or "main") exactly as displayed to `<FOREWORD_SELFTEST>.<name>.png`.
#[tauri::command]
pub async fn preview_snapshot(
    app: AppHandle,
    state: Win,
    name: String,
    target: Option<String>,
) -> CmdResult<String> {
    let out = std::env::var("FOREWORD_SELFTEST")
        .map_err(|_| CmdError::Invalid("snapshots are only available in self-test mode".into()))?;
    if name.is_empty() || !name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err(CmdError::Invalid(format!("bad snapshot name: {name:?}")));
    }
    let path = format!("{out}.{name}.png");
    let webview = match target.as_deref() {
        Some("main") => app
            .get_webview(state.label())
            .ok_or_else(|| CmdError::Unavailable("main webview missing".into()))?,
        _ => preview_webview(&app, &state)?,
    };
    #[cfg(target_os = "macos")]
    crate::snapshot::snapshot_png(&webview, path.clone().into())
        .await
        .map_err(CmdError::Io)?;
    Ok(path)
}

/// Give keyboard focus back to the app UI (e.g. after a click in the preview
/// jumped to the source).
#[tauri::command]
pub fn focus_main(app: AppHandle, state: Win) -> CmdResult<()> {
    if let Some(webview) = app.get_webview(state.label()) {
        webview.set_focus()?;
    }
    Ok(())
}

/// Called from inside the preview webview (see PERF_SCRIPT).
#[tauri::command]
pub fn perf_report(app: AppHandle, state: Win, samples: Vec<f64>) -> CmdResult<()> {
    app.emit_to(
        EventTarget::webview(state.label()),
        "perf:preview-paint",
        samples,
    )?;
    Ok(())
}

/// Called from inside the preview webview: diagnostics for the self-test.
#[tauri::command]
pub fn preview_report(app: AppHandle, state: Win, report: serde_json::Value) -> CmdResult<()> {
    // From inside a preview: to its own window's app webview.
    app.emit_to(
        EventTarget::webview(state.label()),
        "preview:report",
        report,
    )?;
    Ok(())
}
