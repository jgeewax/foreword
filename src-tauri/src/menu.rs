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

use tauri::{
    AppHandle, Runtime,
    menu::{
        HELP_SUBMENU_ID, Menu, MenuItem, PredefinedMenuItem, Submenu,
        WINDOW_SUBMENU_ID,
    },
};

/// Menu ids the page acts on (everything here except "new-window" and
/// "close-window", which the app handles itself).
pub const COMMANDS: &[&str] = &[
    "about",
    "settings",
    "check-updates",
    // File
    "new-book",
    "new-chapter",
    "new-file",
    "open-book",
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
    "show-in-preview",
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

    let file = Submenu::with_items(
        handle,
        "File",
        true,
        &[
            &item("new-book", "New Book…", Some("CmdOrCtrl+Shift+N"))?,
            &item("new-chapter", "New Chapter…", Some("CmdOrCtrl+Alt+N"))?,
            &item("new-file", "New File…", Some("CmdOrCtrl+N"))?,
            &sep()?,
            &item("new-window", "New Window", Some("CmdOrCtrl+Alt+Shift+N"))?,
            &item("open-book", "Open Book…", Some("CmdOrCtrl+O"))?,
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
            &item("prev-spelling", "Previous Spelling or Grammar Mistake", Some("CmdOrCtrl+Shift+;"))?,
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

/// The menu bar as text, for the self-test: each menu's title and items.
pub fn outline<R: Runtime>(menu: &Menu<R>) -> tauri::Result<Vec<(String, Vec<String>)>> {
    let mut out = Vec::new();
    for top in menu.items()? {
        let Some(sub) = top.as_submenu() else {
            continue;
        };
        let mut items = Vec::new();
        for i in sub.items()? {
            if let Some(m) = i.as_menuitem() {
                items.push(format!("{}={}", m.id().as_ref(), m.text()?));
            } else if let Some(p) = i.as_predefined_menuitem() {
                let text = p.text()?;
                items.push(if text.is_empty() { "---".into() } else { text });
            }
        }
        out.push((sub.text()?, items));
    }
    Ok(out)
}
