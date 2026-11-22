//! The app's windows as the author left them: the book each had open, and
//! where each was on the screen. Kept as they change (windows.json in the
//! app's data folder, flushed like a book's state), so quitting, a crash or a
//! force quit and starting again brings every window back, each with its book.
//! A window the author closes is left out; quitting (⌘Q) closes none.
//!
//! Not kept for a launch that names its book (`FOREWORD_WORKSPACE`, the
//! self-test): those run beside the author's own Foreword, in the same data
//! folder. A dev build keeps its own file.

use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{
        Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};

use serde::{Deserialize, Serialize};
use tauri::Manager;

use crate::book_state::write_durably;

/// Where a window was: its top-left corner and the size of its content, in points.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq)]
pub struct Frame {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// A window as it was left.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
pub struct Kept {
    pub label: String,
    #[serde(default)]
    pub root: Option<String>,
    #[serde(default)]
    pub frame: Option<Frame>,
}

#[derive(Default)]
pub struct Windows {
    /// None: not kept (a launch that names its book).
    file: Option<PathBuf>,
    list: Mutex<Vec<Kept>>,
    /// The windows as they were left, read at launch.
    saved: Vec<Kept>,
    /// The book each window opened at launch is to open, for its page to ask (launch_options).
    restore: Mutex<HashMap<String, Option<String>>>,
    write_due: AtomicBool,
    quitting: AtomicBool,
}

impl Windows {
    pub fn load(data: &Path) -> Self {
        let named = std::env::var_os("FOREWORD_WORKSPACE").is_some()
            || std::env::var_os("FOREWORD_SELFTEST").is_some();
        if named {
            return Self::default();
        }
        let file = data.join(if cfg!(debug_assertions) {
            "windows-dev.json"
        } else {
            "windows.json"
        });
        let saved = std::fs::read_to_string(&file)
            .ok()
            .and_then(|t| serde_json::from_str::<Vec<Kept>>(&t).ok())
            .map(in_order)
            .unwrap_or_default();
        Self {
            file: Some(file),
            saved,
            ..Self::default()
        }
    }

    /// The windows as they were left, the first window's first (none: not kept, or none left open).
    pub fn saved(&self) -> &[Kept] {
        &self.saved
    }

    /// A window opened: `kept`, the one it brings back (its place is used by its builder).
    pub fn opened(&self, app: &tauri::AppHandle, window: &tauri::Window, kept: Option<&Kept>) {
        if self.file.is_none() {
            return;
        }
        let label = window.label().to_string();
        if let Some(k) = kept {
            self.restore
                .lock()
                .unwrap()
                .insert(label.clone(), k.root.clone());
        }
        let entry = Kept {
            label: label.clone(),
            root: kept.and_then(|k| k.root.clone()),
            frame: frame_of(window),
        };
        let mut list = self.list.lock().unwrap();
        list.retain(|k| k.label != label);
        list.push(entry);
        drop(list);
        self.schedule(app);
    }

    /// For a window's page: the book it's to open, as it was left (Some(None):
    /// it had none); None if it isn't one brought back.
    pub fn restore_for(&self, label: &str) -> Option<Option<String>> {
        self.restore.lock().unwrap().get(label).cloned()
    }

    pub fn set_root(&self, app: &tauri::AppHandle, label: &str, root: &Path) {
        self.update(app, label, |k| {
            k.root = Some(root.to_string_lossy().into_owned())
        });
    }

    /// Moved or resized (not while full screen: it comes back as a window, where it was before).
    pub fn moved(&self, app: &tauri::AppHandle, window: &tauri::Window) {
        if window.is_fullscreen().unwrap_or(false) || window.is_minimized().unwrap_or(false) {
            return;
        }
        if let Some(frame) = frame_of(window) {
            self.update(app, window.label(), |k| k.frame = Some(frame));
        }
    }

    /// The author closed it: it doesn't come back. Quitting closes none.
    pub fn closed(&self, app: &tauri::AppHandle, label: &str) {
        if self.file.is_none() || self.quitting.load(Ordering::SeqCst) {
            return;
        }
        self.list.lock().unwrap().retain(|k| k.label != label);
        self.schedule(app);
    }

    /// The app is quitting: its windows close with it, and all come back.
    pub fn quitting(&self) {
        self.quitting.store(true, Ordering::SeqCst);
    }

    fn update(&self, app: &tauri::AppHandle, label: &str, change: impl FnOnce(&mut Kept)) {
        if self.file.is_none() {
            return;
        }
        let mut list = self.list.lock().unwrap();
        let Some(k) = list.iter_mut().find(|k| k.label == label) else {
            return;
        };
        let before = k.clone();
        change(k);
        let changed = *k != before;
        drop(list);
        if changed {
            self.schedule(app);
        }
    }

