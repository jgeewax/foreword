mod agent;
mod children;
mod clipboard;
mod code;
mod config;
mod discover;
mod error;
mod export;
mod files;
mod git;
mod history;
mod logs;
mod lsp;
mod menu;
mod packages;
mod preview;
mod print;
mod render;
#[cfg(target_os = "macos")]
mod snapshot;
mod workspace;

use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{
        Arc, Mutex,
        atomic::{AtomicU32, Ordering},
    },
};

use serde::Serialize;
use tauri::{
    Emitter, EventTarget, LogicalPosition, Manager, RunEvent, WebviewUrl, WindowEvent,
    ipc::{CommandArg, CommandItem, InvokeError},
    webview::WebviewBuilder,
    window::WindowBuilder,
};

use crate::error::{CmdError, CmdResult};

/// One window's book: its folder, file watcher, Tinymist, OpenCode and the
/// lock on its History repo. Each window has its own, like VS Code's windows.
#[derive(Default)]
pub struct WindowState {
    root: Mutex<Option<PathBuf>>,
    watcher: Mutex<Option<notify::RecommendedWatcher>>,
    typst: tokio::sync::Mutex<Option<lsp::LspProcess>>,
    /// Writer queue to Tinymist's stdin; separate so `typst_send` can stay synchronous.
    typst_tx: Mutex<Option<tokio::sync::mpsc::UnboundedSender<Vec<u8>>>>,
    agent: tokio::sync::Mutex<Option<agent::AgentServer>>,
    /// Serializes history (Git) operations on the snapshot repo.
    history: tokio::sync::Mutex<()>,
}

/// Every window's state, by window label ("main", then "win-2", "win-3"…).
#[derive(Default)]
pub struct AppState {
    windows: Mutex<HashMap<String, Arc<WindowState>>>,
    next_window: AtomicU32,
}

impl AppState {
    fn window(&self, label: &str) -> Arc<WindowState> {
        self.windows
            .lock()
            .unwrap()
            .entry(label.to_string())
            .or_default()
            .clone()
    }

    fn all(&self) -> Vec<(String, Arc<WindowState>)> {
        self.windows
            .lock()
            .unwrap()
            .iter()
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect()
    }

    fn kill_children(&self) {
        for (_, w) in self.all() {
            w.kill_children();
        }
    }
}

/// A command's window: the state of the window whose webview called it (main
/// or preview). Commands take `state: Win` and use it like the state itself.
pub struct Win {
    state: Arc<WindowState>,
    label: String,
}

impl Win {
    /// The window's label, which is also its main webview's.
    pub fn label(&self) -> &str {
        &self.label
    }
}

impl std::ops::Deref for Win {
    type Target = WindowState;
    fn deref(&self) -> &WindowState {
        &self.state
    }
}

impl<'de, R: tauri::Runtime> CommandArg<'de, R> for Win {
    fn from_command(command: CommandItem<'de, R>) -> Result<Self, InvokeError> {
        let webview = command.message.webview();
        let label = webview.window().label().to_string();
        let state = webview.state::<AppState>().window(&label);
        Ok(Win { state, label })
    }
}

/// The preview webview of a window.
pub fn preview_label(window: &str) -> String {
    format!("{window}-preview")
}

impl WindowState {
    fn root(&self) -> CmdResult<PathBuf> {
        self.root
            .lock()
            .unwrap()
            .clone()
            .ok_or_else(|| CmdError::Unavailable("no workspace is open".into()))
    }

    fn kill_children(&self) {
        if let Ok(mut typst) = self.typst.try_lock()
            && let Some(lsp) = typst.as_mut()
        {
            lsp.kill();
        }
        if let Ok(mut agent) = self.agent.try_lock()
            && let Some(server) = agent.as_mut()
        {
            server.kill();
        }
    }
}

/// Settings ▸ Tools: what a typed or pasted path for a tool holds.
#[tauri::command]
async fn tool_probe(tool: String, path: String) -> CmdResult<discover::Probe> {
    let tool = discover::Tool::parse(&tool)
        .ok_or_else(|| CmdError::Invalid(format!("unknown tool {tool}")))?;
    Ok(discover::probe(tool, &path))
}

