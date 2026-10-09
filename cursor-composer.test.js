"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { UnitedShareError, applyComposerAnswer, composerBox, composerPrompt, composerTarget, composerViewState } = require("./unitedshare-core");

function editorWith(selection, cursor) {
  const calls = [];
  return {
    calls,
    getSelection() {
      return selection;
    },
    getCursor() {
      return cursor;
    },
    replaceSelection(text) {
      calls.push({ op: "replace", text });
    },
    replaceRange(text, from) {
      calls.push({ op: "insert", text, from });
    },
  };
}

test("eine Markierung wird nur durch die Antwort ersetzt", () => {
  const editor = editorWith("alter Satz", { line: 3, ch: 1 });
  assert.equal(applyComposerAnswer(editor, "neuer Satz"), "replace");
  assert.deepEqual(editor.calls, [{ op: "replace", text: "neuer Satz" }]);
});

test("ohne Markierung steht die Antwort am Cursor", () => {
  const cursor = { line: 3, ch: 1 };
  const editor = editorWith("", cursor);
  assert.equal(applyComposerAnswer(editor, "neuer Satz"), "insert");
  assert.deepEqual(editor.calls, [{ op: "insert", text: "neuer Satz", from: cursor }]);
});

test("eine leere Antwort lässt das Dokument stehen", () => {
  const editor = editorWith("alter Satz", { line: 1, ch: 0 });
  assert.equal(applyComposerAnswer(editor, "   "), "empty");
  assert.deepEqual(editor.calls, []);
});

test("eine Markdown-Notiz im Bearbeiten ist das Ziel", () => {
  const editor = editorWith("", { line: 0, ch: 0 });
  const target = composerTarget({ viewType: "markdown", mode: "source", editor, extension: "md" });
  assert.equal(target && target.kind, "markdown");
  assert.equal(target && target.editor, editor);
});

test("die Lesansicht bekommt kein schwebendes Feld", () => {
  const editor = editorWith("sichtbar", { line: 0, ch: 0 });
  assert.equal(composerTarget({ viewType: "markdown", mode: "preview", editor, extension: "md" }), null);
});

test("ein PDF bekommt kein schwebendes Feld", () => {
  const editor = editorWith("", { line: 0, ch: 0 });
  assert.equal(composerTarget({ viewType: "pdf", mode: "source", editor, extension: "pdf" }), null);
});

test("die Seitenleiste bekommt kein schwebendes Feld", () => {
  const editor = editorWith("", { line: 0, ch: 0 });
  const blocked = [
    "unitedshare-sidebar",
    "image",
    "audio",
    "video",
    "graph",
    "localgraph",
    "file-explorer",
    "search",
    "backlink",
    "outgoing-link",
    "tag",
    "outline",
    "bookmarks",
    "empty",
  ];
  for (const viewType of blocked) {
    assert.equal(composerTarget({ viewType, mode: "source", editor }), null, viewType);
  }
});

test("eine Canvas-Karte im Bearbeiten ist das Ziel", () => {
  const editor = editorWith("Karte", { line: 0, ch: 2 });
  const target = composerTarget({ viewType: "canvas", editor, extension: "canvas" });
  assert.equal(target && target.kind, "canvas");
  assert.equal(target && target.editor, editor);
});

test("eine Canvas ohne Karte bekommt kein schwebendes Feld", () => {
  assert.equal(composerTarget({ viewType: "canvas", editor: null, extension: "canvas" }), null);
});

test("eine Quelldatei im Bearbeiten ist das Ziel", () => {
  const editor = editorWith("const n = 1;", { line: 0, ch: 0 });
  const target = composerTarget({ viewType: "", mode: "source", editor, extension: "js" });
  assert.equal(target && target.kind, "source");
  assert.equal(target && target.editor, editor);
});

test("ein Bild bekommt kein schwebendes Feld", () => {
  const editor = editorWith("", { line: 0, ch: 0 });
  assert.equal(composerTarget({ viewType: "", editor, extension: "png" }), null);
});

test("eine Markierung wird als Auftrag ohne die Anweisung im Dokument beschrieben", () => {
  assert.equal(composerPrompt("  kürzer  ", "  alt  "), [
    "Bearbeite nur die markierte Stelle im offenen Dokument.",
    "Antworte nur mit dem Ersatztext.",
    "Keine Erklärung.",
    "Setze die ganze Antwort nicht in Anführungszeichen.",
    "",
    "Auftrag:",
    "kürzer",
    "",
    "Markierter Text:",
    "  alt  ",
  ].join("\n"));
});

test("ohne Markierung beschreibt der Auftrag nur den Text am Cursor", () => {
  assert.equal(composerPrompt("ergänze den Satz", ""), [
    "Schreibe an der Cursor-Stelle im offenen Dokument weiter.",
    "Antworte nur mit dem Text, der eingefügt wird.",
    "Keine Erklärung.",
    "Setze die ganze Antwort nicht in Anführungszeichen.",
    "",
    "Auftrag:",
    "ergänze den Satz",
  ].join("\n"));
  assert.equal(composerPrompt("   ", ""), "");
});

