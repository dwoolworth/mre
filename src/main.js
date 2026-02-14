import "github-markdown-css/github-markdown.css";

const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;
const { getCurrentWebviewWindow } = window.__TAURI__.webviewWindow;

// ===== Lazy-loaded highlight.js =====
let hljs = null;
async function loadHighlightJs() {
  if (hljs) return hljs;
  const mod = await import("highlight.js/lib/common");
  hljs = mod.default;
  return hljs;
}

// ===== State =====
let currentPath = null;
let favorites = JSON.parse(localStorage.getItem("md-favorites") || "[]");
let showFavoritesOnly = false;
let filterText = "";
let editMode = false;

// Settings — now split into colorScheme + themeName
let settings = {
  colorScheme: localStorage.getItem("md-color-scheme") || "dark",
  themeName: localStorage.getItem("md-theme-name") || "github",
  fontSize: parseInt(localStorage.getItem("md-font-size")) || 16,
  fontFamily: localStorage.getItem("md-font-family") || "system",
  headingScale: localStorage.getItem("md-heading-scale") || "normal",
  contentWidth: localStorage.getItem("md-content-width") || "medium",
  lineNumbers: localStorage.getItem("md-line-numbers") === "true",
  sidebarVisible: localStorage.getItem("md-sidebar") !== "false",
  sidebarWidth: parseInt(localStorage.getItem("md-sidebar-width")) || 360,
  // Custom color overrides (null = use theme default)
  headingColor: localStorage.getItem("md-heading-color") || null,
  paragraphColor: localStorage.getItem("md-paragraph-color") || null,
  linkColor: localStorage.getItem("md-link-color") || null,
  lineColor: localStorage.getItem("md-line-color") || null,
};

// Folder tree data
let folderTree = [];

// ===== DOM References =====
let els = {};

