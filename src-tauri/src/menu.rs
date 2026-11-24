//! The menu bar. Each menu is about one thing: files (File), editing text
//! (Edit), the window's panes (View), making the book (Book), the writing
//! assistant (Assistant). The app's own items forward their id to the page
//! (`COMMANDS`), which acts on it in `studio.menuCommand`.
//!
//! Shortcuts the page also handles (⌘O, ⌘P, ⌘S, ⌘B, ⌘I…) are shown here too.
//! A ⌘ key that's on an item goes to the menu, not the page (the page is a
//! child web view, and wry gives those keys to the menu bar first), so the
//! item acts, with the page or the preview focused, and a press isn't applied
//! twice. Keys on no item (the ⌘K chords) reach the page.

use std::{path::Path, sync::Mutex};

use tauri::{
    AppHandle, Runtime,
    menu::{
        HELP_SUBMENU_ID, Menu, MenuItem, PredefinedMenuItem, Submenu,
        WINDOW_SUBMENU_ID,
    },
};

/// Menu ids the page acts on (everything here except "new-window",
/// "close-window" and the recent books, which the app handles itself).
pub const COMMANDS: &[&str] = &[
    "about",
    "settings",
    "check-updates",
    // File
    "new-book",
    "new-chapter",
    "new-file",
    "open-book",
    "open-recent-more",
    "clear-recent",
    "go-to-file",
    "save",
    "save-all",
    "close-tab",
    "reopen-tab",
    // Edit
    "find",
    "find-in-book",
    "replace",
    "format-document",
    "next-spelling",
    "prev-spelling",
    "add-comment",
    // View
    "command-palette",
    "toggle-sidebar",
    "toggle-preview",
    "toggle-assistant",
    "show-files",
    "show-contents",
    "show-review",
    "show-history",
    "show-tasks",
    "show-git",
    "show-todo-tab",
    "show-in-preview",
    "show-spelling",
    "zoom-in",
    "zoom-out",
    "zoom-reset",
    // Book
    "export-pdf",
    "export-epub",
    "open-pdf",
    "print-mixam",
    "design-cover",
    "style-guide",
    "name-version",
    "setup-code",
    "add-makefile",
    "book-settings",
    // Assistant
    "new-task",
    "task-done",
    "ask-selection",
    "fix-comments",
    "stop",
    "permissions",
    // Window
    "prev-tab",
    "next-tab",
    // Help
    "typst-guide",
    "take-tour",
];

