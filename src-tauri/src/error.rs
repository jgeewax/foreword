use serde::Serialize;

/// Error returned to the frontend as `{ kind, message }`.
#[derive(Debug, Serialize)]
#[serde(tag = "kind", content = "message", rename_all = "camelCase")]
pub enum CmdError {
    /// The file on disk is not the version the caller expected.
    Conflict(String),
    NotFound(String),
    Invalid(String),
    /// A required tool or process is missing or not running.
    Unavailable(String),
    Io(String),
}

pub type CmdResult<T> = Result<T, CmdError>;

impl std::fmt::Display for CmdError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            CmdError::Conflict(m) => write!(f, "conflict: {m}"),
            CmdError::NotFound(m) => write!(f, "not found: {m}"),
            CmdError::Invalid(m) => write!(f, "invalid: {m}"),
            CmdError::Unavailable(m) => write!(f, "unavailable: {m}"),
            CmdError::Io(m) => write!(f, "io: {m}"),
        }
    }
}

impl From<std::io::Error> for CmdError {
    fn from(e: std::io::Error) -> Self {
        match e.kind() {
            std::io::ErrorKind::NotFound => CmdError::NotFound(e.to_string()),
            _ => CmdError::Io(e.to_string()),
        }
    }
}

impl From<tauri::Error> for CmdError {
    fn from(e: tauri::Error) -> Self {
        CmdError::Io(e.to_string())
    }
}

impl From<reqwest::Error> for CmdError {
    fn from(e: reqwest::Error) -> Self {
        CmdError::Unavailable(e.to_string())
    }
}
