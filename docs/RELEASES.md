# MRE Release History

## v0.1.7

**Text-to-Speech: Read Aloud**

### Read Aloud
- Read any markdown document aloud with Cmd+T or the toolbar speaker button
- Three TTS providers: OpenAI, Google Cloud, and ElevenLabs
- Markdown-aware text extraction: headings, paragraphs, lists, links (reads link text, skips URLs), block quotes, tables — all read naturally
- Code blocks optionally read or replaced with "Code block." (configurable)
- Chunked streaming: first chunk plays immediately, remaining chunks generate in background
- Player bar with play/pause, progress scrubbing, chunk counter, and stop button
- Cancellable generation — stop mid-document and audio generation halts server-side

### TTS Settings
- Provider selection with voice picker (auto-loads available voices per provider)
- Speed control slider (0.5x to 2.0x)
- Read Code Blocks toggle
- Per-provider API key management with save/remove and green dot status indicators
- Keys persisted securely in app data directory

### Dependencies
- Added `base64` for audio data encoding/decoding
- CSP updated to allow `blob:` media sources for audio playback

---

## v0.1.6

**Git Integration, Editor Line Numbers, and Settings Enhancements**

### Git Awareness & File History
- Branch name and file status (modified, staged, untracked) shown in toolbar
- Browse full commit history for any file with rendered markdown preview
- Clickable commit hashes link to the commit on GitHub, GitLab, or other hosts
- History panel persists when switching between files

### Visual Diff
- Compare any two commits, or a commit against the working copy
- Split and unified diff views with synced scrolling
- Diff stats badge showing additions and deletions

### Commit, Push, and Pull
- Commit changes directly from MRE with an inline message popover
- Push and pull with automatic SSH-to-HTTPS URL conversion for token auth
- GitHub Personal Access Token authentication via Settings, persisted across sessions

### Editor Improvements
- Line numbers with scroll-synced gutter in edit mode

### Settings
- Background Color and Label Color pickers
- Reset All to Defaults button for color overrides
- GitHub sign-in section for managing authentication

### Dependencies
- Added `git2` (vendored OpenSSL) for portable git operations
- Added `similar` for line-level text diffing
- Added `reqwest` (rustls-tls) for GitHub API verification

---

## v0.1.5

**Fix Emoji Shortcodes in PDF Export**

- Emoji shortcodes (`:smile:`, `:rocket:`, etc.) now render correctly in PDF exports
- Added ShortCode node handler in the Typst conversion path
- System emoji fonts (Apple Color Emoji) handle rendering in PDF output

---

## v0.1.4

**Fix macOS DMG Build**

- Fixed a bundler panic caused by empty `ext[]` in folder file associations
- Moved macOS folder registration (`public.folder`) to a custom Info.plist
- Markdown file associations remain in tauri.conf.json for cross-platform support

---

## v0.1.3

**Folder Context Menu & Emoji Shortcodes**

- Right-click folders in macOS Finder to open them in MRE
- NSIS installer hooks for Windows folder right-click "Open with MRE"
- GitHub-style emoji shortcodes enabled in markdown rendering

---

## v0.1.2

**New Icon, macOS Signing, README Fixes**

- New MRE icon with all platform variants (macOS, Windows, iOS, Android)
- Apple code signing and notarization added to CI release workflow
- Fixed hardcoded download links in README

---

## v0.1.1

**macOS File Association Fix**

- Fixed double-clicking a `.md` file in Finder to cold-start the app
- Added full README with features, download links, and build instructions

---

## v0.1.0

**Initial Release**

- GitHub Flavored Markdown rendering via comrak
- Inline editing with save
- Folder browser with file tree, favorites, and search filter
- 6 themes (GitHub, Solarized, One Dark, Dracula, Monokai, Nord) with light/dark variants
- Syntax highlighting via highlight.js
- PDF export via Typst
- Customizable font size, font family, heading scale, and content width
- macOS file associations for `.md` files
- Live reload on file changes
- Drag and drop support
- Cross-platform build support (macOS, Windows, Linux)