pub fn build<R: Runtime>(handle: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let item = |id: &str, text: &str, accelerator: Option<&str>| {
        MenuItem::with_id(handle, id, text, true, accelerator)
    };
    let sep = || PredefinedMenuItem::separator(handle);
    // The product's name ("Foreword"), not the crate's ("foreword"), in About, Hide and Quit.
    let name = handle
        .config()
        .product_name
        .clone()
        .unwrap_or_else(|| handle.package_info().name.clone());
    let app = Submenu::with_items(
        handle,
        &name,
        true,
        &[
            // The app's own About (src/components/AboutDialog.tsx), not the standard panel.
            &item("about", &format!("About {name}"), None)?,
            &item("check-updates", "Check for Updates…", None)?,
            &sep()?,
            &item("settings", "Settings…", Some("CmdOrCtrl+,"))?,
            &sep()?,
            &PredefinedMenuItem::services(handle, None)?,
            &sep()?,
            &PredefinedMenuItem::hide(handle, Some(&format!("Hide {name}")))?,
            &PredefinedMenuItem::hide_others(handle, None)?,
            &PredefinedMenuItem::show_all(handle, None)?,
            &sep()?,
            &PredefinedMenuItem::quit(handle, Some(&format!("Quit {name}")))?,
        ],
    )?;

    // Its books come from the page once it starts (`set_recent`).
    let open_recent = Submenu::with_id(handle, OPEN_RECENT, "Open Recent", true)?;
    fill_recent(handle, &open_recent, &[])?;
    let file = Submenu::with_id_and_items(
        handle,
        FILE,
        "File",
        true,
        &[
            &item("new-book", "New Book…", Some("CmdOrCtrl+Shift+N"))?,
            &item("new-chapter", "New Chapter…", Some("CmdOrCtrl+Alt+N"))?,
            &item("new-file", "New File…", Some("CmdOrCtrl+N"))?,
            &sep()?,
            &item("new-window", "New Window", Some("CmdOrCtrl+Alt+Shift+N"))?,
            &item("open-book", "Open Book…", Some("CmdOrCtrl+O"))?,
            &open_recent,
            &item("go-to-file", "Go to File…", Some("CmdOrCtrl+P"))?,
            &sep()?,
            &item("save", "Save", Some("CmdOrCtrl+S"))?,
            &item("save-all", "Save All", Some("CmdOrCtrl+Alt+S"))?,
            &sep()?,
            // ⌘W closes the tab, as in Safari and VS Code; the window gets ⇧⌘W.
            &item("close-tab", "Close Tab", Some("CmdOrCtrl+W"))?,
            &item("reopen-tab", "Reopen Closed Tab", Some("CmdOrCtrl+Shift+T"))?,
            &item("close-window", "Close Window", Some("CmdOrCtrl+Shift+W"))?,
        ],
    )?;

    let edit = Submenu::with_items(
        handle,
        "Edit",
        true,
        &[
            // Not the stock items: in the page they're the page's (see `edit_action`).
            &item("undo", "Undo", Some("CmdOrCtrl+Z"))?,
            &item("redo", "Redo", Some("CmdOrCtrl+Shift+Z"))?,
            &sep()?,
            &PredefinedMenuItem::cut(handle, None)?,
            &PredefinedMenuItem::copy(handle, None)?,
            &PredefinedMenuItem::paste(handle, None)?,
            &item("select-all", "Select All", Some("CmdOrCtrl+A"))?,
            &sep()?,
            &item("find", "Find…", Some("CmdOrCtrl+F"))?,
            &item("replace", "Find and Replace…", Some("CmdOrCtrl+Alt+F"))?,
            &item("find-in-book", "Find in Book…", Some("CmdOrCtrl+Shift+F"))?,
            &sep()?,
            &item("format-document", "Format Document", Some("Shift+Alt+F"))?,
            &sep()?,
            // ⌘; as in Pages and TextEdit ("Check Document Now").
            &item("next-spelling", "Next Spelling or Grammar Mistake", Some("CmdOrCtrl+;"))?,
            &item("prev-spelling", "Previous Spelling or Grammar Mistake", None)?,
            // ⌘: as in Pages ("Show Spelling and Grammar"): the book's, in the Spelling view.
            &item("show-spelling", "Show Spelling and Grammar", Some("CmdOrCtrl+Shift+;"))?,
            &sep()?,
            &item("add-comment", "Add Comment…", Some("CmdOrCtrl+Alt+M"))?,
        ],
    )?;

    let view = Submenu::with_items(
        handle,
        "View",
        true,
        &[
            // Every command by name, as VS Code's (the page lists them: app/commands.ts).
            &item(
                "command-palette",
                "Command Palette…",
                Some("CmdOrCtrl+Shift+P"),
            )?,
            &sep()?,
            &item("toggle-sidebar", "Toggle Sidebar", Some("CmdOrCtrl+B"))?,
            &item("toggle-preview", "Toggle Preview", Some("CmdOrCtrl+Alt+P"))?,
            &item(
                "toggle-assistant",
                "Toggle Assistant",
                Some("CmdOrCtrl+Alt+B"),
            )?,
            &sep()?,
            &item("show-files", "Files", None)?,
            &item("show-contents", "Contents", None)?,
            &item("show-review", "Review", None)?,
            &item("show-history", "History", None)?,
            &item("show-tasks", "Tasks", None)?,
            &item("show-git", "Source Control", None)?,
            &item("show-todo-tab", "To Do", None)?,
            &sep()?,
            &item("show-in-preview", "Show in Preview", None)?,
            &sep()?,
            &item("zoom-in", "Zoom In", Some("CmdOrCtrl+="))?,
            &item("zoom-out", "Zoom Out", Some("CmdOrCtrl+-"))?,
            &item("zoom-reset", "Actual Size", Some("CmdOrCtrl+0"))?,
            &sep()?,
            &PredefinedMenuItem::fullscreen(handle, None)?,
        ],
    )?;

    let book = Submenu::with_items(
        handle,
        "Book",
        true,
        &[
            &item("export-pdf", "Export PDF…", Some("CmdOrCtrl+Shift+E"))?,
            &item("export-epub", "Export EPUB…", None)?,
            &item("open-pdf", "Open Exported PDF", Some("CmdOrCtrl+Alt+E"))?,
            &item("print-mixam", "Print with Mixam…", None)?,
            &sep()?,
            &item("design-cover", "Design Cover…", None)?,
            &item("style-guide", "Writing Style Guide", None)?,
            &item("name-version", "Name This Version…", None)?,
            &sep()?,
            &item("setup-code", "Runnable Code Examples…", None)?,
            &item("add-makefile", "Add a Makefile…", None)?,
            &sep()?,
            &item("book-settings", "Book Settings…", None)?,
        ],
    )?;

    let assistant = Submenu::with_items(
        handle,
        "Assistant",
        true,
        &[
            &item("new-task", "New Task", Some("CmdOrCtrl+T"))?,
            &item("task-done", "Task Done", Some("CmdOrCtrl+Shift+D"))?,
            &sep()?,
            &item("ask-selection", "Add Selection to Chat", Some("CmdOrCtrl+I"))?,
            &item("fix-comments", "Fix Review Comments", None)?,
            &item("stop", "Stop", None)?,
            &sep()?,
            &item("permissions", "Permissions…", None)?,
        ],
    )?;

    let window = Submenu::with_id_and_items(
        handle,
        WINDOW_SUBMENU_ID,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(handle, None)?,
            &PredefinedMenuItem::maximize(handle, None)?,
            &sep()?,
            &item("prev-tab", "Show Previous Tab", Some("Ctrl+Shift+Tab"))?,
            &item("next-tab", "Show Next Tab", Some("Ctrl+Tab"))?,
        ],
    )?;

    let help = Submenu::with_id_and_items(
        handle,
        HELP_SUBMENU_ID,
        "Help",
        true,
        &[
            &item("typst-guide", "Typst Basics", None)?,
            &item("take-tour", "Take the Tour", None)?,
        ],
    )?;

    Menu::with_items(
        handle,
        &[&app, &file, &edit, &view, &book, &assistant, &window, &help],
    )
}

