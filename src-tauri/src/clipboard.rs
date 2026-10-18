//! The macOS pasteboard. Native context-menu actions run outside a DOM user
//! gesture, where WebKit may refuse `navigator.clipboard`; reading it there
//! also asks the user first.
use crate::error::{CmdError, CmdResult};

#[tauri::command]
pub fn clipboard_write(text: String) -> CmdResult<()> {
    #[cfg(target_os = "macos")]
    {
        use objc2_app_kit::{NSPasteboard, NSPasteboardTypeString};
        use objc2_foundation::NSString;
        let board = NSPasteboard::generalPasteboard();
        board.clearContents();
        // SAFETY: NSPasteboardTypeString is a constant provided by AppKit.
        let ok = board.setString_forType(&NSString::from_str(&text), unsafe {
            NSPasteboardTypeString
        });
        if ok {
            Ok(())
        } else {
            Err(CmdError::Io("the clipboard refused the text".into()))
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = text;
        Err(CmdError::Unavailable(
            "clipboard is only implemented on macOS".into(),
        ))
    }
}

/// The clipboard's text; for a file copied in Finder, its path.
#[tauri::command]
pub fn clipboard_read() -> CmdResult<Option<String>> {
    #[cfg(target_os = "macos")]
    {
        use objc2_app_kit::{NSPasteboard, NSPasteboardTypeFileURL, NSPasteboardTypeString};
        use objc2_foundation::NSURL;
        let board = NSPasteboard::generalPasteboard();
        // SAFETY: the pasteboard types are constants provided by AppKit.
        let file = board
            .stringForType(unsafe { NSPasteboardTypeFileURL })
            .and_then(|url| NSURL::URLWithString(&url))
            .and_then(|url| url.filePathURL())
            .and_then(|url| url.path());
        if let Some(path) = file {
            return Ok(Some(path.to_string()));
        }
        Ok(board
            .stringForType(unsafe { NSPasteboardTypeString })
            .map(|s| s.to_string()))
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err(CmdError::Unavailable(
            "clipboard is only implemented on macOS".into(),
        ))
    }
}