// ===== Init =====
window.addEventListener("DOMContentLoaded", async () => {
  els = {
    toolbar: document.getElementById("toolbar"),
    toolbarTitle: document.getElementById("toolbar-title"),
    sidebar: document.getElementById("sidebar"),
    fileTree: document.getElementById("file-tree"),
    filterInput: document.getElementById("filter-input"),
    contentArea: document.getElementById("content-area"),
    content: document.getElementById("content"),
    editor: document.getElementById("editor"),
    emptyState: document.getElementById("empty-state"),
    fontSizeDisplay: document.getElementById("font-size-display"),
    settingsOverlay: document.getElementById("settings-overlay"),
    // New settings elements
    settingThemeName: document.getElementById("setting-theme-name"),
    settingFontSlider: document.getElementById("setting-font-slider"),
    settingFontValue: document.getElementById("setting-font-value"),
    settingFontFamily: document.getElementById("setting-font-family"),
    settingContentWidth: document.getElementById("setting-content-width"),
    settingLineNumbers: document.getElementById("setting-line-numbers"),
    // Color pickers
    settingHeadingColor: document.getElementById("setting-heading-color"),
    settingParagraphColor: document.getElementById("setting-paragraph-color"),
    settingLinkColor: document.getElementById("setting-link-color"),
    settingLineColor: document.getElementById("setting-line-color"),
  };

  // Apply all settings
  applyTheme();
  applyFontSize();
  applyFontFamily();
  applyContentWidth();
  applyHeadingScale();
  applyLineNumbers();
  applyColorOverrides();
  applySidebar();

  // Restore settings UI state
  initSegmentedControl("seg-color-scheme", settings.colorScheme, (val) => {
    settings.colorScheme = val;
    localStorage.setItem("md-color-scheme", val);
    applyTheme();
    syncColorPickersToTheme();
  });

  els.settingThemeName.value = settings.themeName;
  els.settingThemeName.addEventListener("change", (e) => {
    settings.themeName = e.target.value;
    localStorage.setItem("md-theme-name", settings.themeName);
    applyTheme();
    syncColorPickersToTheme();
  });

  els.settingFontSlider.value = settings.fontSize;
  els.settingFontSlider.addEventListener("input", (e) => {
    settings.fontSize = parseInt(e.target.value);
    applyFontSize();
  });

  els.settingFontFamily.value = settings.fontFamily;
  els.settingFontFamily.addEventListener("change", (e) => {
    settings.fontFamily = e.target.value;
    localStorage.setItem("md-font-family", settings.fontFamily);
    applyFontFamily();
  });

  initSegmentedControl("seg-heading-scale", settings.headingScale, (val) => {
    settings.headingScale = val;
    localStorage.setItem("md-heading-scale", val);
    applyHeadingScale();
  });

  els.settingContentWidth.value = settings.contentWidth;
  els.settingContentWidth.addEventListener("change", (e) => {
    settings.contentWidth = e.target.value;
    localStorage.setItem("md-content-width", settings.contentWidth);
    applyContentWidth();
  });

  els.settingLineNumbers.checked = settings.lineNumbers;
  els.settingLineNumbers.addEventListener("change", (e) => {
    settings.lineNumbers = e.target.checked;
    localStorage.setItem("md-line-numbers", settings.lineNumbers.toString());
    applyLineNumbers();
  });

  // Color pickers
  setupColorPicker("setting-heading-color", "headingColor", "md-heading-color");
  setupColorPicker("setting-paragraph-color", "paragraphColor", "md-paragraph-color");
  setupColorPicker("setting-link-color", "linkColor", "md-link-color");
  setupColorPicker("setting-line-color", "lineColor", "md-line-color");

  // Reset buttons
  document.querySelectorAll(".reset-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = btn.dataset.target;
      const map = {
        "heading-color": { key: "headingColor", storageKey: "md-heading-color", pickerId: "setting-heading-color" },
        "paragraph-color": { key: "paragraphColor", storageKey: "md-paragraph-color", pickerId: "setting-paragraph-color" },
        "link-color": { key: "linkColor", storageKey: "md-link-color", pickerId: "setting-link-color" },
        "line-color": { key: "lineColor", storageKey: "md-line-color", pickerId: "setting-line-color" },
      };
      const info = map[target];
      if (info) {
        settings[info.key] = null;
        localStorage.removeItem(info.storageKey);
        applyColorOverrides();
        syncColorPickersToTheme();
      }
    });
  });

  // Sync color pickers to current theme defaults
  syncColorPickersToTheme();

  // ===== Toolbar buttons =====
  els.btnEdit = document.getElementById("btn-edit");
  els.btnSave = document.getElementById("btn-save");
  els.btnExportPdf = document.getElementById("btn-export-pdf");
  document.getElementById("btn-toggle-sidebar").addEventListener("click", toggleSidebar);
  els.btnEdit.addEventListener("click", enterEditMode);
  els.btnSave.addEventListener("click", saveFile);
  els.btnExportPdf.addEventListener("click", exportPdf);
  document.getElementById("btn-font-down").addEventListener("click", () => changeFontSize(-1));
  document.getElementById("btn-font-up").addEventListener("click", () => changeFontSize(1));
  document.getElementById("btn-settings").addEventListener("click", openSettings);

  // ===== Sidebar buttons =====
  document.getElementById("btn-open-folder").addEventListener("click", openFolderDialog);
  document.getElementById("btn-open-file").addEventListener("click", openFileDialog);
  document.getElementById("btn-favorites-filter").addEventListener("click", toggleFavoritesFilter);

  // ===== Filter input =====
  els.filterInput.addEventListener("input", (e) => {
    filterText = e.target.value.toLowerCase();
    renderFileTree();
  });

  // ===== Settings modal =====
  document.getElementById("btn-close-settings").addEventListener("click", closeSettings);
  els.settingsOverlay.addEventListener("click", (e) => {
    if (e.target === els.settingsOverlay) closeSettings();
  });

  // ===== Keyboard shortcuts =====
  document.addEventListener("keydown", (e) => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && (e.key === "=" || e.key === "+")) {
      e.preventDefault();
      changeFontSize(1);
    } else if (mod && e.key === "-") {
      e.preventDefault();
      changeFontSize(-1);
    } else if (mod && e.key === "0") {
      e.preventDefault();
      settings.fontSize = 16;
      applyFontSize();
    } else if (mod && e.key === "b") {
      e.preventDefault();
      toggleSidebar();
    } else if (e.key === "Escape") {
      if (editMode) {
        exitEditMode();
      } else {
        closeSettings();
      }
    }
  });

  // ===== Drag and drop =====
  const appWindow = getCurrentWebviewWindow();
  appWindow.onDragDropEvent((event) => {
    if (event.payload.type === "drop") {
      const paths = event.payload.paths;
      if (paths && paths.length > 0) {
        const p = paths[0];
        if (/\.(md|markdown|mdown|mkd|mkdn|mdx)$/i.test(p)) {
          openFile(p);
        } else {
          openFolder(p);
        }
      }
    }
  });

  // ===== Resize handle =====
  setupResizeHandle();

  // ===== Tauri events =====
  await listen("file-changed", async () => {
    if (currentPath && !editMode) {
      const scrollTop = els.contentArea.scrollTop;
      await openFile(currentPath);
      requestAnimationFrame(() => {
        els.contentArea.scrollTop = scrollTop;
      });
    }
  });

  await listen("open-file", async (event) => {
    if (event.payload) {
      await openFile(event.payload);
    }
  });

  // ===== Menu events =====
  await listen("menu-open-file", () => openFileDialog());
  await listen("menu-open-folder", () => openFolderDialog());
  await listen("menu-export-pdf", () => exportPdf());
  await listen("menu-preferences", () => openSettings());
  await listen("menu-edit-document", () => {
    if (currentPath && !editMode) enterEditMode();
  });
  await listen("menu-save", () => {
    if (editMode) saveFile();
  });
  await listen("menu-save-as", () => {
    if (editMode) saveFileAs();
  });

  // Check for initial file
  try {
    const initialPath = await invoke("get_initial_file");
    if (initialPath) {
      await openFile(initialPath);
    }
  } catch (e) {
    console.error("Failed to get initial file:", e);
  }
});

