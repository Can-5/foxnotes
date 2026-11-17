# Fox Notes

**Yerel bilgi kasan — markdown notların, dosyaların olarak kalır.**
Notion/Obsidian tarzı bir bilgi kasası: çevrimdışı, hesapsız, sunucusuz. Notlarınız `~/FoxNotes/` içinde düz `.md` dosyalarıdır; istediğiniz editörle açın, yedekleyin, git ile izleyin.

# Fox Notes

**Your local knowledge vault — markdown notes stay as plain files.**
A Notion/Obsidian-style knowledge vault: offline, no account, no server. Notes live in `~/FoxNotes/` as plain `.md` files — open them with any editor, back them up, version them with git.

---

## Özellikler / Features

- **Dosya tabanlı kasa / File-based vault** — notlarınız `~/FoxNotes/` altında gerçek `.md` dosyaları; alt klasörler desteklenir (`projeler/fikir` → `projeler/fikir.md`)
- **`[[Wiki Bağlantılar]]`** — çift yönlü bağlantılar; her nota bağlananları ("BU NOTA BAĞLANANLAR") gösterir; olmayan bağlantıya tıklayınca oluşturma onayı sorar
- **`#etiketler` + etiket kenar çubuğu** — etiketleri tıklayarak filtreleyin / tag sidebar filtering
- **Canlı arama** — `/` ile odaklanın; çok kelimeli AND araması (başlık, içerik, etiket) / live token-AND search
- **Graf görünümü** — ⌘/Ctrl ile değil; üstteki **Graf** düğmesiyle canvas tabanlı bağlantı grafiği; düğüme tıklayarak notu açın / canvas graph overlay, click a node to open
- **Otomatik kaydetme** — 600 ms debounce; `Kaydedildi ✓ HH:MM` durumu / autosave with status
- **Sıralama** — ada veya değişiklik zamanına göre / sort by name or mtime
- **Klavye** — `Ctrl/Cmd+S` kaydet, `/` arama, `n` yeni not, `Esc` katmanları kapat / keyboard shortcuts
- **Web modu** — Tauri olmadan tarayıcıda da çalışır; localStorage'da saklanır / runs in a browser too (localStorage fallback)

## Çalıştırma / Run

Masaüstü (Tauri v2, Linux):

```sh
cargo tauri build   # üretir: ~/.../target/release/bundle/{deb,rpm,appimage}/
```

veya hazır ikiliyi çalıştırın / or run the prebuilt binary:

```sh
./src-tauri/target/release/foxnotes
```

Web modu (tarayıcı):

```sh
python3 -m http.server --bind 127.0.0.1 -d web 8792
# http://127.0.0.1:8792/
```

İlk açılışta 3 başlangıç notu oluşturulur ("Fox Notes'e hoş geldin", "Proje fikirleri", "Okuma listesi"). Masaüstü modunda dosyalar `~/FoxNotes/` klasörüne yazılır; web modunda tarayıcının localStorage'ına.

On first launch 3 starter notes are created. Desktop mode writes to `~/FoxNotes/`; web mode uses browser localStorage.

## Derleme gereksinimleri / Build requirements

- Rust + `cargo install tauri-cli --version '^2'` (yalnızca masaüstü)
- Linux sistem bağımlılıkları: `webkit2gtk-4.1`, `libgtk-3`, `libsoup-3` (Debian/Ubuntu: `libwebkit2gtk-4.1-dev libgtk-3-dev libsoup-3.0-dev`; Fedora: `webkit2gtk4.1-devel gtk3-devel libsoup3-devel`)
- Web modu için hiçbir bağımlılık yoktur / web mode needs nothing

## Dürüst sınırlar / Honest limits

- **Backlink'ler dosya adı tabanlıdır** — bir notu yeniden adlandırırsanız `[[Bağlantı]]` hedef adları güncellenmez / backlinks are filename-based, not updated on rename
- **Senkronizasyon yok** — birden çok cihazda kullanmak için `~/FoxNotes` klasörünü kendiniz senkronlayın (Syncthing, git, vb.); çakışma çözümü yoktur / no sync; sync the folder yourself, no conflict resolution
- **Şifreleme yok** — notlar düz metin dosyalarıdır; hassas verileri disk şifrelemesiyle koruyun / notes are plain text; no app-level encryption
- **Eklenti/temalar yok** — tek tema, tek düzen / no plugins or themes
- **Büyük kasalar** — 2000 dosya / 12 klasör derinliği sınırı vardır (Rust tarafı taraması) / vault scan capped at 2000 files, depth 12
