//! Runnable code examples in a book (`#run("name", ```lang …```)`): run one
//! example with the matching interpreter, in the book's folder, from a temp
//! file. Capped output, a timeout, stdin closed, and the whole process group
//! killed on timeout. The app only calls this for books the author trusts.
use std::{
    path::Path,
    process::Stdio,
    time::{Duration, Instant},
};

use serde::Serialize;
use tauri::State;
use tokio::{
    io::{AsyncRead, AsyncReadExt},
    process::Command,
};

use crate::{
    AppState, discover,
    error::{CmdError, CmdResult},
};

const MAX_OUTPUT: usize = 256 * 1024;
const DEFAULT_TIMEOUT_MS: u64 = 30_000;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunResult {
    stdout: String,
    stderr: String,
    /// Exit code; null if killed (timeout) or ended by a signal.
    exit: Option<i32>,
    timed_out: bool,
    truncated: bool,
    duration_ms: u64,
    interpreter: String,
}

/// Interpreter, extra arguments and file extension for a language tag.
fn interpreter(lang: &str) -> Option<(&'static str, &'static [&'static str], &'static str)> {
    Some(match lang.to_ascii_lowercase().as_str() {
        "python" | "py" | "python3" => ("python3", &["-u"], "py"),
        "javascript" | "js" | "node" => ("node", &[], "js"),
        "bash" | "sh" | "shell" => ("bash", &[], "sh"),
        "zsh" => ("zsh", &[], "zsh"),
        "ruby" | "rb" => ("ruby", &[], "rb"),
        "r" => ("Rscript", &[], "R"),
        "julia" | "jl" => ("julia", &[], "jl"),
        "perl" | "pl" => ("perl", &[], "pl"),
        "lua" => ("lua", &[], "lua"),
        _ => return None,
    })
}

async fn read_capped<R: AsyncRead + Unpin>(reader: Option<R>) -> (Vec<u8>, bool) {
    let Some(mut reader) = reader else {
        return (Vec::new(), false);
    };
    let (mut buf, mut chunk, mut truncated) = (Vec::new(), [0u8; 8192], false);
    while let Ok(n) = reader.read(&mut chunk).await {
        if n == 0 {
            break;
        }
        let room = MAX_OUTPUT.saturating_sub(buf.len());
        buf.extend_from_slice(&chunk[..n.min(room)]);
        truncated |= n > room;
    }
    (buf, truncated)
}

pub async fn run_code(
    root: &Path,
    lang: &str,
    code: &str,
    timeout_ms: u64,
) -> CmdResult<RunResult> {
    let (exe, args, ext) = interpreter(lang).ok_or_else(|| {
        CmdError::Invalid(format!("Typst Studio can't run “{lang}” examples yet"))
    })?;
    let bin = discover::find(exe, &format!("TYPST_STUDIO_{}", exe.to_ascii_uppercase()))
        .ok_or_else(|| {
            CmdError::Unavailable(format!(
                "{exe} isn't installed; it's needed to run {lang} examples"
            ))
        })?;
    let dir = std::env::temp_dir().join(format!(
        "typst-studio-run-{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&dir)?;
    let file = dir.join(format!("example.{ext}"));
    std::fs::write(&file, code)?;

    let start = Instant::now();
    let mut child = Command::new(&bin)
        .args(args)
        .arg(&file)
        .current_dir(root)
        .env("PATH", discover::search_path())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .process_group(0)
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| CmdError::Unavailable(format!("couldn't start {exe}: {e}")))?;
    let pid = child.id();
    let (out, err) = (child.stdout.take(), child.stderr.take());
    let work = async { tokio::join!(read_capped(out), read_capped(err), child.wait()) };
    let result = tokio::time::timeout(Duration::from_millis(timeout_ms), work).await;
    let (stdout, stderr, exit, timed_out, truncated) = match result {
        Ok(((o, ot), (e, et), status)) => {
            let code = status.ok().and_then(|s| s.code());
            (o, e, code, false, ot || et)
        }
        Err(_) => {
            // The example and anything it started share the process group.
            if let Some(pid) = pid {
                // SAFETY: killpg only sends a signal; pid is our own child's group.
                unsafe { libc::killpg(pid as i32, libc::SIGKILL) };
            }
            (
                Vec::new(),
                format!("Stopped after {} seconds.", timeout_ms / 1000).into_bytes(),
                None,
                true,
                false,
            )
        }
    };
    let _ = std::fs::remove_dir_all(&dir);
    Ok(RunResult {
        stdout: String::from_utf8_lossy(&stdout).into_owned(),
        stderr: String::from_utf8_lossy(&stderr).into_owned(),
        exit,
        timed_out,
        truncated,
        duration_ms: start.elapsed().as_millis() as u64,
        interpreter: bin.to_string_lossy().into_owned(),
    })
}

#[tauri::command]
pub async fn code_run(
    state: State<'_, AppState>,
    lang: String,
    code: String,
    timeout_ms: Option<u64>,
) -> CmdResult<RunResult> {
    let root = state.root()?;
    run_code(
        &root,
        &lang,
        &code,
        timeout_ms
            .unwrap_or(DEFAULT_TIMEOUT_MS)
            .clamp(1_000, 600_000),
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp() -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!(
            "typst-studio-code-{}",
            uuid::Uuid::new_v4().simple()
        ));
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[tokio::test]
    async fn runs_in_the_book_folder_and_captures_output() {
        let root = temp();
        std::fs::write(root.join("data.txt"), "42").unwrap();
        let r = run_code(
            &root,
            "bash",
            "cat data.txt; echo; echo oops >&2; exit 3",
            10_000,
        )
        .await
        .unwrap();
        assert_eq!(r.stdout, "42\n");
        assert_eq!(r.stderr, "oops\n");
        assert_eq!(r.exit, Some(3));
        assert!(!r.timed_out);
        std::fs::remove_dir_all(&root).ok();
    }

    #[tokio::test]
    async fn times_out_and_kills_child_processes() {
        let root = temp();
        let t = Instant::now();
        let r = run_code(&root, "bash", "sleep 30 & sleep 30; echo never", 1_000)
            .await
            .unwrap();
        assert!(r.timed_out);
        assert_eq!(r.exit, None);
        assert!(t.elapsed() < Duration::from_secs(5));
        std::fs::remove_dir_all(&root).ok();
    }

    #[tokio::test]
    async fn caps_output_and_rejects_unknown_languages() {
        let root = temp();
        let r = run_code(&root, "bash", "yes | head -c 1000000", 10_000)
            .await
            .unwrap();
        assert!(r.truncated);
        assert_eq!(r.stdout.len(), MAX_OUTPUT);
        assert!(matches!(
            run_code(&root, "cobol", "", 1_000).await,
            Err(CmdError::Invalid(_))
        ));
        std::fs::remove_dir_all(&root).ok();
    }
}