// ===== Segmented Control Helper =====
function initSegmentedControl(containerId, activeValue, onChange) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const buttons = container.querySelectorAll(".seg-btn");

  // Set initial active state
  buttons.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.value === activeValue);
  });

  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      buttons.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      onChange(btn.dataset.value);
    });
  });
}

// ===== Color Picker Helper =====
function setupColorPicker(pickerId, settingsKey, storageKey) {
  const picker = document.getElementById(pickerId);
  if (!picker) return;
  picker.addEventListener("input", (e) => {
    settings[settingsKey] = e.target.value;
    localStorage.setItem(storageKey, e.target.value);
    applyColorOverrides();
  });
}

// ===== Sync color pickers to show current effective colors =====
function syncColorPickersToTheme() {
  // We need to read the computed CSS variable values from the current theme
  // Temporarily ensure theme is applied, then read computed styles
  const cs = getComputedStyle(document.body);

  const headingDefault = cs.getPropertyValue("--heading-color").trim();
  const textDefault = cs.getPropertyValue("--text-primary").trim();
  const linkDefault = cs.getPropertyValue("--link-color").trim();
  const borderDefault = cs.getPropertyValue("--border-color").trim();

  if (els.settingHeadingColor) {
    els.settingHeadingColor.value = settings.headingColor || toHex(headingDefault);
  }
  if (els.settingParagraphColor) {
    els.settingParagraphColor.value = settings.paragraphColor || toHex(textDefault);
  }
  if (els.settingLinkColor) {
    els.settingLinkColor.value = settings.linkColor || toHex(linkDefault);
  }
  if (els.settingLineColor) {
    els.settingLineColor.value = settings.lineColor || toHex(borderDefault);
  }
}

// Convert CSS color string to hex for color picker
function toHex(color) {
  if (!color || color === "") return "#000000";
  if (color.startsWith("#")) {
    // Ensure 6 digits
    if (color.length === 4) {
      return "#" + color[1] + color[1] + color[2] + color[2] + color[3] + color[3];
    }
    return color;
  }
  // For rgb/rgba values, use a temp element
  const temp = document.createElement("div");
  temp.style.color = color;
  document.body.appendChild(temp);
  const computed = getComputedStyle(temp).color;
  document.body.removeChild(temp);
  const match = computed.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
  if (match) {
    const r = parseInt(match[1]).toString(16).padStart(2, "0");
    const g = parseInt(match[2]).toString(16).padStart(2, "0");
    const b = parseInt(match[3]).toString(16).padStart(2, "0");
    return `#${r}${g}${b}`;
  }
  return "#000000";
}

