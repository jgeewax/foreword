//! PNG snapshots of a WKWebView, exactly as displayed (GPU-composited layers
//! included). Used by the self-test to verify the preview visually in the real
//! app, where headless browsers render differently.
use std::{path::PathBuf, sync::Mutex};

use block2::RcBlock;
use objc2::runtime::AnyObject;
use objc2_app_kit::{
    NSBitmapImageFileType, NSBitmapImageRep, NSBitmapImageRepPropertyKey, NSImage,
};
use objc2_foundation::{NSDictionary, NSError};
use objc2_web_kit::WKWebView;
use tauri::Webview;

fn encode_png(image: &NSImage) -> Result<Vec<u8>, String> {
    let tiff = image
        .TIFFRepresentation()
        .ok_or("snapshot has no TIFF representation")?;
    let bitmap = NSBitmapImageRep::imageRepWithData(&tiff).ok_or("snapshot is not a bitmap")?;
    let props: objc2::rc::Retained<NSDictionary<NSBitmapImageRepPropertyKey, AnyObject>> =
        NSDictionary::new();
    // SAFETY: an empty properties dictionary is valid for PNG encoding.
    let png =
        unsafe { bitmap.representationUsingType_properties(NSBitmapImageFileType::PNG, &props) }
            .ok_or("PNG encoding failed")?;
    Ok(png.to_vec())
}

pub async fn snapshot_png(webview: &Webview, path: PathBuf) -> Result<(), String> {
    let (tx, rx) = tokio::sync::oneshot::channel::<Result<(), String>>();
    let tx = Mutex::new(Some(tx));
    webview
        .with_webview(move |platform| {
            // SAFETY: on macOS `inner()` is the live WKWebView; this closure runs on the main thread.
            let wk = unsafe { &*(platform.inner() as *const WKWebView) };
            let handler = RcBlock::new(move |image: *mut NSImage, error: *mut NSError| {
                // SAFETY: WebKit passes either a valid image or a valid error.
                let result = match (unsafe { image.as_ref() }, unsafe { error.as_ref() }) {
                    (Some(image), _) => encode_png(image)
                        .and_then(|png| std::fs::write(&path, png).map_err(|e| e.to_string())),
                    (None, Some(error)) => Err(error.localizedDescription().to_string()),
                    (None, None) => Err("snapshot returned nothing".into()),
                };
                if let Some(tx) = tx.lock().unwrap().take() {
                    let _ = tx.send(result);
                }
            });
            // SAFETY: called on the main thread with a valid completion block.
            unsafe { wk.takeSnapshotWithConfiguration_completionHandler(None, &handler) };
        })
        .map_err(|e| e.to_string())?;
    rx.await.map_err(|_| "snapshot was cancelled".to_string())?
}

/// Native window/webview geometry (points): how the page maps onto the window
/// (title bar overlap, content insets) and where the window's buttons are.
pub async fn window_geometry(
    window: &tauri::Window,
    webview: &Webview,
) -> Result<serde_json::Value, String> {
    use objc2_app_kit::{NSWindow, NSWindowButton, NSWindowStyleMask};
    let ns_window = window.ns_window().map_err(|e| e.to_string())? as usize;
    let (tx, rx) = tokio::sync::oneshot::channel::<serde_json::Value>();
    let tx = Mutex::new(Some(tx));
    webview
        .with_webview(move |platform| {
            // SAFETY: both pointers are live AppKit objects; this runs on the main thread.
            let wk = unsafe { &*(platform.inner() as *const WKWebView) };
            let win = unsafe { &*(ns_window as *const NSWindow) };
            let frame = win.frame();
            let layout = win.contentLayoutRect();
            let content = win.contentView().map(|v| v.frame());
            let wk_frame = wk.frame();
            let insets = wk.safeAreaInsets();
            // Close to zoom, top-down in window points ([left, top, right, bottom]);
            // null in full screen, where they leave the window with the title bar.
            let button = |b: NSWindowButton| {
                let button = win.standardWindowButton(b)?;
                (!button.isHidden()).then(|| button.convertRect_toView(button.bounds(), None))
            };
            let full_screen = win.styleMask().contains(NSWindowStyleMask::FullScreen);
            let buttons = match (button(NSWindowButton::CloseButton), button(NSWindowButton::ZoomButton)) {
                (Some(close), Some(zoom)) if !full_screen => Some([
                    close.origin.x,
                    frame.size.height - (close.origin.y + close.size.height),
                    zoom.origin.x + zoom.size.width,
                    frame.size.height - zoom.origin.y,
                ]),
                _ => None,
            };
            let value = serde_json::json!({
                "fullSizeContentView": win.styleMask().contains(NSWindowStyleMask::FullSizeContentView),
                "windowFrame": [frame.size.width, frame.size.height],
                "contentLayoutRect": [layout.origin.x, layout.origin.y, layout.size.width, layout.size.height],
                "contentViewFrame": content.map(|c| vec![c.origin.x, c.origin.y, c.size.width, c.size.height]),
                "webviewFrame": [wk_frame.origin.x, wk_frame.origin.y, wk_frame.size.width, wk_frame.size.height],
                "webviewSafeAreaInsets": { "top": insets.top, "left": insets.left, "bottom": insets.bottom, "right": insets.right },
                "webviewHidden": wk.isHidden(),
                "windowButtons": buttons,
            });
            if let Some(tx) = tx.lock().unwrap().take() {
                let _ = tx.send(value);
            }
        })
        .map_err(|e| e.to_string())?;
    rx.await.map_err(|_| "geometry query cancelled".to_string())
}