#[derive(Serialize)]
struct ToolsStatus {
    tinymist: discover::ToolInfo,
    opencode: discover::ToolInfo,
    git: discover::ToolInfo,
}

#[tauri::command]
async fn tools_status() -> ToolsStatus {
    ToolsStatus {
        tinymist: discover::tool_info(discover::Tool::Tinymist),
        opencode: discover::tool_info(discover::Tool::OpenCode),
        git: discover::tool_info(discover::Tool::Git),
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LaunchOptions {
    /// `TYPST_STUDIO_WORKSPACE`: open this folder at launch.
    workspace: Option<String>,
    /// Dev builds only: the repo's sample book, for the welcome screen.
    sample_book: Option<String>,
    /// `TYPST_STUDIO_SELFTEST`: run the scripted self-test and write results here.
    selftest_out: Option<String>,
    /// `TYPST_STUDIO_SELFTEST_AGENT=1`: include a real agent turn in the self-test.
    selftest_agent: bool,
    /// `TYPST_STUDIO_SELFTEST_EDITS=1`: let the self-test's agent edit files
    /// (only ever pointed at a scratch copy of a book).
    selftest_edits: bool,
    /// `TYPST_STUDIO_SELFTEST_ONLY=a,b`: run only these self-test groups.
    selftest_only: Option<String>,
    /// A window opened with New Window: it starts without a book, not the last one.
    fresh: bool,
}

#[tauri::command]
fn launch_options(state: Win) -> LaunchOptions {
    let sample = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../fixtures/sample-book");
    // The environment (a book to open, the self-test) is for the first window only.
    let first = state.label() == "main";
    let env = |k: &str| std::env::var(k).ok().filter(|_| first);
    LaunchOptions {
        fresh: !first,
        workspace: env("TYPST_STUDIO_WORKSPACE"),
        sample_book: (cfg!(debug_assertions) && sample.is_dir()).then(|| {
            sample
                .canonicalize()
                .unwrap_or(sample)
                .to_string_lossy()
                .into_owned()
        }),
        selftest_out: env("TYPST_STUDIO_SELFTEST"),
        selftest_agent: env("TYPST_STUDIO_SELFTEST_AGENT").is_some_and(|v| v == "1"),
        selftest_edits: env("TYPST_STUDIO_SELFTEST_EDITS").is_some_and(|v| v == "1"),
        selftest_only: env("TYPST_STUDIO_SELFTEST_ONLY"),
    }
}

/// Frontend diagnostics (uncaught errors, self-test progress) into the app log;
/// in self-test mode also appended to `<out>.log` so a hung run can be diagnosed.
#[tauri::command]
fn ui_log(line: String) {
    if let Ok(out) = std::env::var("TYPST_STUDIO_SELFTEST") {
        use std::io::Write;
        if let Ok(mut f) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(format!("{out}.log"))
        {
            let _ = writeln!(f, "{line}");
        }
    }
    logs::push("ui", line);
}

/// UI zoom (⌘= / ⌘− / ⌘0): native page zoom of the main webview, like VS Code's
/// window zoom. The preview webview keeps its own scale (its pages fit the pane).
#[tauri::command]
fn set_ui_zoom(app: tauri::AppHandle, state: Win, factor: f64) -> CmdResult<f64> {
    let factor = factor.clamp(0.5, 2.5);
    app.get_webview(state.label())
        .ok_or_else(|| CmdError::Unavailable("main webview missing".into()))?
        .set_zoom(factor)?;
    Ok(factor)
}

/// A webview of the calling window by role: "main" (the app) or "preview".
fn webview_label(state: &Win, role: &str) -> String {
    if role == "preview" {
        preview_label(state.label())
    } else {
        state.label().to_string()
    }
}

#[derive(Serialize)]
struct Frame {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

/// Logical (point) frames of the app's webviews; the self-test checks that the
/// preview stays aligned with its pane at every zoom level.
#[tauri::command]
fn webview_frames(
    app: tauri::AppHandle,
    state: Win,
) -> CmdResult<std::collections::HashMap<String, Frame>> {
    let window = app
        .get_window(state.label())
        .ok_or_else(|| CmdError::Unavailable("window missing".into()))?;
    let scale = window.scale_factor()?;
    let mut out = std::collections::HashMap::new();
    let inner = window.inner_size()?.to_logical::<f64>(scale);
    let outer = window.outer_size()?.to_logical::<f64>(scale);
    out.insert(
        "window-inner".into(),
        Frame {
            x: 0.0,
            y: 0.0,
            width: inner.width,
            height: inner.height,
        },
    );
    out.insert(
        "window-outer".into(),
        Frame {
            x: 0.0,
            y: 0.0,
            width: outer.width,
            height: outer.height,
        },
    );
    // This window's webviews, by role ("main", "preview").
    for (label, webview) in app.webviews() {
        let label = if label == state.label() {
            "main".to_string()
        } else if label == preview_label(state.label()) {
            "preview".to_string()
        } else {
            continue;
        };
        let b = webview.bounds()?;
        let pos = b.position.to_logical::<f64>(scale);
        let size = b.size.to_logical::<f64>(scale);
        out.insert(
            label,
            Frame {
                x: pos.x,
                y: pos.y,
                width: size.width,
                height: size.height,
            },
        );
    }
    Ok(out)
}

/// Native geometry of the window and a webview (diagnostics; macOS).
#[tauri::command]
async fn native_geometry(
    app: tauri::AppHandle,
    state: Win,
    label: String,
) -> CmdResult<serde_json::Value> {
    let window = app
        .get_window(state.label())
        .ok_or_else(|| CmdError::Unavailable("window missing".into()))?;
    let webview = app
        .get_webview(&webview_label(&state, &label))
        .ok_or_else(|| CmdError::NotFound(format!("no webview {label:?}")))?;
    #[cfg(target_os = "macos")]
    return snapshot::window_geometry(&window, &webview)
        .await
        .map_err(CmdError::Io);
    #[cfg(not(target_os = "macos"))]
    Ok(serde_json::Value::Null)
}

/// Self-test only: write the results and quit.
#[tauri::command]
fn selftest_finish(app: tauri::AppHandle, result: serde_json::Value) -> CmdResult<()> {
    let out = std::env::var("TYPST_STUDIO_SELFTEST")
        .map_err(|_| CmdError::Invalid("not in self-test mode".into()))?;
    std::fs::write(
        &out,
        serde_json::to_string_pretty(&result).unwrap_or_default(),
    )?;
    app.exit(0);
    Ok(())
}

/// A window with the app in it (its main webview has the window's label).
/// Built by hand, not from tauri.conf.json, so the preview can be a second
/// webview in the same window.
fn open_window(app: &tauri::AppHandle, label: &str) -> tauri::Result<tauri::Window> {
    let builder = WindowBuilder::new(app, label)
        .title("Typst Studio")
        .inner_size(1600.0, 1000.0)
        .min_inner_size(960.0, 600.0);
    // As in VS Code: no native title bar, the page draws its own and the
    // window's buttons sit in it. The title is still set (Window menu, Mission
    // Control), just not drawn.
    #[cfg(target_os = "macos")]
    let builder = builder
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true);
    let window = builder.build()?;
    let size = window
        .inner_size()?
        .to_logical::<f64>(window.scale_factor()?);
    window.add_child(
        WebviewBuilder::new(label, WebviewUrl::default()).auto_resize(),
        LogicalPosition::new(0.0, 0.0),
        size,
    )?;
    Ok(window)
}

/// A new window, without a book (it shows the welcome screen): "win-2", "win-3"…
fn new_window(app: &tauri::AppHandle) -> tauri::Result<String> {
    let n = app
        .state::<AppState>()
        .next_window
        .fetch_add(1, Ordering::Relaxed)
        + 2;
    let label = format!("win-{n}");
    open_window(app, &label)?.set_focus()?;
    Ok(label)
}

/// File → New Window, from the page.
#[tauri::command]
fn window_new(app: tauri::AppHandle) -> CmdResult<String> {
    Ok(new_window(&app)?)
}

fn selftest_only() -> CmdResult<()> {
    match std::env::var_os("TYPST_STUDIO_SELFTEST") {
        Some(_) => Ok(()),
        None => Err(CmdError::Invalid("not in self-test mode".into())),
    }
}

#[derive(Serialize)]
struct WindowInfo {
    label: String,
    title: String,
    root: Option<String>,
}

/// Self-test only: every window, its title and its book.
#[tauri::command]
fn selftest_windows(app: tauri::AppHandle) -> CmdResult<Vec<WindowInfo>> {
    selftest_only()?;
    let state = app.state::<AppState>();
    let mut out: Vec<WindowInfo> = app
        .windows()
        .into_iter()
        .map(|(label, w)| WindowInfo {
            title: w.title().unwrap_or_default(),
            root: state
                .window(&label)
                .root
                .lock()
                .unwrap()
                .as_ref()
                .map(|r| r.to_string_lossy().into_owned()),
            label,
        })
        .collect();
    out.sort_by(|a, b| a.label.cmp(&b.label));
    Ok(out)
}

/// Self-test only: run a script in another window's app webview.
#[tauri::command]
fn selftest_eval(app: tauri::AppHandle, label: String, js: String) -> CmdResult<()> {
    selftest_only()?;
    app.get_webview(&label)
        .ok_or_else(|| CmdError::NotFound(format!("no window {label:?}")))?
        .eval(js)?;
    Ok(())
}

/// Self-test only: close a window.
#[tauri::command]
fn selftest_close_window(app: tauri::AppHandle, label: String) -> CmdResult<()> {
    selftest_only()?;
    app.get_window(&label)
        .ok_or_else(|| CmdError::NotFound(format!("no window {label:?}")))?
        .close()?;
    Ok(())
}

/// The menu bar's titles and items (self-test only).
#[tauri::command]
fn menu_outline(app: tauri::AppHandle) -> CmdResult<Vec<(String, Vec<String>)>> {
    if std::env::var_os("TYPST_STUDIO_SELFTEST").is_none() {
        return Err(CmdError::Invalid("not in self-test mode".into()));
    }
    let menu = app
        .menu()
        .ok_or_else(|| CmdError::Unavailable("no menu".into()))?;
    menu::outline(&menu).map_err(|e| CmdError::Io(e.to_string()))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .menu(menu::build)
        .on_menu_event(|app, event| {
            // The menu bar is the app's: it acts on the window in front.
            let front = app
                .windows()
                .into_iter()
                .find(|(_, w)| w.is_focused().unwrap_or(false))
                .map(|(label, _)| label);
            match event.id().as_ref() {
                "new-window" => {
                    if let Err(e) = new_window(app) {
                        logs::push("app", format!("couldn't open a window: {e}"));
                    }
                }
                "close-window" => {
                    if let Some(w) = front.and_then(|l| app.get_window(&l)) {
                        let _ = w.close();
                    }
                }
                "select-all" => menu::select_all(app, front),
                id if menu::COMMANDS.contains(&id) => {
                    if let Some(label) = front {
                        let _ = app.emit_to(EventTarget::webview(&label), "menu", id);
                    }
                }
                _ => {}
            }
        })
        .on_window_event(|window, event| {
            // A closed window's helpers (Tinymist, OpenCode) stop with it.
            if let WindowEvent::Destroyed = event {
                let state = window.state::<AppState>();
                if let Some(w) = state.windows.lock().unwrap().remove(window.label()) {
                    w.kill_children();
                }
            }
        })
        .manage(AppState::default())
        .setup(|app| {
            children::init(app.path().app_data_dir()?);

            // SIGTERM/SIGINT/SIGHUP (kill, Ctrl+C on `tauri dev`, logout) go through
            // the normal exit path so helper processes are stopped too.
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                use tokio::signal::unix::{SignalKind, signal};
                let (Ok(mut term), Ok(mut int), Ok(mut hup)) = (
                    signal(SignalKind::terminate()),
                    signal(SignalKind::interrupt()),
                    signal(SignalKind::hangup()),
                ) else {
                    return;
                };
                tokio::select! {
                    _ = term.recv() => {}
                    _ = int.recv() => {}
                    _ = hup.recv() => {}
                }
                handle.exit(0);
            });

            let window = open_window(app.handle(), "main")?;
            // An occluded window gets no animation frames, which would stall the self-test.
            if std::env::var_os("TYPST_STUDIO_SELFTEST").is_some() {
                let _ = window.set_focus();
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            tools_status,
            tool_probe,
            launch_options,
            ui_log,
            set_ui_zoom,
            webview_frames,
            native_geometry,
            selftest_finish,
            menu_outline,
            window_new,
            selftest_windows,
            selftest_eval,
            selftest_close_window,
            logs::app_logs,
            workspace::workspace_open,
            workspace::workspace_elsewhere,
            workspace::workspace_list,
            workspace::fs_read,
            workspace::fs_hash,
            workspace::fs_write,
            workspace::project_create,
            workspace::sample_create,
            packages::project_create_from_package,
            workspace::reveal_in_finder,
            files::fs_mkdir,
            files::fs_rename,
            files::fs_copy,
            files::fs_trash,
            clipboard::clipboard_write,
            clipboard::clipboard_read,
            print::pdf_info,
            export::export_copy,
            config::config_read,
            config::config_write,
            config::config_open,
            export::open_pdf,
            export::reveal_pdf,
            print::open_url,
            code::code_run,
            render::typst_render,
            lsp::typst_start,
            lsp::typst_send,
            lsp::typst_stop,
            preview::preview_open,
            preview::preview_set_bounds,
            preview::preview_set_visible,
            preview::preview_close,
            preview::preview_eval,
            preview::preview_snapshot,
            preview::focus_main,
            preview::perf_report,
            preview::preview_report,
            agent::agent_start,
            agent::agent_request,
            agent::agent_subscribe,
            agent::agent_stop,
            history::history_init,
            git::git_status,
            git::git_file,
            git::git_log,
            git::git_commit_files,
            git::git_commit,
            git::git_stage,
            git::git_unstage,
            git::git_pull,
            git::git_push,
            history::history_reveal,
            history::history_snapshot,
            history::history_list,
            history::history_changes,
            history::history_file,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Typst Studio")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                app.state::<AppState>().kill_children();
                // Also anything whose lock was busy (e.g. OpenCode still starting).
                children::kill_all();
                children::clear();
            }
        });
}

