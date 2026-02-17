import "github-markdown-css/github-markdown-light.css";

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
let historyMode = false;
let gitStatus = null;
let diffMode = false; // false = preview, true = diff
let diffStyle = "split"; // "split" or "unified"
let selectedCommitOid = null;
let historyCommits = [];
let authStatus = { authenticated: false, username: null };
let commitPopoverOpen = false;

// TTS state
let ttsSettings = {
  provider: localStorage.getItem("md-tts-provider") || "openai",
  voice: localStorage.getItem("md-tts-voice") || "alloy",
  speed: parseFloat(localStorage.getItem("md-tts-speed")) || 1.0,
  readCodeBlocks: localStorage.getItem("md-tts-read-code") === "true",
};
let ttsPlaying = false;
let ttsPaused = false;
let ttsAudioQueue = [];
let ttsCurrentChunkIndex = 0;
let ttsTotalChunks = 0;
let ttsAudioElement = null;
let ttsKeyStatus = { openai: false, google: false, elevenlabs: false };
let ttsKeyModalProvider = null;

// Settings — now split into colorScheme + themeName
let settings = {
  colorScheme: localStorage.getItem("md-color-scheme") || "dark",
  themeName: localStorage.getItem("md-theme-name") || "github",
  fontSize: parseInt(localStorage.getItem("md-font-size")) || 16,
  fontFamily: localStorage.getItem("md-font-family") || "system",
  headingScale: localStorage.getItem("md-heading-scale") || "normal",
  contentWidth: localStorage.getItem("md-content-width") || "medium",
  sidebarVisible: localStorage.getItem("md-sidebar") !== "false",
  sidebarWidth: parseInt(localStorage.getItem("md-sidebar-width")) || 360,
  // Custom color overrides (null = use theme default)
  headingColor: localStorage.getItem("md-heading-color") || null,
  paragraphColor: localStorage.getItem("md-paragraph-color") || null,
  linkColor: localStorage.getItem("md-link-color") || null,
  lineColor: localStorage.getItem("md-line-color") || null,
  bgColor: localStorage.getItem("md-bg-color") || null,
  labelColor: localStorage.getItem("md-label-color") || null,
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
    editorContainer: document.getElementById("editor-container"),
    editorLineNumbers: document.getElementById("editor-line-numbers"),
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
    // Color pickers
    settingHeadingColor: document.getElementById("setting-heading-color"),
    settingParagraphColor: document.getElementById("setting-paragraph-color"),
    settingLinkColor: document.getElementById("setting-link-color"),
    settingLineColor: document.getElementById("setting-line-color"),
    settingBgColor: document.getElementById("setting-bg-color"),
    settingLabelColor: document.getElementById("setting-label-color"),
    // Git / History
    gitBadge: document.getElementById("git-badge"),
    gitBranchName: document.getElementById("git-branch-name"),
    gitFileStatus: document.getElementById("git-file-status"),
    btnHistory: document.getElementById("btn-history"),
    historyPanel: document.getElementById("history-panel"),
    historyList: document.getElementById("history-list"),
    historyPreview: document.getElementById("history-preview"),
    historyPreviewContent: document.getElementById("history-preview-content"),
    // Diff
    diffToolbar: document.getElementById("diff-toolbar"),
    diffControls: document.getElementById("diff-controls"),
    diffStats: document.getElementById("diff-stats"),
    diffView: document.getElementById("diff-view"),
    diffSplit: document.getElementById("diff-split"),
    diffPaneOld: document.getElementById("diff-pane-old"),
    diffPaneNew: document.getElementById("diff-pane-new"),
    diffUnified: document.getElementById("diff-unified"),
    diffVsWorkingCb: document.getElementById("diff-vs-working-cb"),
    // Commit / Push / Pull / Auth
    btnCommit: document.getElementById("btn-commit"),
    btnPush: document.getElementById("btn-push"),
    btnPull: document.getElementById("btn-pull"),
    commitPopover: document.getElementById("commit-popover"),
    commitMessage: document.getElementById("commit-message"),
    btnConfirmCommit: document.getElementById("btn-confirm-commit"),
    authOverlay: document.getElementById("auth-overlay"),
    authBody: document.getElementById("auth-body"),
    authTokenInput: document.getElementById("auth-token-input"),
    authStatusMsg: document.getElementById("auth-status-msg"),
    authSignedIn: document.getElementById("auth-signed-in"),
    authUsername: document.getElementById("auth-username"),
    gitAuthDot: document.getElementById("git-auth-dot"),
    settingsGithubLabel: document.getElementById("settings-github-label"),
    btnSettingsGithub: document.getElementById("btn-settings-github"),
    // TTS
    btnTts: document.getElementById("btn-tts"),
    ttsPlayer: document.getElementById("tts-player"),
    ttsPlayPause: document.getElementById("tts-play-pause"),
    ttsIconPlay: document.getElementById("tts-icon-play"),
    ttsIconPause: document.getElementById("tts-icon-pause"),
    ttsProgressWrapper: document.getElementById("tts-progress-wrapper"),
    ttsProgressBar: document.getElementById("tts-progress-bar"),
    ttsChunkInfo: document.getElementById("tts-chunk-info"),
    ttsStop: document.getElementById("tts-stop"),
    settingTtsProvider: document.getElementById("setting-tts-provider"),
    settingTtsVoice: document.getElementById("setting-tts-voice"),
    settingTtsSpeed: document.getElementById("setting-tts-speed"),
    settingTtsSpeedValue: document.getElementById("setting-tts-speed-value"),
    settingTtsReadCode: document.getElementById("setting-tts-read-code"),
    ttsKeyOverlay: document.getElementById("tts-key-overlay"),
    ttsKeyTitle: document.getElementById("tts-key-title"),
    ttsKeyInstructions: document.getElementById("tts-key-instructions"),
    ttsKeyInput: document.getElementById("tts-key-input"),
  };

  // Apply all settings
  applyTheme();
  applyFontSize();
  applyFontFamily();
  applyContentWidth();
  applyHeadingScale();
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

  // Color pickers
  setupColorPicker("setting-heading-color", "headingColor", "md-heading-color");
  setupColorPicker("setting-paragraph-color", "paragraphColor", "md-paragraph-color");
  setupColorPicker("setting-link-color", "linkColor", "md-link-color");
  setupColorPicker("setting-line-color", "lineColor", "md-line-color");
  setupColorPicker("setting-bg-color", "bgColor", "md-bg-color");
  setupColorPicker("setting-label-color", "labelColor", "md-label-color");

  // Reset buttons
  document.querySelectorAll(".reset-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = btn.dataset.target;
      const map = {
        "heading-color": { key: "headingColor", storageKey: "md-heading-color", pickerId: "setting-heading-color" },
        "paragraph-color": { key: "paragraphColor", storageKey: "md-paragraph-color", pickerId: "setting-paragraph-color" },
        "link-color": { key: "linkColor", storageKey: "md-link-color", pickerId: "setting-link-color" },
        "line-color": { key: "lineColor", storageKey: "md-line-color", pickerId: "setting-line-color" },
        "bg-color": { key: "bgColor", storageKey: "md-bg-color", pickerId: "setting-bg-color" },
        "label-color": { key: "labelColor", storageKey: "md-label-color", pickerId: "setting-label-color" },
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

  // Reset All to Defaults
  document.getElementById("btn-reset-all-colors").addEventListener("click", () => {
    const keys = ["headingColor", "paragraphColor", "linkColor", "lineColor", "bgColor", "labelColor"];
    const storageKeys = ["md-heading-color", "md-paragraph-color", "md-link-color", "md-line-color", "md-bg-color", "md-label-color"];
    keys.forEach((k, i) => {
      settings[k] = null;
      localStorage.removeItem(storageKeys[i]);
    });
    applyColorOverrides();
    syncColorPickersToTheme();
  });

  // Sync color pickers to current theme defaults
  syncColorPickersToTheme();

  // ===== Toolbar buttons =====
  els.btnEdit = document.getElementById("btn-edit");
  els.btnSave = document.getElementById("btn-save");
  els.btnExportPdf = document.getElementById("btn-export-pdf");
  document.getElementById("btn-toggle-sidebar").addEventListener("click", toggleSidebar);
  els.btnHistory.addEventListener("click", toggleHistory);
  document.getElementById("btn-close-history").addEventListener("click", exitHistory);
  initSegmentedControl("seg-view-mode", "preview", (val) => {
    diffMode = val === "diff";
    updateHistoryView();
  });
  initSegmentedControl("seg-diff-style", "split", (val) => {
    diffStyle = val;
    if (diffMode && selectedCommitOid) renderDiff();
  });
  els.diffVsWorkingCb.addEventListener("change", () => {
    if (diffMode && selectedCommitOid) renderDiff();
  });
  els.btnEdit.addEventListener("click", enterEditMode);
  els.btnSave.addEventListener("click", saveFile);
  els.editor.addEventListener("input", updateEditorLineNumbers);
  els.editor.addEventListener("scroll", () => {
    els.editorLineNumbers.scrollTop = els.editor.scrollTop;
  });
  els.btnExportPdf.addEventListener("click", exportPdf);
  els.btnCommit.addEventListener("click", toggleCommitPopover);
  els.btnPush.addEventListener("click", doPush);
  els.btnPull.addEventListener("click", doPull);
  document.getElementById("btn-close-commit").addEventListener("click", closeCommitPopover);
  els.btnConfirmCommit.addEventListener("click", doCommit);
  els.commitMessage.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && els.commitMessage.value.trim()) doCommit();
  });
  // Auth modal
  document.getElementById("btn-close-auth").addEventListener("click", closeAuthModal);
  els.authOverlay.addEventListener("click", (e) => {
    if (e.target === els.authOverlay) closeAuthModal();
  });
  document.getElementById("btn-create-token").addEventListener("click", () => {
    invoke("open_path", { path: "https://github.com/settings/tokens/new?scopes=repo&description=MRE+Markdown+Editor" });
  });
  document.getElementById("btn-save-token").addEventListener("click", doSaveToken);
  els.authTokenInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") doSaveToken();
  });
  document.getElementById("btn-auth-logout").addEventListener("click", doLogout);
  els.btnSettingsGithub.addEventListener("click", () => {
    closeSettings();
    openAuthModal();
  });
  // Click on auth dot opens auth modal
  els.gitAuthDot.addEventListener("click", (e) => {
    e.stopPropagation();
    openAuthModal();
  });

  // TTS controls
  els.btnTts.addEventListener("click", toggleTts);
  els.ttsPlayPause.addEventListener("click", ttsTogglePlayPause);
  els.ttsStop.addEventListener("click", ttsStopPlayback);
  els.ttsProgressWrapper.addEventListener("click", (e) => {
    if (!ttsAudioElement) return;
    const rect = els.ttsProgressWrapper.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    ttsAudioElement.currentTime = pct * ttsAudioElement.duration;
  });

  // TTS settings
  els.settingTtsProvider.value = ttsSettings.provider;
  els.settingTtsProvider.addEventListener("change", (e) => {
    ttsSettings.provider = e.target.value;
    localStorage.setItem("md-tts-provider", ttsSettings.provider);
    loadTtsVoices();
  });
  els.settingTtsVoice.addEventListener("change", (e) => {
    ttsSettings.voice = e.target.value;
    localStorage.setItem("md-tts-voice", ttsSettings.voice);
  });
  els.settingTtsSpeed.value = ttsSettings.speed;
  els.settingTtsSpeedValue.textContent = `${ttsSettings.speed.toFixed(1)}x`;
  els.settingTtsSpeed.addEventListener("input", (e) => {
    ttsSettings.speed = parseFloat(e.target.value);
    els.settingTtsSpeedValue.textContent = `${ttsSettings.speed.toFixed(1)}x`;
    localStorage.setItem("md-tts-speed", ttsSettings.speed.toString());
  });
  els.settingTtsReadCode.checked = ttsSettings.readCodeBlocks;
  els.settingTtsReadCode.addEventListener("change", (e) => {
    ttsSettings.readCodeBlocks = e.target.checked;
    localStorage.setItem("md-tts-read-code", ttsSettings.readCodeBlocks.toString());
  });

  // TTS key buttons
  document.getElementById("btn-tts-key-openai").addEventListener("click", () => openTtsKeyModal("openai"));
  document.getElementById("btn-tts-key-google").addEventListener("click", () => openTtsKeyModal("google"));
  document.getElementById("btn-tts-key-elevenlabs").addEventListener("click", () => openTtsKeyModal("elevenlabs"));
  document.getElementById("btn-close-tts-key").addEventListener("click", closeTtsKeyModal);
  els.ttsKeyOverlay.addEventListener("click", (e) => {
    if (e.target === els.ttsKeyOverlay) closeTtsKeyModal();
  });
  document.getElementById("btn-tts-key-save").addEventListener("click", saveTtsKey);
  document.getElementById("btn-tts-key-remove").addEventListener("click", removeTtsKey);
  els.ttsKeyInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") saveTtsKey();
  });
  // Close commit popover on outside click
  document.addEventListener("click", (e) => {
    if (commitPopoverOpen && !els.commitPopover.contains(e.target) && !els.btnCommit.contains(e.target)) {
      closeCommitPopover();
    }
  });
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
    } else if (mod && e.key === "t") {
      e.preventDefault();
      toggleTts();
    } else if (mod && e.key === "b") {
      e.preventDefault();
      toggleSidebar();
    } else if (e.key === "Escape") {
      if (commitPopoverOpen) {
        closeCommitPopover();
      } else if (historyMode) {
        exitHistory();
      } else if (editMode) {
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
  await listen("menu-file-history", () => {
    if (currentPath) toggleHistory();
  });
  await listen("menu-read-aloud", () => {
    if (currentPath) toggleTts();
  });

  // TTS events
  await listen("tts-chunk-ready", (event) => {
    const { chunkIndex, totalChunks, audioBase64 } = event.payload;
    ttsAudioQueue[chunkIndex] = audioBase64;
    // If we were waiting for this chunk, play it
    if (ttsPlaying && !ttsPaused && !ttsAudioElement && ttsCurrentChunkIndex === chunkIndex) {
      playTtsChunk(chunkIndex);
    }
  });
  await listen("tts-generation-error", (event) => {
    const prevTitle = els.toolbarTitle.textContent;
    els.toolbarTitle.textContent = "TTS Error: " + (event.payload || "Unknown error");
    setTimeout(() => { els.toolbarTitle.textContent = prevTitle; }, 3000);
  });

  // Load TTS key status and voices on startup
  refreshTtsKeyStatus();
  loadTtsVoices();

  // Check for initial file
  try {
    const initialPath = await invoke("get_initial_file");
    if (initialPath) {
      await openFile(initialPath);
    }
  } catch (e) {
    console.error("Failed to get initial file:", e);
  }

  // Check GitHub auth status on startup
  refreshAuthStatus();
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
  const bgDefault = cs.getPropertyValue("--bg-primary").trim();
  const codeDefault = cs.getPropertyValue("--code-bg").trim();

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
  if (els.settingBgColor) {
    els.settingBgColor.value = settings.bgColor || toHex(bgDefault);
  }
  if (els.settingLabelColor) {
    els.settingLabelColor.value = settings.labelColor || toHex(codeDefault);
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
    const wasInHistory = historyMode;

    const result = await invoke("open_and_render", { path });
    currentPath = result.filePath;

    els.toolbarTitle.textContent = result.fileName;
    document.title = `MRE - ${result.fileName}`;
    els.content.innerHTML = result.html;
    els.emptyState.style.display = "none";

    if (wasInHistory) {
      // Keep history open but hide rendered content behind it
      els.content.style.display = "none";
      els.btnEdit.style.display = "none";
      els.btnExportPdf.style.display = "none";
      els.btnTts.style.display = "none";
    } else {
      els.content.style.display = "block";
      els.btnExportPdf.style.display = "";
      els.btnEdit.style.display = "";
      els.btnTts.style.display = "";
    }

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
    refreshGitStatus(result.filePath);

    // Reload history for the new file if panel is open
    if (wasInHistory) {
      enterHistory();
    }
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
    els.editorContainer.style.display = "flex";
    els.btnEdit.style.display = "none";
    els.btnSave.style.display = "";
    els.btnExportPdf.style.display = "none";
    els.btnTts.style.display = "none";
    editMode = true;
    updateEditorLineNumbers();
    els.editor.focus();
  } catch (err) {
    console.error("Failed to read file for editing:", err);
  }
}

function exitEditMode() {
  els.editorContainer.style.display = "none";
  els.content.style.display = "block";
  els.btnSave.style.display = "none";
  els.btnEdit.style.display = "";
  els.btnExportPdf.style.display = "";
  els.btnTts.style.display = "";
  editMode = false;
}

function updateEditorLineNumbers() {
  const lineCount = els.editor.value.split("\n").length;
  let html = "";
  for (let i = 1; i <= lineCount; i++) {
    html += `<span class="editor-line-num">${i}</span>`;
  }
  els.editorLineNumbers.innerHTML = html;
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
      });
    }
  } catch (e) {
    console.error("Failed to load highlight.js:", e);
  }
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
  if (settings.bgColor) {
    el.style.setProperty("--bg-primary", settings.bgColor);
  } else {
    el.style.removeProperty("--bg-primary");
  }
  if (settings.labelColor) {
    el.style.setProperty("--code-bg", settings.labelColor);
  } else {
    el.style.removeProperty("--code-bg");
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

// ===== Git Status =====
async function refreshGitStatus(path) {
  try {
    gitStatus = await invoke("git_file_status", { path });
    if (gitStatus.isRepo) {
      els.gitBadge.style.display = "";
      els.gitBranchName.textContent = gitStatus.branch || "detached";
      els.gitFileStatus.textContent = gitStatus.fileStatus === "clean" ? "" : gitStatus.fileStatus;
      els.gitFileStatus.className = gitStatus.fileStatus;
      els.btnHistory.style.display = "";
      // Show commit button when file is modified/untracked
      const showCommit = gitStatus.fileStatus === "modified" || gitStatus.fileStatus === "untracked";
      els.btnCommit.style.display = showCommit ? "" : "none";
      // Push/pull visibility depends on remote + auth
      updateAuthUI();
    } else {
      els.gitBadge.style.display = "none";
      els.btnHistory.style.display = "none";
      els.btnCommit.style.display = "none";
      els.btnPush.style.display = "none";
      els.btnPull.style.display = "none";
    }
  } catch (e) {
    els.gitBadge.style.display = "none";
    els.btnHistory.style.display = "none";
    els.btnCommit.style.display = "none";
    els.btnPush.style.display = "none";
    els.btnPull.style.display = "none";
  }
}

// ===== History Panel =====
function toggleHistory() {
  if (historyMode) {
    exitHistory();
  } else {
    enterHistory();
  }
}

async function enterHistory() {
  if (!currentPath || editMode) return;
  historyMode = true;
  diffMode = false;
  selectedCommitOid = null;

  // Reset view mode toggle to preview
  document.querySelectorAll("#seg-view-mode .seg-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.value === "preview");
  });

  // Hide normal content, show history panel
  els.content.style.display = "none";
  els.emptyState.style.display = "none";
  els.historyPanel.style.display = "flex";
  els.btnHistory.classList.add("active");
  els.btnEdit.style.display = "none";
  els.btnExportPdf.style.display = "none";

  updateHistoryView();

  // Load commit list
  els.historyList.innerHTML = '<div style="padding: 16px; color: var(--text-muted); font-size: 13px;">Loading history...</div>';
  els.historyPreviewContent.innerHTML = '';

  try {
    historyCommits = await invoke("git_file_history", { path: currentPath, limit: 100 });
    els.historyList.innerHTML = "";

    if (historyCommits.length === 0) {
      els.historyList.innerHTML = '<div style="padding: 16px; color: var(--text-muted); font-size: 13px;">No commits found for this file.</div>';
      return;
    }

    for (const commit of historyCommits) {
      const item = document.createElement("div");
      item.className = "history-item";
      item.dataset.oid = commit.oid;

      const msg = document.createElement("div");
      msg.className = "history-item-message";
      msg.textContent = commit.message;

      const meta = document.createElement("div");
      meta.className = "history-item-meta";

      const hash = document.createElement("span");
      hash.className = "history-item-hash";
      hash.textContent = commit.oid.substring(0, 7);
      if (gitStatus && gitStatus.remoteUrl) {
        hash.classList.add("linkable");
        hash.title = "Open on web";
        hash.addEventListener("click", (e) => {
          e.stopPropagation();
          invoke("open_path", { path: `${gitStatus.remoteUrl}/commit/${commit.oid}` });
        });
      }

      const author = document.createElement("span");
      author.className = "history-item-author";
      author.textContent = commit.author;

      const date = document.createElement("span");
      date.className = "history-item-date";
      date.textContent = commit.dateRelative;

      meta.appendChild(hash);
      meta.appendChild(author);
      meta.appendChild(date);
      item.appendChild(msg);
      item.appendChild(meta);
      els.historyList.appendChild(item);

      item.addEventListener("click", () => selectHistoryCommit(commit.oid, item));
    }

    // Auto-select the first commit
    const firstItem = els.historyList.querySelector(".history-item");
    if (firstItem) {
      selectHistoryCommit(historyCommits[0].oid, firstItem);
    }
  } catch (err) {
    els.historyList.innerHTML = `<div style="padding: 16px; color: var(--text-muted); font-size: 13px;">Failed to load history: ${escapeHtml(String(err))}</div>`;
  }
}

