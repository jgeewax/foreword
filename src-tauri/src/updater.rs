//! Updates, as iTerm2's: a check when the app starts and from Settings, then
//! install now (download, install, restart), install when the app quits, or
//! skip that version. The feed is the latest GitHub release's latest.json
//! (tauri.conf.json's plugins.updater), and every download is checked against
//! the updater key's signature before it's installed.
//!
//! One update for the whole app: its state lives here, and every change to it
//! goes to every window as an `update` event, so each one's Settings agrees.
use std::{
    sync::{LazyLock, Mutex},
    time::{Duration, Instant},
};

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tauri_plugin_updater::{Update, UpdaterExt};

use crate::error::{CmdError, CmdResult};

/// What every window shows. `status`: idle, checking, none (up to date),
/// available, downloading, downloaded, installing, restarting or error.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateState {
    status: &'static str,
    /// The version running.
    current: String,
    /// The version offered, its release notes and date.
    version: Option<String>,
    notes: Option<String>,
    date: Option<String>,
    /// Bytes downloaded, of `total` (when the server says).
    received: u64,
    total: Option<u64>,
    /// While installing: verifying, installing, then restarting.
    phase: Option<&'static str>,
    /// It installs when the app quits.
    on_quit: bool,
    error: Option<String>,
    /// Whether this copy can be replaced: one running from a .app (not `tauri dev`).
    installable: bool,
    /// When the last check finished (ms since 1970).
    checked_at: Option<u64>,
}

struct Pending {
    state: UpdateState,
    update: Option<Update>,
    bytes: Option<Vec<u8>>,
    /// Installing at quit has started (the second exit request lets the app go).
    quitting: bool,
}

static PENDING: LazyLock<Mutex<Pending>> = LazyLock::new(|| {
    Mutex::new(Pending {
        state: UpdateState {
            status: "idle",
            current: String::new(),
            version: None,
            notes: None,
            date: None,
            received: 0,
            total: None,
            phase: None,
            on_quit: false,
            error: None,
            installable: installable(),
            checked_at: None,
        },
        update: None,
        bytes: None,
        quitting: false,
    })
});

/// One download at a time, whichever window asks.
static DOWNLOADING: LazyLock<tokio::sync::Mutex<()>> =
    LazyLock::new(|| tokio::sync::Mutex::new(()));

/// The updater replaces the .app the program runs from; `tauri dev`'s program
/// isn't in one, and "installing" would replace target/debug instead.
fn installable() -> bool {
    std::env::current_exe().is_ok_and(|p| p.to_string_lossy().contains(".app/Contents/MacOS/"))
}

