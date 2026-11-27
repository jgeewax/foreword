//! A window's book in Mission Control. Each window's title is its book
//! (workspace.rs), but the title is hidden, the page drawing its own title bar,
//! and Mission Control then labels a full-screen space with the app's name
//! only: "Foreword" for every book. So, as Electron does for VS Code, the
//! title is shown while the window is full screen (where macOS draws it in the
//! bar that slides down with the menu bar) and hidden again as it leaves.

use std::ptr::NonNull;

use block2::RcBlock;
use objc2::rc::Retained;
use objc2_app_kit::{
    NSWindow, NSWindowDidEnterFullScreenNotification, NSWindowStyleMask,
    NSWindowTitleVisibility, NSWindowWillExitFullScreenNotification,
};
use objc2_foundation::{NSNotification, NSNotificationCenter, NSNotificationName};

/// Watches every window going in and out of full screen. Once, at start.
pub fn install() {
    let center = NSNotificationCenter::defaultCenter();
    // SAFETY: AppKit's own notification names, always there.
    let (enter, exit) = unsafe {
        (
            NSWindowDidEnterFullScreenNotification,
            NSWindowWillExitFullScreenNotification,
        )
    };
    watch(&center, enter, NSWindowTitleVisibility::Visible);
    watch(&center, exit, NSWindowTitleVisibility::Hidden);
}

fn watch(center: &NSNotificationCenter, name: &NSNotificationName, title: NSWindowTitleVisibility) {
    let block = RcBlock::new(move |note: NonNull<NSNotification>| {
        // SAFETY: the center passes a live notification.
        let note = unsafe { note.as_ref() };
        let Some(window) = note.object().and_then(|o| o.downcast::<NSWindow>().ok()) else {
            return;
        };
        if is_book_window(&window) {
            window.setTitleVisibility(title);
        }
    });
    // SAFETY: any window (no object), and with no queue the block runs where
    // AppKit posts these, on the main thread, as NSWindow needs. The center
    // keeps the observer for the app's life; nothing removes it.
    let _observer: Retained<_> =
        unsafe { center.addObserverForName_object_queue_usingBlock(Some(name), None, None, &block) };
}

/// A window made by `open_window` (lib.rs): content under a transparent title
/// bar, the title hidden. Not a panel or a sheet of the system's.
fn is_book_window(window: &Retained<NSWindow>) -> bool {
    window.titlebarAppearsTransparent()
        && window.styleMask().contains(NSWindowStyleMask::FullSizeContentView)
}
