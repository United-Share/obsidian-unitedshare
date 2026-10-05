"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");
const test = require("node:test");
const assert = require("node:assert/strict");

const state = {
  requests: [],
  replies: [],
};

function createNode(tag) {
  const classList = new Set();
  classList.contains = (name) => classList.has(name);
  const node = {
    tag,
    classList,
    children: [],
    text: "",
    value: "",
    disabled: false,
    attrs: {},
    listeners: {},
    html: "",
    addClass(name) {
      this.classList.add(name);
      return this;
    },
    removeClass(name) {
      this.classList.delete(name);
      return this;
    },
    createEl(childTag, opts = {}) {
      const child = createNode(childTag);
      if (opts.cls) {
        for (const name of String(opts.cls).split(/\s+/)) {
          if (name) child.addClass(name);
        }
      }
      if (opts.text) child.text = opts.text;
      if (opts.attr) child.attrs = { ...opts.attr };
      this.children.push(child);
      return child;
    },
    empty() {
      this.children = [];
    },
    setText(text) {
      this.text = text;
    },
    appendText(text) {
      this.text += text;
    },
    addEventListener(type, fn) {
      this.listeners[type] = fn;
    },
    set innerHTML(html) {
      this.html = String(html);
    },
  };
  return node;
}

function find(node, pred) {
  if (pred(node)) return node;
  for (const child of node.children || []) {
    const found = find(child, pred);
    if (found) return found;
  }
  return null;
}

function installObsidianMock() {
  class Notice {}
  class Plugin {
    constructor(app) {
      this.app = app;
      this.registeredViews = [];
      this.ribbons = [];
      this.commands = [];
    }
    registerView(type, factory) {
      this.registeredViews.push({ type, factory });
    }
    addRibbonIcon(icon, title, callback) {
      this.ribbons.push({ icon, title, callback });
    }
    addCommand(command) {
      this.commands.push(command);
    }
    addSettingTab() {}
    async loadData() {
      return {};
    }
    async saveData() {}
  }
  class ItemView {
    constructor(leaf) {
      this.leaf = leaf;
      this.app = leaf.app;
      this.contentEl = createNode("div");
    }
  }
  class Modal {
    constructor(app) {
      this.app = app;
      this.contentEl = createNode("div");
    }
  }
  class PluginSettingTab {}
  class Setting {
    setName() { return this; }
    setDesc() { return this; }
    addText() { return this; }
    addButton() { return this; }
  }
  class MarkdownView {}
  const obsidian = {
    ItemView,
    MarkdownView,
    MarkdownRenderer: { async render() {} },
    Modal,
    Notice,
    Plugin,
    PluginSettingTab,
    Setting,
    setIcon(el, icon) {
      el.attrs["data-icon"] = icon;
    },
    addIcon() {},
    requestUrl: async (options) => {
      state.requests.push(options);
      const text = state.replies.length ? state.replies.shift() : "Antwort aus messages";
      return {
        status: 200,
        text,
        json: {
          type: "message",
          role: "assistant",
          content: [{ type: "text", text }],
          stop_reason: "end_turn",
        },
      };
    },
  };
  const original = Module.prototype.require;
  Module.prototype.require = function (id) {
    if (id === "obsidian") return obsidian;
    return original.apply(this, arguments);
  };
  return () => {
    Module.prototype.require = original;
  };
}

function diskVault(root) {
  const files = new Map();
  const folders = new Set([""]);
  return {
    adapter: {
      getBasePath() {
        return root;
      },
    },
    getAbstractFileByPath(rel) {
      if (files.has(rel)) return { path: rel, name: path.basename(rel) };
      if (folders.has(rel)) {
        return {
          path: rel,
          children: [...files.keys()]
            .filter((item) => item.startsWith(rel ? `${rel}/` : "") && !item.slice(rel.length + 1).includes("/"))
            .map((item) => ({ path: item, name: path.basename(item) })),
        };
      }
      return null;
    },
    getRoot() {
      return this.getAbstractFileByPath("");
    },
    async cachedRead(file) {
      if (files.has(file.path)) return files.get(file.path);
      const abs = path.join(root, file.path);
      return fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : null;
    },
    async createFolder(rel) {
      folders.add(rel);
      fs.mkdirSync(path.join(root, rel), { recursive: true });
    },
    async create(rel, content) {
      files.set(rel, String(content));
      const abs = path.join(root, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, String(content));
      return { path: rel, name: path.basename(rel) };
    },
    async modify(file, content) {
      files.set(file.path, String(content));
      fs.writeFileSync(path.join(root, file.path), String(content));
    },
  };
}