test("eine Canvas übernimmt nicht den Editor einer anderen Notiz", () => {
  const stale = editorWith("Notiz", { line: 1, ch: 0 });
  const card = editorWith("Karte", { line: 0, ch: 0 });
  assert.equal(composerViewState({
    activeLeaf: {
      view: {
        viewType: "canvas",
        file: { path: "Board.canvas", extension: "canvas" },
      },
    },
    activeEditor: { editor: stale, file: { path: "Notiz.md", extension: "md" } },
  }), null);
  const open = composerViewState({
    activeLeaf: {
      view: {
        viewType: "canvas",
        file: { path: "Board.canvas", extension: "canvas" },
      },
    },
    activeEditor: { editor: card, file: { path: "Board.canvas", extension: "canvas" } },
  });
  assert.equal(open && open.kind, "canvas");
  assert.equal(open && open.editor, card);
});

test("das Feld bleibt über der Tastatur am Cursor", () => {
  const box = composerBox(
    { left: 40, top: 700, bottom: 720, right: 48 },
    { width: 390, height: 800 },
    300,
  );
  assert.equal(box.height, 44);
  assert.equal(box.top, 448);
  assert.ok(box.top + box.height <= 800 - 300 - 8);
  assert.equal(box.left, 40);
  assert.ok(box.width <= 390 - 16);
});

function composerNode(tag) {
  const node = {
    tag,
    classList: new Set(),
    children: [],
    text: "",
    value: "",
    attrs: {},
    listeners: {},
    style: {},
    parent: null,
    focused: 0,
    focus() {
      this.focused += 1;
    },
    blur() {
      this.focused = 0;
    },
    addClass(name) {
      this.classList.add(name);
      return this;
    },
    removeClass(name) {
      this.classList.delete(name);
      return this;
    },
    createEl(childTag, opts = {}) {
      const child = composerNode(childTag);
      child.parent = this;
      if (opts.cls) {
        for (const name of String(opts.cls).split(/\s+/)) {
          if (name) child.addClass(name);
        }
      }
      if (opts.attr) child.attrs = { ...opts.attr };
      this.children.push(child);
      return child;
    },
    addEventListener(type, fn) {
      this.listeners[type] = fn;
    },
    remove() {
      if (!this.parent) return;
      this.parent.children = this.parent.children.filter((child) => child !== this);
      this.parent = null;
    },
    empty() {
      this.children = [];
    },
  };
  return node;
}

function findComposerNode(node, pred) {
  if (!node) return null;
  if (pred(node)) return node;
  for (const child of node.children || []) {
    const found = findComposerNode(child, pred);
    if (found) return found;
  }
  return null;
}

function installComposerObsidian() {
  const requests = [];
  const notices = [];
  const icons = [];
  class Notice {
    constructor(message) {
      notices.push(message);
    }
  }
  class Plugin {
    constructor(app) {
      this.app = app;
    }
    registerView() {}
    addRibbonIcon() {}
    addCommand() {}
    addSettingTab() {}
    registerEvent(ref) {
      this.events = this.events || [];
      this.events.push(ref);
      return ref;
    }
    registerDomEvent(el, type, fn) {
      if (el && typeof el.addEventListener === "function") el.addEventListener(type, fn);
    }
    async loadData() {
      return {};
    }
    async saveData() {}
  }
  class ItemView {}
  class Modal {}
  class PluginSettingTab {}
  class Setting {}
  class MarkdownView {}
  const obsidian = {
    ItemView,
    MarkdownRenderer: {},
    MarkdownView,
    Modal,
    Notice,
    Plugin,
    PluginSettingTab,
    Setting,
    addIcon() {},
    requestUrl(req) {
      requests.push(req);
      return Promise.resolve({ status: 200, json: {}, text: "" });
    },
    setIcon(el, icon) {
      icons.push(icon);
    },
  };
  const Module = require("node:module");
  const original = Module.prototype.require;
  Module.prototype.require = function (id) {
    if (id === "obsidian") return obsidian;
    return original.apply(this, arguments);
  };
  const pluginPath = require.resolve("./main.src.js");
  delete require.cache[pluginPath];
  const UnitedSharePlugin = require("./main.src.js");
  return {
    UnitedSharePlugin,
    requests,
    notices,
    icons,
    restore() {
      Module.prototype.require = original;
    },
  };
}

function composerApp(editor, view) {
  const containerEl = composerNode("div");
  const leafView = {
    viewType: view.viewType,
    mode: view.mode,
    editor: view.editor,
    file: view.file,
    getViewType() {
      return view.viewType;
    },
    getMode() {
      return view.mode;
    },
  };
  const workspace = {
    containerEl,
    activeLeaf: { view: leafView },
    activeEditor: view.activeEditor || null,
    listeners: {},
    on(name, fn) {
      this.listeners[name] = fn;
      return { name, fn };
    },
    onLayoutReady(callback) {
      callback();
    },
    rightSplit: { collapsed: true },
    getLeavesOfType() {
      return [{}];
    },
    getRightLeaf() {
      return null;
    },
    revealLeaf() {},
    detachLeavesOfType() {},
    getActiveViewOfType() {
      return null;
    },
  };
  return { workspace, vault: {} };
}

