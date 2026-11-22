//! The Dock icon's menu (right-click or hold on Foreword in the Dock): New
//! Window, and the recent books, each opening in a window of its own, so
//! several books are open at once as projects are in VS Code. macOS lists the
//! open windows above these itself.
//!
//! Tauri has no Dock menu and keeps its own menus to itself, so this adds
//! `applicationDockMenu:` to the app's delegate (tao's), and the items'
//! actions beside it. They act on the event loop, as the menu bar's items do.

use std::{
    cell::RefCell,
    path::Path,
    sync::{Mutex, OnceLock},
};

use objc2::{
    MainThreadMarker, MainThreadOnly, ffi,
    rc::Retained,
    runtime::{AnyClass, AnyObject, Imp, Sel},
    sel,
};
use objc2_app_kit::{NSApplication, NSMenu, NSMenuItem};
use objc2_foundation::NSString;

static APP: OnceLock<tauri::AppHandle> = OnceLock::new();

/// The recent books, newest first, as the page keeps them (`dock_recent`).
static RECENT: Mutex<Vec<String>> = Mutex::new(Vec::new());

thread_local! {
    /// The menu last shown and the books in it, by item tag.
    static SHOWN: RefCell<Option<(Retained<NSMenu>, Vec<String>)>> = const { RefCell::new(None) };
}

/// The page's recent books (all windows share them): the Dock offers them.
pub fn set_recent(paths: Vec<String>) {
    *RECENT.lock().unwrap() = paths;
}

/// Gives the app its Dock menu. On the main thread, once the app has started.
pub fn install(app: &tauri::AppHandle) {
    let _ = APP.set(app.clone());
    let Some(mtm) = MainThreadMarker::new() else {
        return;
    };
    let ns_app = NSApplication::sharedApplication(mtm);
    let Some(delegate) = ns_app.delegate() else {
        return;
    };
    // SAFETY: a delegate is an object.
    let object: &AnyObject = unsafe { &*Retained::as_ptr(&delegate).cast::<AnyObject>() };
    let class = object.class() as *const AnyClass as *mut AnyClass;
    type Menu = unsafe extern "C-unwind" fn(&AnyObject, Sel, *mut AnyObject) -> *mut NSMenu;
    type Action = unsafe extern "C-unwind" fn(&AnyObject, Sel, *mut AnyObject);
    // SAFETY: each function has the signature its type encoding says: it
    // returns an object (`@`) or nothing (`v`), and takes self, _cmd and one object.
    let added = unsafe {
        [
            (
                sel!(applicationDockMenu:),
                std::mem::transmute::<Menu, Imp>(dock_menu),
                c"@@:@",
            ),
            (
                sel!(forewordNewWindow:),
                std::mem::transmute::<Action, Imp>(new_window),
                c"v@:@",
            ),
            (
                sel!(forewordOpenBook:),
                std::mem::transmute::<Action, Imp>(open_book),
                c"v@:@",
            ),
        ]
        .map(|(name, imp, types)| ffi::class_addMethod(class, name, imp, types.as_ptr()).as_bool())
    };
    if added.contains(&false) {
        crate::logs::push("app", format!("the Dock menu isn't all there: {added:?}"));
    }
    // AppKit may have looked at what the delegate does when it was set: set it again.
    ns_app.setDelegate(Some(&delegate));
}

/// The Dock menu's items, as text (the self-test): "New Window", "---", the books.
pub fn outline() -> Vec<String> {
    let Some(mtm) = MainThreadMarker::new() else {
        return Vec::new();
    };
    let Some(delegate) = NSApplication::sharedApplication(mtm).delegate() else {
        return Vec::new();
    };
    // SAFETY: what `install` added: it takes the app, and returns a menu or nil.
    let menu: Option<Retained<NSMenu>> = unsafe {
        objc2::msg_send![&*delegate, applicationDockMenu: &*NSApplication::sharedApplication(mtm)]
    };
    let Some(menu) = menu else {
        return Vec::new();
    };
    menu.itemArray()
        .iter()
        .map(|i| {
            if i.isSeparatorItem() {
                "---".into()
            } else {
                i.title().to_string()
            }
        })
        .collect()
}

