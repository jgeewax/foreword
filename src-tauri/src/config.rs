//! The author's settings file, `~/.foreword/settings.json`: every app
//! preference, editable by hand (like Claude Code's settings.json). Self-tests
//! get their own folder next to their results, so they never touch it.
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
};

use serde::Serialize;

use crate::error::{CmdError, CmdResult};

const MAX_BYTES: usize = 256 * 1024;

pub fn config_dir() -> PathBuf {
    if let Ok(dir) = std::env::var("FOREWORD_CONFIG_DIR") {
        return PathBuf::from(dir);
    }
    if let Ok(out) = std::env::var("FOREWORD_SELFTEST") {
        return Path::new(&out).with_extension("config");
    }
    let home = std::env::var("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("/tmp"));
    let dir = home.join(".foreword");
    // Its name from before the app was renamed (legacy): moved, unless the new one is there.
    let legacy = home.join(".typst-studio");
    if !dir.exists() && legacy.is_dir() {
        let _ = fs::rename(&legacy, &dir);
    }
    dir
}

pub fn config_file() -> PathBuf {
    config_dir().join("settings.json")
}

#[derive(Serialize)]
pub struct ConfigFile {
    /// Where it is (for display), with ~ for the home folder.
    path: String,
    /// Its text, or null if there's no file yet.
    text: Option<String>,
}

fn display(p: &Path) -> String {
    match std::env::var("HOME") {
        Ok(home) if p.starts_with(&home) => format!("~{}", &p.to_string_lossy()[home.len()..]),
        _ => p.to_string_lossy().into_owned(),
    }
}

pub fn read_at(file: &Path) -> CmdResult<Option<String>> {
    match fs::read_to_string(file) {
        Ok(t) => Ok(Some(t)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.into()),
    }
}

/// Write the file whole (through a temporary file), only if it's a JSON object.
pub fn write_at(file: &Path, text: &str) -> CmdResult<()> {
    if text.len() > MAX_BYTES {
        return Err(CmdError::Invalid("the settings are too large".into()));
    }
    match serde_json::from_str::<serde_json::Value>(text) {
        Ok(serde_json::Value::Object(_)) => {}
        _ => return Err(CmdError::Invalid("settings must be a JSON object".into())),
    }
    let dir = file
        .parent()
        .ok_or_else(|| CmdError::Invalid("no folder".into()))?;
    fs::create_dir_all(dir)?;
    let tmp = dir.join(format!(".settings.{}.tmp", uuid::Uuid::new_v4().simple()));
    let result = (|| -> std::io::Result<()> {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(text.as_bytes())?;
        f.sync_all()?;
        fs::rename(&tmp, file)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    Ok(result?)
}

#[tauri::command]
pub async fn config_read() -> CmdResult<ConfigFile> {
    let file = config_file();
    Ok(ConfigFile {
        path: display(&file),
        text: read_at(&file)?,
    })
}

#[tauri::command]
pub async fn config_write(text: String) -> CmdResult<()> {
    write_at(&config_file(), &text)
}

/// Open the settings file in the author's text editor (TextEdit unless they chose another).
#[tauri::command]
pub async fn config_open() -> CmdResult<()> {
    let file = config_file();
    if !file.is_file() {
        return Err(CmdError::NotFound(
            "the settings file hasn't been written yet".into(),
        ));
    }
    let status = std::process::Command::new("/usr/bin/open")
        .arg("-t")
        .arg(&file)
        .status()?;
    if !status.success() {
        return Err(CmdError::Io("couldn't open the settings file".into()));
    }
    Ok(())
}

/// Light or dark, if the settings file chooses one (`theme`); None follows macOS.
/// Read at launch, so the first window opens in it; the page sets it after.
pub fn theme() -> Option<tauri::Theme> {
    theme_in(&read_at(&config_file()).ok()??)
}

fn theme_in(settings: &str) -> Option<tauri::Theme> {
    let value: serde_json::Value = serde_json::from_str(settings).ok()?;
    match value.get("theme")?.as_str()? {
        "light" => Some(tauri::Theme::Light),
        "dark" => Some(tauri::Theme::Dark),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_theme() {
        assert_eq!(
            theme_in(r#"{ "theme": "light" }"#),
            Some(tauri::Theme::Light)
        );
        assert_eq!(theme_in(r#"{ "theme": "dark" }"#), Some(tauri::Theme::Dark));
        assert_eq!(theme_in(r#"{ "theme": "system" }"#), None);
        assert_eq!(theme_in(r#"{ "sendKey": "enter" }"#), None);
        assert_eq!(theme_in("{ not json"), None);
    }

    #[test]
    fn writes_json_objects_only_and_whole() {
        let dir = std::env::temp_dir().join(format!("foreword-config-{}", std::process::id()));
        let file = dir.join("nested/settings.json");
        assert_eq!(read_at(&file).unwrap(), None);
        write_at(&file, "{\n  \"sendKey\": \"enter\"\n}\n").unwrap();
        assert_eq!(
            read_at(&file).unwrap().as_deref(),
            Some("{\n  \"sendKey\": \"enter\"\n}\n")
        );
        // A broken or non-object text never replaces the file.
        assert!(write_at(&file, "{ not json").is_err());
        assert!(write_at(&file, "[1, 2]").is_err());
        assert!(read_at(&file).unwrap().unwrap().contains("sendKey"));
        assert_eq!(fs::read_dir(dir.join("nested")).unwrap().count(), 1);
        let _ = fs::remove_dir_all(&dir);
    }
}
