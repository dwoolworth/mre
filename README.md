# MRE — Markdown Read & Edit

A fast, lightweight desktop app for reading and editing Markdown files. Built because VS Code's Markdown preview is clunky, and sometimes you just need a clean way to read `.md` files and throw in a quick edit.

> **MRE** — like the Meal Ready to Eat. Everything you need, nothing you don't.

---

## Download

:point_right: **[Download the latest release](https://github.com/dwoolworth/mre/releases/latest)** — macOS (Apple Silicon & Intel), Linux, and Windows builds available.

---

## Features

:book: **Beautiful rendering** — GitHub-flavored Markdown with full GFM support (tables, task lists, strikethrough, autolinks, footnotes)

:pencil2: **Inline editing** — Toggle between rendered view and a raw editor, save with `Cmd+S` / `Ctrl+S`

:open_file_folder: **Folder browser** — Open a folder and browse all Markdown files in a sidebar tree with search and favorites

:art: **6 themes** — GitHub, Solarized, One Dark, Dracula, Monokai, Nord — each with light and dark variants

:mag: **Syntax highlighting** — Code blocks highlighted with highlight.js, with optional line numbers

:page_facing_up: **PDF export** — Export any Markdown file to a beautifully typeset PDF via Typst, respecting your font size setting

:gear: **Customizable** — Font size, font family, heading scale, content width, custom colors for headings/text/links/borders

:file_folder: **File associations** — Double-click or right-click `.md` files to open them directly in MRE

:arrows_counterclockwise: **Live reload** — File watcher auto-refreshes the view when the file changes on disk

:drag_and_drop: **Drag & drop** — Drop `.md` files or folders directly onto the window

:zap: **Lightweight** — ~6MB binary, launches instantly, native performance

---

## Why not VS Code?

VS Code is great for writing code, but its Markdown preview is a side panel that fights for screen space, doesn't support GFM fully out of the box, and can't export to PDF without extensions. If you spend time reading Markdown — documentation, READMEs, notes, Claude Code output — MRE gives you a dedicated, distraction-free experience with a single click.

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd/Ctrl + O` | Open file |
| `Cmd/Ctrl + Shift + O` | Open folder |
| `Cmd/Ctrl + S` | Save (in edit mode) |
| `Cmd/Ctrl + Shift + S` | Save As (in edit mode) |
| `Cmd/Ctrl + E` | Export to PDF |
| `Cmd/Ctrl + B` | Toggle sidebar |
| `Cmd/Ctrl + ,` | Preferences |
| `Cmd/Ctrl + =` | Increase font size |
| `Cmd/Ctrl + -` | Decrease font size |
| `Cmd/Ctrl + 0` | Reset font size |
| `Escape` | Exit edit mode / close settings |

---

## Building from Source

### Prerequisites

- [Node.js](https://nodejs.org/) 20+
- [Rust](https://www.rust-lang.org/tools/install) (stable)
- Platform dependencies:
  - **macOS**: Xcode Command Line Tools
  - **Linux**: `libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf`
  - **Windows**: [Microsoft C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)

### Build

```bash
# Install dependencies
npm install

# Development (hot reload)
npm run tauri dev

# Production build
npm run tauri build
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| :desktop_computer: Framework | [Tauri v2](https://v2.tauri.app/) |
| :crab: Backend | Rust — [comrak](https://github.com/kivikakk/comrak) (GFM), [notify](https://github.com/notify-rs/notify) (file watcher), [typst](https://github.com/typst/typst) (PDF) |
| :globe_with_meridians: Frontend | Vanilla JS + [Vite](https://vitejs.dev/) |
| :art: Styling | [github-markdown-css](https://github.com/sindresorhus/github-markdown-css) + [highlight.js](https://highlightjs.org/) |

---

## License

MIT License — see [LICENSE](LICENSE) for details.

Made in U.S.A. :us:
