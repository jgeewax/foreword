//! Exported PDFs outside the book: copy one to where the author chose in the
//! Save dialog, and open or reveal a PDF. Only `.pdf` files, so these can't be
//! used to write or launch anything else.
use std::{
    fs,
    path::{Path, PathBuf},
};

use crate::{
    Win, WindowState,
    error::{CmdError, CmdResult},
    workspace::resolve,
};

fn is_pdf(p: &Path) -> bool {
    p.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case("pdf"))
}

/// Copy `from` (a PDF in the book) to `to` (an absolute path the author picked),
/// through a temporary file next to it, so a failed copy never leaves half a PDF.
pub fn copy_pdf(from: &Path, to: &Path) -> CmdResult<()> {
    if !is_pdf(from) || !is_pdf(to) {
        return Err(CmdError::Invalid("only PDF files can be exported".into()));
    }
    if !to.is_absolute() {
        return Err(CmdError::Invalid(format!(
            "not a full path: {}",
            to.display()
        )));
    }
    let dir = to.parent().filter(|d| d.is_dir()).ok_or_else(|| {
        CmdError::NotFound(format!("the folder for {} doesn't exist", to.display()))
    })?;
    if to.is_dir() {
        return Err(CmdError::Invalid(format!("{} is a folder", to.display())));
    }
    if from.canonicalize()? == to.canonicalize().unwrap_or_default() {
        return Ok(());
    }
    let name = to
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("export.pdf");
    let tmp = dir.join(format!(
        ".{name}.{}.foreword.tmp",
        uuid::Uuid::new_v4().simple()
    ));
    let result = fs::copy(from, &tmp).and_then(|_| fs::rename(&tmp, to));
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    Ok(result?)
}

/// Copy an exported PDF from the book to where the author chose to save it.
#[tauri::command]
pub async fn export_copy(state: Win, from: String, to: String) -> CmdResult<String> {
    let src = resolve(&state.root()?, &from)?;
    if !src.is_file() {
        return Err(CmdError::NotFound(format!("{from} doesn't exist")));
    }
    let dst = PathBuf::from(&to);
    copy_pdf(&src, &dst)?;
    Ok(to)
}

/// A PDF to open or reveal: workspace-relative or absolute, existing, `.pdf`.
fn existing_pdf(state: &WindowState, path: &str) -> CmdResult<PathBuf> {
    let p = if path.starts_with('/') {
        PathBuf::from(path)
    } else {
        resolve(&state.root()?, path)?
    };
    if !is_pdf(&p) {
        return Err(CmdError::Invalid(format!("not a PDF: {path}")));
    }
    if !p.is_file() {
        return Err(CmdError::NotFound(format!("{path} doesn't exist")));
    }
    Ok(p)
}

fn run_open(args: &[&std::ffi::OsStr]) -> CmdResult<()> {
    let status = std::process::Command::new("/usr/bin/open")
        .args(args)
        .status()?;
    if !status.success() {
        return Err(CmdError::Io("couldn't open it".into()));
    }
    Ok(())
}

/// Open a PDF in the default viewer (Preview, unless the author chose another).
#[tauri::command]
pub async fn open_pdf(state: Win, path: String) -> CmdResult<()> {
    let p = existing_pdf(&state, &path)?;
    run_open(&[p.as_os_str()])
}

/// Show a PDF in Finder.
#[tauri::command]
pub async fn reveal_pdf(state: Win, path: String) -> CmdResult<()> {
    let p = existing_pdf(&state, &path)?;
    run_open(&[std::ffi::OsStr::new("-R"), p.as_os_str()])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn copies_pdfs_only_and_replaces_atomically() {
        let dir = std::env::temp_dir().join(format!("foreword-export-{}", std::process::id()));
        fs::create_dir_all(dir.join("out")).unwrap();
        let src = dir.join("main.pdf");
        fs::write(&src, b"%PDF-1.7 new").unwrap();
        let dst = dir.join("out/My Book.pdf");
        fs::write(&dst, b"%PDF-1.7 old").unwrap();
        copy_pdf(&src, &dst).unwrap();
        assert_eq!(fs::read(&dst).unwrap(), b"%PDF-1.7 new");
        // No temporary files left behind.
        assert_eq!(fs::read_dir(dir.join("out")).unwrap().count(), 1);

        assert!(copy_pdf(&src, &dir.join("out/notes.txt")).is_err());
        assert!(copy_pdf(&dir.join("x.typ"), &dir.join("out/a.pdf")).is_err());
        assert!(copy_pdf(&src, Path::new("relative.pdf")).is_err());
        assert!(copy_pdf(&src, &dir.join("missing-folder/a.pdf")).is_err());
        // Copying a file onto itself is a no-op, not a truncation.
        copy_pdf(&src, &src).unwrap();
        assert_eq!(fs::read(&src).unwrap(), b"%PDF-1.7 new");
        let _ = fs::remove_dir_all(&dir);
    }
}
