mod agent;
mod children;
mod clipboard;
mod code;
mod discover;
mod error;
mod export;
mod files;
mod history;
mod logs;
mod lsp;
mod packages;
mod preview;
mod print;
#[cfg(target_os = "macos")]
mod snapshot;
mod workspace;

use std::{path::PathBuf, sync::Mutex};

use serde::Serialize;
use tauri::{
    Emitter, EventTarget, LogicalPosition, Manager, RunEvent, WebviewUrl,
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
    webview::WebviewBuilder,
    window::WindowBuilder,
};

use crate::error::{CmdError, CmdResult};

#[derive(Default)]
pub struct AppState {
    root: Mutex<Option<PathBuf>>,
    watcher: Mutex<Option<notify::RecommendedWatcher>>,
    typst: tokio::sync::Mutex<Option<lsp::LspProcess>>,
    /// Writer queue to Tinymist's stdin; separate so `typst_send` can stay synchronous.
    typst_tx: Mutex<Option<tokio::sync::mpsc::UnboundedSender<Vec<u8>>>>,
    agent: tokio::sync::Mutex<Option<agent::AgentServer>>,
    /// Serializes history (Git) operations on the snapshot repo.
    history: tokio::sync::Mutex<()>,
}

impl AppState {
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

#[derive(Serialize)]
struct ToolsStatus {
    tinymist: discover::ToolInfo,
    opencode: discover::ToolInfo,
}

#[tauri::command]
async fn tools_status() -> ToolsStatus {
    ToolsStatus {
        tinymist: discover::tool_info(discover::find_tinymist()),
        opencode: discover::tool_info(discover::find_opencode()),
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
}

#[tauri::command]
fn launch_options() -> LaunchOptions {
    let sample = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../fixtures/sample-book");
    LaunchOptions {
        workspace: std::env::var("TYPST_STUDIO_WORKSPACE").ok(),
        sample_book: (cfg!(debug_assertions) && sample.is_dir()).then(|| {
            sample
                .canonicalize()
                .unwrap_or(sample)
                .to_string_lossy()
                .into_owned()
        }),
        selftest_out: std::env::var("TYPST_STUDIO_SELFTEST").ok(),
        selftest_agent: std::env::var("TYPST_STUDIO_SELFTEST_AGENT").is_ok_and(|v| v == "1"),
        selftest_edits: std::env::var("TYPST_STUDIO_SELFTEST_EDITS").is_ok_and(|v| v == "1"),
        selftest_only: std::env::var("TYPST_STUDIO_SELFTEST_ONLY").ok(),
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
fn set_ui_zoom(app: tauri::AppHandle, factor: f64) -> CmdResult<f64> {
    let factor = factor.clamp(0.5, 2.5);
    app.get_webview("main")
        .ok_or_else(|| CmdError::Unavailable("main webview missing".into()))?
        .set_zoom(factor)?;
    Ok(factor)
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
fn webview_frames(app: tauri::AppHandle) -> CmdResult<std::collections::HashMap<String, Frame>> {
    let window = app
        .get_window("main")
        .ok_or_else(|| CmdError::Unavailable("main window missing".into()))?;
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
    for (label, webview) in app.webviews() {
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
async fn native_geometry(app: tauri::AppHandle, label: String) -> CmdResult<serde_json::Value> {
    let window = app
        .get_window("main")
        .ok_or_else(|| CmdError::Unavailable("main window missing".into()))?;
    let webview = app
        .get_webview(&label)
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

/// The default menu's "Close Window" (⌘W), and a separator left dangling after it.
fn remove_close_window<R: tauri::Runtime>(menu: &Submenu<R>) -> tauri::Result<()> {
    for item in menu.items()? {
        if item
            .as_predefined_menuitem()
            .is_some_and(|p| p.text().is_ok_and(|t| t == "Close Window"))
        {
            menu.remove(&item)?;
        }
    }
    if let Some(last) = menu.items()?.last()
        && last
            .as_predefined_menuitem()
            .is_some_and(|p| p.text().is_ok_and(|t| t.is_empty()))
    {
        menu.remove(last)?;
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .menu(|handle| {
            // The standard macOS menu, plus View → Zoom In / Zoom Out / Actual Size.
            // Menu shortcuts work whichever webview (editor or preview) has focus.
            let menu = Menu::default(handle)?;
            let zoom_in =
                MenuItem::with_id(handle, "zoom-in", "Zoom In", true, Some("CmdOrCtrl+="))?;
            let zoom_out =
                MenuItem::with_id(handle, "zoom-out", "Zoom Out", true, Some("CmdOrCtrl+-"))?;
            let zoom_reset = MenuItem::with_id(
                handle,
                "zoom-reset",
                "Actual Size",
                true,
                Some("CmdOrCtrl+0"),
            )?;
            let separator = PredefinedMenuItem::separator(handle)?;
            let items = menu.items()?;
            // App menu (first submenu): "Settings…" after "About", like other Mac apps.
            if let Some(app_menu) = items.first().and_then(|i| i.as_submenu()) {
                let settings =
                    MenuItem::with_id(handle, "settings", "Settings…", true, Some("CmdOrCtrl+,"))?;
                app_menu.insert(&settings, 2)?;
                app_menu.insert(&PredefinedMenuItem::separator(handle)?, 3)?;
            }
            if let Some(file) = items
                .iter()
                .filter_map(|i| i.as_submenu())
                .find(|s| s.text().is_ok_and(|t| t == "File"))
            {
                let export = MenuItem::with_id(
                    handle,
                    "export-pdf",
                    "Export PDF…",
                    true,
                    Some("CmdOrCtrl+Shift+E"),
                )?;
                let new_book = MenuItem::with_id(
                    handle,
                    "new-book",
                    "New Book…",
                    true,
                    Some("CmdOrCtrl+Shift+N"),
                )?;
                let new_chapter = MenuItem::with_id(
                    handle,
                    "new-chapter",
                    "New Chapter…",
                    true,
                    Some("CmdOrCtrl+Alt+N"),
                )?;
                let new_file =
                    MenuItem::with_id(handle, "new-file", "New File…", true, Some("CmdOrCtrl+N"))?;
                let cover =
                    MenuItem::with_id(handle, "design-cover", "Design Cover…", true, None::<&str>)?;
                let open_pdf = MenuItem::with_id(
                    handle,
                    "open-pdf",
                    "Open Exported PDF",
                    true,
                    Some("CmdOrCtrl+Alt+E"),
                )?;
                let print = MenuItem::with_id(
                    handle,
                    "print-mixam",
                    "Print with Mixam…",
                    true,
                    None::<&str>,
                )?;
                file.prepend_items(&[
                    &new_book,
                    &new_chapter,
                    &new_file,
                    &PredefinedMenuItem::separator(handle)?,
                    &cover,
                    &export,
                    &open_pdf,
                    &print,
                    &PredefinedMenuItem::separator(handle)?,
                ])?;
                // ⌘W closes the tab, as in Safari and VS Code; the window gets ⇧⌘W.
                remove_close_window(file)?;
                file.append_items(&[
                    &MenuItem::with_id(
                        handle,
                        "close-tab",
                        "Close Tab",
                        true,
                        Some("CmdOrCtrl+W"),
                    )?,
                    &MenuItem::with_id(
                        handle,
                        "reopen-tab",
                        "Reopen Closed Tab",
                        true,
                        Some("CmdOrCtrl+Shift+T"),
                    )?,
                    &MenuItem::with_id(
                        handle,
                        "close-window",
                        "Close Window",
                        true,
                        Some("CmdOrCtrl+Shift+W"),
                    )?,
                ])?;
            }
            if let Some(window) = items
                .iter()
                .filter_map(|i| i.as_submenu())
                .find(|s| s.text().is_ok_and(|t| t == "Window"))
            {
                remove_close_window(window)?;
                window.append_items(&[
                    &PredefinedMenuItem::separator(handle)?,
                    &MenuItem::with_id(
                        handle,
                        "prev-tab",
                        "Show Previous Tab",
                        true,
                        Some("Ctrl+Shift+Tab"),
                    )?,
                    &MenuItem::with_id(
                        handle,
                        "next-tab",
                        "Show Next Tab",
                        true,
                        Some("Ctrl+Tab"),
                    )?,
                ])?;
            }
            let guide =
                MenuItem::with_id(handle, "typst-guide", "Typst Basics", true, None::<&str>)?;
            match items
                .iter()
                .filter_map(|i| i.as_submenu())
                .find(|s| s.text().is_ok_and(|t| t == "Help"))
            {
                Some(help) => help.prepend(&guide)?,
                None => menu.append(&Submenu::with_items(handle, "Help", true, &[&guide])?)?,
            }
            if let Some(view) = items
                .iter()
                .filter_map(|i| i.as_submenu())
                .find(|s| s.text().is_ok_and(|t| t == "View"))
            {
                view.prepend_items(&[&zoom_in, &zoom_out, &zoom_reset, &separator])?;
            }
            Ok(menu)
        })
        .on_menu_event(|app, event| {
            let id = event.id().as_ref();
            if id == "close-window" {
                if let Some(w) = app.get_window("main") {
                    let _ = w.close();
                }
                return;
            }
            if id.starts_with("zoom-")
                || [
                    "settings",
                    "export-pdf",
                    "new-book",
                    "new-chapter",
                    "new-file",
                    "design-cover",
                    "print-mixam",
                    "open-pdf",
                    "typst-guide",
                    "close-tab",
                    "reopen-tab",
                    "next-tab",
                    "prev-tab",
                ]
                .contains(&id)
            {
                let _ = app.emit_to(EventTarget::webview("main"), "menu", id);
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

            // Built by hand (not from tauri.conf.json) so the preview can be a
            // second webview in the same window.
            let window = WindowBuilder::new(app, "main")
                .title("Typst Studio")
                .inner_size(1600.0, 1000.0)
                .min_inner_size(960.0, 600.0)
                .build()?;
            let size = window
                .inner_size()?
                .to_logical::<f64>(window.scale_factor()?);
            window.add_child(
                WebviewBuilder::new("main", WebviewUrl::default()).auto_resize(),
                LogicalPosition::new(0.0, 0.0),
                size,
            )?;
            // An occluded window gets no animation frames, which would stall the self-test.
            if std::env::var_os("TYPST_STUDIO_SELFTEST").is_some() {
                let _ = window.set_focus();
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            tools_status,
            launch_options,
            ui_log,
            set_ui_zoom,
            webview_frames,
            native_geometry,
            selftest_finish,
            logs::app_logs,
            workspace::workspace_open,
            workspace::workspace_list,
            workspace::fs_read,
            workspace::fs_hash,
            workspace::fs_write,
            workspace::project_create,
            packages::project_create_from_package,
            workspace::reveal_in_finder,
            files::fs_mkdir,
            files::fs_rename,
            files::fs_copy,
            files::fs_trash,
            clipboard::clipboard_write,
            print::pdf_info,
            export::export_copy,
            export::open_pdf,
            export::reveal_pdf,
            print::open_url,
            code::code_run,
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
