//! Printing: facts about exported PDFs (for the print checks before an order)
//! and opening a printer's website. Typst Studio never places an order itself.
use std::path::Path;

use lopdf::{Dictionary, Document};
use serde::Serialize;
use tauri::State;

use crate::{
    AppState,
    error::{CmdError, CmdResult},
    workspace::resolve,
};

#[derive(Serialize, Debug, PartialEq)]
pub struct PdfInfo {
    pages: usize,
    /// Width and height of the first page's media box, in points (the full sheet, with any bleed).
    media: Option<[f32; 2]>,
    /// Its trim box (the finished page), when the PDF has one: x, y, width, height in points.
    trim: Option<[f32; 4]>,
    /// Every page has the same media box.
    uniform: bool,
}

/// A page box as [x0, y0, x1, y1], looked up the page tree (boxes are inheritable).
fn page_box(doc: &Document, page: &Dictionary, key: &[u8]) -> Option<[f32; 4]> {
    let mut dict = page;
    for _ in 0..32 {
        if let Ok(obj) = dict.get(key) {
            let arr = doc.dereference(obj).ok()?.1.as_array().ok()?;
            let n: Vec<f32> = arr
                .iter()
                .filter_map(|o| doc.dereference(o).ok()?.1.as_float().ok())
                .collect();
            return (n.len() == 4).then(|| [n[0], n[1], n[2], n[3]]);
        }
        dict = doc
            .dereference(dict.get(b"Parent").ok()?)
            .ok()?
            .1
            .as_dict()
            .ok()?;
    }
    None
}

pub fn pdf_info_at(path: &Path) -> CmdResult<PdfInfo> {
    let doc = Document::load(path)
        .map_err(|e| CmdError::Invalid(format!("couldn't read the PDF: {e}")))?;
    let pages = doc.get_pages();
    let mut first: Option<[f32; 4]> = None;
    let mut trim = None;
    let mut uniform = true;
    for (i, id) in pages.values().enumerate() {
        let Ok(dict) = doc.get_dictionary(*id) else {
            continue;
        };
        let media = page_box(&doc, dict, b"MediaBox");
        if i == 0 {
            first = media;
            trim = page_box(&doc, dict, b"TrimBox");
        } else if let (Some(a), Some(b)) = (first, media) {
            let size = |r: [f32; 4]| [r[2] - r[0], r[3] - r[1]];
            let (a, b) = (size(a), size(b));
            if (a[0] - b[0]).abs() > 0.5 || (a[1] - b[1]).abs() > 0.5 {
                uniform = false;
            }
        }
    }
    Ok(PdfInfo {
        pages: pages.len(),
        media: first.map(|r| [r[2] - r[0], r[3] - r[1]]),
        trim: trim.map(|r| [r[0], r[1], r[2] - r[0], r[3] - r[1]]),
        uniform,
    })
}

/// Page count and page size of an exported PDF in the workspace.
#[tauri::command]
pub async fn pdf_info(state: State<'_, AppState>, path: String) -> CmdResult<PdfInfo> {
    let target = resolve(&state.root()?, &path)?;
    if !target.is_file() {
        return Err(CmdError::NotFound(format!("{path} doesn't exist")));
    }
    tauri::async_runtime::spawn_blocking(move || pdf_info_at(&target))
        .await
        .map_err(|e| CmdError::Io(e.to_string()))?
}

/// Printer websites Typst Studio may open in the browser.
const PRINTER_HOSTS: &[&str] = &["mixam.com", "mixam.co.uk", "mixam.ca", "mixam.com.au"];

pub fn allowed_url(url: &str) -> bool {
    let Some(rest) = url.strip_prefix("https://") else {
        return false;
    };
    let host = rest.split(['/', '?', '#']).next().unwrap_or("");
    let host = host.strip_prefix("www.").unwrap_or(host);
    PRINTER_HOSTS.contains(&host) && !url.chars().any(|c| c.is_whitespace() || c.is_control())
}

/// Open a printer's page in the default browser (https, known printers only).
#[tauri::command]
pub async fn open_url(url: String) -> CmdResult<()> {
    if !allowed_url(&url) {
        return Err(CmdError::Invalid(format!("not a printer page Typst Studio opens: {url}")));
    }
    let status = std::process::Command::new("/usr/bin/open").arg(&url).status()?;
    if !status.success() {
        return Err(CmdError::Io(format!("couldn't open {url}")));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_printer_sites_over_https() {
        assert!(allowed_url("https://mixam.com/novels"));
        assert!(allowed_url("https://www.mixam.co.uk/support/filesetup"));
        assert!(allowed_url("https://mixam.com.au/paperbackbooks?x=1"));
        assert!(!allowed_url("http://mixam.com/novels"));
        assert!(!allowed_url("https://mixam.com.evil.example/novels"));
        assert!(!allowed_url("https://evil.example/?mixam.com"));
        assert!(!allowed_url("https://mixam.com@evil.example/"));
        assert!(!allowed_url("file:///etc/passwd"));
        assert!(!allowed_url("https://mixam.com/a b"));
    }

    /// Compiles with the installed `typst` when there is one (skipped otherwise).
    fn typst_pdf(dir: &Path, source: &str) -> Option<std::path::PathBuf> {
        std::fs::write(dir.join("t.typ"), source).ok()?;
        let ok = std::process::Command::new("typst")
            .args(["compile", "t.typ", "t.pdf"])
            .current_dir(dir)
            .status()
            .ok()?
            .success();
        ok.then(|| dir.join("t.pdf"))
    }

    #[test]
    fn reads_pages_sizes_and_bleed_from_typst_pdfs() {
        let dir = std::env::temp_dir().join(format!("typst-studio-pdf-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let Some(plain) = typst_pdf(&dir, "#set page(width: 6in, height: 9in)\nA\n#pagebreak()\nB\n") else {
            eprintln!("typst not installed; skipping");
            return;
        };
        let info = pdf_info_at(&plain).unwrap();
        assert_eq!(info, PdfInfo { pages: 2, media: Some([432.0, 648.0]), trim: None, uniform: true });

        let bled = typst_pdf(&dir, "#set page(width: 6in, height: 9in, bleed: 0.125in)\nA\n#page(width: 5in)[B]\n").unwrap();
        let info = pdf_info_at(&bled).unwrap();
        assert_eq!(info.pages, 2);
        assert_eq!(info.media, Some([450.0, 666.0]));
        let t = info.trim.unwrap();
        assert!((t[0] - 9.0).abs() < 0.01 && (t[2] - 432.0).abs() < 0.01 && (t[3] - 648.0).abs() < 0.01, "{t:?}");
        assert!(!info.uniform);

        std::fs::write(dir.join("bad.pdf"), b"not a pdf").unwrap();
        assert!(pdf_info_at(&dir.join("bad.pdf")).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