test("Enter im schwebenden Feld ersetzt die Markierung nur mit der Antwort", async () => {
  const harness = installComposerObsidian();
  const editor = editorWith("alter Satz", { line: 2, ch: 3 });
  editor.coordsAtPos = () => ({ left: 40, top: 700, bottom: 720, right: 80 });
  const previousWindow = global.window;
  const previousDocument = global.document;
  global.window = {
    innerWidth: 390,
    innerHeight: 800,
    visualViewport: { height: 500, offsetTop: 0 },
  };
  global.document = {
    documentElement: {
      style: {
        getPropertyValue(name) {
          return name === "--keyboard-height" ? "300px" : "";
        },
      },
    },
  };
  try {
    const app = composerApp(editor, {
      viewType: "markdown",
      mode: "source",
      editor,
      file: { path: "Notiz.md", extension: "md" },
    });
    const plugin = new harness.UnitedSharePlugin(app);
    const asked = [];
    plugin.completeThread = async (turns) => {
      asked.push(turns);
      return "neuer Satz";
    };
    await plugin.onload();
    const field = findComposerNode(app.workspace.containerEl, (node) => node.classList.has("unitedshare-cursor-composer"));
    assert.ok(field, "die Eingabe fehlt");
    assert.equal(field.style.top, "");
    assert.equal(field.style.bottom, "316px");
    assert.equal(field.style.left, "16px");
    assert.equal(field.style.width, "358px");
    const input = findComposerNode(field, (node) => node.classList.has("unitedshare-cursor-input"));
    assert.ok(input);
    input.value = "kürzer";
    await input.listeners.keydown({ key: "Enter", shiftKey: false, preventDefault() {} });
    assert.deepEqual(asked, [[{ role: "user", content: composerPrompt("kürzer", "alter Satz") }]]);
    assert.deepEqual(editor.calls, [{ op: "replace", text: "neuer Satz" }]);
    assert.equal(harness.requests.length, 0);
    assert.equal(input.value, "");
    plugin.onunload();
  } finally {
    if (previousWindow === undefined) delete global.window;
    else global.window = previousWindow;
    if (previousDocument === undefined) delete global.document;
    else global.document = previousDocument;
    harness.restore();
  }
});

test("Escape bei zugeklappter Seitenleiste lässt die Eingabe stehen", async () => {
  const harness = installComposerObsidian();
  const point = { line: 2, ch: 3 };
  const editor = editorWith("alter Satz", point);
  editor.coordsAtPos = () => ({ left: 24, top: 80, bottom: 96, right: 40 });
  const previousWindow = global.window;
  const previousDocument = global.document;
  global.window = { innerWidth: 800, innerHeight: 600, visualViewport: { height: 600, offsetTop: 0 } };
  global.document = { documentElement: { style: { getPropertyValue() { return ""; } } } };
  try {
    const app = composerApp(editor, {
      viewType: "markdown",
      mode: "source",
      editor,
      file: { path: "Notiz.md", extension: "md" },
    });
    const plugin = new harness.UnitedSharePlugin(app);
    const asked = [];
    plugin.completeThread = async (turns) => {
      asked.push(turns);
      return "neu";
    };
    await plugin.onload();
    const field = findComposerNode(app.workspace.containerEl, (node) => node.classList.has("unitedshare-cursor-composer"));
    const input = findComposerNode(field, (node) => node.classList.has("unitedshare-cursor-input"));
    input.focus();
    input.value = "kürzer";
    let prevented = false;
    await input.listeners.keydown({
      key: "Escape",
      preventDefault() {
        prevented = true;
      },
    });
    assert.equal(prevented, true);
    assert.equal(input.focused, 0);
    assert.equal(input.value, "kürzer");
    assert.notEqual(field.style.display, "none");
    assert.equal(field.style.bottom, "16px");
    assert.equal(field.style.top, "");
    assert.deepEqual(asked, []);
    assert.deepEqual(editor.calls, []);
    point.line = 5;
    app.workspace.listeners["editor-change"]();
    assert.notEqual(field.style.display, "none");
    assert.equal(input.value, "kürzer");
    plugin.onunload();
    assert.equal(findComposerNode(app.workspace.containerEl, (node) => node.classList.has("unitedshare-cursor-composer")), null);
  } finally {
    if (previousWindow === undefined) delete global.window;
    else global.window = previousWindow;
    if (previousDocument === undefined) delete global.document;
    else global.document = previousDocument;
    harness.restore();
  }
});

