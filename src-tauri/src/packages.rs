//! New project from a Typst Universe template package (e.g. the IEEE or
//! NeurIPS paper templates), like `typst init`: download the package from
//! packages.typst.org, then copy its template folder into a new folder. Only
//! regular files are copied, never symlinks, and only into a folder created
//! for the purpose (see `workspace::create_project_bytes`).
use std::{
    fs,
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};

use crate::{
    error::{CmdError, CmdResult},
    workspace::{self, NewFile},
};

const MAX_PACKAGE_BYTES: usize = 50 * 1024 * 1024;

#[derive(Deserialize)]
pub struct PackageSpec {
    name: String,
    version: String,
}

#[derive(Serialize)]
pub struct CreatedProject {
    root: String,
    entry: String,
}

fn valid_spec(spec: &PackageSpec) -> bool {
    let name_ok = !spec.name.is_empty()
        && spec.name.len() <= 64
        && spec
            .name
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-');
    let parts: Vec<_> = spec.version.split('.').collect();
    name_ok
        && parts.len() == 3
        && parts
            .iter()
            .all(|p| !p.is_empty() && p.len() <= 6 && p.bytes().all(|b| b.is_ascii_digit()))
}

/// `[template]` `path` and `entrypoint` from a package's typst.toml.
fn template_section(toml: &str) -> Option<(String, String)> {
    let mut in_template = false;
    let (mut path, mut entry) = (None, None);
    for line in toml.lines().map(str::trim) {
        if line.starts_with('[') {
            in_template = line == "[template]";
            continue;
        }
        if !in_template {
            continue;
        }
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        let value = value.trim().trim_matches('"').to_string();
        match key.trim() {
            "path" => path = Some(value),
            "entrypoint" => entry = Some(value),
            _ => {}
        }
    }
    Some((path?, entry?))
}

/// Regular files under `dir`, as (relative path, bytes); symlinks are skipped.
fn collect_files(dir: &Path, base: &Path, out: &mut Vec<(String, Vec<u8>)>) -> CmdResult<()> {
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let kind = entry.file_type()?;
        let path = entry.path();
        if kind.is_symlink() {
            continue;
        } else if kind.is_dir() {
            collect_files(&path, base, out)?;
        } else if kind.is_file() {
            let rel = path
                .strip_prefix(base)
                .map_err(|e| CmdError::Io(e.to_string()))?;
            out.push((rel.to_string_lossy().into_owned(), fs::read(&path)?));
        }
    }
    Ok(())
}

async fn download(spec: &PackageSpec) -> CmdResult<Vec<u8>> {
    let url = format!(
        "https://packages.typst.org/preview/{}-{}.tar.gz",
        spec.name, spec.version
    );
    let res = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()?
        .get(&url)
        .send()
        .await?;
    if !res.status().is_success() {
        return Err(CmdError::Unavailable(format!(
            "{url}: HTTP {}",
            res.status()
        )));
    }
    if res
        .content_length()
        .is_some_and(|n| n as usize > MAX_PACKAGE_BYTES)
    {
        return Err(CmdError::Invalid(
            "the template package is too large".into(),
        ));
    }
    let bytes = res.bytes().await?;
    if bytes.len() > MAX_PACKAGE_BYTES {
        return Err(CmdError::Invalid(
            "the template package is too large".into(),
        ));
    }
    Ok(bytes.to_vec())
}

/// Unpack into `dir` with the system tar (bsdtar refuses absolute paths and `..`).
fn unpack(archive: &[u8], dir: &Path) -> CmdResult<()> {
    let file = dir.join("package.tar.gz");
    fs::write(&file, archive)?;
    let out_dir = dir.join("pkg");
    fs::create_dir(&out_dir)?;
    let status = std::process::Command::new("/usr/bin/tar")
        .arg("-xzf")
        .arg(&file)
        .arg("-C")
        .arg(&out_dir)
        .status()?;
    if !status.success() {
        return Err(CmdError::Io("couldn't unpack the template package".into()));
    }
    Ok(())
}