async function selectHistoryCommit(oid, itemEl) {
  // Update selection UI
  els.historyList.querySelectorAll(".history-item.active").forEach((el) => el.classList.remove("active"));
  itemEl.classList.add("active");
  selectedCommitOid = oid;

  if (diffMode) {
    await renderDiff();
  } else {
    await renderPreview(oid);
  }
}

async function renderPreview(oid) {
  els.historyPreviewContent.innerHTML = '<div style="padding: 32px; color: var(--text-muted); font-size: 13px;">Loading...</div>';

  try {
    const result = await invoke("git_file_at_commit", { path: currentPath, oid });
    els.historyPreviewContent.innerHTML = result.html;
    els.historyPreviewContent.style.fontSize = `${settings.fontSize}px`;

    // Highlight code blocks in the preview
    const codeBlocks = els.historyPreviewContent.querySelectorAll("pre code");
    if (codeBlocks.length > 0) {
      try {
        const hl = await loadHighlightJs();
        codeBlocks.forEach((block) => hl.highlightElement(block));
      } catch (_) {}
    }
  } catch (err) {
    els.historyPreviewContent.innerHTML = `<div class="error-message">${escapeHtml(String(err))}</div>`;
  }
}

function updateHistoryView() {
  els.diffControls.style.display = diffMode ? "flex" : "none";
  els.historyPreview.style.display = diffMode ? "none" : "";
  els.diffView.style.display = diffMode ? "" : "none";
  els.diffStats.style.display = diffMode ? "" : "none";
  if (diffMode && selectedCommitOid) {
    renderDiff();
  }
}

