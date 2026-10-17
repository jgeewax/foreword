//! Typst snippets rendered outside the book: formulas and blocks in the chat
//! and in review comments. Each snippet compiles on its own with Tinymist,
//! in a fresh temp folder that is also its Typst root (so it can't read the
//! book or anything else), to SVG. A timeout and a size cap keep a runaway
//! snippet from holding things up.
use std::{process::Stdio, time::Duration};

use serde::Serialize;
use tokio::process::Command;

use crate::{
    discover,
    error::{CmdError, CmdResult},
};

const MAX_SOURCE: usize = 20 * 1024;
const MAX_SNIPPETS: usize = 40;
const TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Serialize)]
pub struct Rendered {
    /// One SVG per page (a snippet normally makes one).
    pages: Vec<String>,
    /// The compiler's message, if it failed.
    error: Option<String>,
}

/// `#rrggbb` only: it goes into the preamble.
fn is_hex_color(c: &str) -> bool {
    c.len() == 7 && c.starts_with('#') && c[1..].chars().all(|ch| ch.is_ascii_hexdigit())
}

fn preamble(fill: &str, size_pt: f64) -> String {
    format!(
        "#set page(width: auto, height: auto, margin: (x: 1pt, y: 2pt), fill: none)\n#set text(size: {size_pt}pt, fill: rgb(\"{fill}\"))\n"
    )
}

async fn render_one(bin: &std::path::Path, source: &str, fill: &str, size_pt: f64) -> Rendered {
    let fail = |e: String| Rendered {
        pages: Vec::new(),
        error: Some(e),
    };
    if source.len() > MAX_SOURCE {
        return fail("too long to show".into());
    }
    let dir = std::env::temp_dir().join(format!(
        "typst-studio-render-{}",
        uuid::Uuid::new_v4().simple()
    ));
    if let Err(e) = std::fs::create_dir_all(&dir) {
        return fail(e.to_string());
    }
    // The real path (/var is /private/var on macOS): Tinymist checks the entry is inside the root.
    let dir = dir.canonicalize().unwrap_or(dir);
    let result = async {
        std::fs::write(
            dir.join("snippet.typ"),
            format!("{}{source}\n", preamble(fill, size_pt)),
        )
        .map_err(|e| e.to_string())?;
        let child = Command::new(bin)
            .arg("compile")
            .arg("--root")
            .arg(&dir)
            .arg(dir.join("snippet.typ"))
            .arg(dir.join("page-{0p}.svg"))
            .current_dir(&dir)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .process_group(0)
            .kill_on_drop(true)
            .spawn()
            .map_err(|e| format!("couldn't start tinymist: {e}"))?;
        let pid = child.id();
        let out = match tokio::time::timeout(TIMEOUT, child.wait_with_output()).await {
            Ok(out) => out.map_err(|e| e.to_string())?,
            Err(_) => {
                if let Some(pid) = pid {
                    // SAFETY: killpg only sends a signal; pid is our own child's group.
                    unsafe { libc::killpg(pid as i32, libc::SIGKILL) };
                }
                return Err("took too long to render".into());
            }
        };
        if !out.status.success() {
            let msg = String::from_utf8_lossy(&out.stderr).trim().to_string();
            return Err(if msg.is_empty() {
                "couldn't render".into()
            } else {
                msg
            });
        }
        let mut names: Vec<_> = std::fs::read_dir(&dir)
            .map_err(|e| e.to_string())?
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .filter(|n| n.starts_with("page-") && n.ends_with(".svg"))
            .collect();
        names.sort();
        names
            .iter()
            .map(|n| std::fs::read_to_string(dir.join(n)).map_err(|e| e.to_string()))
            .collect::<Result<Vec<_>, _>>()
    }
    .await;
    let _ = std::fs::remove_dir_all(&dir);
    match result {
        Ok(pages) => Rendered { pages, error: None },
        Err(e) => fail(e),
    }
}

/// Render snippets (Typst markup; math is `$…$`) in `fill` colour at `size_pt`.
#[tauri::command]
pub async fn typst_render(
    sources: Vec<String>,
    fill: String,
    size_pt: f64,
) -> CmdResult<Vec<Rendered>> {
    if !is_hex_color(&fill) {
        return Err(CmdError::Invalid(format!("not a colour: {fill}")));
    }
    if sources.len() > MAX_SNIPPETS {
        return Err(CmdError::Invalid("too many snippets at once".into()));
    }
    let size_pt = size_pt.clamp(6.0, 32.0);
    let bin = discover::find_tinymist()
        .ok_or_else(|| CmdError::Unavailable("tinymist not found".into()))?;
    let jobs = sources.iter().map(|s| render_one(&bin, s, &fill, size_pt));
    Ok(futures_util::future::join_all(jobs).await)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_plain_hex_colours_reach_the_preamble() {
        assert!(is_hex_color("#d4d4d4"));
        assert!(!is_hex_color("#d4d4d4\")\n#read(\"x\""));
        assert!(!is_hex_color("red"));
        assert!(preamble("#112233", 11.0).contains("rgb(\"#112233\")"));
    }

    #[tokio::test]
    async fn renders_math_and_reports_errors() {
        let Some(bin) = discover::find_tinymist() else {
            return; // no tinymist on this machine
        };
        let ok = render_one(&bin, "$ x^2 + y^2 $", "#000000", 11.0).await;
        assert!(ok.error.is_none(), "{:?}", ok.error);
        assert_eq!(ok.pages.len(), 1);
        assert!(ok.pages[0].starts_with("<svg"));
        let bad = render_one(&bin, "$ frac(1 $", "#000000", 11.0).await;
        assert!(bad.pages.is_empty() && bad.error.is_some());
        // The snippet's root is its own temp folder: the book's files are out of reach.
        let outside = render_one(&bin, "#read(\"/etc/hosts\")", "#000000", 11.0).await;
        assert!(outside.error.is_some());
    }
}