#[tauri::command]
pub async fn project_create_from_package(
    parent: String,
    name: String,
    package: PackageSpec,
    extra: Vec<NewFile>,
) -> CmdResult<CreatedProject> {
    if !valid_spec(&package) {
        return Err(CmdError::Invalid(format!(
            "not a package: {}:{}",
            package.name, package.version
        )));
    }
    let archive = download(&package).await?;
    let tmp: PathBuf = std::env::temp_dir().join(format!(
        "foreword-pkg-{}",
        uuid::Uuid::new_v4().simple()
    ));
    fs::create_dir_all(&tmp)?;
    let result = (|| -> CmdResult<CreatedProject> {
        unpack(&archive, &tmp)?;
        let pkg = tmp.join("pkg");
        let toml = fs::read_to_string(pkg.join("typst.toml"))?;
        let (template_dir, entry) = template_section(&toml).ok_or_else(|| {
            CmdError::Invalid(format!("{} has no [template] section", package.name))
        })?;
        let template = pkg.join(&template_dir);
        if !template.canonicalize()?.starts_with(pkg.canonicalize()?) {
            return Err(CmdError::Invalid(
                "the template folder is outside the package".into(),
            ));
        }
        let mut files = Vec::new();
        collect_files(&template, &template, &mut files)?;
        // Our files (project settings, style guide…) never replace the template's own.
        for f in workspace::new_file_parts(extra) {
            if !files.iter().any(|(p, _)| p == &f.0) {
                files.push(f);
            }
        }
        let root = workspace::create_project_bytes(Path::new(&parent), &name, &files)?;
        Ok(CreatedProject {
            root: root.to_string_lossy().into_owned(),
            entry,
        })
    })();
    let _ = fs::remove_dir_all(&tmp);
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_template_section() {
        let toml = "[package]\nname = \"charged-ieee\"\nentrypoint = \"lib.typ\"\n\n[template]\npath = \"template\"\nentrypoint = \"main.typ\"\nthumbnail = \"thumbnail.png\"\n";
        assert_eq!(
            template_section(toml),
            Some(("template".into(), "main.typ".into()))
        );
        assert_eq!(template_section("[package]\nname = \"x\"\n"), None);
    }

    #[test]
    fn accepts_only_plain_package_specs() {
        let spec = |n: &str, v: &str| PackageSpec {
            name: n.into(),
            version: v.into(),
        };
        assert!(valid_spec(&spec("charged-ieee", "0.1.4")));
        for (n, v) in [
            ("../x", "0.1.0"),
            ("Caps", "0.1.0"),
            ("x", "0.1"),
            ("x", "0.1.0-rc"),
            ("x/y", "1.0.0"),
        ] {
            assert!(!valid_spec(&spec(n, v)), "{n}:{v}");
        }
    }

    #[test]
    fn collects_regular_files_but_not_symlinks() {
        let dir = std::env::temp_dir().join(format!(
            "foreword-collect-{}",
            uuid::Uuid::new_v4().simple()
        ));
        fs::create_dir_all(dir.join("sub")).unwrap();
        fs::write(dir.join("main.typ"), "= Hi").unwrap();
        fs::write(dir.join("sub/fig.png"), [0u8, 1, 2]).unwrap();
        std::os::unix::fs::symlink("/etc/hosts", dir.join("evil")).unwrap();
        let mut files = Vec::new();
        collect_files(&dir, &dir, &mut files).unwrap();
        files.sort();
        assert_eq!(
            files.iter().map(|f| f.0.as_str()).collect::<Vec<_>>(),
            ["main.typ", "sub/fig.png"]
        );
        assert_eq!(files[1].1, vec![0u8, 1, 2]);
        fs::remove_dir_all(&dir).ok();
    }
}