async function renderDiff() {
  if (!selectedCommitOid || !currentPath) return;

  // Find the parent commit (next in list, since list is newest-first)
  const idx = historyCommits.findIndex((c) => c.oid === selectedCommitOid);
  const vsWorking = els.diffVsWorkingCb.checked;

  let oldOid, newOid;
  if (vsWorking) {
    // Selected commit vs working copy
    oldOid = selectedCommitOid;
    newOid = null; // null = working copy
  } else {
    // Parent commit vs selected commit
    oldOid = idx < historyCommits.length - 1 ? historyCommits[idx + 1].oid : null;
    newOid = selectedCommitOid;
  }

  try {
    const result = await invoke("git_diff_file", {
      path: currentPath,
      oldOid: oldOid,
      newOid: newOid,
    });

    // Update stats
    els.diffStats.innerHTML =
      `<span class="diff-stat-add">+${result.additions}</span> <span class="diff-stat-del">-${result.deletions}</span>`;

    if (diffStyle === "split") {
      renderSplitDiff(result.lines);
    } else {
      renderUnifiedDiff(result.lines);
    }
  } catch (err) {
    els.diffPaneOld.innerHTML = `<div class="error-message">${escapeHtml(String(err))}</div>`;
    els.diffPaneNew.innerHTML = "";
    els.diffUnified.innerHTML = `<div class="error-message">${escapeHtml(String(err))}</div>`;
  }
}