#[cfg(test)]
mod tests {
    /// Every command the app registers is in the command manifest (build.rs) and
    /// allowed for a window (capabilities/). Without both, Tauri refuses the call
    /// at run time ("not allowed"), which no type check catches.
    #[test]
    fn every_registered_command_is_allowed() {
        let lib = include_str!("lib.rs");
        let build = include_str!("../build.rs");
        let capabilities = [
            include_str!("../capabilities/main.json"),
            include_str!("../capabilities/preview.json"),
        ];
        let open = "generate_handler![";
        let start = lib.find(open).expect("generate_handler!") + open.len();
        let end = start + lib[start..].find(']').expect("end of generate_handler!");
        let names: Vec<&str> = lib[start..end]
            .split(',')
            .filter_map(|p| p.trim().rsplit("::").next())
            .filter(|n| !n.is_empty())
            .collect();
        assert!(names.len() > 50, "found only {names:?}");
        for name in names {
            assert!(
                build.contains(&format!("\"{name}\"")),
                "{name} isn't in build.rs's command manifest"
            );
            let permission = format!("\"allow-{}\"", name.replace('_', "-"));
            assert!(
                capabilities.iter().any(|c| c.contains(&permission)),
                "{name} isn't allowed in capabilities/ ({permission})"
            );
        }
    }
}