// ===== File Operations =====
async function openFile(path) {
  try {
    if (editMode) exitEditMode();

    const result = await invoke("open_and_render", { path });
    currentPath = result.filePath;

    els.toolbarTitle.textContent = result.fileName;
    document.title = `MRE - ${result.fileName}`;
    els.content.innerHTML = result.html;
    els.content.style.display = "block";
    els.emptyState.style.display = "none";
    els.btnExportPdf.style.display = "";
    els.btnEdit.style.display = "";

    // Mark active in sidebar
    document.querySelectorAll(".tree-item.active").forEach((el) => el.classList.remove("active"));
    const activeItem = document.querySelector(`.tree-item[data-path="${CSS.escape(result.filePath)}"]`);
    if (activeItem) activeItem.classList.add("active");

    // External links
    els.content.querySelectorAll("a[href]").forEach((a) => {
      const href = a.getAttribute("href");
      if (href && (href.startsWith("http://") || href.startsWith("https://"))) {
        a.setAttribute("target", "_blank");
        a.setAttribute("rel", "noopener noreferrer");
      }
    });

    await highlightCodeBlocks();
  } catch (err) {
    els.content.innerHTML = `<div class="error-message">Failed to open file: ${escapeHtml(String(err))}</div>`;
    els.content.style.display = "block";
    els.emptyState.style.display = "none";
  }
}

async function openFolder(path) {
  try {
    folderTree = await invoke("scan_folder", { path });
    renderFileTree();
  } catch (err) {
    console.error("Failed to scan folder:", err);
  }
}

// ===== Dialogs =====
async function openFileDialog() {
  try {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const selected = await open({
      multiple: false,
      filters: [
        { name: "Markdown", extensions: ["md", "markdown", "mdown", "mkd", "mkdn", "mdx"] },
      ],
    });
    if (selected) {
      const path = typeof selected === "string" ? selected : selected.path;
      if (path) await openFile(path);
    }
  } catch (e) {
    console.error("Failed to open file dialog:", e);
  }
}

async function openFolderDialog() {
  try {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const selected = await open({
      directory: true,
      multiple: false,
    });
    if (selected) {
      const path = typeof selected === "string" ? selected : selected.path;
      if (path) await openFolder(path);
    }
  } catch (e) {
    console.error("Failed to open folder dialog:", e);
  }
}

// ===== File Tree Rendering =====
function renderFileTree() {
  els.fileTree.innerHTML = "";
  if (folderTree.length === 0) return;
  const fragment = document.createDocumentFragment();
  renderEntries(folderTree, fragment, 0);
  els.fileTree.appendChild(fragment);
}

function renderEntries(entries, container, depth) {
  for (const entry of entries) {
    if (filterText) {
      if (!entryMatchesFilter(entry, filterText)) continue;
    }
    if (showFavoritesOnly && !entry.isDir) {
      if (!favorites.includes(entry.path)) continue;
    }
    if (showFavoritesOnly && entry.isDir) {
      if (!entryHasFavorites(entry)) continue;
    }

    if (entry.isDir) {
      renderDirEntry(entry, container, depth);
    } else {
      renderFileEntry(entry, container, depth);
    }
  }
}