function renderSplitDiff(lines) {
  els.diffSplit.style.display = "flex";
  els.diffUnified.style.display = "none";

  let oldHtml = "";
  let newHtml = "";

  for (const line of lines) {
    const content = escapeHtml(line.content.replace(/\n$/, ""));
    const oldNum = line.oldLine != null ? line.oldLine : "";
    const newNum = line.newLine != null ? line.newLine : "";

    if (line.tag === "equal") {
      const row = `<div class="diff-line"><span class="diff-line-num">${oldNum}</span><span class="diff-line-content">${content}</span></div>`;
      oldHtml += row.replace(oldNum, oldNum);
      newHtml += `<div class="diff-line"><span class="diff-line-num">${newNum}</span><span class="diff-line-content">${content}</span></div>`;
    } else if (line.tag === "delete") {
      oldHtml += `<div class="diff-line delete"><span class="diff-line-num">${oldNum}</span><span class="diff-line-content">${content}</span></div>`;
      newHtml += `<div class="diff-line"><span class="diff-line-num"></span><span class="diff-line-content"></span></div>`;
    } else if (line.tag === "insert") {
      oldHtml += `<div class="diff-line"><span class="diff-line-num"></span><span class="diff-line-content"></span></div>`;
      newHtml += `<div class="diff-line insert"><span class="diff-line-num">${newNum}</span><span class="diff-line-content">${content}</span></div>`;
    }
  }

  els.diffPaneOld.innerHTML = oldHtml;
  els.diffPaneNew.innerHTML = newHtml;

  // Synced scrolling
  setupSyncedScroll(els.diffPaneOld, els.diffPaneNew);
}