test("zeige die Graphansicht im schwebenden Feld öffnet den Graphen und lässt die Notiz stehen", async () => {
  const harness = installComposerObsidian();
  const editor = editorWith("", { line: 0, ch: 0 });
  editor.coordsAtPos = () => ({ left: 20, top: 40, bottom: 56, right: 30 });
  const previousWindow = global.window;
  const previousDocument = global.document;
  global.window = { innerWidth: 800, innerHeight: 600, visualViewport: { height: 600, offsetTop: 0 } };
  global.document = { documentElement: { style: { getPropertyValue() { return ""; } } } };
  try {
    const app = composerApp(editor, {
      viewType: "markdown",
      mode: "source",
      editor,
      file: { path: "Notiz.md", extension: "md" },
    });
    const ran = [];
    app.commands = {
      executeCommandById(id) {
        ran.push(id);
        return true;
      },
    };
    const plugin = new harness.UnitedSharePlugin(app);
    const asked = [];
    plugin.completeThread = async (turns) => {
      asked.push(turns);
      return "Graph";
    };
    await plugin.onload();
    const input = findComposerNode(app.workspace.containerEl, (node) => node.classList.has("unitedshare-cursor-input"));
    input.value = "zeige die Graphansicht";
    await input.listeners.keydown({ key: "Enter", shiftKey: false, preventDefault() {} });
    assert.deepEqual(ran, ["graph:open"]);
    assert.deepEqual(asked, []);
    assert.deepEqual(editor.calls, []);
    assert.equal(input.value, "");
    plugin.onunload();
  } finally {
    if (previousWindow === undefined) delete global.window;
    else global.window = previousWindow;
    if (previousDocument === undefined) delete global.document;
    else global.document = previousDocument;
    harness.restore();
  }
});

function markdownFace(editor) {
  return {
    viewType: "markdown",
    mode: "source",
    editor,
    file: { path: "Notiz.md", extension: "md" },
  };
}

async function runComposer(editor, view, act) {
  if (typeof editor.coordsAtPos !== "function") {
    editor.coordsAtPos = () => ({ left: 24, top: 40, bottom: 56, right: 40 });
  }
  const harness = installComposerObsidian();
  const previousWindow = global.window;
  const previousDocument = global.document;
  global.window = {
    innerWidth: 390,
    innerHeight: 800,
    visualViewport: { height: 800, offsetTop: 0 },
  };
  global.document = {
    documentElement: { style: { getPropertyValue() { return ""; } } },
  };
  try {
    const app = composerApp(editor, view);
    const plugin = new harness.UnitedSharePlugin(app);
    await plugin.onload();
    const field = findComposerNode(app.workspace.containerEl, (node) => node.classList.has("unitedshare-cursor-composer"));
    const input = field && findComposerNode(field, (node) => node.classList.has("unitedshare-cursor-input"));
    const send = field && findComposerNode(field, (node) => node.classList.has("unitedshare-cursor-send"));
    await act({ harness, app, plugin, field, input, send });
    plugin.onunload();
  } finally {
    if (previousWindow === undefined) delete global.window;
    else global.window = previousWindow;
    if (previousDocument === undefined) delete global.document;
    else global.document = previousDocument;
    harness.restore();
  }
}

test("eine Markierung aus Leerzeichen wird ersetzt", () => {
  const editor = editorWith("   ", { line: 0, ch: 1 });
  assert.equal(applyComposerAnswer(editor, "x"), "replace");
  assert.deepEqual(editor.calls, [{ op: "replace", text: "x" }]);
});

test("ohne Tastatur sitzt das Feld unter dem Cursor", () => {
  const box = composerBox({ left: 10, top: 80, bottom: 100, right: 20 }, { width: 1200, height: 800 }, 0);
  assert.equal(box.top, 108);
  assert.equal(box.height, 44);
});

test("die Eingabe sitzt unten mittig im Fenster", () => {
  const { composerDock } = require("./unitedshare-core");
  assert.equal(typeof composerDock, "function");
  assert.deepEqual(composerDock({ width: 390, height: 800 }, 0), {
    left: 16,
    bottom: 16,
    width: 358,
    height: 56,
  });
  assert.deepEqual(composerDock({ width: 1200, height: 800 }, 0), {
    left: 240,
    bottom: 16,
    width: 720,
    height: 56,
  });
  assert.equal(composerDock({ width: 390, height: 800 }, 300).bottom, 316);
  assert.deepEqual(composerDock({ width: 1400, height: 900 }, 0, { left: 260, width: 900 }), {
    left: 350,
    bottom: 16,
    width: 720,
    height: 56,
  });
  const narrow = composerDock({ width: 1400, height: 900 }, 0, { left: 40, width: 300 });
  assert.equal(narrow.width, 268);
  assert.equal(narrow.left, 56);
});

test("die Seitenleiste hält die Eingabe, solange sie offen ist", () => {
  const { sidebarPromptOpen } = require("./unitedshare-core");
  assert.equal(typeof sidebarPromptOpen, "function");
  const leavesFor = (type) => (type === "unitedshare-sidebar" ? [{}] : []);
  assert.equal(sidebarPromptOpen(null), false);
  assert.equal(sidebarPromptOpen({}), false);
  assert.equal(sidebarPromptOpen({
    getLeavesOfType() {
      return [];
    },
    rightSplit: { collapsed: true },
  }), false);
  assert.equal(sidebarPromptOpen({
    getLeavesOfType: leavesFor,
    rightSplit: { collapsed: false },
  }), true);
  assert.equal(sidebarPromptOpen({
    getLeavesOfType: leavesFor,
    rightSplit: { collapsed: true },
  }), false);
  assert.equal(sidebarPromptOpen({ getLeavesOfType: leavesFor }), true);
});