function renderDirEntry(entry, container, depth) {
  const item = document.createElement("div");
  item.className = "tree-item dir";
  item.dataset.path = entry.path;
  item.dataset.depth = depth;

  const chevron = document.createElement("span");
  chevron.className = "tree-chevron";
  chevron.innerHTML = `<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M6.22 3.22a.75.75 0 011.06 0l4.25 4.25a.75.75 0 010 1.06l-4.25 4.25a.751.751 0 01-1.042-.018.751.751 0 01-.018-1.042L9.94 8 6.22 4.28a.75.75 0 010-1.06z"/></svg>`;

  const icon = document.createElement("span");
  icon.className = "tree-icon folder";
  icon.innerHTML = `<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M1.75 1A1.75 1.75 0 000 2.75v10.5C0 14.216.784 15 1.75 15h12.5A1.75 1.75 0 0016 13.25v-8.5A1.75 1.75 0 0014.25 3H7.5a.25.25 0 01-.2-.1l-.9-1.2C6.07 1.26 5.55 1 5 1H1.75z"/></svg>`;

  const name = document.createElement("span");
  name.className = "tree-name";
  name.textContent = entry.name;

  const badge = document.createElement("span");
  badge.className = "tree-badge";
  badge.textContent = entry.mdCount;

  item.appendChild(chevron);
  item.appendChild(icon);
  item.appendChild(name);
  item.appendChild(badge);
  container.appendChild(item);

  const childContainer = document.createElement("div");
  childContainer.className = "tree-children";
  container.appendChild(childContainer);

  if (entry.children) {
    renderEntries(entry.children, childContainer, depth + 1);
  }

  if (filterText || showFavoritesOnly) {
    chevron.classList.add("expanded");
    childContainer.classList.add("expanded");
  }

  item.addEventListener("click", () => {
    chevron.classList.toggle("expanded");
    childContainer.classList.toggle("expanded");
  });
}

function renderFileEntry(entry, container, depth) {
  const item = document.createElement("div");
  item.className = "tree-item file";
  item.dataset.path = entry.path;
  item.dataset.depth = depth;

  if (entry.path === currentPath) {
    item.classList.add("active");
  }

  const spacer = document.createElement("span");
  spacer.style.width = "16px";
  spacer.style.flexShrink = "0";

  const icon = document.createElement("span");
  icon.className = "tree-icon file";
  icon.innerHTML = `<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M2 1.75C2 .784 2.784 0 3.75 0h6.586c.464 0 .909.184 1.237.513l2.914 2.914c.329.328.513.773.513 1.237v9.586A1.75 1.75 0 0113.25 16h-9.5A1.75 1.75 0 012 14.25V1.75z"/></svg>`;

  const name = document.createElement("span");
  name.className = "tree-name";
  name.textContent = entry.name;

  const star = document.createElement("span");
  star.className = "tree-star" + (favorites.includes(entry.path) ? " favorited" : "");
  star.innerHTML = `<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M8 .25a.75.75 0 01.673.418l1.882 3.815 4.21.612a.75.75 0 01.416 1.279l-3.046 2.97.719 4.192a.751.751 0 01-1.088.791L8 12.347l-3.766 1.98a.75.75 0 01-1.088-.79l.72-4.194L.818 6.374a.75.75 0 01.416-1.28l4.21-.611L7.327.668A.75.75 0 018 .25z"/></svg>`;

  star.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleFavorite(entry.path);
    star.classList.toggle("favorited");
  });

  item.appendChild(spacer);
  item.appendChild(icon);
  item.appendChild(name);
  item.appendChild(star);
  container.appendChild(item);

  item.addEventListener("click", () => openFile(entry.path));
}

function entryMatchesFilter(entry, text) {
  if (entry.name.toLowerCase().includes(text)) return true;
  if (entry.isDir && entry.children) {
    return entry.children.some((child) => entryMatchesFilter(child, text));
  }
  return false;
}

function entryHasFavorites(entry) {
  if (!entry.isDir) return favorites.includes(entry.path);
  if (entry.children) {
    return entry.children.some((child) => entryHasFavorites(child));
  }
  return false;
}

// ===== Favorites =====
function toggleFavorite(path) {
  const idx = favorites.indexOf(path);
  if (idx >= 0) favorites.splice(idx, 1);
  else favorites.push(path);
  localStorage.setItem("md-favorites", JSON.stringify(favorites));
}

function toggleFavoritesFilter() {
  showFavoritesOnly = !showFavoritesOnly;
  document.getElementById("btn-favorites-filter").classList.toggle("active", showFavoritesOnly);
  renderFileTree();
}

