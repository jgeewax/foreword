//! Small in-memory log of subprocess output, shown in the UI when something fails.
use std::{
    collections::VecDeque,
    sync::{Mutex, OnceLock},
};

use serde::Serialize;
use tokio::io::{AsyncBufReadExt, AsyncRead, BufReader};

const MAX_LINES: usize = 2000;

#[derive(Serialize, Clone)]
pub struct LogLine {
    source: &'static str,
    line: String,
}

fn buffer() -> &'static Mutex<VecDeque<LogLine>> {
    static LOGS: OnceLock<Mutex<VecDeque<LogLine>>> = OnceLock::new();
    LOGS.get_or_init(|| Mutex::new(VecDeque::with_capacity(MAX_LINES)))
}

pub fn push(source: &'static str, line: impl Into<String>) {
    let mut logs = buffer().lock().unwrap();
    if logs.len() == MAX_LINES {
        logs.pop_front();
    }
    logs.push_back(LogLine {
        source,
        line: line.into(),
    });
}

/// Drain a child's output stream into the log.
pub fn pipe(source: &'static str, stream: impl AsyncRead + Unpin + Send + 'static) {
    tauri::async_runtime::spawn(async move {
        let mut lines = BufReader::new(stream).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            push(source, line);
        }
    });
}

#[tauri::command]
pub fn app_logs(source: Option<String>) -> Vec<LogLine> {
    buffer()
        .lock()
        .unwrap()
        .iter()
        .filter(|l| source.as_deref().is_none_or(|s| s == l.source))
        .cloned()
        .collect()
}