function makeApp(root) {
  const app = {
    vault: diskVault(root),
    workspace: {
      leaves: [],
      onLayoutReady(callback) {
        callback();
      },
      getLeavesOfType() {
        return [];
      },
      getRightLeaf() {
        const leaf = {
          app: null,
          async setViewState() {},
        };
        leaf.app = app;
        return leaf;
      },
      revealLeaf() {},
      detachLeavesOfType() {},
      getActiveViewOfType() {
        return null;
      },
    },
  };
  return app;
}

const restore = installObsidianMock();
const UnitedSharePlugin = require("./main.src.js");

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "us-chat-vault-"));
}

async function openChat(root) {
  state.requests = [];
  state.replies = [];
  const app = makeApp(root);
  const plugin = new UnitedSharePlugin(app);
  await plugin.onload();
  plugin.settings.apiKey = "test-key";
  plugin.settings.model = "rmxos-mega2026.1";
  plugin.settings.baseUrl = "https://api.unitedshare.ai/v1";
  const view = plugin.registeredViews[0].factory({ app });
  await view.onOpen();
  return { app, plugin, view };
}

async function ask(view, question) {
  view.questionEl.value = question;
  const button = find(view.contentEl, (node) => node.tag === "button" && node.attrs["aria-label"] === "Fragen");
  assert.ok(button, "Schaltfläche Fragen fehlt");
  await button.listeners.click();
}

function bodies() {
  return state.requests.map((call) => JSON.parse(call.body));
}

test("Fragen legt hallo.py aus einem Python-Block an und startet sie", async () => {
  const root = tempRoot();
  try {
    const { view } = await openChat(root);
    state.replies.push(
      "Ich lege die Datei an.\n\n```python\nprint('vault-ok')\n```\n",
      "hallo.py ist angelegt und gelaufen.",
    );
    await ask(view, "Lege hallo.py an und starte sie.");
    const written = path.join(root, "hallo.py");
    assert.equal(fs.existsSync(written), true);
    assert.equal(fs.readFileSync(written, "utf8"), "print('vault-ok')\n");
    assert.equal(view.answer, "hallo.py ist angelegt und gelaufen.");
    const parsed = bodies();
    assert.equal(parsed.length, 2);
    for (const body of parsed) {
      assert.equal(body.stream, false);
      assert.equal(Object.hasOwn(body, "tools"), false);
    }
    assert.equal(state.requests[0].url, "https://api.unitedshare.ai/v1/messages");
    assert.match(JSON.stringify(parsed[1].messages), /vault-ok/);
    assert.equal(view.answer.includes("```"), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Fragen liest eine benannte Notiz und schickt den Text mit", async () => {
  const root = tempRoot();
  try {
    fs.writeFileSync(path.join(root, "Willkommen.md"), "Guten Tag\n");
    const { app, view } = await openChat(root);
    app.vault.getAbstractFileByPath = (rel) => {
      if (rel === "Willkommen.md") return { path: rel, name: "Willkommen.md" };
      return null;
    };
    state.replies.push("Die Notiz sagt Guten Tag.");
    await ask(view, "Lies Willkommen.md");
    assert.equal(view.answer, "Die Notiz sagt Guten Tag.");
    const parsed = bodies();
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].stream, false);
    assert.equal(Object.hasOwn(parsed[0], "tools"), false);
    const packed = JSON.stringify(parsed[0].messages);
    assert.match(packed, /Guten Tag/);
    assert.match(packed, /Willkommen\.md/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("eine Erklärung mit Python-Block legt keine Datei an", async () => {
  const root = tempRoot();
  try {
    const { view } = await openChat(root);
    state.replies.push("print gibt Text aus.\n\n```python\nprint('vault-ok')\n```\n");
    await ask(view, "Was bedeutet print in Python?");
    assert.equal(fs.existsSync(path.join(root, "hallo.py")), false);
    assert.equal(bodies().length, 1);
    assert.equal(Object.hasOwn(bodies()[0], "tools"), false);
    assert.match(view.answer, /print gibt Text aus/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test.after(() => {
  restore();
});