/// The self-test: choose the `n`th item of the menu last shown, as AppKit does.
pub fn choose(n: usize) -> bool {
    let Some(mtm) = MainThreadMarker::new() else {
        return false;
    };
    let item = SHOWN.with(|s| {
        s.borrow()
            .as_ref()
            .and_then(|(menu, _)| menu.itemArray().iter().nth(n))
    });
    let Some(item) = item else {
        return false;
    };
    let (Some(action), Some(target)) = (item.action(), item.target()) else {
        return false;
    };
    let sender: &AnyObject = &item;
    // SAFETY: the item's own action, sent to its own target, from the item.
    unsafe {
        NSApplication::sharedApplication(mtm).sendAction_to_from(action, Some(&target), Some(sender))
    }
}

unsafe extern "C-unwind" fn dock_menu(
    this: &AnyObject,
    _: Sel,
    _app: *mut AnyObject,
) -> *mut NSMenu {
    let Some(mtm) = MainThreadMarker::new() else {
        return std::ptr::null_mut();
    };
    let books: Vec<String> = RECENT
        .lock()
        .unwrap()
        .iter()
        .filter(|p| Path::new(p).is_dir())
        .cloned()
        .collect();
    let menu = NSMenu::new(mtm);
    let item = |title: &str, action: Sel| {
        // SAFETY: the actions are the delegate's (`install`), and it's their target.
        unsafe {
            let item = NSMenuItem::initWithTitle_action_keyEquivalent(
                NSMenuItem::alloc(mtm),
                &NSString::from_str(title),
                Some(action),
                &NSString::new(),
            );
            item.setTarget(Some(this));
            item
        }
    };
    menu.addItem(&item("New Window", sel!(forewordNewWindow:)));
    if !books.is_empty() {
        menu.addItem(&NSMenuItem::separatorItem(mtm));
        for (tag, title) in titles(&books).iter().enumerate() {
            let book = item(title, sel!(forewordOpenBook:));
            book.setTag(tag as isize);
            menu.addItem(&book);
        }
    }
    let shown = Retained::as_ptr(&menu) as *mut NSMenu;
    SHOWN.with(|s| *s.borrow_mut() = Some((menu, books)));
    shown
}

unsafe extern "C-unwind" fn new_window(_: &AnyObject, _: Sel, _: *mut AnyObject) {
    on_event_loop(|app| crate::open_new_window(app, None));
}

unsafe extern "C-unwind" fn open_book(_: &AnyObject, _: Sel, sender: *mut AnyObject) {
    // SAFETY: the sender is the item chosen, one of the menu's (`dock_menu`).
    let Some(item) = (unsafe { sender.cast::<NSMenuItem>().as_ref() }) else {
        return;
    };
    let tag = item.tag();
    let book = SHOWN.with(|s| {
        s.borrow()
            .as_ref()
            .and_then(|(_, books)| usize::try_from(tag).ok().and_then(|i| books.get(i).cloned()))
    });
    if let Some(book) = book {
        on_event_loop(move |app| crate::open_book_window(app, &book));
    }
}

fn on_event_loop(act: impl FnOnce(&tauri::AppHandle) + Send + 'static) {
    if let Some(app) = APP.get() {
        let handle = app.clone();
        let _ = app.run_on_main_thread(move || act(&handle));
    }
}

/// Each book by its folder's name; two with the same name also say where they are.
fn titles(books: &[String]) -> Vec<String> {
    let name = |p: &str| {
        Path::new(p)
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| p.to_string())
    };
    books
        .iter()
        .map(|p| {
            let own = name(p);
            let shared = books.iter().filter(|q| name(q) == own).count() > 1;
            match Path::new(p).parent().filter(|_| shared) {
                Some(parent) => format!("{own} — {}", tilde(&parent.to_string_lossy())),
                None => own,
            }
        })
        .collect()
}

fn tilde(path: &str) -> String {
    match std::env::var("HOME") {
        Ok(home) if !home.is_empty() && path.starts_with(&home) => {
            format!("~{}", &path[home.len()..])
        }
        _ => path.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn books_with_the_same_name_say_where_they_are() {
        let books = ["/a/novel", "/b/notes/novel", "/a/poems"].map(String::from);
        assert_eq!(
            titles(&books),
            ["novel — /a", "novel — /b/notes", "poems"]
        );
    }
}