// ===== Edit Mode =====
async function enterEditMode() {
  if (!currentPath || editMode) return;
  try {
    const raw = await invoke("read_file_content", { path: currentPath });
    els.editor.value = raw;
    els.content.style.display = "none";
    els.editor.style.display = "block";
    els.btnEdit.style.display = "none";
    els.btnSave.style.display = "";
    els.btnExportPdf.style.display = "none";
    editMode = true;
    els.editor.focus();
  } catch (err) {
    console.error("Failed to read file for editing:", err);
  }
}

function exitEditMode() {
  els.editor.style.display = "none";
  els.content.style.display = "block";
  els.btnSave.style.display = "none";
  els.btnEdit.style.display = "";
  els.btnExportPdf.style.display = "";
  editMode = false;
}

async function saveFile() {
  if (!currentPath || !editMode) return;
  try {
    await invoke("save_file", { path: currentPath, content: els.editor.value });
    exitEditMode();
    await openFile(currentPath);
  } catch (err) {
    console.error("Failed to save file:", err);
    alert("Save failed: " + err);
  }
}

async function saveFileAs() {
  if (!editMode) return;
  try {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const defaultName = currentPath ? currentPath.split(/[/\\]/).pop() : "untitled.md";
    const outputPath = await save({
      defaultPath: defaultName,
      filters: [{ name: "Markdown", extensions: ["md", "markdown", "mdown", "mkd", "mkdn", "mdx"] }],
    });
    if (!outputPath) return;
    await invoke("save_file", { path: outputPath, content: els.editor.value });
    currentPath = outputPath;
    exitEditMode();
    await openFile(currentPath);
  } catch (err) {
    console.error("Failed to save file:", err);
    alert("Save As failed: " + err);
  }
}

// ===== Export PDF =====
async function exportPdf() {
  if (!currentPath) return;
  try {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const defaultName = currentPath.replace(/\.[^.]+$/, ".pdf").split(/[/\\]/).pop();
    const outputPath = await save({
      defaultPath: defaultName,
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });
    if (!outputPath) return;

    const prevTitle = els.toolbarTitle.textContent;
    els.toolbarTitle.textContent = "Exporting PDF...";
    try {
      await invoke("export_pdf", { sourcePath: currentPath, outputPath, fontSize: settings.fontSize });
      els.toolbarTitle.textContent = prevTitle;
      await invoke("open_path", { path: outputPath });
    } catch (err) {
      els.toolbarTitle.textContent = prevTitle;
      console.error("PDF export failed:", err);
      alert("PDF export failed: " + err);
    }
  } catch (e) {
    console.error("Failed to open save dialog:", e);
  }
}

// ===== Code Highlighting =====
async function highlightCodeBlocks() {
  const codeBlocks = els.content.querySelectorAll("pre code");
  if (codeBlocks.length === 0) return;

  try {
    const hl = await loadHighlightJs();
    if (codeBlocks.length > 20) {
      const observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              hl.highlightElement(entry.target);
              if (settings.lineNumbers) addLineNumbers(entry.target);
              observer.unobserve(entry.target);
            }
          });
        },
        { root: els.contentArea, rootMargin: "200px" }
      );
      codeBlocks.forEach((block) => observer.observe(block));
    } else {
      codeBlocks.forEach((block) => {
        hl.highlightElement(block);
        if (settings.lineNumbers) addLineNumbers(block);
      });
    }
  } catch (e) {
    console.error("Failed to load highlight.js:", e);
  }
}

function addLineNumbers(codeEl) {
  // Wrap each line in a span with a line number
  const lines = codeEl.innerHTML.split("\n");
  if (lines[lines.length - 1] === "") lines.pop(); // remove trailing empty line
  codeEl.innerHTML = lines
    .map((line, i) => `<span class="code-line"><span class="line-number">${i + 1}</span>${line}</span>`)
    .join("\n");
}

// ===== Theme =====
function applyTheme() {
  let scheme = settings.colorScheme;
  if (scheme === "system") {
    scheme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  const dataTheme = `${settings.themeName}-${scheme}`;
  document.body.setAttribute("data-theme", dataTheme);
}

// Listen for system theme changes
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  if (settings.colorScheme === "system") {
    applyTheme();
    syncColorPickersToTheme();
  }
});

