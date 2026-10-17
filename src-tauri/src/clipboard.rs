//! Copy text to the macOS pasteboard. Native context-menu actions run outside
//! a DOM user gesture, where WebKit may refuse `navigator.clipboard`.
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