const FILE: &str = "file";
const OPEN_RECENT: &str = "open-recent";
/// A recent book's item in File → Open Recent: this, then the book's folder.
pub const RECENT_BOOK: &str = "open-recent:";

/// The recent books, newest first, as the page keeps them (all windows share
/// them): File → Open Recent and the Dock offer them.
static RECENT: Mutex<Vec<String>> = Mutex::new(Vec::new());

pub fn set_recent(paths: Vec<String>) {
    *RECENT.lock().unwrap() = paths;
}

pub fn recent() -> Vec<String> {
    RECENT.lock().unwrap().clone()
}

/// File → Open Recent again, for the window in front, whose book is `current`:
/// each recent book still there but that one, then More… and Clear Recently
/// Opened, as in VS Code. The menu bar is the app's, so this runs whenever
/// the list changes and a window comes forward or goes.
pub fn show_recent<R: Runtime>(app: &AppHandle<R>, current: Option<&Path>) -> tauri::Result<()> {
    let sub = app
        .menu()
        .and_then(|m| m.get(FILE))
        .and_then(|f| f.as_submenu().and_then(|f| f.get(OPEN_RECENT)))
        .and_then(|r| r.as_submenu().cloned());
    let Some(sub) = sub else {
        return Ok(());
    };
    let books: Vec<String> = recent()
        .into_iter()
        .filter(|p| Some(Path::new(p)) != current && Path::new(p).is_dir())
        .collect();
    fill_recent(app, &sub, &books)
}

fn fill_recent<R: Runtime>(
    handle: &AppHandle<R>,
    sub: &Submenu<R>,
    books: &[String],
) -> tauri::Result<()> {
    for _ in 0..sub.items()?.len() {
        sub.remove_at(0)?;
    }
    for book in books {
        // By where it is, as VS Code's are (`&` alone would be taken for a mnemonic and dropped).
        let title = tilde(book).replace('&', "&&");
        sub.append(&MenuItem::with_id(
            handle,
            format!("{RECENT_BOOK}{book}"),
            title,
            true,
            None::<&str>,
        )?)?;
    }
    if !books.is_empty() {
        sub.append(&PredefinedMenuItem::separator(handle)?)?;
    }
    // ⌃R, as in VS Code: the palette, with the recent books.
    sub.append(&MenuItem::with_id(
        handle,
        "open-recent-more",
        "More…",
        !books.is_empty(),
        Some("Ctrl+R"),
    )?)?;
    sub.append(&PredefinedMenuItem::separator(handle)?)?;
    let any = !recent().is_empty();
    sub.append(&MenuItem::with_id(
        handle,
        "clear-recent",
        "Clear Recently Opened…",
        any,
        None::<&str>,
    )?)?;
    Ok(())
}

/// File → Open Recent as AppKit has it (the self-test): each item's title, its
/// key after it ("⌃r"), and "(off)" after one greyed out.
#[cfg(target_os = "macos")]
pub fn native_open_recent() -> Vec<String> {
    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSApplication, NSEventModifierFlags};
    use objc2_foundation::NSString;

    let Some(mtm) = MainThreadMarker::new() else {
        return Vec::new();
    };
    let within = |menu: Option<objc2::rc::Retained<objc2_app_kit::NSMenu>>, title: &str| {
        menu.and_then(|m| m.itemWithTitle(&NSString::from_str(title)))
            .and_then(|i| i.submenu())
    };
    let file = within(NSApplication::sharedApplication(mtm).mainMenu(), "File");
    let Some(recent) = within(file, "Open Recent") else {
        return Vec::new();
    };
    let keys = [
        (NSEventModifierFlags::Control, "⌃"),
        (NSEventModifierFlags::Option, "⌥"),
        (NSEventModifierFlags::Shift, "⇧"),
        (NSEventModifierFlags::Command, "⌘"),
    ];
    recent
        .itemArray()
        .iter()
        .map(|i| {
            if i.isSeparatorItem() {
                return "---".to_string();
            }
            let mut text = i.title().to_string();
            let key = i.keyEquivalent().to_string();
            if !key.is_empty() {
                let mask = i.keyEquivalentModifierMask();
                let held: String = keys
                    .iter()
                    .filter(|(flag, _)| mask.contains(*flag))
                    .map(|(_, sign)| *sign)
                    .collect();
                text.push_str(&format!(" {held}{key}"));
            }
            if !i.isEnabled() {
                text.push_str(" (off)");
            }
            text
        })
        .collect()
}