    /// Written a moment after the first change since the last write (a drag moves it many times).
    fn schedule(&self, app: &tauri::AppHandle) {
        if self.file.is_none() || self.write_due.swap(true, Ordering::SeqCst) {
            return;
        }
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(Duration::from_millis(400)).await;
            let _ = tauri::async_runtime::spawn_blocking(move || {
                static WRITING: Mutex<()> = Mutex::new(());
                let _one_at_a_time = WRITING.lock().unwrap();
                let windows = app.state::<Windows>();
                windows.write_due.store(false, Ordering::SeqCst);
                let text =
                    serde_json::to_string_pretty(&in_order(windows.list.lock().unwrap().clone()))
                        .unwrap_or_default();
                if let Some(file) = &windows.file
                    && let Err(e) = write_durably(file, text.as_bytes())
                {
                    crate::logs::push("app", format!("couldn't keep the windows: {e}"));
                }
            })
            .await;
        });
    }
}

/// "main" first, then "win-2", "win-3"… as they were opened.
fn in_order(mut list: Vec<Kept>) -> Vec<Kept> {
    let rank = |k: &Kept| match k.label.as_str() {
        "main" => 0,
        l => l
            .strip_prefix("win-")
            .and_then(|n| n.parse::<u32>().ok())
            .unwrap_or(u32::MAX),
    };
    list.sort_by_key(rank);
    list
}

fn frame_of(window: &tauri::Window) -> Option<Frame> {
    let scale = window.scale_factor().ok()?;
    let at = window.outer_position().ok()?.to_logical::<f64>(scale);
    let size = window.inner_size().ok()?.to_logical::<f64>(scale);
    Some(Frame {
        x: at.x,
        y: at.y,
        width: size.width,
        height: size.height,
    })
}

/// Whether a window there would show on one of the screens now (its title bar, at least).
pub fn on_screen(app: &tauri::AppHandle, frame: &Frame) -> bool {
    let Ok(monitors) = app.available_monitors() else {
        return false;
    };
    let screens: Vec<Frame> = monitors
        .iter()
        .map(|m| {
            let at = m.position().to_logical::<f64>(m.scale_factor());
            let size = m.size().to_logical::<f64>(m.scale_factor());
            Frame {
                x: at.x,
                y: at.y,
                width: size.width,
                height: size.height,
            }
        })
        .collect();
    shows_on(frame, &screens)
}

fn shows_on(frame: &Frame, screens: &[Frame]) -> bool {
    let (x, y) = (frame.x + frame.width / 2.0, frame.y + 10.0);
    frame.width >= 100.0
        && frame.height >= 100.0
        && screens
            .iter()
            .any(|s| x >= s.x && x < s.x + s.width && y >= s.y && y < s.y + s.height)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_first_window_comes_first() {
        let k = |label: &str| Kept {
            label: label.into(),
            ..Kept::default()
        };
        let order: Vec<String> = in_order(vec![k("win-10"), k("win-3"), k("main"), k("odd")])
            .into_iter()
            .map(|k| k.label)
            .collect();
        assert_eq!(order, ["main", "win-3", "win-10", "odd"]);
    }

    #[test]
    fn a_window_comes_back_only_where_a_screen_shows_it() {
        let screen = Frame {
            x: 0.0,
            y: 0.0,
            width: 1728.0,
            height: 1117.0,
        };
        let at = |x: f64, y: f64| Frame {
            x,
            y,
            width: 1200.0,
            height: 800.0,
        };
        assert!(shows_on(&at(100.0, 40.0), &[screen]));
        // On a screen that's gone (to the right of this one), or above the top.
        assert!(!shows_on(&at(2000.0, 40.0), &[screen]));
        assert!(!shows_on(&at(100.0, -400.0), &[screen]));
        // On the second screen, when it's there.
        let second = Frame {
            x: 1728.0,
            ..screen
        };
        assert!(shows_on(&at(2000.0, 40.0), &[screen, second]));
        assert!(!shows_on(
            &Frame {
                width: 10.0,
                ..at(100.0, 40.0)
            },
            &[screen]
        ));
    }

    #[test]
    fn reads_what_it_writes() {
        let list = vec![Kept {
            label: "main".into(),
            root: Some("/books/a".into()),
            frame: Some(Frame {
                x: 10.0,
                y: 20.0,
                width: 1400.0,
                height: 900.0,
            }),
        }];
        let text = serde_json::to_string(&list).unwrap();
        assert_eq!(serde_json::from_str::<Vec<Kept>>(&text).unwrap(), list);
        // Older or partial entries still read.
        assert_eq!(
            serde_json::from_str::<Vec<Kept>>(r#"[{"label":"win-2"}]"#).unwrap()[0].root,
            None
        );
    }
}