test("das schwebende Feld ist fest über dem Dokument und auf dem Handy mit 16px gesetzt", () => {
  const css = fs.readFileSync(path.join(__dirname, "styles.css"), "utf8");
  assert.match(css, /\.unitedshare-cursor-composer\s*\{[^}]*position:\s*fixed/);
  assert.match(css, /\.unitedshare-cursor-composer\s*\{[^}]*z-index:\s*30/);
  assert.match(css, /\.unitedshare-cursor-composer\s*\{[^}]*min-height:\s*56px/);
  assert.match(css, /\.unitedshare-cursor-composer\s*\{[^}]*border-radius:\s*16px/);
  assert.match(css, /\.unitedshare-cursor-composer\s*\{[^}]*gap:\s*10px/);
  assert.match(css, /\.unitedshare-cursor-composer \.unitedshare-cursor-mark\s*\{[^}]*width:\s*22px/);
  assert.match(css, /\.unitedshare-cursor-composer button\.unitedshare-cursor-send\s*\{[^}]*width:\s*32px/);
  assert.match(css, /\.unitedshare-cursor-composer button\.unitedshare-cursor-send\s*\{[^}]*border-radius:\s*10px/);
  assert.match(css, /\.unitedshare-cursor-composer button\.unitedshare-cursor-send\s*\{[^}]*background:\s*var\(--interactive-accent\)/);
  assert.match(css, /\.unitedshare-cursor-composer button\.unitedshare-cursor-send\s*\{[^}]*color:\s*var\(--text-on-accent\)/);
  assert.match(css, /body\.is-mobile \.unitedshare-cursor-composer textarea\.unitedshare-cursor-input\s*\{[^}]*font-size:\s*16px/);
});

test("der Senden-Knopf im schwebenden Feld trägt den Pfeil nach oben", async () => {
  const editor = editorWith("", { line: 0, ch: 0 });
  await runComposer(editor, markdownFace(editor), ({ harness }) => {
    assert.deepEqual(harness.icons, ["arrow-up"]);
  });
});

test("die Anleitung beschreibt die Eingabe unten im Fenster", () => {
  const readme = fs.readFileSync(path.join(__dirname, "README.md"), "utf8");
  assert.match(readme, /Seitenleiste zugeklappt/);
  assert.match(readme, /unten im Fenster/);
  assert.match(readme, /UnitedShareAI/);
  assert.match(readme, /nur durch die Antwort ersetzt/);
  const manifestVersion = JSON.parse(fs.readFileSync(path.join(__dirname, "manifest.json"), "utf8")).version;
  assert.ok(readme.includes(`Release-Tag \`${manifestVersion}\``),
    `die Anleitung nennt nicht ${manifestVersion}`);
  assert.doesNotMatch(readme, /schwebendes Feld an der Cursor-Stelle/);
});

test("Enter ohne Markierung fügt nur die Antwort am Cursor ein", async () => {
  const cursor = { line: 4, ch: 2 };
  const editor = editorWith("", cursor);
  await runComposer(editor, markdownFace(editor), async ({ input, plugin }) => {
    const asked = [];
    plugin.completeThread = async (turns) => {
      asked.push(turns);
      return "Fortsetzung";
    };
    input.value = "ergänze den Satz";
    await input.listeners.keydown({ key: "Enter", shiftKey: false, preventDefault() {} });
    assert.deepEqual(asked, [[{ role: "user", content: composerPrompt("ergänze den Satz", "") }]]);
    assert.deepEqual(editor.calls, [{ op: "insert", text: "Fortsetzung", from: cursor }]);
    assert.equal(input.value, "");
  });
});

test("Lesansicht, PDF, Bild und die Seitenleiste blenden das schwebende Feld aus", async () => {
  const faces = [
    { viewType: "markdown", mode: "preview", file: { path: "Notiz.md", extension: "md" } },
    { viewType: "pdf", mode: "source", file: { path: "A.pdf", extension: "pdf" } },
    { viewType: "", mode: "source", file: { path: "A.png", extension: "png" } },
    { viewType: "unitedshare-sidebar", mode: "source", file: null },
  ];
  for (const face of faces) {
    const editor = editorWith("sichtbar", { line: 0, ch: 0 });
    await runComposer(editor, { ...face, editor }, ({ field }) => {
      assert.ok(field, face.viewType || face.file.extension);
      assert.equal(field.style.display, "none", face.viewType || face.file.extension);
    });
  }
});

test("Canvas-Karte und Quelldatei zeigen das schwebende Feld", async () => {
  const card = editorWith("Karte", { line: 0, ch: 1 });
  await runComposer(card, {
    viewType: "canvas",
    mode: "source",
    editor: card,
    file: { path: "Board.canvas", extension: "canvas" },
    activeEditor: { editor: card, file: { path: "Board.canvas", extension: "canvas" } },
  }, ({ field }) => {
    assert.notEqual(field.style.display, "none");
  });
  const source = editorWith("const n = 1;", { line: 1, ch: 0 });
  await runComposer(source, {
    viewType: "",
    mode: "source",
    editor: source,
    file: { path: "app.js", extension: "js" },
  }, ({ field }) => {
    assert.notEqual(field.style.display, "none");
  });
});