function renderUnifiedDiff(lines) {
  els.diffSplit.style.display = "none";
  els.diffUnified.style.display = "";

  let html = "";
  for (const line of lines) {
    const content = escapeHtml(line.content.replace(/\n$/, ""));
    const oldNum = line.oldLine != null ? line.oldLine : "";
    const newNum = line.newLine != null ? line.newLine : "";
    let prefix = " ";
    let cls = "";

    if (line.tag === "insert") {
      prefix = "+";
      cls = " insert";
    } else if (line.tag === "delete") {
      prefix = "-";
      cls = " delete";
    }

    html += `<div class="diff-line${cls}"><span class="diff-line-num-old">${oldNum}</span><span class="diff-line-num-new">${newNum}</span><span class="diff-line-content"><span class="diff-line-prefix">${prefix}</span>${content}</span></div>`;
  }

  els.diffUnified.innerHTML = html;
}

function setupSyncedScroll(paneA, paneB) {
  let syncing = false;
  const sync = (source, target) => {
    if (syncing) return;
    syncing = true;
    target.scrollTop = source.scrollTop;
    target.scrollLeft = source.scrollLeft;
    syncing = false;
  };
  // Remove old listeners by cloning
  const newA = paneA.cloneNode(true);
  const newB = paneB.cloneNode(true);
  paneA.parentNode.replaceChild(newA, paneA);
  paneB.parentNode.replaceChild(newB, paneB);
  els.diffPaneOld = newA;
  els.diffPaneNew = newB;
  newA.addEventListener("scroll", () => sync(newA, newB));
  newB.addEventListener("scroll", () => sync(newB, newA));
}

