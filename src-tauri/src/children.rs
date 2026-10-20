//! Helper-process bookkeeping. macOS has no parent-death signal, so if the app
//! is force-quit or crashes, `opencode serve` keeps running. Each app instance
//! records the helpers it spawned in its own file (`children-<pid>.json`) with a
//! command-line signature. At startup, files left by instances that are no
//! longer running are reaped: matching helpers are terminated (never by PID
//! alone, so a recycled PID is not hit). Other running instances are untouched.
use std::{
    fs,
    path::PathBuf,
    process::Command,
    sync::{Mutex, OnceLock},
};

use serde::{Deserialize, Serialize};

use crate::logs;

#[derive(Serialize, Deserialize, Clone)]
struct Entry {
    pid: u32,
    /// Substring that must appear in the process's command line.
    signature: String,
}

static FILE: OnceLock<PathBuf> = OnceLock::new();
static ENTRIES: Mutex<Vec<Entry>> = Mutex::new(Vec::new());

fn save(entries: &[Entry]) {
    if let Some(path) = FILE.get() {
        let _ = fs::write(path, serde_json::to_string(entries).unwrap_or_default());
    }
}

fn command_line(pid: u32) -> Option<String> {
    let out = Command::new("/bin/ps")
        .args(["-o", "command=", "-p", &pid.to_string()])
        .output()
        .ok()?;
    out.status
        .success()
        .then(|| String::from_utf8_lossy(&out.stdout).trim().to_string())
}

fn owner_pid(path: &std::path::Path) -> Option<u32> {
    path.file_name()?
        .to_str()?
        .strip_prefix("children-")?
        .strip_suffix(".json")?
        .parse()
        .ok()
}

/// Call once at startup: reap helpers of dead instances, then start our own file.
pub fn init(dir: PathBuf) {
    let _ = fs::create_dir_all(&dir);
    let me = std::process::id();
    let exe = std::env::current_exe()
        .ok()
        .and_then(|p| p.file_name().map(|n| n.to_string_lossy().into_owned()))
        .unwrap_or_else(|| "foreword".into());
    for file in fs::read_dir(&dir).into_iter().flatten().flatten() {
        let path = file.path();
        let Some(owner) = owner_pid(&path) else {
            continue;
        };
        if owner == me || command_line(owner).is_some_and(|cmd| cmd.contains(&exe)) {
            continue; // still running: not ours to clean up
        }
        let stale: Vec<Entry> = fs::read_to_string(&path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();
        for e in stale {
            if command_line(e.pid).is_some_and(|cmd| cmd.contains(&e.signature)) {
                logs::push(
                    "app",
                    format!("terminating leftover helper {} ({})", e.pid, e.signature),
                );
                let _ = Command::new("/bin/kill").arg(e.pid.to_string()).status();
            }
        }
        let _ = fs::remove_file(&path);
    }
    let _ = fs::remove_file(dir.join("children.json")); // pre-per-instance format
    let _ = FILE.set(dir.join(format!("children-{me}.json")));
    save(&[]);
}

pub fn register(pid: u32, signature: String) {
    let mut entries = ENTRIES.lock().unwrap();
    entries.push(Entry { pid, signature });
    save(&entries);
}

pub fn unregister(pid: u32) {
    let mut entries = ENTRIES.lock().unwrap();
    entries.retain(|e| e.pid != pid);
    save(&entries);
}

/// Stop every helper this instance registered, without needing any lock
/// elsewhere: at exit a helper can still be starting (its lock held for up to
/// 30 s), and skipping it then would leave it running with no record. Each PID
/// is checked against its command line first; SIGTERM, then SIGKILL after 300 ms.
pub fn kill_all() {
    let entries = ENTRIES.lock().map(|e| e.clone()).unwrap_or_default();
    kill_entries(&entries);
}

fn kill_entries(entries: &[Entry]) {
    let live: Vec<&Entry> = entries
        .iter()
        .filter(|e| command_line(e.pid).is_some_and(|cmd| cmd.contains(&e.signature)))
        .collect();
    for e in &live {
        // SAFETY: plain kill(2) on a PID whose command line we just checked.
        unsafe { libc::kill(e.pid as libc::pid_t, libc::SIGTERM) };
    }
    if live.is_empty() {
        return;
    }
    let deadline = std::time::Instant::now() + std::time::Duration::from_millis(300);
    while std::time::Instant::now() < deadline {
        // SAFETY: signal 0 only checks whether the process exists.
        if live
            .iter()
            .all(|e| unsafe { libc::kill(e.pid as libc::pid_t, 0) } != 0)
        {
            return;
        }
        std::thread::sleep(std::time::Duration::from_millis(20));
    }
    for e in &live {
        if command_line(e.pid).is_some_and(|cmd| cmd.contains(&e.signature)) {
            // SAFETY: as above.
            unsafe { libc::kill(e.pid as libc::pid_t, libc::SIGKILL) };
        }
    }
}

/// Remove our registry file on a clean exit.
pub fn clear() {
    if let Some(path) = FILE.get() {
        let _ = fs::remove_file(path);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kills_registered_helpers_and_only_those() {
        let mut ours = std::process::Command::new("/bin/sleep")
            .arg("37.123")
            .spawn()
            .unwrap();
        let mut other = std::process::Command::new("/bin/sleep")
            .arg("38.456")
            .spawn()
            .unwrap();
        // A matching entry, and one whose command line doesn't match (a recycled PID, say).
        kill_entries(&[
            Entry {
                pid: ours.id(),
                signature: "sleep 37.123".into(),
            },
            Entry {
                pid: other.id(),
                signature: "opencode serve".into(),
            },
        ]);
        assert!(ours.try_wait().unwrap().is_some() || ours.wait().is_ok());
        assert!(
            other.try_wait().unwrap().is_none(),
            "a process that doesn't match is left alone"
        );
        other.kill().unwrap();
        other.wait().unwrap();
    }
}