/// A path under the home folder from "~".
pub fn tilde(path: &str) -> String {
    match std::env::var("HOME") {
        Ok(home) if !home.is_empty() && path.starts_with(&home) => {
            format!("~{}", &path[home.len()..])
        }
        _ => path.to_string(),
    }
}

/// Edit → Undo, Redo and Select All (`id`), and their keys: the menu bar sees
/// ⌘Z, ⇧⌘Z and ⌘A before the page does (wry gives a child web view's ⌘ keys
/// to the menu first). While the window's page has the keyboard, the page acts
/// (an event named `id`): AppKit's `undo:`, `redo:` and `selectAll:` act on
/// the focused field, and the editor's is Monaco's hidden one, not the text.
/// Anywhere else (the preview, a dialog's text field) it's AppKit's, as the
/// stock items were.
pub fn edit_action(app: &AppHandle, front: Option<String>, id: &str) {
    #[cfg(target_os = "macos")]
    {
        use objc2::{MainThreadMarker, rc::Retained, runtime::Sel, sel};
        use objc2_app_kit::NSApplication;
        use tauri::{Emitter, EventTarget, Manager};

        fn native(action: Sel) {
            if let Some(mtm) = MainThreadMarker::new() {
                // SAFETY: standard actions; a nil target sends it to the first responder.
                unsafe {
                    NSApplication::sharedApplication(mtm).sendAction_to_from(action, None, None)
                };
            }
        }
        let action = match id {
            "undo" => sel!(undo:),
            "redo" => sel!(redo:),
            _ => sel!(selectAll:),
        };
        let Some(page) = front.and_then(|label| app.get_webview(&label)) else {
            return native(action);
        };
        let app = app.clone();
        let label = page.label().to_string();
        let event = id.to_string();
        let _ = page.with_webview(move |platform| {
            let Some(mtm) = MainThreadMarker::new() else {
                return;
            };
            let responder = NSApplication::sharedApplication(mtm)
                .keyWindow()
                .and_then(|w| w.firstResponder());
            if responder.is_some_and(|r| Retained::as_ptr(&r).cast() == platform.inner()) {
                // Not from here: emitting runs script in this web view, which this call holds.
                tauri::async_runtime::spawn(async move {
                    let _ = app.emit_to(EventTarget::webview(&label), &event, ());
                });
            } else {
                native(action);
            }
        });
    }
    #[cfg(not(target_os = "macos"))]
    let _ = (app, front, id);
}

/// The menu bar as text, for the self-test: each menu's title and items
/// ("id=Title", "(off)" after one greyed out). A submenu's items follow it,
/// with its title ("open-recent-more=Open Recent ▸ More…").
pub fn outline<R: Runtime>(menu: &Menu<R>) -> tauri::Result<Vec<(String, Vec<String>)>> {
    fn items<R: Runtime>(
        sub: &Submenu<R>,
        within: &str,
        out: &mut Vec<String>,
    ) -> tauri::Result<()> {
        for i in sub.items()? {
            if let Some(m) = i.as_menuitem() {
                let off = if m.is_enabled()? { "" } else { " (off)" };
                out.push(format!("{}={within}{}{off}", m.id().as_ref(), m.text()?));
            } else if let Some(p) = i.as_predefined_menuitem() {
                let text = p.text()?;
                out.push(format!(
                    "{within}{}",
                    if text.is_empty() { "---".into() } else { text }
                ));
            } else if let Some(s) = i.as_submenu() {
                let title = s.text()?;
                out.push(format!("{within}{title} ▸"));
                items(s, &format!("{within}{title} ▸ "), out)?;
            }
        }
        Ok(())
    }
    let mut out = Vec::new();
    for top in menu.items()? {
        let Some(sub) = top.as_submenu() else {
            continue;
        };
        let mut list = Vec::new();
        items(sub, "", &mut list)?;
        out.push((sub.text()?, list));
    }
    Ok(out)
}
