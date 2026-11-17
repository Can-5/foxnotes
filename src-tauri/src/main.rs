use serde::Serialize;
use std::fs;
use std::path::{Component, Path, PathBuf};

#[derive(Serialize)]
struct ListEntry {
    path: String,
    mtime: u64,
    size: u64,
}

fn vault_root() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "Ev dizini bulunamadı".to_string())?;
    let root = home.join("FoxNotes");
    fs::create_dir_all(&root).map_err(|e| format!("Kasa oluşturulamadı: {e}"))?;
    Ok(root)
}

/// Yalnızca normal bileşenli, `.md` uzantılı göreli yolları kabul eder.
fn safe_join(root: &Path, rel: &str) -> Result<PathBuf, String> {
    let rel_path = Path::new(rel);
    if rel_path.is_absolute() {
        return Err("Mutlak yol geçersiz".to_string());
    }
    let mut cleaned = PathBuf::new();
    for comp in rel_path.components() {
        match comp {
            Component::Normal(c) => cleaned.push(c),
            Component::CurDir => {}
            _ => return Err("Geçersiz yol bileşeni".to_string()),
        }
    }
    if cleaned.as_os_str().is_empty() {
        return Err("Boş yol".to_string());
    }
    let is_md = cleaned
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("md"))
        .unwrap_or(false);
    if !is_md {
        return Err("Yalnızca .md dosyalarına izin verilir".to_string());
    }
    Ok(root.join(cleaned))
}

#[tauri::command]
fn vault_path() -> Result<String, String> {
    Ok(vault_root()?.to_string_lossy().into_owned())
}

#[tauri::command]
fn vault_list() -> Result<Vec<ListEntry>, String> {
    const MAX_FILES: usize = 2000;
    const MAX_DEPTH: usize = 12;
    let root = vault_root()?;
    let mut out: Vec<ListEntry> = Vec::new();

    fn walk(dir: &Path, rel: &str, depth: usize, out: &mut Vec<ListEntry>) {
        if depth > MAX_DEPTH || out.len() >= MAX_FILES {
            return;
        }
        let entries = match fs::read_dir(dir) {
            Ok(e) => e,
            Err(_) => return,
        };
        for entry in entries.flatten() {
            if out.len() >= MAX_FILES {
                return;
            }
            let name = entry.file_name().to_string_lossy().into_owned();
            if name.starts_with('.') {
                continue; // gizli dosya/klasörleri atla
            }
            let path = entry.path();
            let rel_child = if rel.is_empty() { name.clone() } else { format!("{rel}/{name}") };
            if path.is_dir() {
                walk(&path, &rel_child, depth + 1, out);
            } else if path
                .extension()
                .and_then(|e| e.to_str())
                .map(|e| e.eq_ignore_ascii_case("md"))
                .unwrap_or(false)
            {
                let meta = match entry.metadata() {
                    Ok(m) => m,
                    Err(_) => continue,
                };
                let mtime = meta
                    .modified()
                    .ok()
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_secs())
                    .unwrap_or(0);
                out.push(ListEntry { path: rel_child, mtime, size: meta.len() });
            }
        }
    }

    walk(&root, "", 0, &mut out);
    out.sort_by(|a, b| b.mtime.cmp(&a.mtime));
    Ok(out)
}

#[tauri::command]
fn vault_read(rel: String) -> Result<String, String> {
    let root = vault_root()?;
    let path = safe_join(&root, &rel)?;
    fs::read_to_string(&path).map_err(|e| format!("Okunamadı ({rel}): {e}"))
}

#[tauri::command]
fn vault_write(rel: String, content: String) -> Result<(), String> {
    let root = vault_root()?;
    let path = safe_join(&root, &rel)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Klasör oluşturulamadı: {e}"))?;
    }
    fs::write(&path, content).map_err(|e| format!("Yazılamadı ({rel}): {e}"))
}

#[tauri::command]
fn vault_delete(rel: String) -> Result<(), String> {
    let root = vault_root()?;
    let path = safe_join(&root, &rel)?;
    fs::remove_file(&path).map_err(|e| format!("Silinemedi ({rel}): {e}"))
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            vault_path,
            vault_list,
            vault_read,
            vault_write,
            vault_delete
        ])
        .run(tauri::generate_context!())
        .expect("Fox Notes çalıştırılamadı");
}