/// Change the state and tell every window.
fn set(app: &AppHandle, change: impl FnOnce(&mut Pending)) -> UpdateState {
    let state = {
        let mut p = PENDING.lock().unwrap();
        change(&mut p);
        p.state.current = app.package_info().version.to_string();
        p.state.clone()
    };
    let _ = app.emit("update", &state);
    state
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// The feed: tauri.conf.json's, or FOREWORD_UPDATE_URL (self-tests).
fn updater(app: &AppHandle) -> CmdResult<tauri_plugin_updater::Updater> {
    let mut builder = app.updater_builder().timeout(Duration::from_secs(30));
    if let Some(url) = std::env::var("FOREWORD_UPDATE_URL")
        .ok()
        .filter(|u| !u.is_empty())
    {
        let url = url
            .parse()
            .map_err(|e| CmdError::Invalid(format!("FOREWORD_UPDATE_URL: {e}")))?;
        builder = builder.endpoints(vec![url]).map_err(fail)?;
    }
    builder.build().map_err(fail)
}

fn fail(e: tauri_plugin_updater::Error) -> CmdError {
    CmdError::Unavailable(e.to_string())
}

/// The update now, for a window opening Settings.
#[tauri::command]
pub fn update_state(app: AppHandle) -> UpdateState {
    set(&app, |_| {})
}

/// Ask the feed whether there's a newer version. A download or install in
/// progress is left alone.
#[tauri::command]
pub async fn update_check(app: AppHandle) -> CmdResult<UpdateState> {
    {
        let p = PENDING.lock().unwrap();
        if matches!(
            p.state.status,
            "downloading" | "downloaded" | "installing" | "restarting"
        ) {
            return Ok(p.state.clone());
        }
    }
    set(&app, |p| {
        p.state.status = "checking";
        p.state.error = None;
    });
    let found = match updater(&app) {
        Ok(u) => u.check().await.map_err(fail),
        Err(e) => Err(e),
    };
    Ok(set(&app, |p| {
        p.state.checked_at = Some(now_ms());
        match found {
            Ok(Some(update)) => {
                p.state.status = "available";
                p.state.version = Some(update.version.clone());
                p.state.notes = update.body.clone().filter(|b| !b.trim().is_empty());
                p.state.date = update.date.map(|d| d.to_string());
                p.state.received = 0;
                p.state.total = None;
                p.update = Some(update);
                p.bytes = None;
            }
            Ok(None) => {
                p.state.status = "none";
                p.state.version = None;
                p.state.notes = None;
                p.update = None;
            }
            Err(e) => {
                p.state.status = "error";
                p.state.error = Some(e.to_string());
            }
        }
    }))
}

/// Download the update offered (checked against its signature), keeping it for
/// install now or at quit. Progress goes out as `update` events.
async fn download(app: &AppHandle) -> CmdResult<()> {
    let _one = DOWNLOADING.lock().await;
    let update = {
        let p = PENDING.lock().unwrap();
        if p.bytes.is_some() {
            return Ok(());
        }
        p.update
            .clone()
            .ok_or_else(|| CmdError::Invalid("there's no update to download".into()))?
    };
    set(app, |p| {
        p.state.status = "downloading";
        p.state.received = 0;
        p.state.total = None;
        p.state.error = None;
    });
    let mut received = 0u64;
    let mut said = Instant::now() - Duration::from_secs(1);
    let got = update
        .download(
            |chunk, total| {
                received += chunk as u64;
                if said.elapsed() >= Duration::from_millis(100) {
                    said = Instant::now();
                    set(app, |p| {
                        p.state.received = received;
                        p.state.total = total;
                    });
                }
            },
            || {},
        )
        .await;
    match got {
        Ok(bytes) => {
            let size = bytes.len() as u64;
            set(app, |p| {
                p.state.status = "downloaded";
                p.state.received = size;
                p.state.total = Some(p.state.total.unwrap_or(size));
                p.bytes = Some(bytes);
            });
            Ok(())
        }
        Err(e) => {
            let message = e.to_string();
            set(app, |p| {
                p.state.status = "error";
                p.state.error = Some(format!("The download didn't finish: {message}"));
                p.state.on_quit = false;
            });
            Err(fail(e))
        }
    }
}

/// Install now: download (if it isn't yet), check the signature, install, and
/// start the new version.
#[tauri::command]
pub async fn update_install(app: AppHandle) -> CmdResult<()> {
    if !installable() {
        return Err(CmdError::Invalid(
            "this copy runs from source (npm run app), so there's no app to replace: install from the DMG".into(),
        ));
    }
    download(&app).await?;
    let (update, bytes) = {
        let p = PENDING.lock().unwrap();
        match (p.update.clone(), p.bytes.clone()) {
            (Some(u), Some(b)) => (u, b),
            _ => return Err(CmdError::Invalid("there's no update to install".into())),
        }
    };
    set(&app, |p| {
        p.state.status = "installing";
        p.state.phase = Some("verifying");
    });
    let installed = tauri::async_runtime::spawn_blocking({
        let app = app.clone();
        move || {
            update.verify(&bytes)?;
            set(&app, |p| p.state.phase = Some("installing"));
            update.install(&bytes)
        }
    })
    .await?;
    if let Err(e) = installed {
        let message = e.to_string();
        set(&app, |p| {
            p.state.status = "error";
            p.state.phase = None;
            p.state.error = Some(format!("It couldn't be installed: {message}"));
        });
        return Err(fail(e));
    }
    set(&app, |p| {
        p.state.phase = Some("restarting");
        p.state.status = "restarting";
    });
    // A moment for every window to say so.
    tokio::time::sleep(Duration::from_millis(600)).await;
    app.restart();
}

/// Install when the app quits: download now, install on the way out.
#[tauri::command]
pub async fn update_install_on_quit(app: AppHandle) -> CmdResult<UpdateState> {
    if !installable() {
        return Err(CmdError::Invalid(
            "this copy runs from source (npm run app), so there's no app to replace: install from the DMG".into(),
        ));
    }
    set(&app, |p| p.state.on_quit = true);
    download(&app).await?;
    Ok(set(&app, |_| {}))
}

/// Don't install at quit after all (the download is kept).
#[tauri::command]
pub fn update_cancel_on_quit(app: AppHandle) -> UpdateState {
    set(&app, |p| p.state.on_quit = false)
}

/// The app is about to quit: with an update downloaded for it, install it
/// first, off the main thread (an install that needs an administrator's
/// password asks on the main thread), then quit for real. Returns whether the
/// quit is held back meanwhile.
pub fn hold_exit_for_install(app: &AppHandle) -> bool {
    let (update, bytes) = {
        let mut p = PENDING.lock().unwrap();
        if p.quitting || !p.state.on_quit || !installable() {
            return false;
        }
        match (p.update.clone(), p.bytes.clone()) {
            (Some(u), Some(b)) => {
                p.quitting = true;
                (u, b)
            }
            _ => return false,
        }
    };
    let app = app.clone();
    std::thread::spawn(move || {
        if let Err(e) = update.install(&bytes) {
            eprintln!("update: couldn't install at quit: {e}");
        }
        app.exit(0);
    });
    true
}