function exitHistory() {
  if (!historyMode) return;
  historyMode = false;
  diffMode = false;
  selectedCommitOid = null;
  historyCommits = [];
  els.historyPanel.style.display = "none";
  els.content.style.display = "block";
  els.btnHistory.classList.remove("active");
  if (currentPath) {
    els.btnEdit.style.display = "";
    els.btnExportPdf.style.display = "";
    els.btnTts.style.display = "";
  }
}

// ===== Commit / Push / Pull =====
function toggleCommitPopover() {
  if (commitPopoverOpen) {
    closeCommitPopover();
  } else {
    openCommitPopover();
  }
}

function openCommitPopover() {
  commitPopoverOpen = true;
  els.commitPopover.style.display = "block";
  els.commitMessage.value = "";
  els.commitMessage.focus();
}

function closeCommitPopover() {
  commitPopoverOpen = false;
  els.commitPopover.style.display = "none";
}

async function doCommit() {
  const message = els.commitMessage.value.trim();
  if (!message || !currentPath) return;

  els.btnConfirmCommit.disabled = true;
  els.btnConfirmCommit.textContent = "Committing...";

  try {
    const commit = await invoke("git_commit", { path: currentPath, message });
    closeCommitPopover();
    // Refresh git status to show "clean"
    refreshGitStatus(currentPath);
    els.toolbarTitle.textContent = `Committed: ${commit.oid.substring(0, 7)}`;
    setTimeout(() => {
      if (currentPath) {
        const name = currentPath.split(/[/\\]/).pop();
        els.toolbarTitle.textContent = name;
      }
    }, 2000);
  } catch (err) {
    alert("Commit failed: " + err);
  } finally {
    els.btnConfirmCommit.disabled = false;
    els.btnConfirmCommit.textContent = "Commit";
  }
}

async function doPush() {
  if (!currentPath) return;
  if (!authStatus.authenticated) {
    openAuthModal();
    return;
  }

  els.btnPush.disabled = true;
  const prevTitle = els.toolbarTitle.textContent;
  els.toolbarTitle.textContent = "Pushing...";

  try {
    await invoke("git_push", { path: currentPath });
    els.toolbarTitle.textContent = "Pushed!";
    setTimeout(() => { els.toolbarTitle.textContent = prevTitle; }, 2000);
  } catch (err) {
    els.toolbarTitle.textContent = prevTitle;
    alert("Push failed: " + err);
  } finally {
    els.btnPush.disabled = false;
  }
}

async function doPull() {
  if (!currentPath) return;
  if (!authStatus.authenticated) {
    openAuthModal();
    return;
  }

  els.btnPull.disabled = true;
  const prevTitle = els.toolbarTitle.textContent;
  els.toolbarTitle.textContent = "Pulling...";

  try {
    const msg = await invoke("git_pull", { path: currentPath });
    els.toolbarTitle.textContent = msg;
    setTimeout(() => { els.toolbarTitle.textContent = prevTitle; }, 2000);
    // Reload file if it changed
    if (msg.includes("Fast-forwarded")) {
      await openFile(currentPath);
    }
  } catch (err) {
    els.toolbarTitle.textContent = prevTitle;
    alert("Pull failed: " + err);
  } finally {
    els.btnPull.disabled = false;
  }
}

// ===== GitHub Auth =====
async function refreshAuthStatus() {
  try {
    authStatus = await invoke("github_auth_status");
    updateAuthUI();
  } catch (e) {
    authStatus = { authenticated: false, username: null };
    updateAuthUI();
  }
}

function updateAuthUI() {
  // Auth dot in git badge
  if (gitStatus && gitStatus.isRepo) {
    els.gitAuthDot.style.display = authStatus.authenticated ? "" : "none";
    els.gitAuthDot.title = authStatus.authenticated
      ? `GitHub: ${authStatus.username || "connected"}`
      : "Not signed in to GitHub";
    // Show push/pull when there's a remote and we have auth
    const hasRemote = gitStatus.remoteUrl != null;
    els.btnPush.style.display = hasRemote ? "" : "none";
    els.btnPull.style.display = hasRemote ? "" : "none";
  }
  // Settings row
  if (authStatus.authenticated) {
    els.settingsGithubLabel.textContent = `Signed in as ${authStatus.username || "GitHub user"}`;
    els.btnSettingsGithub.textContent = "Manage";
  } else {
    els.settingsGithubLabel.textContent = "Not signed in";
    els.btnSettingsGithub.textContent = "Sign In";
  }
}