test("Umschalt-Enter schickt den Auftrag nicht", async () => {
  const editor = editorWith("Satz", { line: 0, ch: 0 });
  await runComposer(editor, markdownFace(editor), async ({ input, plugin }) => {
    const asked = [];
    plugin.completeThread = async () => {
      asked.push("asked");
      return "neu";
    };
    input.value = "zwei Zeilen";
    await input.listeners.keydown({ key: "Enter", shiftKey: true, preventDefault() {} });
    assert.deepEqual(asked, []);
    assert.deepEqual(editor.calls, []);
    assert.equal(input.value, "zwei Zeilen");
  });
});

test("eine leere Antwort lässt Auftrag und Dokument stehen", async () => {
  const editor = editorWith("alter Satz", { line: 1, ch: 0 });
  await runComposer(editor, markdownFace(editor), async ({ input, plugin }) => {
    plugin.completeThread = async () => "   ";
    input.value = "kürzer";
    await input.listeners.keydown({ key: "Enter", shiftKey: false, preventDefault() {} });
    assert.deepEqual(editor.calls, []);
    assert.equal(input.value, "kürzer");
  });
});

test("ein fehlgeschlagener Aufruf lässt Auftrag und Dokument stehen", async () => {
  const editor = editorWith("alter Satz", { line: 1, ch: 0 });
  await runComposer(editor, markdownFace(editor), async ({ input, plugin, harness }) => {
    plugin.completeThread = async () => {
      throw new UnitedShareError("Der Schlüssel fehlt.");
    };
    input.value = "kürzer";
    await input.listeners.keydown({ key: "Enter", shiftKey: false, preventDefault() {} });
    assert.deepEqual(harness.notices, ["Der Schlüssel fehlt."]);
    assert.equal(input.value, "kürzer");
    assert.deepEqual(editor.calls, []);
  });
  const plain = editorWith("alter Satz", { line: 1, ch: 0 });
  await runComposer(plain, markdownFace(plain), async ({ input, plugin, harness }) => {
    plugin.completeThread = async () => {
      throw new Error("netz");
    };
    input.value = "kürzer";
    await input.listeners.keydown({ key: "Enter", shiftKey: false, preventDefault() {} });
    assert.deepEqual(harness.notices, ["Der Modellaufruf ist fehlgeschlagen."]);
    assert.equal(input.value, "kürzer");
    assert.deepEqual(plain.calls, []);
  });
});

test("während der Auftrag läuft bleibt das Feld leer, Senden ist aus und das Zeichen läuft", async () => {
  const editor = editorWith("alter Satz", { line: 2, ch: 0 });
  await runComposer(editor, markdownFace(editor), async ({ input, send, field, plugin }) => {
    let release;
    let calls = 0;
    plugin.completeThread = () => {
      calls += 1;
      return new Promise((resolve) => {
        release = resolve;
      });
    };
    input.value = "kürzer";
    input.listeners.keydown({ key: "Enter", shiftKey: false, preventDefault() {} });
    assert.equal(input.value, "");
    assert.equal(send.disabled, true);
    assert.equal(input.disabled, true);
    assert.equal(field.classList.has("is-busy"), true);
    const loader = findComposerNode(field, (node) => node.classList.has("unitedshare-loader"));
    assert.ok(loader);
    assert.match(String(loader.html || loader.innerHTML || ""), /unitedshare-mark/);
    input.listeners.keydown({ key: "Enter", shiftKey: false, preventDefault() {} });
    assert.equal(calls, 1);
    release("neuer Satz");
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(send.disabled, false);
    assert.equal(input.disabled, false);
    assert.equal(field.classList.has("is-busy"), false);
    assert.equal(input.value, "");
    assert.deepEqual(editor.calls, [{ op: "replace", text: "neuer Satz" }]);
  });
});

test("der Senden-Knopf schickt denselben Auftrag wie Enter", async () => {
  const editor = editorWith("alter Satz", { line: 2, ch: 0 });
  await runComposer(editor, markdownFace(editor), async ({ input, send, plugin }) => {
    plugin.completeThread = async () => "neuer Satz";
    input.value = "kürzer";
    await send.listeners.click();
    assert.deepEqual(editor.calls, [{ op: "replace", text: "neuer Satz" }]);
    assert.equal(input.value, "");
  });
});

test("das Feld nimmt den Fokus nicht von allein", async () => {
  const editor = editorWith("", { line: 0, ch: 0 });
  await runComposer(editor, markdownFace(editor), ({ input, app }) => {
    assert.equal(input.focused, 0);
    app.workspace.listeners["editor-change"]();
    assert.equal(input.focused, 0);
  });
});

test("ein schon geschriebener Auftrag bleibt beim Nachziehen des Cursors stehen", async () => {
  const editor = editorWith("", { line: 0, ch: 0 });
  await runComposer(editor, markdownFace(editor), ({ input, field, app }) => {
    input.value = "halb fertig";
    app.workspace.listeners["editor-change"]();
    assert.equal(input.value, "halb fertig");
    assert.notEqual(field.style.display, "none");
  });
});

