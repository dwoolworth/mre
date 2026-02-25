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

// ===== Lazy-loaded mermaid.js =====
let mermaidLib = null;
async function loadMermaid() {
  if (mermaidLib) return mermaidLib;
  const mod = await import("mermaid");
  mermaidLib = mod.default;
  mermaidLib.initialize({
    startOnLoad: false,
    theme: getCurrentScheme() === "dark" ? "dark" : "default",
    securityLevel: "strict",
  });
  return mermaidLib;
}

// ===== Lazy-loaded xterm.js =====
let xtermModule = null;
let xtermFitAddon = null;
let xtermWebLinksAddon = null;
async function loadXterm() {
  if (xtermModule) return { Terminal: xtermModule.Terminal, FitAddon: xtermFitAddon.FitAddon, WebLinksAddon: xtermWebLinksAddon.WebLinksAddon };
  await import("@xterm/xterm/css/xterm.css");
  xtermModule = await import("@xterm/xterm");
  xtermFitAddon = await import("@xterm/addon-fit");
  xtermWebLinksAddon = await import("@xterm/addon-web-links");
  return { Terminal: xtermModule.Terminal, FitAddon: xtermFitAddon.FitAddon, WebLinksAddon: xtermWebLinksAddon.WebLinksAddon };
}

function getCurrentScheme() {
  let scheme = settings.colorScheme;
  if (scheme === "system") {
    scheme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return scheme;
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

// Find in Document state
let findBarOpen = false;
let findMatches = [];
let findCurrentIndex = -1;

// Editor Find & Replace state
let editorFindOpen = false;
let editorFindMatches = [];
let editorFindCurrentIndex = -1;

// Search in Files state
let searchInFilesMode = false;
let searchInFilesResults = [];

// Terminal state
let terminalOpen = false;
let terminalInstances = new Map(); // id → { terminal, fitAddon, element, listener, exitListener, name }
let activeTerminalId = null;
let terminalPanelHeight = parseInt(localStorage.getItem("md-terminal-height")) || 300;
let terminalCounter = 0;

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
let currentFolderPath = null;

// Navigation history
let navHistory = [];
let navIndex = -1;
let navNavigating = false; // flag to prevent pushing during back/forward

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
    contentScroll: document.getElementById("content-scroll"),
    btnNavBack: document.getElementById("btn-nav-back"),
    btnNavForward: document.getElementById("btn-nav-forward"),
    btnNavHome: document.getElementById("btn-nav-home"),
    btnNavTop: document.getElementById("btn-nav-top"),
    btnNavBottom: document.getElementById("btn-nav-bottom"),
    btnNavRefresh: document.getElementById("btn-nav-refresh"),
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
    // Terminal
    terminalPanel: document.getElementById("terminal-panel"),
    terminalResizeHandle: document.getElementById("terminal-resize-handle"),
    terminalTabs: document.getElementById("terminal-tabs"),
    terminalContainers: document.getElementById("terminal-containers"),
    btnTerminalAdd: document.getElementById("btn-terminal-add"),
    // Find in Document
    findBar: document.getElementById("find-bar"),
    findInput: document.getElementById("find-input"),
    findCount: document.getElementById("find-count"),
    btnFindPrev: document.getElementById("btn-find-prev"),
    btnFindNext: document.getElementById("btn-find-next"),
    btnFindClose: document.getElementById("btn-find-close"),
    // Editor Find & Replace
    editorFindBar: document.getElementById("editor-find-bar"),
    editorFindInput: document.getElementById("editor-find-input"),
    editorReplaceInput: document.getElementById("editor-replace-input"),
    editorReplaceRow: document.querySelector(".editor-replace-row"),
    editorFindCount: document.getElementById("editor-find-count"),
    btnEditorFindPrev: document.getElementById("btn-editor-find-prev"),
    btnEditorFindNext: document.getElementById("btn-editor-find-next"),
    btnEditorFindClose: document.getElementById("btn-editor-find-close"),
    btnEditorReplace: document.getElementById("btn-editor-replace"),
    btnEditorReplaceAll: document.getElementById("btn-editor-replace-all"),
    // Search in Files
    btnSearchContents: document.getElementById("btn-search-contents"),
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
  els.btnCancelEdit = document.getElementById("btn-cancel-edit");
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
  els.btnCancelEdit.addEventListener("click", cancelEdit);
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
  document.getElementById("btn-refresh-folder").addEventListener("click", refreshFolder);
  document.getElementById("btn-favorites-filter").addEventListener("click", toggleFavoritesFilter);

  // ===== Nav bar buttons =====
  els.btnNavBack.addEventListener("click", navBack);
  els.btnNavForward.addEventListener("click", navForward);
  els.btnNavHome.addEventListener("click", navHome);
  els.btnNavTop.addEventListener("click", () => { els.contentScroll.scrollTop = 0; });
  els.btnNavBottom.addEventListener("click", () => { els.contentScroll.scrollTop = els.contentScroll.scrollHeight; });
  els.btnNavRefresh.addEventListener("click", navRefresh);

  // ===== Terminal buttons =====
  document.getElementById("btn-nav-terminal").addEventListener("click", toggleTerminalPanel);
  els.btnTerminalAdd.addEventListener("click", () => addTerminal());
  setupTerminalResizeHandle();

  // ===== Find in Document =====
  els.btnFindClose.addEventListener("click", closeFindBar);
  els.btnFindNext.addEventListener("click", findNext);
  els.btnFindPrev.addEventListener("click", findPrev);
  let findDebounce = null;
  els.findInput.addEventListener("input", () => {
    clearTimeout(findDebounce);
    findDebounce = setTimeout(() => {
      clearFindHighlights();
      if (els.findInput.value) findInDocument(els.findInput.value);
      else { findMatches = []; findCurrentIndex = -1; els.findCount.textContent = ""; }
    }, 150);
  });
  els.findInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); e.shiftKey ? findPrev() : findNext(); }
    if (e.key === "Escape") { e.preventDefault(); closeFindBar(); }
  });

  // ===== Editor Find & Replace =====
  els.btnEditorFindClose.addEventListener("click", closeEditorFindBar);
  els.btnEditorFindNext.addEventListener("click", editorFindNext);
  els.btnEditorFindPrev.addEventListener("click", editorFindPrev);
  els.btnEditorReplace.addEventListener("click", editorReplace);
  els.btnEditorReplaceAll.addEventListener("click", editorReplaceAll);
  let editorFindDebounce = null;
  els.editorFindInput.addEventListener("input", () => {
    clearTimeout(editorFindDebounce);
    editorFindDebounce = setTimeout(() => {
      if (els.editorFindInput.value) findInEditor(els.editorFindInput.value);
      else { editorFindMatches = []; editorFindCurrentIndex = -1; els.editorFindCount.textContent = ""; }
    }, 150);
  });
  els.editorFindInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); e.shiftKey ? editorFindPrev() : editorFindNext(); }
    if (e.key === "Escape") { e.preventDefault(); closeEditorFindBar(); }
  });
  els.editorReplaceInput.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { e.preventDefault(); closeEditorFindBar(); }
  });

  // ===== Search in Files =====
  els.btnSearchContents.addEventListener("click", toggleSearchInFiles);

  // ===== Filter input =====
  let searchDebounce = null;
  els.filterInput.addEventListener("input", (e) => {
    if (searchInFilesMode) {
      clearTimeout(searchDebounce);
      const q = e.target.value;
      searchDebounce = setTimeout(() => {
        if (q.trim()) performSearchInFiles(q.trim());
        else { searchInFilesResults = []; renderFileTree(); }
      }, 300);
    } else {
      filterText = e.target.value.toLowerCase();
      renderFileTree();
    }
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
    } else if (mod && e.key === "`") {
      e.preventDefault();
      toggleTerminalPanel();
    } else if (mod && e.key === "f") {
      e.preventDefault();
      if (editMode) openEditorFindBar(false);
      else if (currentPath && !historyMode) openFindBar();
    } else if (mod && e.key === "h") {
      e.preventDefault();
      if (editMode) openEditorFindBar(true);
    } else if (e.key === "Escape") {
      if (findBarOpen) {
        closeFindBar();
      } else if (editorFindOpen) {
        closeEditorFindBar();
      } else if (commitPopoverOpen) {
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
      const scrollTop = els.contentScroll.scrollTop;
      await openFile(currentPath);
      requestAnimationFrame(() => {
        els.contentScroll.scrollTop = scrollTop;
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
  await listen("menu-find", () => {
    if (editMode) openEditorFindBar(false);
    else if (currentPath && !historyMode) openFindBar();
  });
  await listen("menu-find-replace", () => {
    if (editMode) openEditorFindBar(true);
  });
  await listen("menu-open-recent-file", async (event) => {
    if (event.payload) await openFile(event.payload);
  });
  await listen("menu-open-recent-folder", async (event) => {
    if (event.payload) await openFolder(event.payload);
  });
  await listen("menu-clear-recents", () => {
    invoke("clear_recents").catch(() => {});
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

// ===== Path Helpers =====
function resolvePath(path) {
  const parts = path.split("/");
  const resolved = [];
  for (const part of parts) {
    if (part === "." || part === "") continue;
    if (part === "..") { resolved.pop(); }
    else { resolved.push(part); }
  }
  return "/" + resolved.join("/");
}

// ===== File Operations =====
async function openFile(path) {
  try {
    if (findBarOpen) closeFindBar();
    if (editorFindOpen) closeEditorFindBar();
    if (editMode) exitEditMode();
    const wasInHistory = historyMode;

    const result = await invoke("open_and_render", { path });
    currentPath = result.filePath;
    invoke("add_recent_file", { path: result.filePath }).catch(() => {});

    // Track navigation history (skip duplicates and re-renders of the same file)
    if (!navNavigating && result.filePath && navHistory[navIndex] !== result.filePath) {
      navHistory = navHistory.slice(0, navIndex + 1);
      navHistory.push(result.filePath);
      navIndex = navHistory.length - 1;
    }
    updateNavButtons();

    // Auto-open parent folder if file is outside current folder (or no folder loaded)
    const parentDir = result.filePath.substring(0, result.filePath.lastIndexOf("/"));
    if (parentDir && (!currentFolderPath || !parentDir.startsWith(currentFolderPath))) {
      openFolder(parentDir);
    }

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

    // Mark active in sidebar and expand parent folders
    revealInTree(result.filePath);

    // Handle links: .md links navigate in-app, external/mailto open externally with confirmation
    els.content.querySelectorAll("a[href]").forEach((a) => {
      const href = a.getAttribute("href");
      if (!href) return;
      if (href.match(/\.(?:md|markdown|mdown|mkd|mkdn|mdx)(?:#.*)?$/i)) {
        a.addEventListener("click", (e) => {
          e.preventDefault();
          const linkPath = href.replace(/#.*$/, "");
          const parentDir = currentPath.substring(0, currentPath.lastIndexOf("/"));
          const resolved = resolvePath(parentDir + "/" + linkPath);
          openFile(resolved);
        });
      } else if (href.startsWith("http://") || href.startsWith("https://") || href.startsWith("mailto:")) {
        a.removeAttribute("target");
        a.addEventListener("click", async (e) => {
          e.preventDefault();
          e.stopImmediatePropagation();
          const { ask } = await import("@tauri-apps/plugin-dialog");
          const label = href.startsWith("mailto:") ? "Send email to " + href.slice(7) + "?" : "Open this link in your browser?";
          const confirmed = await ask(href, { title: label, kind: "info", okLabel: "Open", cancelLabel: "Cancel" });
          if (confirmed) invoke("open_path", { path: href });
        });
      }
    });

    await renderMermaidBlocks(els.content);
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

let folderLoading = false;
async function openFolder(path) {
  if (folderLoading) return;
  folderLoading = true;
  try {
    folderTree = await invoke("scan_folder", { path });
    currentFolderPath = path;
    invoke("add_recent_folder", { path }).catch(() => {});
    renderFileTree();
  } catch (err) {
    console.error("Failed to scan folder:", err);
  } finally {
    folderLoading = false;
  }
}

async function refreshFolder() {
  if (!currentFolderPath) return;
  await openFolder(currentFolderPath);
}

// ===== Navigation History =====
function updateNavButtons() {
  els.btnNavBack.disabled = navIndex <= 0;
  els.btnNavForward.disabled = navIndex >= navHistory.length - 1;
  els.btnNavRefresh.disabled = !currentPath;
}

async function navBack() {
  if (navIndex <= 0) return;
  navIndex--;
  navNavigating = true;
  try { await openFile(navHistory[navIndex]); }
  finally { navNavigating = false; }
}

async function navForward() {
  if (navIndex >= navHistory.length - 1) return;
  navIndex++;
  navNavigating = true;
  try { await openFile(navHistory[navIndex]); }
  finally { navNavigating = false; }
}

async function navHome() {
  if (!currentFolderPath || !folderTree.length) return;
  const mdFiles = folderTree.filter((e) => !e.isDir && /\.(?:md|markdown|mdown|mkd|mkdn|mdx)$/i.test(e.name));
  // Prefer README.md (case-insensitive), otherwise pick the first .md file
  const readme = mdFiles.find((e) => e.name.toLowerCase() === "readme.md");
  const target = readme || mdFiles[0];
  if (target) await openFile(target.path);
}

async function navRefresh() {
  if (!currentPath) return;
  await openFile(currentPath);
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

function revealInTree(filePath) {
  document.querySelectorAll(".tree-item.active").forEach((el) => el.classList.remove("active"));
  const activeItem = document.querySelector(`.tree-item[data-path="${CSS.escape(filePath)}"]`);
  if (!activeItem) return;
  activeItem.classList.add("active");
  // Expand all parent .tree-children containers so the file is visible
  let el = activeItem.parentElement;
  while (el && el !== els.fileTree) {
    if (el.classList.contains("tree-children") && !el.classList.contains("expanded")) {
      el.classList.add("expanded");
      // Also expand the chevron on the preceding dir item
      const dirItem = el.previousElementSibling;
      if (dirItem) {
        const chevron = dirItem.querySelector(".tree-chevron");
        if (chevron) chevron.classList.add("expanded");
      }
    }
    el = el.parentElement;
  }
  activeItem.scrollIntoView({ block: "nearest" });
}

// ===== File Tree Rendering =====
function renderFileTree() {
  els.fileTree.innerHTML = "";
  if (searchInFilesMode && searchInFilesResults.length > 0) {
    // Search results are rendered by renderSearchResults, not here
    return;
  }
  if (folderTree.length === 0) return;
  const fragment = document.createDocumentFragment();
  renderEntries(folderTree, fragment, 0);
  els.fileTree.appendChild(fragment);
  // Mark currently open file as active and expand its parent folders
  if (currentPath) revealInTree(currentPath);
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
  if (findBarOpen) closeFindBar();
  try {
    // Capture scroll position as a ratio before switching views
    const scrollRatio = els.contentScroll.scrollHeight > els.contentScroll.clientHeight
      ? els.contentScroll.scrollTop / (els.contentScroll.scrollHeight - els.contentScroll.clientHeight)
      : 0;

    const raw = await invoke("read_file_content", { path: currentPath });
    els.editor.value = raw;
    els.content.style.display = "none";
    els.editorContainer.style.display = "flex";
    els.btnEdit.style.display = "none";
    els.btnCancelEdit.style.display = "";
    els.btnSave.style.display = "";
    els.btnExportPdf.style.display = "none";
    els.btnTts.style.display = "none";
    editMode = true;
    updateEditorLineNumbers();

    // Restore scroll position proportionally in the editor
    requestAnimationFrame(() => {
      const editorMaxScroll = els.editor.scrollHeight - els.editor.clientHeight;
      els.editor.scrollTop = Math.round(scrollRatio * editorMaxScroll);
      els.editorLineNumbers.scrollTop = els.editor.scrollTop;
    });
  } catch (err) {
    console.error("Failed to read file for editing:", err);
  }
}

function exitEditMode() {
  if (editorFindOpen) closeEditorFindBar();
  // Capture editor scroll ratio before switching back
  const scrollRatio = els.editor.scrollHeight > els.editor.clientHeight
    ? els.editor.scrollTop / (els.editor.scrollHeight - els.editor.clientHeight)
    : 0;

  els.editorContainer.style.display = "none";
  els.content.style.display = "block";
  els.btnCancelEdit.style.display = "none";
  els.btnSave.style.display = "none";
  els.btnEdit.style.display = "";
  els.btnExportPdf.style.display = "";
  els.btnTts.style.display = "";
  editMode = false;

  // Restore scroll position proportionally in the preview
  requestAnimationFrame(() => {
    const maxScroll = els.contentScroll.scrollHeight - els.contentScroll.clientHeight;
    els.contentScroll.scrollTop = Math.round(scrollRatio * maxScroll);
  });
}

async function cancelEdit() {
  exitEditMode();
  // Re-render the file to discard any unsaved changes
  if (currentPath) await openFile(currentPath);
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

// ===== Mermaid Diagrams =====

// Convert foreignObject elements to native SVG text for PDF export
// (resvg/typst can't render foreignObject HTML content)
function cleanSvgForExport(svgString) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgString, "image/svg+xml");
  const svg = doc.documentElement;

  // Add white background
  const bgRect = doc.createElementNS("http://www.w3.org/2000/svg", "rect");
  bgRect.setAttribute("width", "100%");
  bgRect.setAttribute("height", "100%");
  bgRect.setAttribute("fill", "white");
  svg.insertBefore(bgRect, svg.firstChild);

  // Force light theme by directly rewriting fill/stroke attributes on all elements
  const allEls = svg.querySelectorAll("path, rect, circle, line");
  for (const el of allEls) {
    const fill = el.getAttribute("fill");
    if (fill && fill !== "none" && fill !== "white") {
      if (fill === "#1f2020" || fill === "#1f2328") {
        el.setAttribute("fill", "#ffffff");
      } else if (fill.startsWith("hsl(")) {
        // Parse lightness from hsl(..., ..., L%)
        const match = fill.match(/,\s*([\d.]+)%\s*\)/);
        if (match) {
          const lightness = parseFloat(match[1]);
          if (lightness < 20) {
            el.setAttribute("fill", lightness < 10 ? "#ffffff" : "#f6f8fa");
          }
        }
      } else if (fill.startsWith("rgba(") || fill === "rgb(32, 31, 31)") {
        el.setAttribute("fill", "#ffffff");
      }
    }
    const stroke = el.getAttribute("stroke");
    if (stroke === "#ccc" || stroke === "lightgrey" || stroke === "lightGrey") {
      el.setAttribute("stroke", "#57606a");
    }
  }

  // Rewrite CSS styles in <style> elements (dark theme colors)
  const existingStyles = svg.querySelectorAll("style");
  for (const s of existingStyles) {
    s.textContent = s.textContent
      .replace(/fill:\s*#ccc/g, "fill: #1f2328")
      .replace(/fill:\s*#1f2020/g, "fill: #ffffff")
      .replace(/stroke:\s*#ccc/g, "stroke: #57606a")
      .replace(/stroke:\s*lightgrey/g, "stroke: #57606a")
      .replace(/fill:\s*lightgrey/g, "fill: #57606a");
  }

  // Replace all foreignObject elements with SVG text
  const fos = Array.from(svg.querySelectorAll("foreignObject"));
  for (const fo of fos) {
    const width = parseFloat(fo.getAttribute("width") || "0");
    const height = parseFloat(fo.getAttribute("height") || "0");
    const text = fo.textContent.trim();

    if (!text || width === 0) {
      fo.remove();
      continue;
    }

    const textEl = doc.createElementNS("http://www.w3.org/2000/svg", "text");
    textEl.setAttribute("x", String(width / 2));
    textEl.setAttribute("y", String(height / 2));
    textEl.setAttribute("text-anchor", "middle");
    textEl.setAttribute("dominant-baseline", "central");
    textEl.setAttribute("font-family", "Helvetica Neue, Arial, sans-serif");
    textEl.setAttribute("fill", "#1f2328");

    // Detect font size from class: entity names are larger, attributes are smaller
    const isNodeLabel = fo.querySelector(".nodeLabel") !== null;
    const isEdgeLabel = fo.querySelector(".edgeLabel") !== null;
    textEl.setAttribute("font-size", isEdgeLabel ? "12" : "14");
    if (isNodeLabel && height > 20) {
      const parent = fo.closest(".label");
      if (parent) {
        textEl.setAttribute("font-weight", "bold");
        textEl.setAttribute("font-size", "16");
      }
    }

    textEl.textContent = text;
    fo.parentNode.replaceChild(textEl, fo);
  }

  return new XMLSerializer().serializeToString(svg);
}

async function renderMermaidBlocks(container) {
  const mermaidBlocks = container.querySelectorAll("pre code.language-mermaid");
  if (mermaidBlocks.length === 0) return;

  const mm = await loadMermaid();
  let counter = 0;

  for (const codeEl of mermaidBlocks) {
    const pre = codeEl.parentElement;
    const definition = codeEl.textContent;
    const id = `mermaid-${Date.now()}-${counter++}`;

    try {
      const { svg } = await mm.render(id, definition);
      const wrapper = document.createElement("div");
      wrapper.className = "mermaid-diagram";
      wrapper.innerHTML = svg;

      // Click to open fullscreen
      wrapper.addEventListener("click", () => openMermaidFullscreen(svg));

      pre.replaceWith(wrapper);
    } catch (err) {
      // On syntax error, leave as code block for highlight.js
      console.warn("Mermaid render failed:", err);
    }
  }
}

function openMermaidFullscreen(svg) {
  const overlay = document.createElement("div");
  overlay.className = "mermaid-fullscreen";

  const toolbar = document.createElement("div");
  toolbar.className = "mermaid-fs-toolbar";

  let scale = 1, panX = 0, panY = 0;
  const container = document.createElement("div");
  container.className = "mermaid-fs-container";
  container.innerHTML = svg;

  function applyTransform() {
    container.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
  }

  const zoomIn = document.createElement("button");
  zoomIn.className = "nav-btn";
  zoomIn.title = "Zoom in";
  zoomIn.innerHTML = `<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8 4a.5.5 0 01.5.5v3h3a.5.5 0 010 1h-3v3a.5.5 0 01-1 0v-3h-3a.5.5 0 010-1h3v-3A.5.5 0 018 4z"/></svg>`;
  zoomIn.addEventListener("click", (e) => { e.stopPropagation(); scale = Math.min(5, scale + 0.25); applyTransform(); });

  const zoomOut = document.createElement("button");
  zoomOut.className = "nav-btn";
  zoomOut.title = "Zoom out";
  zoomOut.innerHTML = `<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M4 8a.5.5 0 01.5-.5h7a.5.5 0 010 1h-7A.5.5 0 014 8z"/></svg>`;
  zoomOut.addEventListener("click", (e) => { e.stopPropagation(); scale = Math.max(0.25, scale - 0.25); applyTransform(); });

  const resetBtn = document.createElement("button");
  resetBtn.className = "nav-btn";
  resetBtn.title = "Reset view";
  resetBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8 3a5 5 0 0 1 4.546 2.914.5.5 0 1 0 .908-.418A6 6 0 0 0 2.083 5.5H1.5a.5.5 0 0 0 0 1h2a.5.5 0 0 0 .5-.5v-2a.5.5 0 0 0-1 0v.674A5.97 5.97 0 0 1 8 3zM3.546 10.086a.5.5 0 1 0-.908.418A6 6 0 0 0 13.917 10.5h.583a.5.5 0 0 0 0-1h-2a.5.5 0 0 0-.5.5v2a.5.5 0 0 0 1 0v-.674A5.97 5.97 0 0 1 8 13a5 5 0 0 1-4.454-2.914z"/></svg>`;
  resetBtn.addEventListener("click", (e) => { e.stopPropagation(); scale = 1; panX = 0; panY = 0; applyTransform(); });

  const close = document.createElement("button");
  close.className = "nav-btn";
  close.title = "Close (Esc)";
  close.innerHTML = `<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M3.72 3.72a.75.75 0 011.06 0L8 6.94l3.22-3.22a.749.749 0 011.275.326.749.749 0 01-.215.734L9.06 8l3.22 3.22a.749.749 0 01-.326 1.275.749.749 0 01-.734-.215L8 9.06l-3.22 3.22a.751.751 0 01-1.042-.018.751.751 0 01-.018-1.042L6.94 8 3.72 4.78a.75.75 0 010-1.06z"/></svg>`;
  close.addEventListener("click", (e) => { e.stopPropagation(); cleanup(); });

  const printBtn = document.createElement("button");
  printBtn.className = "nav-btn";
  printBtn.title = "Export diagram to PDF";
  printBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M2.75 14A1.75 1.75 0 011 12.25v-2.5a.75.75 0 011.5 0v2.5c0 .138.112.25.25.25h10.5a.25.25 0 00.25-.25v-2.5a.75.75 0 011.5 0v2.5A1.75 1.75 0 0113.25 14H2.75z"/><path d="M7.25 7.689V2a.75.75 0 011.5 0v5.689l1.97-1.969a.749.749 0 111.06 1.06l-3.25 3.25a.749.749 0 01-1.06 0L4.22 6.78a.749.749 0 111.06-1.06l1.97 1.969z"/></svg>`;
  printBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    const { ask } = await import("@tauri-apps/plugin-dialog");
    const landscape = await ask("Choose page orientation", { title: "Export Diagram to PDF", kind: "info", okLabel: "Landscape", cancelLabel: "Portrait" });
    const { save } = await import("@tauri-apps/plugin-dialog");
    const outPath = await save({ defaultPath: "diagram.pdf", filters: [{ name: "PDF", extensions: ["pdf"] }] });
    if (!outPath) return;
    const path = typeof outPath === "string" ? outPath : outPath.path;
    try {
      const cleanedSvg = cleanSvgForExport(svg);
      await invoke("export_diagram_pdf", { svgContent: cleanedSvg, outputPath: path, landscape });
      await invoke("open_path", { path });
    } catch (err) {
      alert("PDF export failed: " + err);
    }
  });

  toolbar.appendChild(zoomIn);
  toolbar.appendChild(zoomOut);
  toolbar.appendChild(resetBtn);
  const sep = document.createElement("span");
  sep.className = "toolbar-sep";
  toolbar.appendChild(sep);
  toolbar.appendChild(printBtn);
  toolbar.appendChild(close);

  // Click-drag to pan
  let dragging = false, dragStartX = 0, dragStartY = 0, startPanX = 0, startPanY = 0;
  const viewport = document.createElement("div");
  viewport.className = "mermaid-fs-viewport";
  viewport.appendChild(container);

  viewport.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    dragging = true;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    startPanX = panX;
    startPanY = panY;
    viewport.style.cursor = "grabbing";
    e.preventDefault();
  });
  window.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    panX = startPanX + (e.clientX - dragStartX);
    panY = startPanY + (e.clientY - dragStartY);
    applyTransform();
  });
  window.addEventListener("mouseup", () => {
    dragging = false;
    viewport.style.cursor = "grab";
  });

  // Scroll wheel zoom
  viewport.addEventListener("wheel", (e) => {
    e.preventDefault();
    scale = Math.min(5, Math.max(0.25, scale + (e.deltaY < 0 ? 0.15 : -0.15)));
    applyTransform();
  }, { passive: false });

  overlay.appendChild(toolbar);
  overlay.appendChild(viewport);

  // Escape to close
  function cleanup() { overlay.remove(); document.removeEventListener("keydown", onKey); }
  const onKey = (e) => { if (e.key === "Escape") cleanup(); };
  document.addEventListener("keydown", onKey);

  document.body.appendChild(overlay);
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
        { root: els.contentScroll, rootMargin: "200px" }
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
  const scheme = getCurrentScheme();
  const dataTheme = `${settings.themeName}-${scheme}`;
  document.body.setAttribute("data-theme", dataTheme);
  // Sync mermaid theme if loaded
  if (mermaidLib) {
    mermaidLib.initialize({
      startOnLoad: false,
      theme: scheme === "dark" ? "dark" : "default",
      securityLevel: "strict",
    });
  }
  // Sync all terminal themes
  const xtermTheme = getXtermTheme();
  for (const inst of terminalInstances.values()) {
    inst.terminal.options.theme = xtermTheme;
  }
}

// Listen for system theme changes
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  if (settings.colorScheme === "system") {
    applyTheme();
    syncColorPickersToTheme();
  }
});

// Clean up all terminal sessions on window close
window.addEventListener("beforeunload", () => {
  for (const [id] of terminalInstances) {
    invoke("close_terminal", { id }).catch(() => {});
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

    // Render mermaid diagrams, then highlight code blocks
    await renderMermaidBlocks(els.historyPreviewContent);
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
    // Reload file and refresh sidebar if changes were pulled
    if (msg.includes("Fast-forwarded")) {
      await openFile(currentPath);
      refreshFolder();
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

// ===== Terminal =====
function getXtermTheme() {
  const cs = getComputedStyle(document.body);
  const scheme = getCurrentScheme();
  if (scheme === "dark") {
    return {
      background: cs.getPropertyValue("--bg-primary").trim() || "#0d1117",
      foreground: cs.getPropertyValue("--text-primary").trim() || "#e6edf3",
      cursor: cs.getPropertyValue("--text-primary").trim() || "#e6edf3",
      cursorAccent: cs.getPropertyValue("--bg-primary").trim() || "#0d1117",
      selectionBackground: "rgba(88, 166, 255, 0.3)",
      black: "#484f58",
      red: "#ff7b72",
      green: "#7ee787",
      yellow: "#e3b341",
      blue: "#79c0ff",
      magenta: "#d2a8ff",
      cyan: "#56d4dd",
      white: "#e6edf3",
      brightBlack: "#6e7681",
      brightRed: "#ffa198",
      brightGreen: "#aff5b4",
      brightYellow: "#f8e3a1",
      brightBlue: "#a5d6ff",
      brightMagenta: "#edc4ff",
      brightCyan: "#a5f3fc",
      brightWhite: "#ffffff",
    };
  }
  return {
    background: cs.getPropertyValue("--bg-primary").trim() || "#ffffff",
    foreground: cs.getPropertyValue("--text-primary").trim() || "#1f2328",
    cursor: cs.getPropertyValue("--text-primary").trim() || "#1f2328",
    cursorAccent: cs.getPropertyValue("--bg-primary").trim() || "#ffffff",
    selectionBackground: "rgba(9, 105, 218, 0.2)",
    black: "#24292f",
    red: "#cf222e",
    green: "#116329",
    yellow: "#4d2d00",
    blue: "#0969da",
    magenta: "#8250df",
    cyan: "#1b7c83",
    white: "#6e7781",
    brightBlack: "#57606a",
    brightRed: "#a40e26",
    brightGreen: "#1a7f37",
    brightYellow: "#633c01",
    brightBlue: "#218bff",
    brightMagenta: "#a475f9",
    brightCyan: "#3192aa",
    brightWhite: "#8c959f",
  };
}

async function toggleTerminalPanel() {
  if (terminalOpen) {
    // Close panel
    terminalOpen = false;
    els.terminalPanel.style.display = "none";
    els.terminalResizeHandle.style.display = "none";
  } else {
    // Open panel
    terminalOpen = true;
    els.terminalPanel.style.display = "flex";
    els.terminalPanel.style.height = `${terminalPanelHeight}px`;
    els.terminalResizeHandle.style.display = "";
    if (terminalInstances.size === 0) {
      await addTerminal();
    } else if (activeTerminalId) {
      // Refit the active terminal when reopening
      const inst = terminalInstances.get(activeTerminalId);
      if (inst) {
        requestAnimationFrame(() => {
          inst.fitAddon.fit();
          inst.terminal.focus();
        });
      }
    }
  }
}

async function addTerminal() {
  const { Terminal, FitAddon, WebLinksAddon } = await loadXterm();

  const cwd = currentFolderPath || (currentPath ? currentPath.substring(0, currentPath.lastIndexOf("/")) : null);
  const effectiveCwd = cwd || "";

  let id;
  try {
    id = await invoke("spawn_terminal", { cwd: effectiveCwd });
  } catch (err) {
    console.error("Failed to spawn terminal:", err);
    return;
  }

  terminalCounter++;
  const name = `Terminal ${terminalCounter}`;

  const terminal = new Terminal({
    theme: getXtermTheme(),
    fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
    fontSize: 13,
    cursorBlink: true,
    allowProposedApi: true,
  });

  const fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);

  const webLinksAddon = new WebLinksAddon();
  terminal.loadAddon(webLinksAddon);

  const element = document.createElement("div");
  element.className = "terminal-instance";
  element.dataset.termId = id;
  els.terminalContainers.appendChild(element);

  terminal.open(element);

  // Fit after a frame to let layout settle
  requestAnimationFrame(() => {
    fitAddon.fit();
    // Tell backend about initial size
    invoke("resize_terminal", { id, rows: terminal.rows, cols: terminal.cols }).catch(() => {});
  });

  // Wire input: user keystrokes → backend
  terminal.onData((data) => {
    invoke("send_terminal_input", { id, data }).catch(() => {});
  });

  // Wire output: backend → terminal
  const outputEvent = `terminal-output-${id}`;
  const outputListener = await listen(outputEvent, (event) => {
    const decoded = atob(event.payload);
    const bytes = new Uint8Array(decoded.length);
    for (let i = 0; i < decoded.length; i++) bytes[i] = decoded.charCodeAt(i);
    terminal.write(bytes);
  });

  // Wire exit event
  const exitEvent = `terminal-exit-${id}`;
  const exitListener = await listen(exitEvent, () => {
    terminal.write("\r\n\x1b[90m[Process exited]\x1b[0m\r\n");
  });

  terminalInstances.set(id, { terminal, fitAddon, element, listener: outputListener, exitListener, name });
  switchTerminal(id);
  renderTerminalTabs();
  terminal.focus();
}

function switchTerminal(id) {
  activeTerminalId = id;
  for (const [tid, inst] of terminalInstances) {
    inst.element.classList.toggle("active", tid === id);
  }
  renderTerminalTabs();
  const inst = terminalInstances.get(id);
  if (inst) {
    requestAnimationFrame(() => {
      inst.fitAddon.fit();
      inst.terminal.focus();
    });
  }
}

async function closeTerminal(id) {
  const inst = terminalInstances.get(id);
  if (!inst) return;

  inst.listener();
  inst.exitListener();
  inst.terminal.dispose();
  inst.element.remove();
  terminalInstances.delete(id);
  invoke("close_terminal", { id }).catch(() => {});

  if (terminalInstances.size === 0) {
    // Auto-close panel
    terminalOpen = false;
    activeTerminalId = null;
    els.terminalPanel.style.display = "none";
    els.terminalResizeHandle.style.display = "none";
  } else if (activeTerminalId === id) {
    // Switch to the last remaining terminal
    const nextId = [...terminalInstances.keys()].pop();
    switchTerminal(nextId);
  }
  renderTerminalTabs();
}

function renderTerminalTabs() {
  els.terminalTabs.innerHTML = "";
  for (const [id, inst] of terminalInstances) {
    const tab = document.createElement("div");
    tab.className = `terminal-tab${id === activeTerminalId ? " active" : ""}`;

    const label = document.createElement("span");
    label.className = "terminal-tab-label";
    label.textContent = inst.name;
    label.addEventListener("click", (e) => {
      e.stopPropagation();
      switchTerminal(id);
    });
    label.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      renameTerminal(id, label);
    });

    const closeBtn = document.createElement("button");
    closeBtn.className = "terminal-tab-close";
    closeBtn.textContent = "\u00d7";
    closeBtn.title = "Close terminal";
    closeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      closeTerminal(id);
    });

    tab.appendChild(label);
    tab.appendChild(closeBtn);
    tab.addEventListener("click", () => switchTerminal(id));
    els.terminalTabs.appendChild(tab);
  }
}

function renameTerminal(id, labelEl) {
  labelEl.contentEditable = "true";
  labelEl.focus();
  // Select all text
  const range = document.createRange();
  range.selectNodeContents(labelEl);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);

  function finish() {
    labelEl.contentEditable = "false";
    const newName = labelEl.textContent.trim();
    if (newName) {
      const inst = terminalInstances.get(id);
      if (inst) inst.name = newName;
    } else {
      // Revert to current name
      const inst = terminalInstances.get(id);
      if (inst) labelEl.textContent = inst.name;
    }
    labelEl.removeEventListener("blur", finish);
    labelEl.removeEventListener("keydown", onKey);
  }

  function onKey(e) {
    if (e.key === "Enter") {
      e.preventDefault();
      labelEl.blur();
    } else if (e.key === "Escape") {
      const inst = terminalInstances.get(id);
      if (inst) labelEl.textContent = inst.name;
      labelEl.blur();
    }
  }

  labelEl.addEventListener("blur", finish);
  labelEl.addEventListener("keydown", onKey);
}

function setupTerminalResizeHandle() {
  const handle = els.terminalResizeHandle;
  if (!handle) return;

  let startY, startHeight;

  handle.addEventListener("mousedown", (e) => {
    e.preventDefault();
    startY = e.clientY;
    startHeight = els.terminalPanel.offsetHeight;
    handle.classList.add("active");
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  });

  function onMouseMove(e) {
    const diff = startY - e.clientY; // dragging up increases height
    const newHeight = Math.min(800, Math.max(100, startHeight + diff));
    els.terminalPanel.style.height = `${newHeight}px`;
    terminalPanelHeight = newHeight;
    // Refit active terminal
    if (activeTerminalId) {
      const inst = terminalInstances.get(activeTerminalId);
      if (inst) inst.fitAddon.fit();
    }
  }

  function onMouseUp() {
    handle.classList.remove("active");
    localStorage.setItem("md-terminal-height", terminalPanelHeight.toString());
    document.removeEventListener("mousemove", onMouseMove);
    document.removeEventListener("mouseup", onMouseUp);
    // Send final resize to backend
    if (activeTerminalId) {
      const inst = terminalInstances.get(activeTerminalId);
      if (inst) {
        inst.fitAddon.fit();
        invoke("resize_terminal", {
          id: activeTerminalId,
          rows: inst.terminal.rows,
          cols: inst.terminal.cols,
        }).catch(() => {});
      }
    }
  }
}

// ResizeObserver to refit terminal when content-area resizes
new ResizeObserver(() => {
  if (terminalOpen && activeTerminalId) {
    const inst = terminalInstances.get(activeTerminalId);
    if (inst) {
      inst.fitAddon.fit();
      invoke("resize_terminal", {
        id: activeTerminalId,
        rows: inst.terminal.rows,
        cols: inst.terminal.cols,
      }).catch(() => {});
    }
  }
}).observe(document.getElementById("content-area"));

// ===== Find in Document (Read Mode) =====
function openFindBar() {
  if (editorFindOpen) closeEditorFindBar();
  findBarOpen = true;
  els.findBar.style.display = "flex";
  els.findInput.focus();
  els.findInput.select();
}

function closeFindBar() {
  findBarOpen = false;
  els.findBar.style.display = "none";
  els.findInput.value = "";
  els.findCount.textContent = "";
  clearFindHighlights();
  findMatches = [];
  findCurrentIndex = -1;
}

function findInDocument(query) {
  clearFindHighlights();
  findMatches = [];
  findCurrentIndex = -1;
  if (!query) { els.findCount.textContent = ""; return; }

  const lowerQuery = query.toLowerCase();
  const walker = document.createTreeWalker(els.content, NodeFilter.SHOW_TEXT, null);
  const textNodes = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode);

  for (const node of textNodes) {
    const text = node.textContent;
    const lowerText = text.toLowerCase();
    let startPos = 0;
    const segments = [];

    while (true) {
      const idx = lowerText.indexOf(lowerQuery, startPos);
      if (idx === -1) break;
      segments.push({ start: idx, end: idx + query.length });
      startPos = idx + 1;
    }

    if (segments.length === 0) continue;

    // Split this text node and wrap matches in <mark>
    const parent = node.parentNode;
    const frag = document.createDocumentFragment();
    let lastEnd = 0;
    for (const seg of segments) {
      if (seg.start > lastEnd) {
        frag.appendChild(document.createTextNode(text.slice(lastEnd, seg.start)));
      }
      const mark = document.createElement("mark");
      mark.className = "find-highlight";
      mark.textContent = text.slice(seg.start, seg.end);
      frag.appendChild(mark);
      findMatches.push(mark);
      lastEnd = seg.end;
    }
    if (lastEnd < text.length) {
      frag.appendChild(document.createTextNode(text.slice(lastEnd)));
    }
    parent.replaceChild(frag, node);
  }

  if (findMatches.length > 0) {
    findCurrentIndex = 0;
    findMatches[0].classList.add("find-current");
    findMatches[0].scrollIntoView({ block: "center", behavior: "smooth" });
    els.findCount.textContent = `1 of ${findMatches.length}`;
  } else {
    els.findCount.textContent = "No results";
  }
}

function clearFindHighlights() {
  const marks = els.content.querySelectorAll("mark.find-highlight");
  marks.forEach((mark) => {
    const parent = mark.parentNode;
    parent.replaceChild(document.createTextNode(mark.textContent), mark);
    parent.normalize();
  });
}

function findNext() {
  if (findMatches.length === 0) return;
  findMatches[findCurrentIndex]?.classList.remove("find-current");
  findCurrentIndex = (findCurrentIndex + 1) % findMatches.length;
  findMatches[findCurrentIndex].classList.add("find-current");
  findMatches[findCurrentIndex].scrollIntoView({ block: "center", behavior: "smooth" });
  els.findCount.textContent = `${findCurrentIndex + 1} of ${findMatches.length}`;
}

function findPrev() {
  if (findMatches.length === 0) return;
  findMatches[findCurrentIndex]?.classList.remove("find-current");
  findCurrentIndex = (findCurrentIndex - 1 + findMatches.length) % findMatches.length;
  findMatches[findCurrentIndex].classList.add("find-current");
  findMatches[findCurrentIndex].scrollIntoView({ block: "center", behavior: "smooth" });
  els.findCount.textContent = `${findCurrentIndex + 1} of ${findMatches.length}`;
}

// ===== Find & Replace in Editor (Edit Mode) =====
function openEditorFindBar(showReplace) {
  if (findBarOpen) closeFindBar();
  editorFindOpen = true;
  els.editorFindBar.style.display = "flex";
  els.editorReplaceRow.style.display = showReplace ? "flex" : "none";
  els.editorFindInput.focus();
  els.editorFindInput.select();
}

function closeEditorFindBar() {
  editorFindOpen = false;
  els.editorFindBar.style.display = "none";
  els.editorFindInput.value = "";
  els.editorReplaceInput.value = "";
  els.editorFindCount.textContent = "";
  els.editorReplaceRow.style.display = "none";
  editorFindMatches = [];
  editorFindCurrentIndex = -1;
}

function findInEditor(query) {
  editorFindMatches = [];
  editorFindCurrentIndex = -1;
  if (!query) { els.editorFindCount.textContent = ""; return; }

  const text = els.editor.value;
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  let startPos = 0;

  while (true) {
    const idx = lowerText.indexOf(lowerQuery, startPos);
    if (idx === -1) break;
    editorFindMatches.push({ start: idx, end: idx + query.length });
    startPos = idx + 1;
  }

  if (editorFindMatches.length > 0) {
    editorFindCurrentIndex = 0;
    const match = editorFindMatches[0];
    els.editor.setSelectionRange(match.start, match.end);
    els.editor.focus();
    scrollEditorToSelection();
    els.editorFindCount.textContent = `1 of ${editorFindMatches.length}`;
  } else {
    els.editorFindCount.textContent = "No results";
  }
}

function scrollEditorToSelection() {
  // Calculate approximate scroll position based on line number
  const text = els.editor.value;
  const selStart = els.editor.selectionStart;
  const linesBefore = text.substring(0, selStart).split("\n").length;
  const lineHeight = 14 * 1.6; // matches editor font-size * line-height
  const targetScroll = (linesBefore - 1) * lineHeight - els.editor.clientHeight / 2;
  els.editor.scrollTop = Math.max(0, targetScroll);
  els.editorLineNumbers.scrollTop = els.editor.scrollTop;
}

function editorFindNext() {
  if (editorFindMatches.length === 0) return;
  editorFindCurrentIndex = (editorFindCurrentIndex + 1) % editorFindMatches.length;
  const match = editorFindMatches[editorFindCurrentIndex];
  els.editor.setSelectionRange(match.start, match.end);
  els.editor.focus();
  scrollEditorToSelection();
  els.editorFindCount.textContent = `${editorFindCurrentIndex + 1} of ${editorFindMatches.length}`;
}

function editorFindPrev() {
  if (editorFindMatches.length === 0) return;
  editorFindCurrentIndex = (editorFindCurrentIndex - 1 + editorFindMatches.length) % editorFindMatches.length;
  const match = editorFindMatches[editorFindCurrentIndex];
  els.editor.setSelectionRange(match.start, match.end);
  els.editor.focus();
  scrollEditorToSelection();
  els.editorFindCount.textContent = `${editorFindCurrentIndex + 1} of ${editorFindMatches.length}`;
}

function editorReplace() {
  if (editorFindMatches.length === 0 || editorFindCurrentIndex < 0) return;
  const match = editorFindMatches[editorFindCurrentIndex];
  const replacement = els.editorReplaceInput.value;
  const text = els.editor.value;
  els.editor.value = text.substring(0, match.start) + replacement + text.substring(match.end);
  updateEditorLineNumbers();
  // Re-run search to update positions
  findInEditor(els.editorFindInput.value);
}

function editorReplaceAll() {
  if (editorFindMatches.length === 0) return;
  const replacement = els.editorReplaceInput.value;
  const text = els.editor.value;
  // Replace in reverse to preserve positions
  let result = text;
  for (let i = editorFindMatches.length - 1; i >= 0; i--) {
    const m = editorFindMatches[i];
    result = result.substring(0, m.start) + replacement + result.substring(m.end);
  }
  els.editor.value = result;
  updateEditorLineNumbers();
  findInEditor(els.editorFindInput.value);
}

// ===== Search in Files =====
function toggleSearchInFiles() {
  searchInFilesMode = !searchInFilesMode;
  els.btnSearchContents.classList.toggle("active", searchInFilesMode);
  els.filterInput.placeholder = searchInFilesMode ? "Search in files..." : "Filter files...";
  els.filterInput.value = "";
  filterText = "";
  searchInFilesResults = [];
  renderFileTree();
  els.filterInput.focus();
}

async function performSearchInFiles(query) {
  if (!currentFolderPath || !query) return;
  try {
    searchInFilesResults = await invoke("search_in_files", {
      folder: currentFolderPath,
      query,
      caseSensitive: false,
    });
    renderSearchResults(query);
  } catch (err) {
    console.error("Search in files failed:", err);
  }
}

function renderSearchResults(query) {
  els.fileTree.innerHTML = "";
  if (searchInFilesResults.length === 0) {
    els.fileTree.innerHTML = `<div class="search-result-count">No results found</div>`;
    return;
  }

  // Group by file
  const groups = new Map();
  for (const match of searchInFilesResults) {
    if (!groups.has(match.filePath)) {
      groups.set(match.filePath, { fileName: match.fileName, matches: [] });
    }
    groups.get(match.filePath).matches.push(match);
  }

  const frag = document.createDocumentFragment();

  // Total count
  const countEl = document.createElement("div");
  countEl.className = "search-result-count";
  const fileCount = groups.size;
  const matchCount = searchInFilesResults.length;
  countEl.textContent = `${matchCount} result${matchCount !== 1 ? "s" : ""} in ${fileCount} file${fileCount !== 1 ? "s" : ""}`;
  frag.appendChild(countEl);

  for (const [filePath, group] of groups) {
    const groupEl = document.createElement("div");
    groupEl.className = "search-result-group";

    // File header
    const fileEl = document.createElement("div");
    fileEl.className = "search-result-file";
    fileEl.textContent = group.fileName;
    fileEl.title = filePath;
    fileEl.addEventListener("click", () => openFile(filePath));
    groupEl.appendChild(fileEl);

    // Match lines (show max 10 per file)
    const displayMatches = group.matches.slice(0, 10);
    for (const match of displayMatches) {
      const lineEl = document.createElement("div");
      lineEl.className = "search-result-line";

      const lineNum = document.createElement("span");
      lineNum.className = "search-result-linenum";
      lineNum.textContent = match.lineNumber;

      const textEl = document.createElement("span");
      textEl.className = "search-result-text";
      // Highlight the query in the line content
      const line = match.lineContent.trim();
      const lowerLine = line.toLowerCase();
      const lowerQuery = query.toLowerCase();
      let html = "";
      let pos = 0;
      let idx;
      while ((idx = lowerLine.indexOf(lowerQuery, pos)) !== -1) {
        html += escapeHtml(line.slice(pos, idx));
        html += `<mark>${escapeHtml(line.slice(idx, idx + query.length))}</mark>`;
        pos = idx + query.length;
      }
      html += escapeHtml(line.slice(pos));
      textEl.innerHTML = html;

      lineEl.appendChild(lineNum);
      lineEl.appendChild(textEl);
      lineEl.addEventListener("click", () => {
        openFile(filePath).then(() => {
          // Try to scroll to the approximate location
          requestAnimationFrame(() => {
            // Use a rough heuristic: scroll to estimated position in the content
            const totalHeight = els.contentScroll.scrollHeight;
            // We don't know exact line count, but line number is a rough proxy
            const lineEst = match.lineNumber;
            // Estimate: assume ~20px per line of rendered content is rough
            els.contentScroll.scrollTop = Math.max(0, lineEst * 20 - els.contentScroll.clientHeight / 2);
          });
        });
      });

      groupEl.appendChild(lineEl);
    }
    if (group.matches.length > 10) {
      const moreEl = document.createElement("div");
      moreEl.className = "search-result-line";
      moreEl.style.color = "var(--text-muted)";
      moreEl.style.fontStyle = "italic";
      moreEl.textContent = `... and ${group.matches.length - 10} more`;
      groupEl.appendChild(moreEl);
    }

    frag.appendChild(groupEl);
  }

  els.fileTree.appendChild(frag);
}

// ===== Helpers =====
function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}