// ===== Font Size =====
function changeFontSize(delta) {
  settings.fontSize = Math.min(28, Math.max(6, settings.fontSize + delta));
  applyFontSize();
}

function applyFontSize() {
  localStorage.setItem("md-font-size", settings.fontSize.toString());
  if (els.content) els.content.style.fontSize = `${settings.fontSize}px`;
  if (els.fontSizeDisplay) els.fontSizeDisplay.textContent = settings.fontSize;
  if (els.settingFontValue) els.settingFontValue.textContent = `${settings.fontSize} pt`;
  if (els.settingFontSlider) els.settingFontSlider.value = settings.fontSize;
}

// ===== Font Family =====
function applyFontFamily() {
  if (!els.content) return;
  els.content.classList.remove("font-system", "font-serif", "font-mono");
  els.content.classList.add(`font-${settings.fontFamily}`);
}

// ===== Content Width =====
function applyContentWidth() {
  if (!els.content) return;
  els.content.classList.remove("width-narrow", "width-medium", "width-wide", "width-full");
  els.content.classList.add(`width-${settings.contentWidth}`);
}

// ===== Heading Scale =====
function applyHeadingScale() {
  if (!els.content) return;
  els.content.classList.remove("heading-compact", "heading-normal", "heading-spacious");
  els.content.classList.add(`heading-${settings.headingScale}`);
}

// ===== Line Numbers =====
function applyLineNumbers() {
  if (!els.content) return;
  els.content.classList.toggle("show-line-numbers", settings.lineNumbers);
}

// ===== Color Overrides =====
function applyColorOverrides() {
  const el = document.body;
  if (settings.headingColor) {
    el.style.setProperty("--heading-color", settings.headingColor);
  } else {
    el.style.removeProperty("--heading-color");
  }
  if (settings.paragraphColor) {
    el.style.setProperty("--text-primary", settings.paragraphColor);
  } else {
    el.style.removeProperty("--text-primary");
  }
  if (settings.linkColor) {
    el.style.setProperty("--link-color", settings.linkColor);
  } else {
    el.style.removeProperty("--link-color");
  }
  if (settings.lineColor) {
    el.style.setProperty("--border-color", settings.lineColor);
  } else {
    el.style.removeProperty("--border-color");
  }
}

// ===== Sidebar =====
function toggleSidebar() {
  settings.sidebarVisible = !settings.sidebarVisible;
  localStorage.setItem("md-sidebar", settings.sidebarVisible.toString());
  applySidebar();
}

function applySidebar() {
  if (els.sidebar) {
    els.sidebar.classList.toggle("hidden", !settings.sidebarVisible);
    if (settings.sidebarVisible) {
      els.sidebar.style.width = `${settings.sidebarWidth}px`;
    } else {
      els.sidebar.style.width = "";
    }
  }
  const resizeHandle = document.getElementById("resize-handle");
  if (resizeHandle) {
    resizeHandle.style.display = settings.sidebarVisible ? "" : "none";
  }
}

// ===== Resize Handle =====
function setupResizeHandle() {
  const handle = document.getElementById("resize-handle");
  if (!handle) return;

  let startX, startWidth;

  handle.addEventListener("mousedown", (e) => {
    e.preventDefault();
    startX = e.clientX;
    startWidth = els.sidebar.offsetWidth;
    handle.classList.add("active");
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  });

  function onMouseMove(e) {
    const diff = e.clientX - startX;
    const newWidth = Math.min(600, Math.max(200, startWidth + diff));
    els.sidebar.style.width = `${newWidth}px`;
    settings.sidebarWidth = newWidth;
  }

  function onMouseUp() {
    handle.classList.remove("active");
    localStorage.setItem("md-sidebar-width", settings.sidebarWidth.toString());
    document.removeEventListener("mousemove", onMouseMove);
    document.removeEventListener("mouseup", onMouseUp);
  }
}

// ===== Settings Modal =====
function openSettings() {
  els.settingsOverlay.style.display = "flex";
  // Sync UI with current state
  syncColorPickersToTheme();
}

function closeSettings() {
  if (els.settingsOverlay.style.display !== "none") {
    els.settingsOverlay.style.display = "none";
  }
}

// ===== Helpers =====
function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}