test("zeige die lokale Graphansicht im schwebenden Feld öffnet den Graphen der Notiz", async () => {
  const editor = editorWith("Notiz", { line: 0, ch: 0 });
  await runComposer(editor, markdownFace(editor), async ({ input, plugin, harness }) => {
    const ran = [];
    plugin.app.commands = {
      executeCommandById(id) {
        ran.push(id);
        return true;
      },
    };
    plugin.completeThread = async () => "Graph";
    input.value = "zeige die lokale Graphansicht";
    await input.listeners.keydown({ key: "Enter", shiftKey: false, preventDefault() {} });
    assert.deepEqual(ran, ["graph:open-local"]);
    assert.deepEqual(harness.notices, ["Lokale Graphansicht ist offen."]);
    assert.deepEqual(editor.calls, []);
    assert.equal(input.value, "");
  });
});

test("ein zweiter Enter wartet, bis der erste Auftrag fertig ist", async () => {
  const editor = editorWith("alter Satz", { line: 0, ch: 0 });
  await runComposer(editor, markdownFace(editor), async ({ input, plugin }) => {
    let started = 0;
    let release;
    plugin.completeThread = () => {
      started += 1;
      return new Promise((resolve) => {
        release = () => resolve("neu");
      });
    };
    input.value = "kürzer";
    const first = input.listeners.keydown({ key: "Enter", shiftKey: false, preventDefault() {} });
    const second = input.listeners.keydown({ key: "Enter", shiftKey: false, preventDefault() {} });
    assert.equal(started, 1);
    release();
    await first;
    await second;
    assert.equal(started, 1);
    assert.deepEqual(editor.calls, [{ op: "replace", text: "neu" }]);
  });
});

function menuStub() {
  return {
    items: [],
    addItem(build) {
      const item = {
        title: "",
        icon: "",
        click: null,
        setTitle(title) {
          this.title = title;
          return this;
        },
        setIcon(icon) {
          this.icon = icon;
          return this;
        },
        onClick(fn) {
          this.click = fn;
          return this;
        },
      };
      build(item);
      this.items.push(item);
      return this;
    },
  };
}

test("die Eingabe steht unten in der Mitte der Notiz, nicht am Cursor", async () => {
  const editor = editorWith("Satz", { line: 4, ch: 2 });
  editor.coordsAtPos = () => ({ left: 24, top: 40, bottom: 56, right: 40 });
  await runComposer(editor, markdownFace(editor), ({ field, app }) => {
    app.workspace.activeLeaf.view.containerEl = {
      getBoundingClientRect() {
        return { left: 260, width: 900 };
      },
    };
    app.workspace.listeners["editor-change"]();
    assert.equal(field.style.top, "");
    assert.equal(field.style.bottom, "16px");
    assert.equal(field.style.left, "350px");
    assert.equal(field.style.width, "720px");
  });
});

test("eine zugeklappte Seitenleiste zeigt die Eingabe unten, eine offene blendet sie aus", async () => {
  const editor = editorWith("Satz", { line: 0, ch: 0 });
  await runComposer(editor, markdownFace(editor), ({ field, app }) => {
    assert.notEqual(field.style.display, "none");
    assert.equal(field.style.bottom, "16px");
    assert.equal(field.style.top, "");
    assert.equal(field.style.left, "16px");
    assert.equal(field.style.width, "358px");
    app.workspace.rightSplit.collapsed = false;
    assert.equal(typeof app.workspace.listeners["layout-change"], "function");
    app.workspace.listeners["layout-change"]();
    assert.equal(field.style.display, "none");
    app.workspace.rightSplit.collapsed = true;
    app.workspace.listeners["layout-change"]();
    assert.notEqual(field.style.display, "none");
    assert.equal(field.style.bottom, "16px");
  });
});

test("die untere Eingabe trägt das UnitedShare-Zeichen", async () => {
  const editor = editorWith("", { line: 0, ch: 0 });
  await runComposer(editor, markdownFace(editor), ({ field, input }) => {
    const mark = findComposerNode(field, (node) => node.classList.has("unitedshare-cursor-mark"));
    assert.ok(mark);
    assert.match(String(mark.innerHTML || ""), /<svg/);
    assert.equal(input.attrs.placeholder, "Nachricht an UnitedShare");
    assert.equal(input.attrs["aria-label"], "UnitedShareAI");
  });
});

test("ein Rechtsklick bietet UnitedShareAI und holt die Eingabe nach vorn", async () => {
  const editor = editorWith("Satz", { line: 1, ch: 0 });
  await runComposer(editor, markdownFace(editor), ({ field, input, app }) => {
    app.workspace.rightSplit.collapsed = false;
    assert.equal(typeof app.workspace.listeners["layout-change"], "function");
    app.workspace.listeners["layout-change"]();
    assert.equal(field.style.display, "none");
    const menu = menuStub();
    assert.equal(typeof app.workspace.listeners["editor-menu"], "function");
    app.workspace.listeners["editor-menu"](menu, editor);
    assert.equal(menu.items.length, 1);
    assert.equal(menu.items[0].title, "UnitedShareAI");
    assert.equal(menu.items[0].icon, "unitedshare");
    menu.items[0].click();
    assert.notEqual(field.style.display, "none");
    assert.equal(input.focused, 1);
    assert.equal(field.style.bottom, "16px");
    assert.equal(field.style.top, "");
  });
});