function openAuthModal() {
  els.authOverlay.style.display = "flex";
  els.authStatusMsg.textContent = "";
  els.authStatusMsg.className = "";

  if (authStatus.authenticated) {
    els.authBody.style.display = "none";
    els.authSignedIn.style.display = "block";
    els.authUsername.textContent = authStatus.username || "Connected";
  } else {
    els.authBody.style.display = "block";
    els.authSignedIn.style.display = "none";
    els.authTokenInput.value = "";
    els.authTokenInput.focus();
  }
}

function closeAuthModal() {
  els.authOverlay.style.display = "none";
}

async function doSaveToken() {
  const token = els.authTokenInput.value.trim();
  if (!token) {
    els.authStatusMsg.textContent = "Please paste a token.";
    els.authStatusMsg.className = "error";
    return;
  }

  const saveBtn = document.getElementById("btn-save-token");
  saveBtn.disabled = true;
  saveBtn.textContent = "Verifying...";
  els.authStatusMsg.textContent = "";
  els.authStatusMsg.className = "";

  try {
    const result = await invoke("github_auth_save_token", { token });
    authStatus = result;
    updateAuthUI();
    // Switch to signed-in view
    els.authBody.style.display = "none";
    els.authSignedIn.style.display = "block";
    els.authUsername.textContent = authStatus.username || "Connected";
  } catch (err) {
    els.authStatusMsg.textContent = err;
    els.authStatusMsg.className = "error";
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = "Sign In";
  }
}

async function doLogout() {
  try {
    await invoke("github_auth_logout");
    authStatus = { authenticated: false, username: null };
    updateAuthUI();
    // Switch back to sign-in view
    els.authBody.style.display = "block";
    els.authSignedIn.style.display = "none";
    els.authTokenInput.value = "";
    els.authStatusMsg.textContent = "Signed out.";
    els.authStatusMsg.className = "";
  } catch (e) {
    alert("Logout failed: " + e);
  }
}

// ===== TTS =====
async function toggleTts() {
  if (ttsPlaying) {
    ttsStopPlayback();
  } else {
    startTts();
  }
}

async function startTts() {
  if (!currentPath || editMode) return;

  try {
    const markdown = await invoke("read_file_content", { path: currentPath });
    if (!markdown || !markdown.trim()) return;

    const prevTitle = els.toolbarTitle.textContent;
    els.toolbarTitle.textContent = "Generating audio...";

    ttsAudioQueue = [];
    ttsCurrentChunkIndex = 0;
    ttsTotalChunks = 0;
    ttsPlaying = true;
    ttsPaused = false;

    const config = {
      provider: ttsSettings.provider,
      voice: ttsSettings.voice,
      speed: ttsSettings.speed,
      readCodeBlocks: ttsSettings.readCodeBlocks,
      languageCode: "en-US",
      model: ttsSettings.provider === "openai" ? "tts-1" : null,
    };

    const result = await invoke("tts_generate", { markdown, config });
    els.toolbarTitle.textContent = prevTitle;

    ttsTotalChunks = result.totalChunks;
    ttsAudioQueue[0] = result.audioBase64;

    // Show player bar
    els.ttsPlayer.style.display = "flex";
    els.ttsChunkInfo.textContent = `1 / ${ttsTotalChunks}`;
    updateTtsPlayPauseIcon();

    // Start playing
    playTtsChunk(0);
  } catch (err) {
    ttsPlaying = false;
    const prevTitle = els.toolbarTitle.textContent;
    els.toolbarTitle.textContent = "TTS: " + err;
    setTimeout(() => {
      if (currentPath) {
        els.toolbarTitle.textContent = currentPath.split(/[/\\]/).pop();
      }
    }, 3000);
  }
}

function playTtsChunk(index) {
  if (!ttsPlaying || index >= ttsTotalChunks) {
    // Playback complete
    ttsFinished();
    return;
  }

  const audioData = ttsAudioQueue[index];
  if (!audioData) {
    // Chunk not ready yet — will be played when tts-chunk-ready fires
    ttsAudioElement = null;
    return;
  }

  ttsCurrentChunkIndex = index;
  els.ttsChunkInfo.textContent = `${index + 1} / ${ttsTotalChunks}`;

  const blob = base64ToBlob(audioData, "audio/mpeg");
  const url = URL.createObjectURL(blob);

  ttsAudioElement = new Audio(url);
  ttsAudioElement.playbackRate = 1.0; // Speed handled server-side for OpenAI

  ttsAudioElement.addEventListener("timeupdate", updateTtsProgress);
  ttsAudioElement.addEventListener("ended", () => {
    URL.revokeObjectURL(url);
    ttsAudioElement = null;
    playTtsChunk(index + 1);
  });
  ttsAudioElement.addEventListener("error", () => {
    URL.revokeObjectURL(url);
    ttsAudioElement = null;
    ttsFinished();
  });

  ttsAudioElement.play().catch(() => {
    ttsFinished();
  });
}

function ttsTogglePlayPause() {
  if (!ttsPlaying || !ttsAudioElement) return;

  if (ttsPaused) {
    ttsAudioElement.play();
    ttsPaused = false;
  } else {
    ttsAudioElement.pause();
    ttsPaused = true;
  }
  updateTtsPlayPauseIcon();
}

function updateTtsPlayPauseIcon() {
  if (ttsPaused) {
    els.ttsIconPlay.style.display = "";
    els.ttsIconPause.style.display = "none";
  } else {
    els.ttsIconPlay.style.display = "none";
    els.ttsIconPause.style.display = "";
  }
}