test("UnitedShareAI auf der Lesansicht öffnet keine Eingabe", async () => {
  const editor = editorWith("sichtbar", { line: 0, ch: 0 });
  await runComposer(editor, {
    viewType: "markdown",
    mode: "preview",
    editor,
    file: { path: "Notiz.md", extension: "md" },
  }, ({ field, input, app }) => {
    assert.equal(field.style.display, "none");
    const menu = menuStub();
    assert.equal(typeof app.workspace.listeners["editor-menu"], "function");
    app.workspace.listeners["editor-menu"](menu, editor);
    menu.items[0].click();
    assert.equal(field.style.display, "none");
    assert.equal(input.focused, 0);
  });
});

test("Escape blendet die erzwungene Eingabe aus, solange die Seitenleiste offen ist", async () => {
  const editor = editorWith("Satz", { line: 1, ch: 0 });
  await runComposer(editor, markdownFace(editor), async ({ field, input, app, plugin }) => {
    const asked = [];
    plugin.completeThread = async () => {
      asked.push("asked");
      return "neu";
    };
    app.workspace.rightSplit.collapsed = false;
    assert.equal(typeof app.workspace.listeners["layout-change"], "function");
    app.workspace.listeners["layout-change"]();
    const menu = menuStub();
    assert.equal(typeof app.workspace.listeners["editor-menu"], "function");
    app.workspace.listeners["editor-menu"](menu, editor);
    menu.items[0].click();
    assert.notEqual(field.style.display, "none");
    input.value = "kürzer";
    await input.listeners.keydown({ key: "Escape", preventDefault() {} });
    assert.equal(field.style.display, "none");
    assert.equal(input.value, "kürzer");
    assert.equal(input.focused, 0);
    assert.deepEqual(asked, []);
    assert.deepEqual(editor.calls, []);
    app.workspace.listeners["layout-change"]();
    assert.equal(field.style.display, "none");
  });
});

test("eine Tastatur hebt die Eingabe, die Statusleiste nicht noch einmal", async () => {
  const harness = installComposerObsidian();
  const editor = editorWith("Satz", { line: 0, ch: 0 });
  editor.coordsAtPos = () => ({ left: 20, top: 40, bottom: 56, right: 40 });
  const previousWindow = global.window;
  const previousDocument = global.document;
  global.window = {
    innerWidth: 390,
    innerHeight: 800,
    visualViewport: { height: 500, offsetTop: 0 },
  };
  global.document = {
    documentElement: {
      style: {
        getPropertyValue(name) {
          return name === "--keyboard-height" ? "300px" : "";
        },
      },
    },
    querySelector(selector) {
      if (selector === ".status-bar") {
        return { getBoundingClientRect() { return { height: 28 }; } };
      }
      return null;
    },
  };
  try {
    const app = composerApp(editor, markdownFace(editor));
    const plugin = new harness.UnitedSharePlugin(app);
    await plugin.onload();
    const field = findComposerNode(app.workspace.containerEl, (node) => node.classList.has("unitedshare-cursor-composer"));
    assert.equal(field.style.bottom, "316px");
    plugin.onunload();
  } finally {
    if (previousWindow === undefined) delete global.window;
    else global.window = previousWindow;
    if (previousDocument === undefined) delete global.document;
    else global.document = previousDocument;
    harness.restore();
  }
});

test("ohne Tastatur steht die Eingabe über der Statusleiste", async () => {
  const harness = installComposerObsidian();
  const editor = editorWith("Satz", { line: 0, ch: 0 });
  const previousWindow = global.window;
  const previousDocument = global.document;
  global.window = {
    innerWidth: 1200,
    innerHeight: 800,
    visualViewport: { height: 800, offsetTop: 0 },
  };
  global.document = {
    documentElement: { style: { getPropertyValue() { return ""; } } },
    querySelector(selector) {
      if (selector === ".status-bar") {
        return { getBoundingClientRect() { return { height: 28 }; } };
      }
      return null;
    },
  };
  try {
    const app = composerApp(editor, markdownFace(editor));
    const plugin = new harness.UnitedSharePlugin(app);
    await plugin.onload();
    const field = findComposerNode(app.workspace.containerEl, (node) => node.classList.has("unitedshare-cursor-composer"));
    assert.equal(field.style.bottom, "44px");
    assert.equal(field.style.left, "240px");
    assert.equal(field.style.width, "720px");
    assert.equal(field.style.top, "");
    plugin.onunload();
  } finally {
    if (previousWindow === undefined) delete global.window;
    else global.window = previousWindow;
    if (previousDocument === undefined) delete global.document;
    else global.document = previousDocument;
    harness.restore();
  }
});