async function ttsStopPlayback() {
  ttsPlaying = false;
  ttsPaused = false;
  if (ttsAudioElement) {
    ttsAudioElement.pause();
    ttsAudioElement = null;
  }
  ttsAudioQueue = [];
  els.ttsPlayer.style.display = "none";
  els.ttsProgressBar.style.width = "0%";

  try {
    await invoke("tts_cancel");
  } catch (_) {}
}

function ttsFinished() {
  ttsPlaying = false;
  ttsPaused = false;
  ttsAudioElement = null;
  els.ttsProgressBar.style.width = "100%";
  setTimeout(() => {
    els.ttsPlayer.style.display = "none";
    els.ttsProgressBar.style.width = "0%";
  }, 1000);
}

function updateTtsProgress() {
  if (!ttsAudioElement || !ttsPlaying) return;
  const chunkProgress = ttsAudioElement.duration
    ? ttsAudioElement.currentTime / ttsAudioElement.duration
    : 0;
  const overallProgress =
    ((ttsCurrentChunkIndex + chunkProgress) / ttsTotalChunks) * 100;
  els.ttsProgressBar.style.width = `${overallProgress}%`;
}

function base64ToBlob(base64, mimeType) {
  const bytes = atob(base64);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    arr[i] = bytes.charCodeAt(i);
  }
  return new Blob([arr], { type: mimeType });
}

// ===== TTS Settings =====
async function refreshTtsKeyStatus() {
  try {
    ttsKeyStatus = await invoke("tts_key_status");
    updateTtsKeyDots();
  } catch (_) {}
}

function updateTtsKeyDots() {
  const dotOpenai = document.getElementById("tts-key-dot-openai");
  const dotGoogle = document.getElementById("tts-key-dot-google");
  const dotElevenlabs = document.getElementById("tts-key-dot-elevenlabs");
  if (dotOpenai) dotOpenai.style.display = ttsKeyStatus.openai ? "" : "none";
  if (dotGoogle) dotGoogle.style.display = ttsKeyStatus.google ? "" : "none";
  if (dotElevenlabs) dotElevenlabs.style.display = ttsKeyStatus.elevenlabs ? "" : "none";

  // Update key button text
  const btnOpenai = document.getElementById("btn-tts-key-openai");
  const btnGoogle = document.getElementById("btn-tts-key-google");
  const btnElevenlabs = document.getElementById("btn-tts-key-elevenlabs");
  if (btnOpenai) btnOpenai.textContent = ttsKeyStatus.openai ? "Manage" : "Set Key";
  if (btnGoogle) btnGoogle.textContent = ttsKeyStatus.google ? "Manage" : "Set Key";
  if (btnElevenlabs) btnElevenlabs.textContent = ttsKeyStatus.elevenlabs ? "Manage" : "Set Key";
}

function openTtsKeyModal(provider) {
  ttsKeyModalProvider = provider;
  const labels = {
    openai: "OpenAI",
    google: "Google Cloud",
    elevenlabs: "ElevenLabs",
  };
  const instructions = {
    openai: "Enter your OpenAI API key. You can create one at platform.openai.com/api-keys.",
    google: "Enter your Google Cloud API key with Text-to-Speech API enabled.",
    elevenlabs: "Enter your ElevenLabs API key from elevenlabs.io/app/settings/api-keys.",
  };
  els.ttsKeyTitle.textContent = `${labels[provider]} API Key`;
  els.ttsKeyInstructions.textContent = instructions[provider];
  els.ttsKeyInput.value = "";
  els.ttsKeyOverlay.style.display = "flex";
  els.ttsKeyInput.focus();
}

function closeTtsKeyModal() {
  els.ttsKeyOverlay.style.display = "none";
  ttsKeyModalProvider = null;
}

async function saveTtsKey() {
  if (!ttsKeyModalProvider) return;
  const key = els.ttsKeyInput.value.trim();
  if (!key) return;

  try {
    await invoke("tts_save_key", { provider: ttsKeyModalProvider, key });
    closeTtsKeyModal();
    refreshTtsKeyStatus();
    loadTtsVoices();
  } catch (err) {
    alert("Failed to save key: " + err);
  }
}

async function removeTtsKey() {
  if (!ttsKeyModalProvider) return;
  try {
    await invoke("tts_remove_key", { provider: ttsKeyModalProvider });
    closeTtsKeyModal();
    refreshTtsKeyStatus();
  } catch (err) {
    alert("Failed to remove key: " + err);
  }
}

async function loadTtsVoices() {
  try {
    const voices = await invoke("tts_list_voices", { provider: ttsSettings.provider });
    els.settingTtsVoice.innerHTML = "";
    for (const v of voices) {
      const opt = document.createElement("option");
      opt.value = v.id;
      opt.textContent = v.name;
      els.settingTtsVoice.appendChild(opt);
    }
    // Restore saved voice if it's in the list
    const savedVoice = ttsSettings.voice;
    const exists = voices.some((v) => v.id === savedVoice);
    if (exists) {
      els.settingTtsVoice.value = savedVoice;
    } else if (voices.length > 0) {
      els.settingTtsVoice.value = voices[0].id;
      ttsSettings.voice = voices[0].id;
      localStorage.setItem("md-tts-voice", ttsSettings.voice);
    }
  } catch (_) {
    // Provider key may not be set — that's fine
  }
}

// ===== Helpers =====
function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}
