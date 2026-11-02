"use strict";

const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { UnitedShareError } = require("./unitedshare-core");

const VIEW_TYPE = "unitedshare-sidebar";
const DUCKDB_ANSICHT_VIEW_TYPE = "unitedshare-duckdb-ansicht";
const root = __dirname;
const MARK_D = "M67.562 0.672852V55.2979C67.562 63.2369 61.2603 69.6729 53.4866 69.6729H0V16.4854C0 7.75235 6.93196 0.672852 15.483 0.672852H67.562ZM48.9193 14.6729H29.7023C26.4996 14.6729 23.428 15.9679 21.1633 18.2733C18.8986 20.5786 17.6263 23.7053 17.6263 26.9655L17.6267 57.8002C17.636 58.0152 17.68 58.2276 17.7574 58.4287C17.8541 58.6801 18.0008 58.9084 18.1884 59.0993C18.3759 59.2902 18.6002 59.4396 18.8471 59.538C19.094 59.6365 19.3583 59.6819 19.6233 59.6714H27.7053C28.235 59.6714 28.7429 59.4572 29.1175 59.076C29.492 58.6948 29.7023 58.1777 29.7023 57.6386V28.9983C29.701 28.7309 29.7517 28.466 29.8515 28.2187C29.9514 27.9715 30.0984 27.7468 30.2842 27.5577C30.4698 27.3687 30.6906 27.219 30.9335 27.1174C31.1763 27.0157 31.4367 26.9641 31.6993 26.9655H48.9193C49.4489 26.9655 49.9569 26.7513 50.3314 26.3701C50.706 25.9889 50.9163 25.4719 50.9163 24.9327V16.8015C50.9168 16.2531 50.7095 15.7257 50.3375 15.3292C49.9654 14.9326 49.4575 14.6975 48.9193 14.6729Z";

function applyAttrs(node, raw) {
  const re = /([:@a-zA-Z_][-a-zA-Z0-9_:.]*)\s*=\s*"([^"]*)"/g;
  let match;
  while ((match = re.exec(raw))) {
    if (match[1] === "class") {
      for (const name of match[2].split(/\s+/)) {
        if (name) node.addClass(name);
      }
    } else {
      node.attrs[match[1]] = match[2];
    }
  }
}

function createNode(tag) {
  return {
    tag,
    classList: new Set(),
    children: [],
    text: "",
    value: "",
    disabled: false,
    attrs: {},
    listeners: {},
    style: {},
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
    setAttr(name, value) {
      if (!this.attrs) this.attrs = {};
      this.attrs[name] = String(value);
      return this;
    },
    set innerHTML(html) {
      this.html = String(html);
      this.children = [];
      const svgMatch = this.html.match(/<svg\b([^>]*)>([\s\S]*?)<\/svg>/i);
      if (svgMatch) {
        const svg = createNode("svg");
        applyAttrs(svg, svgMatch[1]);
        const pathMatch = svgMatch[2].match(/<path\b([^>]*?)\/>/i);
        if (pathMatch) {
          const path = createNode("path");
          applyAttrs(path, pathMatch[1]);
          svg.children.push(path);
        }
        this.children.push(svg);
      }
      const spanMatch = this.html.match(/<span\b([^>]*)>([\s\S]*?)<\/span>/i);
      if (spanMatch) {
        const span = createNode("span");
        applyAttrs(span, spanMatch[1]);
        span.text = spanMatch[2];
        this.children.push(span);
      }
    },
  };
}

function knopf(view, label) {
  return find(view.contentEl, (node) => node.tag === "button" && node.attrs["aria-label"] === label);
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
  const notices = [];
  class Notice {
    constructor(message) {
      notices.push(message);
    }
  }
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
    registerExtensions(extensions, type) {
      this.registeredExtensions = { extensions, type };
    }
    registerMarkdownCodeBlockProcessor(language, handler) {
      this.codeBlockProcessors = this.codeBlockProcessors || [];
      this.codeBlockProcessors.push({ language, handler });
    }
    addRibbonIcon(icon, title, callback) {
      this.ribbons.push({ icon, title, callback });
    }
    addCommand(command) {
      this.commands.push(command);
    }
    addSettingTab(tab) {
      this.settingTab = tab;
    }
    addStatusBarItem() {
      return createNode("div");
    }
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
  class FileView extends ItemView {
    constructor(leaf) {
      super(leaf);
      this.file = null;
    }
  }
  const modals = [];
  class Modal {
    constructor(app) {
      this.app = app;
      this.contentEl = createNode("div");
      modals.push(this);
    }
    open() {
      this.opened = true;
      if (typeof this.onOpen === "function") this.onOpen();
    }
    close() {}
  }
  class PluginSettingTab {
    constructor() {
      this.containerEl = createNode("div");
    }
  }
  const settings = [];
  class Setting {
    constructor() {
      settings.push(this);
      this.name = "";
      this.desc = "";
      this.dropdown = null;
      this.text = null;
    }
    setName(name) {
      this.name = name;
      return this;
    }
    setDesc(desc) {
      this.desc = desc;
      return this;
    }
    addText(build) {
      const text = {
        inputEl: {},
        value: "",
        placeholder: "",
        setPlaceholder(placeholder) {
          this.placeholder = placeholder;
          return this;
        },
        setValue(value) {
          this.value = value;
          return this;
        },
        onChange(fn) {
          this.onChangeFn = fn;
          return this;
        },
        async change(value) {
          this.value = value;
          if (this.onChangeFn) await this.onChangeFn(value);
        },
      };
      this.text = text;
      if (build) build(text);
      return this;
    }
    addDropdown(build) {
      const dropdown = {
        options: {},
        order: [],
        value: "",
        addOption(value, label) {
          if (!Object.hasOwn(this.options, value)) this.order.push(value);
          this.options[value] = label;
          return this;
        },
        setValue(value) {
          this.value = value;
          return this;
        },
        getValue() {
          return this.value;
        },
        onChange(fn) {
          this.onChangeFn = fn;
          return this;
        },
        async change(value) {
          this.value = value;
          if (this.onChangeFn) await this.onChangeFn(value);
        },
      };
      this.dropdown = dropdown;
      if (build) build(dropdown);
      return this;
    }
    addToggle(build) {
      const toggle = {
        value: false,
        disabled: false,
        setValue(value) {
          this.value = Boolean(value);
          return this;
        },
        getValue() {
          return this.value;
        },
        setDisabled(disabled) {
          this.disabled = Boolean(disabled);
          return this;
        },
        onChange(fn) {
          this.onChangeFn = fn;
          return this;
        },
        async change(value) {
          this.value = Boolean(value);
          if (this.onChangeFn) await this.onChangeFn(this.value);
        },
      };
      this.toggle = toggle;
      if (build) build(toggle);
      return this;
    }
    addButton() {
      return this;
    }
  }
  class MarkdownView {}
  function setIcon(el, icon) {
    el.attrs["data-icon"] = icon;
  }
  const icons = [];
  function addIcon(id, svg) {
    icons.push({ id, svg });
  }
  const rendered = [];
  const requests = [];
  let hold = null;
  const MarkdownRenderer = {
    async render(_app, markdown, el, sourcePath, component) {
      rendered.push({ markdown, el, sourcePath, component });
      el.text = "";
      for (const match of markdown.matchAll(/\*\*(.+?)\*\*/g)) {
        el.createEl("strong", { text: match[1] });
      }
      if (/(^|\n)\s*[-*]\s/.test(markdown)) el.createEl("ul");
    },
  };

  const Platform = { isMobile: false };
  const obsidian = {
    FileView,
    ItemView,
    MarkdownView,
    MarkdownRenderer,
    Modal,
    Notice,
    Platform,
    Plugin,
    PluginSettingTab,
    Setting,
    setIcon,
    addIcon,
    requestUrl: async (options) => {
      requests.push(options);
      const url = String(options.url || "");
      if (!url.endsWith("/models") && hold) await hold;
      const authorization = options.headers && options.headers.Authorization;
      if (url.endsWith("/models")) {
        if (authorization === "Bearer rejected-key") {
          return { status: 401, text: "", json: {} };
        }
        return {
          status: 200,
          text: "",
          json: {
            object: "list",
            data: [
              { id: "devstral" },
              { id: "reemax-cortex" },
              { id: "rmxos-sema2026.1" },
              { id: "rmxos-mega2026.1" },
              { id: "  " },
              { id: "rmxos-mega2026.1" },
              { id: "rmxos-mobil2026.1" },
              { id: "nemotron-3-nano" },
            ],
          },
        };
      }
      return {
        status: 200,
        text: JSON.stringify({ type: "message", role: "assistant", content: [{ type: "text", text: "Antwort aus messages" }], stop_reason: "end_turn" }),
        json: {
          type: "message",
          role: "assistant",
          content: [{ type: "text", text: "Antwort aus messages" }],
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
  return {
    notices,
    rendered,
    icons,
    requests,
    holdMessages() {
      let release;
      hold = new Promise((resolve) => {
        release = resolve;
      });
      return () => {
        const done = release;
        hold = null;
        release = null;
        if (done) done();
      };
    },
    MarkdownView,
    Platform,
    settings,
    modals,
    restore() {
      Module.prototype.require = original;
    },
  };
}

function makeApp() {
  const app = {
    workspace: {
      opened: [],
      revealed: [],
      detached: [],
      leaves: [],
      activeView: null,
      onLayoutReady(callback) {
        callback();
      },
      getLeavesOfType(type) {
        return this.leaves.filter((leaf) => leaf.type === type);
      },
      getRightLeaf() {
        const leaf = { type: null, app: null };
        leaf.app = app;
        leaf.setViewState = async (state) => {
          leaf.type = state.type;
          app.workspace.opened.push(state);
          if (!app.workspace.leaves.includes(leaf)) app.workspace.leaves.push(leaf);
        };
        return leaf;
      },
      revealLeaf(leaf) {
        this.revealed.push(leaf);
      },
      detachLeavesOfType(type) {
        this.detached.push(type);
      },
      getActiveViewOfType() {
        return this.activeView;
      },
    },
  };
  return app;
}

const mock = installObsidianMock();
const UnitedSharePlugin = require("./main.src.js");

test("rmxos-Block verwendet Eigenschaften seiner Quelldatei statt der aktiven Notiz", async () => {
  const app = makeApp();
  const gefragt = [];
  app.metadataCache = { getCache: (path) => { gefragt.push(path); return { frontmatter: { date: "31.10.2026" } }; } };
  const plugin = new UnitedSharePlugin(app);
  await plugin.onload();
  const el = createNode("div");
  plugin.codeBlockProcessors.find((p) => p.language === "rmxos").handler('result("r").ok().value("Datum {{$date}}")', el, { sourcePath: "eingebettet.md" });
  assert.deepEqual(gefragt, ["eingebettet.md"]);
  assert.ok(find(el, (node) => node.tag === "td" && node.text === "Datum 31.10.2026"));
});

test("eine zusammengesetzte Eigenschaft (owner aus name und surname) wird im Block aufgelöst", async () => {
  const app = makeApp();
  app.metadataCache = {
    getCache: () => ({ frontmatter: { name: "Karina", surname: "Gutman", owner: "{{$name}} {{$surname}}" } }),
  };
  const plugin = new UnitedSharePlugin(app);
  await plugin.onload();
  const el = createNode("div");
  plugin.codeBlockProcessors.find((p) => p.language === "rmxos").handler('result("r").ok().value("von {{$owner}}")', el, { sourcePath: "n.md" });
  assert.ok(find(el, (node) => node.tag === "td" && node.text === "von Karina Gutman"));
});

test("unlesbare Eigenschaften mit {{ im Block nennen die Ursache statt nur Platzhalter zu zeigen", async () => {
  const app = makeApp();
  // Obsidian liefert bei ungueltigem YAML kein Objekt als frontmatter.
  app.metadataCache = { getCache: () => ({ frontmatter: undefined }) };
  const plugin = new UnitedSharePlugin(app);
  await plugin.onload();
  const el = createNode("div");
  plugin.codeBlockProcessors.find((p) => p.language === "rmxos").handler('result("r").ok().value("{{$owner}}")', el, { sourcePath: "n.md" });
  const hinweis = find(el, (node) => node.tag === "div" && String(node.text || "").includes("Eigenschaften nicht lesbar"));
  assert.ok(hinweis, "der Hinweis muss die YAML-Ursache benennen");
  assert.match(hinweis.text, /Anführungszeichen/u);
});

test("ein Block ohne Eigenschaftsplatzhalter erhält keinen YAML-Hinweis", async () => {
  const app = makeApp();
  app.metadataCache = { getCache: () => ({ frontmatter: undefined }) };
  const plugin = new UnitedSharePlugin(app);
  await plugin.onload();
  const el = createNode("div");
  plugin.codeBlockProcessors.find((p) => p.language === "rmxos").handler('result("r").ok().value("ohne Platzhalter")', el, { sourcePath: "n.md" });
  assert.equal(find(el, (node) => String(node.text || "").includes("Eigenschaften nicht lesbar")), null);
});

test("Verweise in Eigenschaften werden zu echten Obsidian-Links mit Alias", async () => {
  const app = makeApp();
  const geoefnet = [];
  app.workspace.openLinkText = (verweis, quelle) => geoefnet.push({ verweis, quelle });
  app.metadataCache = {
    getCache: () => ({ frontmatter: { link: "[[duckdb-codeblock-test|DuckDB-Testnotiz]]" } }),
    getFirstLinkpathDest: (ziel, quelle) => (ziel === "duckdb-codeblock-test" && quelle === "eingebettet.md" ? { path: "duckdb-codeblock-test.md" } : null),
  };
  const plugin = new UnitedSharePlugin(app);
  await plugin.onload();
  const el = createNode("div");
  plugin.codeBlockProcessors.find((p) => p.language === "rmxos").handler('result("r").ok().value("Siehe {{$link}}")', el, { sourcePath: "eingebettet.md" });
  const verweis = find(el, (node) => node.tag === "a" && node.classList.has("internal-link"));
  assert.ok(verweis, "die Zelle enthält einen echten Link");
  assert.equal(verweis.text, "DuckDB-Testnotiz");
  assert.equal(verweis.attrs["data-href"], "duckdb-codeblock-test.md");
  let verhindert = 0;
  verweis.listeners.click({ preventDefault() { verhindert += 1; }, stopPropagation() { verhindert += 1; } });
  assert.deepEqual(geoefnet, [{ verweis: "duckdb-codeblock-test", quelle: "eingebettet.md" }]);
  assert.equal(verhindert, 2);
});

test("Unaufgelöste Verweise und Einbettungen bleiben Text und SQL-Ergebnisse unberührt", async () => {
  const app = makeApp();
  app.workspace.openLinkText = () => {};
  app.metadataCache = {
    getCache: () => ({ frontmatter: { quelle: "[[fehlt-noch]]", einbettung: "![[duckdb-codeblock-test]]" } }),
    getFirstLinkpathDest: () => null,
  };
  const plugin = new UnitedSharePlugin(app);
  await plugin.onload();
  const processor = plugin.codeBlockProcessors.find((p) => p.language === "rmxos");
  const el = createNode("div");
  processor.handler('result("r").ok().value("{{$quelle}} {{$einbettung}}")', el, { sourcePath: "n.md" });
  assert.ok(find(el, (node) => node.tag === "a" && node.classList.has("is-unresolved")), "unbekannte Ziele sind als unresolved markiert");
  assert.equal(find(el, (node) => node.tag === "a" && String(node.text || "").includes("duckdb")), null, "Einbettungen werden nicht aufgelöst");

  const sql = createNode("div");
  const { renderDuckdbTabelle, zelltextMitVerweisen } = require("./main.src.js");
  renderDuckdbTabelle(sql, { spalten: ["text"], zeilen: [["[[duckdb-codeblock-test]]"]] });
  const zelle = find(sql, (node) => node.tag === "td");
  assert.equal(zelle.text, "[[duckdb-codeblock-test]]", "SQL-Ergebnisse bleiben reiner Text");
  assert.equal(find(sql, (node) => node.tag === "a"), null);
});

test("Auflösung funktioniert auch ohne globales .attrs (echtes Obsidian-DOM)", async () => {
  const app = makeApp();
  app.workspace.openLinkText = () => {};
  app.metadataCache = { getFirstLinkpathDest: () => ({ path: "duckdb-codeblock-test.md" }) };
  const { zelltextMitVerweisen } = require("./main.src.js");
  const zelle = createNode("td");
  delete zelle.attrs; // echtes Obsidian-DOM hat kein .attrs
  zelltextMitVerweisen(zelle, "[[duckdb-codeblock-test]]", app, "n.md");
  assert.equal(zelle.children[0].attrs["data-href"], "duckdb-codeblock-test.md");
  assert.equal(zelle.children[0].classList.has("is-unresolved"), false);
});

test("onload zeigt UnitedShare in der rechten Seitenleiste und in der linken Leiste", async () => {
  const app = makeApp();
  const plugin = new UnitedSharePlugin(app);
  await plugin.onload();

  assert.equal(plugin.registeredViews.length, 2);
  assert.equal(plugin.registeredViews[0].type, VIEW_TYPE);
  assert.equal(plugin.registeredViews[1].type, DUCKDB_ANSICHT_VIEW_TYPE);
  assert.deepEqual([...plugin.registeredExtensions.extensions].sort(), ["duckdb", "parquet", "sql"]);
  assert.equal(plugin.registeredExtensions.type, DUCKDB_ANSICHT_VIEW_TYPE);
  assert.equal(plugin.ribbons.length, 1);
  assert.equal(plugin.ribbons[0].icon, "unitedshare");
  const ribbonMark = mock.icons.find((icon) => icon.id === "unitedshare");
  assert.ok(ribbonMark, "das Leisten-Icon ist das UnitedShare-Zeichen");
  assert.equal(ribbonMark.svg.includes("<svg"), false);
  assert.equal(ribbonMark.svg.includes(MARK_D), true);
  assert.equal(ribbonMark.svg.includes('fill="currentColor"'), true);
  assert.equal(ribbonMark.svg.includes("translate(1.428571 0) scale(1.428571)"), true);
  assert.equal(plugin.ribbons[0].title, "UnitedShare");
  assert.equal(app.workspace.opened.length, 1);
  assert.equal(app.workspace.opened[0].type, VIEW_TYPE);
  assert.equal(app.workspace.opened[0].active, true);
  assert.equal(app.workspace.revealed.length, 1);

  const openCommand = plugin.commands.find((command) => command.id === "open-unitedshare-sidebar");
  assert.ok(openCommand, "Befehl für die Seitenleiste fehlt");
  assert.equal(openCommand.name, "UnitedShare in der Seitenleiste");
  await plugin.ribbons[0].callback();
  assert.equal(app.workspace.opened.length, 1, "ein zweites Öffnen legt keine weitere Ansicht an");
  assert.equal(app.workspace.revealed.length, 2);

  plugin.onunload();
  assert.deepEqual(app.workspace.detached, [VIEW_TYPE, DUCKDB_ANSICHT_VIEW_TYPE]);
});

test("onload gibt den Start frei, bevor das Layout eines großen Tresors fertig ist", { timeout: 1000 }, async () => {
  const app = makeApp();
  let layoutCallback = null;
  let listed = 0;
  app.workspace.onLayoutReady = (callback) => {
    layoutCallback = callback;
  };
  app.vault = {
    getFiles() {
      listed += 1;
      throw new Error("getFiles");
    },
  };
  const plugin = new UnitedSharePlugin(app);
  await plugin.onload();
  assert.equal(listed, 0);
  assert.equal(app.workspace.opened.length, 0);
  assert.equal(typeof layoutCallback, "function");
  layoutCallback();
  await Promise.resolve();
  assert.equal(app.workspace.opened.length, 1);
  assert.equal(app.workspace.opened[0].type, VIEW_TYPE);
});

test("die Seitenansicht stellt die Frage und schreibt Frage plus Antwort in die Notiz", async () => {
  const app = makeApp();
  const plugin = new UnitedSharePlugin(app);
  await plugin.onload();
  const asked = [];
  plugin.completeThread = async (turns) => {
    asked.push(turns);
    return "Antworttext";
  };

  const view = plugin.registeredViews[0].factory({ app });
  assert.equal(view.getViewType(), VIEW_TYPE);
  assert.equal(view.getDisplayText(), "UnitedShare");
  assert.equal(view.getIcon(), "unitedshare");
  await view.onOpen();

  const welcome = find(view.contentEl, (node) => node.classList.has("unitedshare-welcome"));
  const lockup = find(view.contentEl, (node) => node.classList.has("unitedshare-lockup"));
  const mark = lockup && lockup.children.find((node) => node.tag === "svg");
  const markPath = mark && mark.children.find((node) => node.tag === "path");
  const wordmark = lockup && lockup.children.find((node) => node.classList.has("unitedshare-wordmark"));
  const messages = find(view.contentEl, (node) => node.classList.has("unitedshare-messages"));
  const composer = find(view.contentEl, (node) => node.classList.has("unitedshare-input-wrapper"));
  const badge = find(view.contentEl, (node) => node.classList.has("unitedshare-tab-badge") && node.text === "1");
  const askButton = find(view.contentEl, (node) => node.tag === "button" && node.attrs["aria-label"] === "Fragen");
  const insertButton = knopf(view, "Antwort");
  const newConversation = find(view.contentEl, (node) => node.tag === "button" && node.attrs["aria-label"] === "Neues Gespräch");
  assert.equal(find(view.contentEl, (node) => node.tag === "a" && node.attrs.href === "https://unitedshare.ai/privacy"), null);
  assert.equal(find(view.contentEl, (node) => node.tag === "h3"), null);
  assert.ok(welcome);
  assert.ok(lockup);
  assert.equal(mark.attrs.viewBox, "0 0 68 70");
  assert.equal(mark.classList.has("unitedshare-mark"), true);
  assert.equal(markPath.attrs.d, MARK_D);
  assert.equal(markPath.attrs.fill, "currentColor");
  assert.equal(wordmark.text, "UnitedShare");
  assert.equal(find(view.contentEl, (node) => node.classList.has("unitedshare-welcome-text")), null);
  assert.ok(messages);
  assert.ok(composer);
  assert.ok(badge);
  assert.ok(badge.classList.has("unitedshare-tab-badge-active"));
  assert.equal(view.questionEl.classList.has("unitedshare-input"), true);
  assert.equal(askButton.attrs["data-icon"], "arrow-up");
  assert.equal(newConversation.attrs["data-icon"], "square-pen");
  assert.ok(insertButton);
  await plugin.settingTab.display();
  const privacy = find(plugin.settingTab.statusHost, (node) => node.tag === "a" && node.attrs.href === "https://unitedshare.ai/privacy");
  assert.ok(privacy);
  assert.equal(privacy.text, "Datenschutz");

  view.questionEl.value = "   ";
  await askButton.listeners.click();
  assert.deepEqual(asked, []);
  assert.match(view.statusEl.text, /Frage/);

  view.questionEl.value = "Was steht in der Notiz?";
  await askButton.listeners.click();
  assert.deepEqual(asked, [[{ role: "user", content: "Was steht in der Notiz?" }]]);
  assert.equal(view.answerEl.text, "Antworttext");
  assert.equal(askButton.disabled, false);
  const userBubble = find(view.contentEl, (node) => node.classList.has("unitedshare-message-user"));
  const assistantBubble = find(view.contentEl, (node) => node.classList.has("unitedshare-message-assistant"));
  assert.ok(userBubble);
  assert.ok(assistantBubble);
  assert.equal(find(view.contentEl, (node) => node.classList.has("unitedshare-welcome")), null);

  const editor = {
    cursor: { line: 2, ch: 0 },
    replaced: null,
    getCursor() {
      return this.cursor;
    },
    replaceRange(text, cursor) {
      this.replaced = { text, cursor };
    },
  };
  app.workspace.activeView = { editor };
  insertButton.listeners.click();
  assert.deepEqual(editor.replaced, {
    text: "Was steht in der Notiz?\n\nAntworttext\n",
    cursor: editor.cursor,
  });

  view.questionEl.value = "Und weiter?";
  await askButton.listeners.click();
  assert.deepEqual(asked[1], [
    { role: "user", content: "Was steht in der Notiz?" },
    { role: "assistant", content: "Antworttext" },
    { role: "user", content: "Und weiter?" },
  ]);

  await newConversation.listeners.click();
  assert.ok(find(view.contentEl, (node) => node.classList.has("unitedshare-welcome")));
  view.questionEl.value = "Neue Frage";
  await askButton.listeners.click();
  assert.deepEqual(asked[2], [{ role: "user", content: "Neue Frage" }]);
});

test("der Tresor-Index ist ein Desktop-Befehl und sucht ohne Ordner nicht", async () => {
  const app = makeApp();
  const plugin = new UnitedSharePlugin(app);
  await plugin.onload();
  const befehl = plugin.commands.find((command) => command.id === "vault-index-bge");
  assert.ok(befehl);
  assert.equal(befehl.name, "Tresor-Index für bge-m3 nachziehen");

  const vorher = mock.requests.length;
  await befehl.callback();
  assert.equal(mock.notices.at(-1), "Der Tresor-Index liegt neben dem Plugin.");
  assert.equal(mock.requests.length, vorher);

  plugin.completeThread = async () => "Antworttext";
  const view = plugin.registeredViews[0].factory({ app });
  await view.onOpen();
  const askButton = find(view.contentEl, (node) => node.tag === "button" && node.attrs["aria-label"] === "Fragen");
  view.questionEl.value = "Was steht in der Notiz?";
  await askButton.listeners.click();
  assert.equal(mock.requests.length, vorher);

  mock.Platform.isMobile = true;
  try {
    await befehl.callback();
    assert.equal(mock.notices.at(-1), "Der Tresor-Index läuft in der Desktop-App.");
  } finally {
    mock.Platform.isMobile = false;
  }
});

test("ein Embedding-Fehler im Tresor hält die Frage nicht auf", async () => {
  const app = makeApp();
  const plugin = new UnitedSharePlugin(app);
  await plugin.onload();
  const asked = [];
  plugin.completeThread = async (turns) => {
    asked.push(turns);
    return "Antworttext";
  };
  plugin.sucheTresor = async () => {
    throw new UnitedShareError("Das lokale Embedding auf diesem Rechner antwortet nicht.");
  };
  const view = plugin.registeredViews[0].factory({ app });
  await view.onOpen();
  const askButton = find(view.contentEl, (node) => node.tag === "button" && node.attrs["aria-label"] === "Fragen");
  view.questionEl.value = "Wo liegt der Satz?";
  await askButton.listeners.click();
  assert.equal(asked.length, 1);
  assert.equal(mock.notices.includes("Das lokale Embedding auf diesem Rechner antwortet nicht."), true);
});

test("ein Anhang gewinnt vor demselben Pfad im Tresor", async () => {
  const app = makeApp();
  const plugin = new UnitedSharePlugin(app);
  await plugin.onload();
  const asked = [];
  plugin.completeThread = async (turns) => {
    asked.push(turns);
    return "Antworttext";
  };
  plugin.embedForFrontier = async () => [{ path: "A.md", text: "ANGEHANGEN" }];
  plugin.sucheTresor = async () => [
    { pfad: "A.md", stueck: 0, text: "INDEX", score: 0.9 },
    { pfad: "B.md", stueck: 0, text: "NEU", score: 0.4 },
  ];
  const view = plugin.registeredViews[0].factory({ app });
  await view.onOpen();
  view.attachments = ["A.md"];
  const askButton = find(view.contentEl, (node) => node.tag === "button" && node.attrs["aria-label"] === "Fragen");
  view.questionEl.value = "Was steht bei Alpha?";
  await askButton.listeners.click();
  assert.deepEqual(asked[0][0].files, [
    { path: "A.md", text: "ANGEHANGEN" },
    { path: "B.md", text: "NEU" },
  ]);
  assert.equal(JSON.stringify(asked).includes("vektor"), false);
});

test("während die Frage läuft sind die Knöpfe aus, das Feld leer und das Zeichen läuft", async () => {
  const app = makeApp();
  const plugin = new UnitedSharePlugin(app);
  await plugin.onload();
  const view = plugin.registeredViews[0].factory({ app });
  await view.onOpen();
  let release;
  plugin.completeThread = () => new Promise((resolve) => {
    release = resolve;
  });
  view.questionEl.value = "Was steht in der Notiz?";
  const pending = view.askButton.listeners.click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(view.questionEl.value, "");
  const labels = ["Fragen", "Antwort", "Notiz", "Einfügen", "Mermaid", "Link", "Neuer Tab", "Neues Gespräch", "Verlauf"];
  for (const label of labels) {
    const button = find(view.contentEl, (node) => node.tag === "button" && node.attrs["aria-label"] === label);
    assert.equal(button.disabled, true, label);
  }
  assert.equal(view.modelSelectEl.disabled, true);
  const wrap = find(view.contentEl, (node) => node.classList.has("unitedshare-input-wrapper"));
  assert.equal(wrap.classList.has("is-busy"), true);
  const loader = find(wrap, (node) => node.classList.has("unitedshare-loader"));
  assert.ok(loader);
  assert.match(loader.html || loader.innerHTML || "", /unitedshare-mark/);
  release("Antworttext");
  await pending;
  assert.equal(view.askButton.disabled, false);
  assert.equal(view.insertButton.disabled, false);
  assert.equal(wrap.classList.has("is-busy"), false);
  assert.equal(view.questionEl.value, "");
  const css = fs.readFileSync(path.join(root, "styles.css"), "utf8");
  assert.match(css, /@keyframes unitedshare-loader/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
});

test("die Assistentenantwort wird als Markdown gesetzt und die Nutzerblase bleibt Klartext", async () => {
  const app = makeApp();
  const plugin = new UnitedSharePlugin(app);
  await plugin.onload();
  const markdown = "- **Notizen erstellen**: Markdown, Tags.";
  plugin.completeThread = async () => markdown;
  const view = plugin.registeredViews[0].factory({ app });
  await view.onOpen();
  view.questionEl.value = "was kannst du für mich tun hier?";
  await view.askButton.listeners.click();

  const user = find(view.contentEl, (node) => node.classList.has("unitedshare-message-user"));
  const userContent = user.children.find((node) => node.classList.has("unitedshare-message-content"));
  assert.equal(userContent.text, "was kannst du für mich tun hier?");
  assert.equal(userContent.children.length, 0);

  const assistant = find(view.contentEl, (node) => node.classList.has("unitedshare-message-assistant"));
  const content = assistant.children.find((node) => node.classList.has("unitedshare-message-content"));
  assert.equal(content.text.includes("**"), false);
  assert.ok(content.children.some((node) => node.tag === "strong" && node.text === "Notizen erstellen"));
  assert.ok(content.children.some((node) => node.tag === "ul"));
  assert.equal(view.answerEl.text, markdown);
  assert.equal(mock.rendered.filter((call) => call.markdown === markdown).length, 1);
  assert.equal(mock.rendered.some((call) => call.markdown === "was kannst du für mich tun hier?"), false);

  const css = fs.readFileSync(path.join(root, "styles.css"), "utf8");
  assert.match(css, /\.unitedshare-message-assistant > \.unitedshare-message-content\s*\{[^}]*white-space:\s*normal/);
});

test("Verlauf schaltet das Menü über classList.contains", async () => {
  const app = makeApp();
  const plugin = new UnitedSharePlugin(app);
  await plugin.onload();
  const view = plugin.registeredViews[0].factory({ app });
  await view.onOpen();
  const menu = find(view.contentEl, (node) => node.classList.has("unitedshare-history-menu"));
  menu.classList.has = () => {
    throw new TypeError("classList.has is not a function");
  };
  menu.classList.contains = (name) => Set.prototype.has.call(menu.classList, name);
  const history = find(view.contentEl, (node) => node.tag === "button" && node.attrs["aria-label"] === "Verlauf");
  history.listeners.click();
  assert.equal(menu.classList.contains("is-open"), true);
  history.listeners.click();
  assert.equal(menu.classList.contains("is-open"), false);
});

test("eine abgelehnte Frage bleibt in der Seitenleiste sichtbar", async () => {
  const { UnitedShareError } = require("./unitedshare-core");
  const app = makeApp();
  const plugin = new UnitedSharePlugin(app);
  await plugin.onload();
  plugin.completeThread = async () => {
    throw new UnitedShareError("Der UnitedShare-API-Key wurde abgelehnt.", 401);
  };
  const view = plugin.registeredViews[0].factory({ app });
  await view.onOpen();
  view.questionEl.value = "Hallo";
  await view.askButton.listeners.click();
  assert.equal(view.answerEl.text, "");
  assert.match(view.statusEl.text, /API-Key/);
  assert.match(mock.notices.at(-1), /API-Key/);
});

test("ohne aktive Notiz bleibt der Text in der Seitenleiste", async () => {
  const app = makeApp();
  const plugin = new UnitedSharePlugin(app);
  await plugin.onload();
  const view = plugin.registeredViews[0].factory({ app });
  await view.onOpen();
  view.askedQuestion = "Frage";
  view.answer = "Antwort";
  view.insertIntoNote();
  assert.match(mock.notices.at(-1), /Notiz/);
});

test("die Tastatur schiebt das Promptfeld in den sichtbaren Bereich", async () => {
  const css = fs.readFileSync(path.join(root, "styles.css"), "utf8");
  assert.match(css, /--unitedshare-keyboard-inset/);
  assert.match(css, /\.unitedshare-sidebar\.is-keyboard-open \.unitedshare-chat-panel/);
  assert.match(css, /safe-area-inset-bottom/);
  assert.match(css, /@media \(max-width: 520px\)/);
  const app = makeApp();
  const plugin = new UnitedSharePlugin(app);
  await plugin.onload();
  const view = plugin.registeredViews[0].factory({ app });
  await view.onOpen();
  const covered = view.syncKeyboardInset({
    rect: { bottom: 844, height: 760 },
    viewport: { offsetTop: 0, height: 430 },
    layoutHeight: 844,
  });
  assert.equal(covered, 414);
  assert.equal(view.contentEl.classList.has("is-keyboard-open"), true);
  assert.equal(view.contentEl.style["--unitedshare-keyboard-inset"], "414px");
  const open = view.syncKeyboardInset({
    rect: { bottom: 844, height: 760 },
    viewport: { offsetTop: 0, height: 844 },
    layoutHeight: 844,
  });
  assert.equal(open, 0);
  assert.equal(view.contentEl.classList.has("is-keyboard-open"), false);
  assert.equal(view.contentEl.style["--unitedshare-keyboard-inset"], "0px");
  const native = view.syncKeyboardInset({
    rect: { bottom: 844, height: 760 },
    viewport: { offsetTop: 0, height: 844 },
    layoutHeight: 844,
    cssKeyboardHeight: "300px",
    fixedOverlay: true,
  });
  assert.equal(native, 300);
  assert.equal(view.contentEl.classList.has("is-keyboard-open"), true);
  assert.equal(view.contentEl.style["--unitedshare-keyboard-inset"], "300px");
  const pinned = view.syncKeyboardInset({
    rect: { bottom: 844, height: 760 },
    viewport: { offsetTop: 0, height: 844 },
    layoutHeight: 844,
    cssKeyboardHeight: "300px",
    fixedOverlay: false,
  });
  assert.equal(pinned, 0);
  assert.equal(view.contentEl.classList.has("is-keyboard-open"), false);
  const src = fs.readFileSync(path.join(root, "main.src.js"), "utf8");
  const core = fs.readFileSync(path.join(root, "unitedshare-core.js"), "utf8");
  assert.match(src, /keyboardWillShow/);
  assert.match(src, /keyboardWillHide/);
  assert.match(src, /--keyboard-height/);
  assert.match(core, /\.workspace-drawer/);
  assert.match(core, /is-pinned/);
  assert.match(css, /\.workspace-drawer:not\(\.is-pinned\)/);
  assert.match(css, /var\(--keyboard-height, 0px\)/);
  await view.onClose();
  assert.equal(view.keyboardSync, null);
});

test("Tippen neben das Feld und leere Eingabe klappen die Tastatur zu", async () => {
  const app = makeApp();
  const plugin = new UnitedSharePlugin(app);
  await plugin.onload();
  plugin.completeThread = async () => "ok";
  const view = plugin.registeredViews[0].factory({ app });
  await view.onOpen();
  let blurred = 0;
  view.questionEl.blur = () => {
    blurred += 1;
  };
  const down = view.contentEl.listeners.pointerdown;
  const touch = view.contentEl.listeners.touchstart;
  assert.equal(typeof down, "function");
  assert.equal(typeof touch, "function");

  down({ target: { closest() { return null; } } });
  assert.equal(blurred, 1);
  down({ target: view.questionEl });
  down({
    target: {
      closest(selector) {
        return selector === ".unitedshare-input-footer" ? {} : null;
      },
    },
  });
  down({ target: { tag: "button", closest() { return null; } } });
  assert.equal(blurred, 1);

  touch({ target: { closest() { return null; } } });
  assert.equal(blurred, 2);

  view.keyboardInsetPx = 280;
  view.questionEl.value = "  ";
  view.questionEl.listeners.keydown({ key: "Enter", preventDefault() {} });
  assert.equal(blurred, 3);
  assert.equal(view.statusEl.text, "");

  view.keyboardInsetPx = 0;
  view.questionEl.listeners.keydown({ key: "Enter", shiftKey: true, preventDefault() {} });
  view.questionEl.listeners.keydown({ key: "Enter", preventDefault() {} });
  assert.equal(blurred, 3);
  assert.equal(view.statusEl.text, "Bitte eine Frage eingeben.");

  view.keyboardInsetPx = 280;
  view.questionEl.value = "Hallo";
  await view.submit();
  assert.equal(blurred, 4);
  assert.equal(view.questionEl.value, "");

  view.keyboardInsetPx = 0;
  view.questionEl.value = "Noch mal";
  await view.submit();
  assert.equal(blurred, 4);

  await view.onClose();
  assert.equal(view.keyboardDismiss, null);
  assert.equal(view.keyboardSync, null);
});

test("zeige die Graphansicht startet den Obsidian-Befehl und fragt das Modell nicht", async () => {
  const app = makeApp();
  const opened = [];
  app.commands = {
    executeCommandById(id) {
      opened.push(id);
      return true;
    },
  };
  const plugin = new UnitedSharePlugin(app);
  await plugin.onload();
  let asked = 0;
  plugin.completeThread = async () => {
    asked += 1;
    return "soll nicht";
  };
  const view = plugin.registeredViews[0].factory({ app });
  await view.onOpen();
  let blurred = 0;
  view.questionEl.blur = () => {
    blurred += 1;
  };
  view.keyboardInsetPx = 280;
  view.questionEl.value = "zeige die Graphansicht";
  await view.submit();
  assert.deepEqual(opened, ["graph:open"]);
  assert.equal(asked, 0);
  assert.equal(view.questionEl.value, "");
  assert.equal(view.activeTab().messages.length, 0);
  assert.equal(view.statusEl.text, "Graphansicht ist offen.");
  assert.equal(blurred, 1);

  view.questionEl.value = "zeige die lokale Graphansicht";
  await view.submit();
  assert.deepEqual(opened, ["graph:open", "graph:open-local"]);
  assert.equal(view.statusEl.text, "Lokale Graphansicht ist offen.");
  assert.equal(asked, 0);

  app.commands.executeCommandById = (id) => {
    opened.push(id);
    return false;
  };
  view.questionEl.value = "öffne den Graphen";
  await view.submit();
  assert.equal(view.statusEl.text, "Die Graphansicht lässt sich hier nicht öffnen.");
  assert.equal(asked, 0);

  view.questionEl.value = "Was ist die Graphansicht?";
  await view.submit();
  assert.equal(asked, 1);
});

test("Schrift und Zeichen stammen von unitedshare.ai und liegen im Plugin", () => {
  const css = fs.readFileSync(path.join(root, "styles.css"), "utf8");
  const woff = fs.readFileSync(path.join(root, "fonts/Inter-latin.woff2"));
  const license = fs.readFileSync(path.join(root, "fonts/OFL.txt"), "utf8");
  assert.equal(woff.subarray(0, 4).toString(), "wOF2");
  assert.equal(css.includes("Georgia"), false);
  assert.equal(css.includes("fonts.googleapis.com"), false);
  assert.equal(css.includes("fonts.gstatic.com"), false);
  assert.match(css, /font-family:\s*"Inter",\s*-apple-system,\s*BlinkMacSystemFont,\s*sans-serif/);
  assert.match(css, /@font-face\s*\{[^}]*font-family:\s*"Inter"/);
  assert.match(css, /font-weight:\s*300 800/);
  assert.match(css, /unicode-range:[^;]*U\+0000-00FF/);
  assert.equal(css.includes(woff.toString("base64")), true);
  assert.equal(license.includes("SIL Open Font License"), true);
  assert.equal(css.includes("SIL Open Font License"), true);
  assert.match(css, /\.unitedshare-lockup\s*\{[^}]*gap:\s*10px/);
  assert.match(css, /\.unitedshare-mark\s*\{[^}]*width:\s*36px/);
  assert.match(css, /\.unitedshare-wordmark\s*\{[^}]*font-size:\s*20px/);
  assert.match(css, /\.unitedshare-wordmark\s*\{[^}]*font-weight:\s*600/);
  assert.match(css, /\.unitedshare-wordmark\s*\{[^}]*letter-spacing:\s*-0\.01em/);
});

test("README, Stil und gebündelte main.js enthalten die Seitenleiste", () => {
  const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
  const css = fs.readFileSync(path.join(root, "styles.css"), "utf8");
  const main = fs.readFileSync(path.join(root, "main.js"), "utf8");
  assert.equal(readme.includes("rechten Seitenleiste"), true);
  assert.equal(readme.includes("UnitedShare in der Seitenleiste"), true);
  assert.equal(css.includes(".unitedshare-sidebar"), true);
  assert.equal(css.includes(".unitedshare-welcome"), true);
  assert.equal(css.includes(".unitedshare-input-wrapper"), true);
  assert.equal(css.includes(".unitedshare-message-user"), true);
  assert.equal(main.includes(VIEW_TYPE), true);
  assert.equal(main.includes("unitedshare-welcome"), true);
  assert.equal(main.includes("open-unitedshare-sidebar"), true);
});

test("eine erwähnte Notiz geht als Text mit, Notiz hängt die offene Notiz an", async () => {
  const app = makeApp();
  const reads = [];
  app.vault = {
    getAbstractFileByPath(notePath) {
      if (notePath === "Notizen/Heute.md") return { path: notePath };
      return null;
    },
    async cachedRead(file) {
      reads.push(file.path);
      return "Stand: grün";
    },
  };
  const plugin = new UnitedSharePlugin(app);
  await plugin.onload();
  const asked = [];
  plugin.completeThread = async (turns) => {
    asked.push(turns);
    return "aus der Notiz";
  };
  const view = plugin.registeredViews[0].factory({ app });
  await view.onOpen();
  app.workspace.activeView = { file: { path: "Notizen/Heute.md" }, editor: {} };
  const attach = knopf(view, "Notiz");
  assert.ok(attach, "Schaltfläche Notiz fehlt");
  assert.equal(attach.classList.has("is-labeled"), true);
  await attach.listeners.click();
  assert.equal(view.questionEl.value, "");
  assert.deepEqual(view.attachments, ["Notizen/Heute.md"]);
  const chip = find(view.contentEl, (node) => node.classList.has("unitedshare-attachment-path"));
  assert.equal(chip.text, "Notizen/Heute.md");

  plugin.embedForFrontier = async () => {
    throw new Error("Eine Erwähnung wird nicht eingebettet.");
  };
  view.attachments = [];
  view.renderAttachments();
  view.questionEl.value = 'Was steht in @"Notizen/Heute.md"?';
  const askButton = find(view.contentEl, (node) => node.tag === "button" && node.attrs["aria-label"] === "Fragen");
  await askButton.listeners.click();
  assert.deepEqual(reads, ["Notizen/Heute.md"]);
  assert.deepEqual(asked, [[
    {
      role: "user",
      content: 'Was steht in @"Notizen/Heute.md"?',
      files: [{ path: "Notizen/Heute.md", text: "Stand: grün" }],
    },
  ]]);
});

test("ein Anhang geht als Ausschnitt mit und die Chips verschwinden", async () => {
  const app = makeApp();
  app.vault = {
    getAbstractFileByPath(notePath) {
      if (notePath === "Plan.md") return { path: notePath };
      return null;
    },
    async cachedRead(file) {
      assert.equal(file.path, "Plan.md");
      return "Der Nordflügel bleibt geschlossen.";
    },
  };
  const plugin = new UnitedSharePlugin(app);
  await plugin.onload();
  const asked = [];
  plugin.completeThread = async (turns) => {
    asked.push(turns);
    return "Plan steht.";
  };
  plugin.embedForFrontier = async ({ question, mentioned, attached }) => {
    assert.equal(question, "Was machen wir mit dem Flügel?");
    assert.deepEqual(mentioned, []);
    assert.equal(attached[0].path, "Plan.md");
    assert.match(attached[0].text, /Nordflügel/);
    return [{ path: "Plan.md", text: "Ausschnitt: Nordflügel" }];
  };
  const view = plugin.registeredViews[0].factory({ app });
  await view.onOpen();
  view.addAttachment("Plan.md");
  const chip = find(view.contentEl, (node) => node.classList.has("unitedshare-attachment-path"));
  assert.equal(chip.text, "Plan.md");
  view.questionEl.value = "Was machen wir mit dem Flügel?";
  await view.askButton.listeners.click();
  assert.deepEqual(view.attachments, []);
  assert.equal(find(view.contentEl, (node) => node.classList.has("unitedshare-attachment")), null);
  assert.equal(asked[0][0].files[0].text, "Ausschnitt: Nordflügel");
  const user = find(view.contentEl, (node) => node.classList.has("unitedshare-message-user"));
  const files = find(user, (node) => node.classList.has("unitedshare-message-files"));
  assert.equal(files.text, "Plan.md");
});

test("fällt das Embedding aus, geht die Frage mit der ganzen Notiz ans Modell", async () => {
  const { UnitedShareError } = require("./unitedshare-core");
  const app = makeApp();
  app.vault = {
    getAbstractFileByPath(notePath) {
      if (notePath === "Plan.md") return { path: notePath };
      return null;
    },
    async cachedRead() {
      return "Der Nordflügel bleibt geschlossen.";
    },
  };
  const plugin = new UnitedSharePlugin(app);
  await plugin.onload();
  const asked = [];
  plugin.completeThread = async (turns) => {
    asked.push(turns);
    return "Die Notiz bleibt geschlossen.";
  };
  plugin.sucheTresor = async () => [];
  plugin.embedForFrontier = async () => {
    throw new UnitedShareError("Das lokale Embedding auf diesem Rechner antwortet nicht.", 0);
  };
  const view = plugin.registeredViews[0].factory({ app });
  await view.onOpen();
  view.addAttachment("Plan.md");
  view.questionEl.value = "Was machen wir?";
  await view.askButton.listeners.click();
  assert.equal(asked.length, 1);
  assert.equal(asked[0][0].files[0].path, "Plan.md");
  assert.match(asked[0][0].files[0].text, /Nordflügel/);
  assert.equal(view.questionEl.value, "");
  assert.deepEqual(view.attachments, []);
});

test("completeThread geht an /v1/chat/completions ohne Werkzeuge", async () => {
  const app = makeApp();
  const plugin = new UnitedSharePlugin(app);
  await plugin.onload();
  plugin.settings.apiKey = "test-key";
  plugin.settings.model = "rmxos-mega2026.1";
  const before = mock.requests.length;
  const text = await plugin.completeThread([{ role: "user", content: "Hallo" }]);
  const call = mock.requests[before];
  assert.equal(call.url, "https://api.unitedshare.ai/v1/chat/completions");
  const body = JSON.parse(call.body);
  assert.equal(body.model, "rmxos-mega2026.1");
  assert.equal(body.stream, true);
  assert.equal(body.max_tokens, 1200);
  // requestUrlAsFetch entfernt Content-Length bewusst, bevor es an requestUrl
  // geht: Capacitors natives HTTP auf Mobile wirft bei diesem verbotenen Header.
  assert.equal(Object.hasOwn(call.headers, "Content-Length"), false);
  assert.equal(Object.hasOwn(body, "tools"), false);
  assert.equal(Object.hasOwn(body, "system"), false);
  assert.equal(body.messages[0].role, "system");
  assert.equal(typeof body.messages[0].content, "string");
  assert.match(body.messages[0].content, /Obsidian/);
  assert.equal(body.messages[1].role, "user");
  assert.equal(body.messages[1].content, "Hallo");
  assert.equal(text, "Antwort aus messages");
});

test("die Antwortzeile steht, bevor der Körper da ist", async () => {
  const release = mock.holdMessages();
  const app = makeApp();
  const plugin = new UnitedSharePlugin(app);
  await plugin.onload();
  plugin.settings.apiKey = "test-key";
  plugin.settings.model = "rmxos-mega2026.1";
  const view = plugin.registeredViews[0].factory({ app });
  await view.onOpen();
  view.questionEl.value = "Hallo";
  const askButton = find(view.contentEl, (node) => node.tag === "button" && node.attrs["aria-label"] === "Fragen");
  const pending = askButton.listeners.click();
  const start = Date.now();
  let row = null;
  while (!row) {
    if (Date.now() - start > 2000) break;
    const found = find(view.contentEl, (node) => node.classList.has("unitedshare-message-assistant"));
    if (found && view.answer === "" && view.statusEl.text === "Antwort kommt.") row = found;
    else await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.ok(row, "die Antwortzeile fehlt, solange der Körper aussteht");
  assert.equal(view.answer, "");
  assert.equal(view.statusEl.text, "Antwort kommt.");
  assert.ok(find(row, (node) => node.classList.has("is-streaming")));
  release();
  await pending;
  assert.equal(view.answer, "Antwort aus messages");
  assert.equal(view.statusEl.text, "");
});

function lastSetting(name) {
  return [...mock.settings].reverse().find((setting) => setting.name === name);
}

function modelCalls() {
  return mock.requests.filter((call) => String(call.url || "").endsWith("/models"));
}

test("ein hinterlegter Schlüssel lädt die Modellnamen in die Aufklappliste", async () => {
  const app = makeApp();
  const plugin = new UnitedSharePlugin(app);
  plugin.loadData = async () => ({
    apiKey: "test-key",
    baseUrl: "https://api.example.test/v1",
    model: "rmxos-mega2026.1",
  });
  const stored = [];
  plugin.saveData = async (data) => {
    stored.push(JSON.parse(JSON.stringify(data)));
  };
  await plugin.onload();
  const before = modelCalls().length;
  await plugin.settingTab.display();
  const loaded = modelCalls();
  assert.equal(loaded.length, before + 1);
  assert.equal(loaded[before].method, "GET");
  assert.equal(loaded[before].url, "https://api.example.test/v1/models");
  assert.equal(loaded[before].headers.Authorization, "Bearer test-key");
  const model = lastSetting("Modell");
  assert.ok(model.dropdown, "Modell ist eine Aufklappliste");
  // mobil (01.11.2026): fuer On-Device reserviert, faellt aus dem Menue.
  assert.deepEqual(model.dropdown.order, [
    "",
    "rmxos-sema2026.1",
    "rmxos-mega2026.1",
  ]);
  assert.equal(model.dropdown.value, "rmxos-mega2026.1");
  assert.equal(plugin.settings.model, "rmxos-mega2026.1");

  const leaf = { type: VIEW_TYPE, app, view: null };
  app.workspace.leaves.push(leaf);
  const view = plugin.registeredViews[0].factory(leaf);
  leaf.view = view;
  await view.onOpen();
  const select = find(view.contentEl, (node) => node.tag === "select" && node.classList.has("unitedshare-model-select"));
  assert.ok(select, "die Seitenleiste bietet die Modelle als Aufklappliste");
  assert.equal(select.value, "rmxos-mega2026.1");
  assert.deepEqual(
    select.children.filter((node) => node.tag === "option").map((node) => node.attrs.value),
    ["", "rmxos-sema2026.1", "rmxos-mega2026.1"],
  );
  assert.equal(modelCalls().length, before + 1, "dieselbe Liste wird nicht erneut geladen");

  select.value = "rmxos-sema2026.1";
  await select.listeners.change();
  assert.equal(plugin.settings.model, "rmxos-sema2026.1");
  assert.equal(model.dropdown.value, "rmxos-sema2026.1");
  assert.equal(stored.at(-1).model, "rmxos-sema2026.1");
});

test("ohne gespeichertes Modell bleibt die Auswahl leer", async () => {
  const app = makeApp();
  const plugin = new UnitedSharePlugin(app);
  plugin.loadData = async () => ({
    apiKey: "test-key",
    baseUrl: "https://api.example.test/v1",
    model: "",
  });
  await plugin.onload();
  await plugin.settingTab.display();
  const model = lastSetting("Modell");
  assert.equal(model.dropdown.value, "");
  assert.equal(plugin.settings.model, "");
  assert.equal(model.dropdown.options["rmxos-mega2026.1"], "rmxos-mega2026.1");
});

test("eine Kennung außerhalb der drei Hauptmodelle fällt weg", async () => {
  const app = makeApp();
  const plugin = new UnitedSharePlugin(app);
  plugin.loadData = async () => ({
    apiKey: "test-key",
    baseUrl: "https://api.example.test/v1",
    model: "devstral",
  });
  await plugin.onload();
  assert.equal(plugin.settings.model, "");
  await plugin.settingTab.display();
  const model = lastSetting("Modell");
  assert.equal(model.dropdown.value, "");
  assert.equal(model.dropdown.options.devstral, undefined);
  assert.equal(model.dropdown.options["reemax-cortex"], undefined);
  assert.equal(model.dropdown.options["rmxos-mega2026.1"], "rmxos-mega2026.1");
});

test("ohne Schlüssel geht kein Modellabruf raus", async () => {
  const app = makeApp();
  const plugin = new UnitedSharePlugin(app);
  plugin.loadData = async () => ({ apiKey: "", model: "" });
  await plugin.onload();
  const before = modelCalls().length;
  await plugin.settingTab.display();
  assert.equal(modelCalls().length, before);
  const model = lastSetting("Modell");
  assert.equal(model.dropdown.options[""], "Zuerst den Schlüssel eintragen");
});

test("nach dem Schlüssel lädt die Liste, ein abgelehnter Schlüssel lässt die Kennung als Text", async () => {
  const app = makeApp();
  const plugin = new UnitedSharePlugin(app);
  plugin.loadData = async () => ({ apiKey: "", baseUrl: "https://api.example.test/v1", model: "rmxos-sema2026.1" });
  await plugin.onload();
  await plugin.settingTab.display();
  const before = modelCalls().length;
  const key = lastSetting("API-Schlüssel");
  await key.text.change("a");
  await key.text.change("ab");
  await key.text.change("test-key");
  assert.equal(modelCalls().length, before);
  await new Promise((resolve) => setTimeout(resolve, 500));
  const loaded = modelCalls();
  assert.equal(loaded.length, before + 1);
  assert.equal(loaded[before].headers.Authorization, "Bearer test-key");
  assert.equal(lastSetting("Modell").dropdown.value, "rmxos-sema2026.1");
  // mobil (01.11.2026, reservierter Name) taucht nicht mehr im Menue auf.
  assert.equal(lastSetting("Modell").dropdown.options["rmxos-mobil2026.1"], undefined);
  assert.equal(lastSetting("Modell").dropdown.options.devstral, undefined);

  await key.text.change("rejected-key");
  await new Promise((resolve) => setTimeout(resolve, 500));
  const failed = lastSetting("Modell");
  assert.equal(failed.dropdown, null);
  assert.match(failed.desc, /abgelehnt/);
  assert.equal(failed.text.value, "rmxos-sema2026.1");
  assert.equal(plugin.settings.model, "rmxos-sema2026.1");
});

test("ein gespeichertes rmxos-mobil2026.1 wird beim Laden geleert (Name reserviert)", async () => {
  // Seit 01.11.2026 ist der Name fuer kuenftige On-Device-Modelle
  // reserviert: er steht in keiner Allowlist mehr. loadSettings behandelt
  // ihn wie jedes nicht erlaubte Modell und leert die Einstellung.
  const app = makeApp();
  const plugin = new UnitedSharePlugin(app);
  plugin.loadData = async () => ({ apiKey: "", baseUrl: "https://api.example.test/v1", model: "rmxos-mobil2026.1" });
  await plugin.onload();
  assert.equal(plugin.settings.model, "");
});

function nodeTexts(node, acc = []) {
  if (node && node.text) acc.push(node.text);
  for (const child of (node && node.children) || []) nodeTexts(child, acc);
  return acc;
}

function pillTexte(node, acc = []) {
  if (node && node.classList && node.classList.has("unitedshare-pill")) acc.push(node.text);
  for (const child of (node && node.children) || []) pillTexte(child, acc);
  return acc;
}

function meshSpawn(bodies) {
  const seen = [];
  const spawn = (cmd, args) => {
    assert.equal(cmd, "reemax");
    seen.push(args.slice());
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};
    const key = args.join(" ");
    process.nextTick(() => {
      child.stdout.emit("data", bodies[key] || "{}\n");
      child.emit("close", 0);
    });
    return child;
  };
  spawn.seen = seen;
  return spawn;
}

test("ein Schlüssel und reemax zeigen das direkte Netz, nicht im Modellmenü", async () => {
  const app = makeApp();
  app.vault = { adapter: { getBasePath: () => "/tmp/vault-mesh" } };
  const plugin = new UnitedSharePlugin(app);
  plugin.loadData = async () => ({
    apiKey: "test-key",
    baseUrl: "https://api.example.test/v1",
    model: "rmxos-mega2026.1",
  });
  plugin.meshSpawn = meshSpawn({
    "version --json": '{"ok":true,"bin":"reemax","version":"0.3.3"}\n',
    "mesh peers --json": '{"ok":true,"peers":[{"name":"mini","address":"10.75.0.2"},{"name":"firma","address":"10.73.0.24"}]}\n',
    "offer ls --json": '{"v":1,"offers":[{"id":"qwen","kind":"model","peer":"mini"},{"id":"schreiber","kind":"agent","peer":"mini"},{"id":"tafel","kind":"ui"}]}\n',
    "sync pairs --json": '{"ok":true,"pairs":[{"name":"noten","peer":"10.75.0.2","local":"/Users/secret","remote":"/remote/secret"},{"name":"demo","peer":"10.73.0.26","local":"/Users/reemax/tmp/fabric-demo","remote":"coding"}]}\n',
    "list --json": '{"backends":[{"name":"peer","url":"http://10.75.0.2:11434"},{"name":"litellm","url":"https://llm.unitedshare.ai/v1"}],"models":[{"id":"mesh-only-model","backend":"peer"},{"id":"grok-devstral","backend":"litellm"}]}\n',
  });
  await plugin.onload();
  await plugin.settingTab.display();
  const model = lastSetting("Modell");
  assert.deepEqual(model.dropdown.order, ["", "rmxos-sema2026.1", "rmxos-mega2026.1"]);
  assert.equal(model.dropdown.options["mesh-only-model"], undefined);
  assert.equal(model.dropdown.options.qwen, undefined);
  const settingText = nodeTexts(plugin.settingTab.containerEl).join("\n");
  assert.match(settingText, /Direktes Netz/);
  assert.match(settingText, /Ein eingerichteter Rechner mit reemax kann im direkten Netz ein Modell, einen Agenten oder eine Oberfläche anbieten/);
  assert.match(settingText, /Modell: mini:qwen, mesh-only-model/);
  assert.match(settingText, /Agent: mini:schreiber/);
  assert.match(settingText, /Oberfläche: tafel/);
  assert.match(settingText, /Gegenstellen: mini/);
  assert.match(settingText, /Dateipaare im direkten Netz: noten/);
  assert.match(settingText, /Dateipaare im Firmennetz: demo/);
  assert.equal(settingText.includes("firma"), false);
  assert.equal(settingText.includes("/Users"), false);
  assert.equal(settingText.includes("grok-devstral"), false);
  assert.equal(settingText.includes("Datenbank"), false);

  const leaf = { type: VIEW_TYPE, app, view: null };
  app.workspace.leaves.push(leaf);
  const view = plugin.registeredViews[0].factory(leaf);
  leaf.view = view;
  await view.onOpen();
  assert.equal(
    find(view.contentEl, (node) => node.classList && node.classList.has("unitedshare-mesh")),
    null,
  );
  const mesh = plugin.settingTab.statusMesh;
  assert.ok(mesh, "die Einstellungen zeigen das direkte Netz");
  const sideText = nodeTexts(mesh).join("\n");
  assert.equal(sideText.includes("Direktes Netz"), false);
  assert.equal(find(mesh, (node) => node.tag === "h3"), null);
  assert.equal(find(mesh, (node) => node.classList && node.classList.has("unitedshare-mesh-options")), null);
  assert.deepEqual(pillTexte(mesh), [
    "reemax 0.3.3",
    "Modell: mini:qwen, mesh-only-model",
    "Agent: mini:schreiber",
    "Oberfläche: tafel",
    "Gegenstellen: mini",
    "Dateipaare im direkten Netz: noten",
    "Dateipaare im Firmennetz: demo",
  ]);
  assert.match(sideText, /Modell: mini:qwen, mesh-only-model/);
  assert.match(sideText, /Agent: mini:schreiber/);
  assert.match(sideText, /Oberfläche: tafel/);
  const select = find(view.contentEl, (node) => node.tag === "select");
  assert.deepEqual(
    select.children.filter((node) => node.tag === "option").map((node) => node.attrs.value),
    ["", "rmxos-sema2026.1", "rmxos-mega2026.1"],
  );
  assert.deepEqual(plugin.meshSpawn.seen, [
    ["version", "--json"],
    ["mesh", "peers", "--json"],
    ["offer", "ls", "--json"],
    ["sync", "pairs", "--json"],
    ["list", "--json"],
  ]);
});

test("ohne Schlüssel fragt das direkte Netz reemax nicht", async () => {
  const app = makeApp();
  app.vault = { adapter: { getBasePath: () => "/tmp/vault-mesh" } };
  const plugin = new UnitedSharePlugin(app);
  plugin.loadData = async () => ({ apiKey: "", model: "" });
  let calls = 0;
  plugin.meshSpawn = () => {
    calls += 1;
    throw new Error("nicht rufen");
  };
  await plugin.onload();
  await plugin.settingTab.display();
  const leaf = { type: VIEW_TYPE, app, view: null };
  app.workspace.leaves.push(leaf);
  const view = plugin.registeredViews[0].factory(leaf);
  leaf.view = view;
  await view.onOpen();
  assert.equal(calls, 0);
  assert.equal(nodeTexts(plugin.settingTab.containerEl).join("\n").includes("Direktes Netz"), false);
  assert.equal(nodeTexts(view.contentEl).join("\n").includes("Direktes Netz"), false);
});

test("unter node --test startet ein fehlender meshSpawn nicht das echte reemax", async () => {
  const app = makeApp();
  app.vault = { adapter: { getBasePath: () => "/tmp/vault-mesh" } };
  const plugin = new UnitedSharePlugin(app);
  plugin.loadData = async () => ({
    apiKey: "test-key",
    baseUrl: "https://api.example.test/v1",
    model: "",
  });
  await plugin.onload();
  await plugin.settingTab.display();
  const text = nodeTexts(plugin.settingTab.containerEl).join("\n");
  assert.equal(text.includes("Direktes Netz"), false);
  assert.equal(text.includes("0.3.3"), false);
  assert.equal(text.includes("demo"), false);
});

test("unter dem Eingabefeld steht eine Statusleiste aus kleinen Pills", async () => {
  const css = fs.readFileSync(path.join(root, "styles.css"), "utf8");
  assert.match(css, /\.unitedshare-statusleiste\s*\{[^}]*flex-wrap:\s*wrap/);
  assert.match(css, /\.unitedshare-pill\s*\{[^}]*border-radius:\s*999px/);
  assert.match(css, /\.unitedshare-sidebar\.is-keyboard-open \.unitedshare-statusleiste/);
  const { plugin, view } = await offeneSeite();
  const footer = find(view.contentEl, (node) => node.classList.has("unitedshare-input-footer"));
  assert.equal(footer.children.find((node) => node.classList.has("unitedshare-statusleiste")), undefined);
  assert.equal(find(view.contentEl, (node) => node.classList.has("unitedshare-hint")), null);
  const text = nodeTexts(view.contentEl).join("\n");
  assert.equal(text.includes("Die Frage verlässt den Tresor als Text"), false);
  assert.equal(text.includes("Direktes Netz"), false);
  await plugin.settingTab.display();
  const bar = plugin.settingTab.statusHost;
  assert.ok(bar, "Statusleiste fehlt");
  const pills = pillTexte(bar);
  assert.ok(pills.includes("Frage als Text"));
  assert.ok(pills.includes("Einbettung lokal"));
  assert.ok(pills.includes("Dateien lokal"));
  const link = find(bar, (node) => node.tag === "a" && node.attrs.href === "https://unitedshare.ai/privacy");
  assert.equal(link.text, "Datenschutz");
  assert.equal(link.classList.has("unitedshare-pill"), true);
});

test("die Statusleiste lässt leere Netz-Angebote weg", async () => {
  const { plugin, view } = await offeneSeite();
  await plugin.settingTab.display();
  plugin.ensureMesh = async () => ({
    installed: true,
    version: "0.3.3",
    ready: true,
    peers: ["node"],
    kinds: [
      { id: "model", name: "Modell", items: [] },
      { id: "agent", name: "Agent", items: [] },
      { id: "ui", name: "Oberfläche", items: [] },
    ],
    pairs: { direkt: [], firma: ["demo"] },
  });
  await view.renderMeshOptions();
  const mesh = plugin.settingTab.statusMesh;
  const text = nodeTexts(mesh).join("\n");
  assert.equal(text.includes("Direktes Netz"), false);
  assert.equal(text.includes("keins"), false);
  assert.equal(text.includes("keine"), false);
  assert.deepEqual(pillTexte(mesh), [
    "reemax 0.3.3",
    "Gegenstellen: node",
    "Dateipaare im Firmennetz: demo",
  ]);
  const settings = nodeTexts(plugin.settingTab.containerEl).join("\n");
  assert.equal(settings.includes("Direktes Netz"), false);
});

// --------------------------------------------------------------------------
// Gesprächsablage in <Tresor>/.vault/chats
//
// Die reinen Funktionen stehen in chat-speicher.test.js. Hier geht es um die
// Verdrahtung, und die entscheidet im Betrieb: ein Verlauf, der geschrieben
// wird, aber beim Start nicht zurückkommt, hilft niemandem.

function chatAdapterMock(dateien = {}) {
  const inhalt = new Map(Object.entries(dateien));
  const ordner = [];
  return {
    inhalt,
    getBasePath: () => "/tmp/vault-chats",
    async exists(pfad) {
      return inhalt.has(pfad) || ordner.includes(pfad);
    },
    async mkdir(pfad) {
      ordner.push(pfad);
    },
    async write(pfad, daten) {
      inhalt.set(pfad, daten);
    },
    async read(pfad) {
      if (!inhalt.has(pfad)) throw new Error(`nicht da: ${pfad}`);
      return inhalt.get(pfad);
    },
    async list(pfad) {
      const praefix = pfad ? `${pfad}/` : "";
      const files = [];
      for (const schluessel of inhalt.keys()) {
        if (schluessel.startsWith(praefix) && !schluessel.slice(praefix.length).includes("/")) {
          files.push(schluessel);
        }
      }
      return { files, folders: [] };
    },
  };
}

function abgelegtesGespraech({ id, offen, frage = "Was ist DIDNS?" }) {
  return JSON.stringify({
    id,
    titel: frage,
    erstellt: "2026-10-09T10:00:00.000Z",
    geaendert: "2026-10-09T10:05:00.000Z",
    offen,
    messages: [
      { role: "user", content: frage },
      { role: "assistant", content: "Eine DID ist eine URI." },
    ],
  });
}

async function ansichtMitAdapter(adapter) {
  const app = makeApp();
  app.vault = { adapter };
  const plugin = new UnitedSharePlugin(app);
  plugin.loadData = async () => ({
    apiKey: "test-key",
    baseUrl: "https://api.example.test/v1",
    model: "",
  });
  await plugin.onload();
  const view = plugin.registeredViews[0].factory({ app });
  return { app, plugin, view };
}

test("ein offenes Gespräch kommt nach dem Neustart in den Reiter zurück", async () => {
  // Das ist die eigentliche Anforderung: nach dem Schliessen von Obsidian
  // soll sich einfach weiterschreiben lassen. Es genuegt nicht, das Gespräch
  // ins Verlaufsmenue zu legen -- dann muesste man es jedes Mal heraussuchen.
  const adapter = chatAdapterMock({
    ".vault/chats/2026-10-09-1000-offen1.json": abgelegtesGespraech({ id: "offen1", offen: true }),
  });
  const { view } = await ansichtMitAdapter(adapter);
  await view.onOpen();

  assert.equal(view.tabs.length, 1);
  assert.equal(view.tabs[0].chatId, "offen1");
  assert.equal(view.tabs[0].messages.length, 2);
  assert.equal(view.tabs[0].messages[0].content, "Was ist DIDNS?");
  assert.equal(view.history.length, 0);
});

test("ein abgeschlossenes Gespräch landet im Verlauf, nicht im Reiter", async () => {
  const adapter = chatAdapterMock({
    ".vault/chats/2026-10-09-1000-zu1.json": abgelegtesGespraech({ id: "zu1", offen: false }),
  });
  const { view } = await ansichtMitAdapter(adapter);
  await view.onOpen();

  assert.equal(view.history.length, 1);
  assert.equal(view.history[0].chatId, "zu1");
  assert.equal(view.tabs.length, 1);
  assert.equal(view.tabs[0].messages.length, 0, "der Reiter bleibt leer");
});

test("der weitergeführte Verlauf geht beim nächsten Fragen mit", async () => {
  // Weiterschreiben heisst: das Modell kennt das bisherige Gespräch. Sonst
  // waere der wiederhergestellte Reiter nur Zierde.
  const adapter = chatAdapterMock({
    ".vault/chats/2026-10-09-1000-offen1.json": abgelegtesGespraech({ id: "offen1", offen: true }),
  });
  const { plugin, view } = await ansichtMitAdapter(adapter);
  const gesendet = [];
  plugin.completeThread = async (turns) => {
    gesendet.push(turns);
    return "Weiter geht es.";
  };
  await view.onOpen();
  view.questionEl.value = "Und was ist mit DNS?";
  await view.submit();

  assert.equal(gesendet.length, 1);
  const rollen = gesendet[0].map((turn) => turn.role);
  assert.deepEqual(rollen, ["user", "assistant", "user"],
    "der alte Verlauf muss vor der neuen Frage stehen");
  assert.equal(gesendet[0][0].content, "Was ist DIDNS?");
});

test("nach einer Antwort liegt das Gespräch in .vault/chats", async () => {
  const adapter = chatAdapterMock();
  const { plugin, view } = await ansichtMitAdapter(adapter);
  plugin.completeThread = async () => "Es ist 14:23 Uhr.";
  await view.onOpen();
  view.questionEl.value = "Wie spät ist es?";
  await view.submit();

  const pfade = [...adapter.inhalt.keys()].filter((p) => p.startsWith(".vault/chats/"));
  assert.equal(pfade.length, 1, `geschrieben: ${JSON.stringify(pfade)}`);
  const abgelegt = JSON.parse(adapter.inhalt.get(pfade[0]));
  assert.equal(abgelegt.offen, true);
  assert.deepEqual(abgelegt.messages.map((m) => m.role), ["user", "assistant"]);
  assert.equal(abgelegt.messages[1].content, "Es ist 14:23 Uhr.");
});

test("ein zweites Gespräch schreibt in dieselbe Datei", async () => {
  const adapter = chatAdapterMock();
  const { plugin, view } = await ansichtMitAdapter(adapter);
  plugin.completeThread = async () => "Antwort.";
  await view.onOpen();
  view.questionEl.value = "Erste Frage";
  await view.submit();
  view.questionEl.value = "Zweite Frage";
  await view.submit();

  const pfade = [...adapter.inhalt.keys()].filter((p) => p.startsWith(".vault/chats/"));
  assert.equal(pfade.length, 1, "derselbe Reiter, dieselbe Datei");
  assert.equal(JSON.parse(adapter.inhalt.get(pfade[0])).messages.length, 4);
});

test("scheitert der Modellaufruf, landet die Ursache im Fehlerprotokoll", async () => {
  // ANLASS (2026-10-18): "ab und zu" meldete das Plugin nur "Status 400",
  // ohne dass sich hinterher rekonstruieren liess, warum. Eine Zeile im
  // Tresor macht den seltenen Fall rückwirkend sichtbar.
  const { UnitedShareError } = require("./unitedshare-core");
  const adapter = chatAdapterMock();
  const { plugin, view } = await ansichtMitAdapter(adapter);
  plugin.completeThread = async () => {
    throw new UnitedShareError(
      "Modellaufruf fehlgeschlagen (Status 400): model rmxos-mobil2026.1 ist unbekannt",
      400,
    );
  };
  await view.onOpen();
  view.questionEl.value = "Wie spät ist es?";
  await view.submit();

  const protokoll = adapter.inhalt.get(".vault/debug.log");
  assert.ok(protokoll, "kein Fehlerprotokoll geschrieben");
  assert.match(protokoll, /status=400/);
  assert.match(protokoll, /model rmxos-mobil2026\.1 ist unbekannt/);
});

test("ein abgeschlossenes Gespräch wird mit seinen Nachrichten abgelegt", async () => {
  // newConversation leert den Reiter unmittelbar nach dem Ablegen. Das geht
  // heute gut, weil der Eintrag entsteht, bevor der erste await faellt --
  // eine Abhaengigkeit, die beim naechsten Umbau still bricht. Hier steht
  // sie als Vertrag.
  const adapter = chatAdapterMock();
  const { plugin, view } = await ansichtMitAdapter(adapter);
  plugin.completeThread = async () => "Antwort.";
  await view.onOpen();
  view.questionEl.value = "Eine Frage";
  await view.submit();

  view.newConversation();
  await new Promise((fertig) => setImmediate(fertig));

  const pfade = [...adapter.inhalt.keys()].filter((p) => p.startsWith(".vault/chats/"));
  assert.equal(pfade.length, 1);
  const abgelegt = JSON.parse(adapter.inhalt.get(pfade[0]));
  assert.equal(abgelegt.offen, false, "abgeschlossen, also nicht mehr offen");
  assert.equal(abgelegt.messages.length, 2, "die Nachrichten dürfen nicht weggeleert sein");
});

test("ein Protokollblock steht nie in der Blase, auch nicht während des Stroms", async () => {
  const adapter = chatAdapterMock();
  const { plugin, view } = await ansichtMitAdapter(adapter);
  const gesehen = [];
  plugin.completeThread = async (turns, onDelta) => {
    // So kommt es wirklich an: Stück für Stück, der Block zuerst offen.
    onDelta("Ich sehe nach.\n```unitedshare\n{\"action\":\"read\"");
    onDelta("Ich sehe nach.\n```unitedshare\n{\"action\":\"read\",\"path\":\"a.md\"}\n```");
    gesehen.push(view.activeTab().messages.map((m) => m.content).join("|"));
    return "In der Notiz steht: Guten Tag.";
  };
  await view.onOpen();
  view.questionEl.value = "Lies @a.md";
  await view.submit();

  for (const stand of gesehen) {
    assert.equal(stand.includes("unitedshare"), false,
      `waehrend des Stroms sichtbar: ${stand}`);
    assert.equal(stand.includes('"action"'), false, stand);
  }
  const blasen = view.activeTab().messages.map((m) => m.content);
  assert.equal(blasen.some((t) => String(t).includes("unitedshare")), false);
  assert.equal(blasen[blasen.length - 1], "In der Notiz steht: Guten Tag.");
});

test("auch nach einem Fehler bleibt kein Protokollblock stehen", async () => {
  // Der gemeldete Fall. Scheitert ein späterer Schritt, lässt der
  // Fehlerzweig die Teilantwort stehen -- und genau die enthielt bisher den
  // Block.
  const adapter = chatAdapterMock();
  const { plugin, view } = await ansichtMitAdapter(adapter);
  plugin.completeThread = async (turns, onDelta) => {
    onDelta("Ich sehe nach.\n```unitedshare\n{\"action\":\"read\",\"path\":\"@DID Chats.md\"}\n```");
    throw new Error("Zeitüberschreitung");
  };
  await view.onOpen();
  view.questionEl.value = "Lies @DID Chats.md";
  await view.submit();

  const blasen = view.activeTab().messages.map((m) => String(m.content));
  assert.equal(blasen.some((t) => t.includes("unitedshare")), false,
    `Block stehen geblieben: ${JSON.stringify(blasen)}`);
  assert.equal(blasen.some((t) => t.includes('"action"')), false);
  assert.equal(blasen.some((t) => t.includes("Ich sehe nach.")), true,
    "der erklärende Satz soll bleiben, nur das Protokoll nicht");
});

test("auch ohne Werkzeug zeigt die Kette, dass gearbeitet wird", async () => {
  // Der häufigste Fall und der mit der längsten Wartezeit: eine Frage, die
  // kein Werkzeug braucht. Bisher blieb die Kette dabei leer -- gerade dann
  // sieht der Nutzer am längsten nichts.
  const adapter = chatAdapterMock();
  const { plugin, view } = await ansichtMitAdapter(adapter);
  let standBeimDenken = null;
  plugin.completeThread = async (turns, onDelta) => {
    // Kopie, nicht Referenz: beim Prüfen nach submit() wäre der Zustand
    // längst "fertig", und der Test bewiese nichts.
    standBeimDenken = ((view.activeTab().messages.find((m) => m.streaming) || {}).schritte || [])
      .map((x) => ({ art: x.art, zustand: x.zustand }));
    onDelta("Eine DID ist eine URI.");
    return "Eine DID ist eine URI.";
  };
  await view.onOpen();
  view.questionEl.value = "Was ist eine DID?";
  await view.submit();

  assert.ok(standBeimDenken && standBeimDenken.length,
    "während des Wartens muss ein Schritt stehen");
  assert.equal(standBeimDenken[0].art, "denken");
  assert.equal(standBeimDenken[0].zustand, "laeuft");
});

test("sobald Text kommt, ist das Denken abgehakt", async () => {
  const adapter = chatAdapterMock();
  const { plugin, view } = await ansichtMitAdapter(adapter);
  plugin.completeThread = async (turns, onDelta) => {
    onDelta("Antwort");
    return "Antwort";
  };
  await view.onOpen();
  view.questionEl.value = "Frage";
  await view.submit();

  const letzte = view.activeTab().messages[view.activeTab().messages.length - 1];
  const denken = (letzte.schritte || []).find((s) => s.art === "denken");
  assert.ok(denken, "der Denkschritt bleibt sichtbar");
  assert.equal(denken.zustand, "fertig");
});

test("eine Aktion hakt das Denken ebenfalls ab", async () => {
  const adapter = chatAdapterMock();
  const { plugin, view } = await ansichtMitAdapter(adapter);
  plugin.completeThread = async (turns, onDelta, onSchritt) => {
    onSchritt({ zustand: "laeuft", art: "read", text: 'Liest „a.md“', zeichen: "file-text" });
    onSchritt({ zustand: "fertig", art: "read", text: 'Liest „a.md“', zeichen: "file-text", ergebnis: "Inhalt" });
    onDelta("Da steht Inhalt.");
    return "Da steht Inhalt.";
  };
  await view.onOpen();
  view.questionEl.value = "Lies a.md";
  await view.submit();

  const letzte = view.activeTab().messages[view.activeTab().messages.length - 1];
  const arten = (letzte.schritte || []).map((s) => `${s.art}:${s.zustand}`);
  assert.deepEqual(arten, ["denken:fertig", "read:fertig"]);
});

test("das Ergebnis einer Aktion wird mitgeführt", async () => {
  const adapter = chatAdapterMock();
  const { plugin, view } = await ansichtMitAdapter(adapter);
  plugin.completeThread = async (turns, onDelta, onSchritt) => {
    onSchritt({ zustand: "laeuft", art: "read", text: 'Liest „a.md“' });
    onSchritt({ zustand: "fertig", art: "read", text: 'Liest „a.md“', ergebnis: "Zeile eins" });
    onDelta("Fertig.");
    return "Fertig.";
  };
  await view.onOpen();
  view.questionEl.value = "Lies a.md";
  await view.submit();

  const letzte = view.activeTab().messages[view.activeTab().messages.length - 1];
  const gelesen = (letzte.schritte || []).find((s) => s.art === "read");
  assert.equal(gelesen.ergebnis, "Zeile eins");
});

test("ohne Adapter läuft alles weiter, nur ohne Ablage", async () => {
  // Auf einer Plattform ohne Adapter darf das Fragen nicht scheitern.
  const app = makeApp();
  app.vault = {};
  const plugin = new UnitedSharePlugin(app);
  plugin.loadData = async () => ({ apiKey: "k", baseUrl: "https://api.example.test/v1", model: "" });
  await plugin.onload();
  const view = plugin.registeredViews[0].factory({ app });
  plugin.completeThread = async () => "Antwort ohne Ablage.";
  await view.onOpen();
  view.questionEl.value = "Frage";
  await view.submit();

  assert.equal(view.activeTab().messages.length, 2);
});

function findAll(node, pred, out = []) {
  if (pred(node)) out.push(node);
  for (const child of node.children || []) findAll(child, pred, out);
  return out;
}

async function sichtMitSchritten(ablauf) {
  const app = makeApp();
  const plugin = new UnitedSharePlugin(app);
  await plugin.onload();
  plugin.settings.apiKey = "test-key";
  plugin.settings.model = "rmxos-mega2026.1";
  plugin.completeThread = ablauf;
  const view = plugin.registeredViews[0].factory({ app });
  await view.onOpen();
  view.questionEl.value = "Lies a.md";
  const askButton = find(view.contentEl, (node) => node.tag === "button" && node.attrs["aria-label"] === "Fragen");
  return { view, pending: askButton.listeners.click() };
}

const schrittZeilen = (view) => findAll(view.contentEl, (node) => node.classList.has("unitedshare-schritt"));

test("die Schritte erscheinen als Kette über der Antwort und schließen sich", async () => {
  let zwischen = null;
  const { view, pending } = await sichtMitSchritten(async (_turns, _onDelta, onSchritt) => {
    onSchritt({ zustand: "laeuft", art: "read", text: "Liest „a.md“" });
    zwischen = schrittZeilen(view).map((z) => [...z.classList].join(" "));
    onSchritt({ zustand: "fertig", art: "read", text: "Liest „a.md“" });
    onSchritt({ zustand: "laeuft", art: "write", text: "Schreibt „b.md“" });
    onSchritt({ zustand: "fertig", art: "write", text: "Schreibt „b.md“" });
    return "Erledigt.";
  });
  await pending;
  // Der Denkschritt steht vor der ersten Aktion und ist in dem Moment schon
  // abgehakt -- eine Tätigkeit beendet das Warten.
  assert.deepEqual(zwischen, [
    "unitedshare-schritt is-fertig",
    "unitedshare-schritt is-laeuft",
  ]);
  const zeilen = schrittZeilen(view);
  assert.equal(zeilen.length, 3, "Denken, Lesen, Schreiben");
  assert.ok(zeilen.every((z) => z.classList.has("is-fertig")));
  const texte = zeilen.map((z) => find(z, (n) => n.classList.has("unitedshare-schritt-text")).text);
  assert.deepEqual(texte, ["Denkt nach", "Liest „a.md“", "Schreibt „b.md“"]);
  const reihe = find(view.contentEl, (node) => node.classList.has("unitedshare-message-assistant"));
  assert.ok(find(reihe, (node) => node.classList.has("unitedshare-schritte")));
  assert.equal(view.answer, "Erledigt.");
});

test("Freigabe und Ablehnung erscheinen als ein einziger Schritt mit eindeutiger Beschriftung", async () => {
  let wartet;
  const { view, pending } = await sichtMitSchritten(async (_turns, _onDelta, onSchritt) => {
    onSchritt({ id: 1, zustand: "geplant", art: "write", text: "Schreibt „b.md“" });
    onSchritt({ id: 1, zustand: "wartet", art: "write", text: "Schreibt „b.md“" });
    const zeile = schrittZeilen(view).find((z) => z.classList.has("is-wartet"));
    wartet = [find(zeile, (n) => n.classList.has("unitedshare-schritt-text")).text, find(zeile, (n) => n.classList.has("unitedshare-schritt-status")).text];
    onSchritt({ id: 1, zustand: "abgelehnt", art: "write", text: "Schreibt „b.md“", ergebnis: "vom Nutzer abgelehnt" });
    return "Nicht geschrieben.";
  });
  await pending;
  assert.deepEqual(wartet, ["Schreibvorschlag für „b.md“", "Wartet auf deine Freigabe"]);
  const zeilen = schrittZeilen(view);
  assert.equal(zeilen.length, 2);
  assert.ok(zeilen[1].classList.has("is-abgelehnt"));
  assert.equal(find(zeilen[1], (n) => n.classList.has("unitedshare-schritt-status")).text, "Abgelehnt");
});

test("auch ohne Aktionen steht der Denkschritt in der Kette", async () => {
  // Dieser Vertrag war umgekehrt: ohne Aktionen blieb die Kette leer.
  // Geaendert auf Mikes Ansage, dass der Nutzer sehen soll, dass etwas
  // passiert -- und gerade bei einer Frage ohne Werkzeug ist die Wartezeit
  // am laengsten, weil das Modell denkt. Gezeigt wird nur der Zustand; der
  // Inhalt des Denkens kommt nicht an (gemessen: die Delta-Felder im Strom
  // sind ausschliesslich content und role).
  const { view, pending } = await sichtMitSchritten(async () => "Nur Text.");
  await pending;
  const zeilen = schrittZeilen(view);
  assert.equal(zeilen.length, 1, "genau ein Schritt, nicht mehr");
  const letzte = view.activeTab().messages[view.activeTab().messages.length - 1];
  assert.deepEqual((letzte.schritte || []).map((x) => `${x.art}:${x.zustand}`),
    ["denken:fertig"]);
});

test("bei einem Fehler bleibt der offene Schritt als fehlgeschlagen stehen", async () => {
  const { view, pending } = await sichtMitSchritten(async (_turns, _onDelta, onSchritt) => {
    onSchritt({ zustand: "laeuft", art: "run", text: "Startet „x.py“" });
    throw new Error("weg");
  });
  await pending;
  const zeilen = schrittZeilen(view);
  assert.equal(zeilen.length, 2, "Denken und der abgebrochene Start");
  // Der Denkschritt ist abgehakt, der Start blieb offen und wird als
  // abgebrochen markiert -- nach einem Abbruch alles als erledigt zu zeigen
  // wäre falsch.
  assert.ok(zeilen[0].classList.has("is-fertig"));
  assert.ok(zeilen[1].classList.has("is-fehlgeschlagen"));
  assert.equal(view.statusEl.text, "Der Modellaufruf ist fehlgeschlagen.");
});

function editorMit(text) {
  return {
    value: text,
    cursor: { line: 1, ch: 0 },
    replaced: 0,
    getValue() {
      return this.value;
    },
    getCursor() {
      return this.cursor;
    },
    replaceRange(chunk, cursor) {
      this.replaced += 1;
      this.last = { text: chunk, cursor };
      this.value += chunk;
    },
  };
}

function notizTresor(texts) {
  const vault = {
    writes: 0,
    getAbstractFileByPath(notePath) {
      if (Object.hasOwn(texts, notePath)) return { path: notePath };
      return null;
    },
    async cachedRead(file) {
      return texts[file.path];
    },
    async modify(file, content) {
      texts[file.path] = content;
      vault.writes += 1;
    },
  };
  return vault;
}

async function offeneSeite() {
  const app = makeApp();
  const plugin = new UnitedSharePlugin(app);
  await plugin.onload();
  const view = plugin.registeredViews[0].factory({ app });
  await view.onOpen();
  return { app, plugin, view };
}

test("die untere Leiste trägt Beschriftung, Notiz, Einfügen, Mermaid und Link", async () => {
  const { app, plugin, view } = await offeneSeite();
  for (const label of ["Notiz", "Einfügen", "Mermaid", "Link", "Antwort", "Fragen", "Bild"]) {
    const button = knopf(view, label);
    assert.ok(button, label);
    assert.equal(button.classList.has("is-labeled"), true, label);
    const caption = find(button, (node) => node.classList.has("unitedshare-nav-caption"));
    assert.equal(caption.text, label);
  }
  assert.equal(knopf(view, "Verlauf").classList.has("is-labeled"), false);
  assert.equal(view.budgetEl.text, "");
  assert.equal(view.budgetEl.classList.has("is-ruhend"), true);
  assert.equal(view.budgetEl.classList.has("is-leer"), false);

  const vorher = mock.modals.length;
  app.workspace.activeView = null;
  await knopf(view, "Notiz").listeners.click();
  assert.equal(view.questionEl.value, "");
  assert.equal((view.attachments || []).length, 0);
  const wahl = mock.modals[mock.modals.length - 1];
  assert.ok(mock.modals.length > vorher);
  assert.equal(wahl.opened, true);
  assert.equal(find(wahl.contentEl, (node) => node.tag === "h2").text, "Notiz anhängen");

  app.workspace.activeView = { file: { path: "../Geheim.md" }, editor: editorMit("") };
  await knopf(view, "Notiz").listeners.click();
  assert.equal((view.attachments || []).length, 0);

  const editor = editorMit("schon da");
  app.workspace.activeView = { file: { path: "Offen.md" }, editor };
  app.vault = notizTresor({ "Offen.md": "schon da" });
  await knopf(view, "Notiz").listeners.click();
  assert.deepEqual(view.attachments, ["Offen.md"]);
  assert.equal(view.questionEl.value, "");
  await knopf(view, "Notiz").listeners.click();
  assert.deepEqual(view.attachments, ["Offen.md"]);
  assert.equal(mock.modals[mock.modals.length - 1].opened, true);

  plugin.einfuegeText = async () => "aus der Zwischenablage";
  await knopf(view, "Einfügen").listeners.click();
  assert.equal(editor.last.text, "aus der Zwischenablage");
  assert.equal(editor.cursor, editor.last.cursor);

  app.workspace.activeView = null;
  plugin.einfuegeText = async () => "Feld";
  view.questionEl.value = "Frage ";
  await knopf(view, "Einfügen").listeners.click();
  assert.equal(view.questionEl.value, "Frage Feld");

  const leerAb = mock.notices.length;
  plugin.einfuegeText = async () => "";
  await knopf(view, "Einfügen").listeners.click();
  assert.ok(mock.notices.slice(leerAb).includes("Die Zwischenablage ist leer."));
  assert.equal(view.questionEl.value, "Frage Feld");

  const unlesbarAb = mock.notices.length;
  plugin.einfuegeText = async () => {
    throw new Error("denied");
  };
  await knopf(view, "Einfügen").listeners.click();
  assert.ok(mock.notices.slice(unlesbarAb).includes("Die Zwischenablage lässt sich nicht lesen."));

  plugin.einfuegeText = async () => "```mermaid\nflowchart LR\n  A-->B\n```\n";
  app.workspace.activeView = { editor };
  const vorherErsetzt = editor.replaced;
  await knopf(view, "Mermaid").listeners.click();
  assert.equal(editor.replaced, vorherErsetzt + 1);
  assert.match(editor.last.text, /```mermaid\nflowchart LR\n {2}A-->B\n```\n/);
  assert.equal(editor.last.text.includes("A[Notiz]"), false);

  const mermaidAb = mock.notices.length;
  plugin.einfuegeText = async () => {
    throw new Error("denied");
  };
  view.answer = "siehe\n```mermaid\nflowchart TD\n  X[Ja]\n```\n";
  await knopf(view, "Mermaid").listeners.click();
  assert.match(editor.last.text, /X\[Ja\]/);
  assert.equal(mock.notices.length, mermaidAb);

  plugin.einfuegeText = async () => "";
  view.answer = "";
  await knopf(view, "Mermaid").listeners.click();
  assert.equal(editor.last.text, "```mermaid\nflowchart LR\n  A[Notiz]\n```\n");

  const paarAb = mock.notices.length;
  view.attachments = [];
  app.workspace.activeView = { file: { path: "Offen.md" }, editor };
  await knopf(view, "Link").listeners.click();
  assert.ok(mock.notices.slice(paarAb).includes("Hänge die andere Notiz an. Die offene Notiz ist die eine Seite."));

  view.attachments = ["Offen.md"];
  await knopf(view, "Link").listeners.click();
  assert.ok(mock.notices.slice(paarAb).includes("Hänge die andere Notiz an. Die offene Notiz ist die eine Seite."));
  assert.equal(editor.value.includes("[[Offen]]"), false);

  const texts = { "Offen.md": "Anfang\n", "Andere.md": "Ziel\n" };
  app.vault = notizTresor(texts);
  editor.value = "Anfang\n";
  editor.replaced = 0;
  view.attachments = ["Andere.md"];
  await knopf(view, "Link").listeners.click();
  assert.equal(editor.last.text, "[[Andere]]");
  assert.match(texts["Andere.md"], /\[\[Offen\]\]/);
  assert.equal((texts["Andere.md"].match(/\[\[Offen\]\]/g) || []).length, 1);
  const writes = app.vault.writes;
  await knopf(view, "Link").listeners.click();
  assert.equal(editor.replaced, 1);
  assert.equal(app.vault.writes, writes);
  assert.equal((texts["Andere.md"].match(/\[\[Offen\]\]/g) || []).length, 1);

  const fremdAb = mock.notices.length;
  app.vault = notizTresor({ "Offen.md": "Anfang\n" });
  editor.value = "Anfang\n";
  view.attachments = ["Fehlt.md"];
  await knopf(view, "Link").listeners.click();
  assert.ok(mock.notices.slice(fremdAb).includes("Die andere Notiz lässt sich nicht lesen."));
});

test("das Budget nennt nur mitgelieferte Grenzen", async () => {
  const { plugin, view } = await offeneSeite();
  const css = fs.readFileSync(path.join(root, "styles.css"), "utf8");
  assert.match(css, /\.unitedshare-toolbar-actions\s*\{[^}]*flex-wrap:\s*wrap/);
  assert.match(css, /\.unitedshare-nav-btn\.is-labeled/);
  assert.match(css, /\.unitedshare-budget\b/);
  assert.match(css, /\.unitedshare-budget\.is-leer/);
  assert.match(css, /\.unitedshare-budget\.is-ruhend/);
  assert.equal(css.includes(".unitedshare-budget:empty"), false);

  let runde = 0;
  plugin.completeThread = async (_turns, _onDelta, _onSchritt, onMeta) => {
    runde += 1;
    if (runde === 1) {
      onMeta({
        limits: { rest_tag: 800, rest_monat: 40000 },
        usage: { summe: 16 },
      });
    } else if (runde === 2) {
      onMeta({ limits: null, usage: { summe: 4 } });
    } else {
      onMeta({
        limits: { rest_tag: 1, rest_woche: 2, rest_monat: 3, nachgekauft: 9 },
        usage: { summe: 1 },
      });
    }
    return "ok";
  };
  view.questionEl.value = "Erste";
  await knopf(view, "Fragen").listeners.click();
  assert.equal(view.statusEl.text, "");
  assert.equal(view.budgetEl.text, "Tag 800 · Monat 40.000 · Dieser Aufruf: 16 Token");
  assert.equal(view.budgetEl.classList.has("is-leer"), false);

  view.questionEl.value = "Zweite";
  await knopf(view, "Fragen").listeners.click();
  assert.equal(view.budgetEl.text, "Tag 800 · Monat 40.000 · Dieser Aufruf: 4 Token");

  view.questionEl.value = "Dritte";
  await knopf(view, "Fragen").listeners.click();
  assert.equal(view.budgetEl.text, "Tag 1 · Woche 2 · Monat 3 · Nachgekauft 9 · Dieser Aufruf: 1 Token");

  const { UnitedShareError } = require("./unitedshare-core");
  plugin.completeThread = async () => {
    const error = new UnitedShareError("Das Tageslimit ist aufgebraucht.", 429);
    error.limits = { rest_tag: 0, rest_monat: 1200 };
    throw error;
  };
  const ab = mock.notices.length;
  view.questionEl.value = "Vierte";
  await knopf(view, "Fragen").listeners.click();
  assert.ok(mock.notices.slice(ab).includes("Das Tageslimit ist aufgebraucht."));
  assert.equal(view.statusEl.text, "Das Tageslimit ist aufgebraucht.");
  assert.equal(view.budgetEl.text, "Tag 0 · Monat 1.200");
  assert.equal(view.budgetEl.classList.has("is-leer"), true);
});

test("der Stopp-Knopf ist nur während eines Auftrags aktiv und bricht die Laufsteuerung ab", async () => {
  const { plugin, view } = await offeneSeite();
  const stopp = knopf(view, "Stopp");
  assert.ok(stopp, "Stopp-Knopf fehlt");
  // Ausserhalb eines Auftrags: ausgeblendet und tot.
  assert.equal(knopf(view, "Fragen").disabled, false);
  assert.equal(stopp.disabled, true);
  assert.equal(view.inputWrap.classList.has("is-busy"), false);

  // Waehrend eines Auftrags kippt die Freigabe: alles Fragende wird stumm,
  // der Stopp-Knopf wach -- und der Wrapper traegt is-busy, was ihn einblendet.
  view.setAskControls(true);
  assert.equal(knopf(view, "Fragen").disabled, true);
  assert.equal(stopp.disabled, false);
  assert.equal(view.inputWrap.classList.has("is-busy"), true);

  // Der Klick stoppt alle gemeldeten Auftraege.
  const abgebrochen = [];
  const steuerA = { abort: () => abgebrochen.push("a") };
  const steuerB = { abort: () => abgebrochen.push("b") };
  plugin.laufe = [steuerA, steuerB];
  await stopp.listeners.click();
  assert.deepEqual(abgebrochen, ["a", "b"]);
  // Nach dem Stopp ist die Liste leer -- ein zweiter Klick stoppt nichts mehr.
  assert.deepEqual(plugin.laufe, []);
});

test("ein Nutzerabbruch beendet mit klarer Meldung, markiert offene Schritte als abgebrochen und alarmiert nicht doppelt", async () => {
  const { plugin, view } = await offeneSeite();
  const { UnitedShareError } = require("./unitedshare-core");
  plugin.absichtEinbetten = async () => null;
  plugin.completeThread = async (_turns, onDelta, onSchritt) => {
    // Ein Schritt laeuft bereits, das Denken steht offen -- dann bricht der
    // Nutzer ab. Genau die Lage, die vorher stumm haengen blieb.
    onSchritt({ text: "Liest die Notiz", zustand: "laeuft", id: 1 });
    const error = new UnitedShareError("Der Auftrag wurde abgebrochen.", 0);
    error.abgebrochen = true;
    throw error;
  };

  const ab = mock.notices.length;
  view.questionEl.value = "Fasse zusammen.";
  await knopf(view, "Fragen").listeners.click();

  // Benannte Meldung im Status statt stiller Haenger...
  assert.equal(view.statusEl.text, "Der Auftrag wurde abgebrochen.");
  // ...kein zusaetzlicher Alarm fuer einen Abbruch, den der Nutzer selbst wollte.
  assert.equal(mock.notices.slice(ab).includes("Der Auftrag wurde abgebrochen."), false);
  // ...und der offene Schritt steht als "abgebrochen" da, nicht "fehlgeschlagen".
  const tab = view.activeTab();
  const letzte = tab.messages[tab.messages.length - 1];
  assert.equal(letzte.streaming, false);
  const zustaende = (letzte.schritte || []).map((s) => s.zustand);
  assert.ok(zustaende.includes("abgebrochen"), `Zustaende: ${zustaende.join(", ")}`);
  assert.equal(zustaende.includes("fehlgeschlagen"), false);
  // Die Freigabe ist zurueck: der naechste Auftrag darf wieder starten.
  assert.equal(knopf(view, "Fragen").disabled, false);
  assert.equal(knopf(view, "Stopp").disabled, true);
});

test("ein fehlgeschlagener Auftrag meldet weiter mit Notice und markiert Schritte als fehlgeschlagen", async () => {
  const { plugin, view } = await offeneSeite();
  const { UnitedShareError } = require("./unitedshare-core");
  plugin.absichtEinbetten = async () => null;
  plugin.completeThread = async (_turns, _onDelta, onSchritt) => {
    onSchritt({ text: "Liest die Notiz", zustand: "laeuft", id: 1 });
    throw new UnitedShareError("API-Key fehlt.", 401);
  };

  const ab = mock.notices.length;
  view.questionEl.value = "Fasse zusammen.";
  await knopf(view, "Fragen").listeners.click();

  assert.equal(view.statusEl.text, "API-Key fehlt.");
  // Ein echter Fehler alarmiert -- anders als der Nutzerabbruch.
  assert.ok(mock.notices.slice(ab).includes("API-Key fehlt."));
  const tab = view.activeTab();
  const letzte = tab.messages[tab.messages.length - 1];
  const zustaende = (letzte.schritte || []).map((s) => s.zustand);
  assert.ok(zustaende.includes("fehlgeschlagen"), `Zustaende: ${zustaende.join(", ")}`);
  assert.equal(zustaende.includes("abgebrochen"), false);
});

const PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

test("Bild zeigt die Abbildung und setzt sie in die offene Notiz", async () => {
  const { app, plugin, view } = await offeneSeite();
  const leerAb = mock.notices.length;
  view.questionEl.value = "   ";
  await knopf(view, "Bild").listeners.click();
  assert.equal(view.bildMenu.classList.has("is-open"), true);
  assert.equal(mock.notices.slice(leerAb).includes("Beschreibe das Bild."), false);
  await knopf(view, "1:1").listeners.click();
  assert.ok(mock.notices.slice(leerAb).includes("Beschreibe das Bild."));

  let statusBeimAuftrag = "";
  let knopfGesperrt = false;
  plugin.generateImage = async (prompt) => {
    statusBeimAuftrag = view.statusEl.text;
    knopfGesperrt = knopf(view, "Bild").disabled;
    return { mime: "image/png", b64: PNG_B64, prompt, extra: "weg" };
  };
  view.questionEl.value = "eine rote Kugel";
  await knopf(view, "1:1").listeners.click();
  assert.equal(statusBeimAuftrag, "Die Aufgabe läuft noch.");
  assert.equal(knopfGesperrt, true);
  const img = find(view.contentEl, (node) => node.tag === "img");
  assert.match(img.attrs.src, new RegExp(`^data:image/png;base64,${PNG_B64}`));
  const einbetten = knopf(view, "In die Notiz");
  assert.equal(einbetten.attrs.title, "In die Notiz");
  assert.equal(einbetten.attrs["data-icon"], "image-plus");
  assert.equal(view.questionEl.value, "");
  const nachricht = view.activeTab().messages.find((message) => message.bilder);
  assert.deepEqual(nachricht.bilder, [{
    mime: "image/png",
    b64: PNG_B64,
    prompt: "eine rote Kugel",
    breite: 1024,
    hoehe: 1024,
  }]);
  assert.equal(Object.hasOwn(nachricht.bilder[0], "path"), false);
  assert.equal(nachricht.content, "eine rote Kugel");

  const ohneNotiz = mock.notices.length;
  app.workspace.activeView = null;
  await einbetten.listeners.click();
  assert.ok(mock.notices.slice(ohneNotiz).includes("Keine aktive Notiz."));

  const written = [];
  const folders = [];
  app.vault = {
    getAbstractFileByPath() {
      return null;
    },
    async createFolder(folder) {
      folders.push(folder);
    },
    async createBinary(notePath, data) {
      written.push({ notePath, data });
      return { path: notePath };
    },
  };
  const editor = editorMit("");
  app.workspace.activeView = { editor, file: { path: "Offen.md" } };
  await einbetten.listeners.click();
  assert.deepEqual(folders, ["UnitedShare", "UnitedShare/bilder"]);
  assert.match(written[0].notePath, /^UnitedShare\/bilder\/bild-\d+\.png$/);
  assert.ok(written[0].data instanceof Uint8Array);
  assert.equal(written[0].data[0], 0x89);
  assert.equal(written[0].data[1], 0x50);
  assert.match(editor.last.text, /^!\[\[UnitedShare\/bilder\/bild-\d+\.png\]\]\n\*eine rote Kugel\*$/);
});

test("ein erzeugtes Bild landet ohne Klick in der offenen Notiz", async () => {
  const { app, plugin, view } = await offeneSeite();
  const written = [];
  app.vault = {
    getAbstractFileByPath() {
      return null;
    },
    async createFolder() {},
    async createBinary(notePath, data) {
      written.push({ notePath, data });
      return { path: notePath };
    },
  };
  const editor = editorMit("");
  app.workspace.activeView = { editor, file: { path: "Offen.md" } };
  plugin.generateImage = async (prompt) => ({ mime: "image/png", b64: PNG_B64, prompt });
  view.questionEl.value = "eine rote Kugel";
  await knopf(view, "1:1").listeners.click();
  assert.equal(written.length, 1);
  assert.match(written[0].notePath, /^UnitedShare\/bilder\/bild-\d+\.png$/);
  assert.equal(editor.replaced, 1);
  assert.match(editor.value, /!\[\[UnitedShare\/bilder\/bild-\d+\.png\]\]\n\*eine rote Kugel\*/);
  const nachricht = view.activeTab().messages.find((message) => message.bilder);
  assert.match(nachricht.bilder[0].path, /^UnitedShare\/bilder\/bild-\d+\.png$/);
  assert.equal(nachricht.bilder[0].b64, PNG_B64);
});

test("ein Bild ohne Datei bleibt in der Sitzung und nicht in der Ablage", async () => {
  const { view } = await offeneSeite();
  const bild = { mime: "image/png", b64: PNG_B64, prompt: "Kugel", extra: "weg" };
  view.activeTab().messages = [{ role: "assistant", content: "", bilder: [bild] }];
  assert.equal(view.activeTab().messages[0].bilder[0].b64, PNG_B64);
  assert.equal(view.tabAlsEintrag(view.activeTab()), null);

  view.newConversation();
  assert.equal(JSON.stringify(view.history).includes(PNG_B64), false);
  assert.equal(view.history[0].messages[0].bilder, undefined);
});

test("ein Bild mit Pfad und ohne Text bleibt in der Ablage", async () => {
  const { view } = await offeneSeite();
  const bild = {
    mime: "image/png",
    b64: PNG_B64,
    path: "UnitedShare/bilder/kugel.png",
    prompt: "Kugel",
    extra: "weg",
  };
  view.activeTab().messages = [{ role: "assistant", content: "", bilder: [bild] }];
  const eintrag = view.tabAlsEintrag(view.activeTab());
  assert.equal(eintrag.messages.length, 1);
  assert.deepEqual(eintrag.messages[0].bilder, [{
    mime: "image/png",
    path: "UnitedShare/bilder/kugel.png",
    prompt: "Kugel",
  }]);
  assert.equal(JSON.stringify(eintrag).includes(PNG_B64), false);
});

test("Token aufladen verlinkt die Verbrauchsseite und lässt den bestehenden Text stehen", async () => {
  const { plugin } = await offeneSeite();
  const satz = "Lesen, Listen, Schreiben und Starten laufen auf diesem Rechner über die Funktionen des offenen Tresors. Notiz hängt die offene Notiz an. Einfügen setzt die Zwischenablage an den Cursor. Antwort schreibt Frage und Antwort an den Cursor.";
  await plugin.settingTab.display();
  const setting = lastSetting("Token aufladen");
  assert.ok(setting);
  assert.equal(setting.desc, "Tag und Monat kommen vom Dienst. Nachkauf und Planwechsel stehen auf der Verbrauchsseite.");
  const link = find(plugin.settingTab.containerEl, (node) => node.tag === "a" && node.text === "Verbrauch öffnen");
  assert.equal(link.attrs.href, "https://unitedshare.ai/app/budget/");
  assert.equal(nodeTexts(plugin.settingTab.containerEl).join("\n").includes(satz), true);

  plugin.aufladenUrl = "https://evil.example/app/budget";
  await plugin.settingTab.display();
  const boese = find(plugin.settingTab.containerEl, (node) => node.tag === "a" && node.text === "Verbrauch öffnen");
  assert.equal(boese.attrs.href, "https://unitedshare.ai/app/budget/");

  plugin.aufladenUrl = "https://unitedshare.ai/app/budget/nachkauf";
  await plugin.settingTab.display();
  const gut = find(plugin.settingTab.containerEl, (node) => node.tag === "a" && node.text === "Verbrauch öffnen");
  assert.equal(gut.attrs.href, "https://unitedshare.ai/app/budget/nachkauf");
});

test("ein Bildfehler schreibt Limit und Auflade-Adresse", async () => {
  const { UnitedShareError } = require("./unitedshare-core");
  const { plugin, view } = await offeneSeite();
  plugin.generateImage = async () => {
    const error = new UnitedShareError("Das Tageslimit ist aufgebraucht.", 429);
    error.limits = { rest_tag: 0, rest_monat: 10 };
    error.aufladenUrl = "https://unitedshare.ai/app/budget/";
    throw error;
  };
  view.questionEl.value = "zu viel";
  await knopf(view, "Bild").listeners.click();
  await knopf(view, "1:1").listeners.click();
  assert.equal(find(view.contentEl, (node) => node.tag === "img"), null);
  assert.equal(find(view.contentEl, (node) => node.classList && node.classList.has("unitedshare-bild-platz")), null);
  assert.equal(view.statusEl.text, "Das Tageslimit ist aufgebraucht.");
  assert.equal(view.budgetEl.text.includes("Tag 0"), true);
  assert.equal(plugin.aufladenUrl, "https://unitedshare.ai/app/budget/");
});

test("die drei Punkte öffnen das Menü und schicken keine Frage", async () => {
  const { app, plugin, view } = await offeneSeite();
  view.questionEl.value = "bleibt";
  let called = 0;
  plugin.completeThread = async () => {
    called += 1;
    return "nein";
  };
  const mehr = knopf(view, "Mehr");
  const caption = find(mehr, (node) => node.classList.has("unitedshare-nav-caption"));
  assert.equal(caption.text, "...");
  const vorher = app.workspace.opened.length;
  await mehr.listeners.click();
  assert.equal(view.questionEl.value, "bleibt");
  assert.equal(called, 0);
  assert.equal(view.mehrMenu.classList.has("is-open"), true);
  assert.equal(app.workspace.opened.length, vorher);
  assert.equal(view.mehrMenu.children.includes(view.bildMenu), false);
});

test("eine Einstellung legt Notiz in die Leiste", async () => {
  const { app, plugin, view } = await offeneSeite();
  app.workspace.leaves.push({ type: VIEW_TYPE, app, view });
  assert.ok(view.mehrMenu.children.includes(view.attachButton));
  assert.equal(view.leisteEl.children.includes(view.attachButton), false);
  assert.ok(view.leisteEl.children.includes(view.askButton));
  await plugin.settingTab.display();
  await lastSetting("Notiz").dropdown.change("leiste");
  assert.ok(view.leisteEl.children.includes(view.attachButton));
  assert.equal(view.mehrMenu.children.includes(view.attachButton), false);
  assert.ok(view.leisteEl.children.includes(view.askButton));
  assert.equal(plugin.settings.promptWerkzeuge.notiz, "leiste");
  assert.ok(view.leisteEl.children.indexOf(view.attachButton) < view.leisteEl.children.indexOf(view.askButton));
});

test("ein eigenes Format mit 10 mal 10 wird abgelehnt", async () => {
  const { plugin, view } = await offeneSeite();
  view.questionEl.value = "klein";
  find(view.contentEl, (node) => node.attrs["aria-label"] === "Breite").value = "10";
  find(view.contentEl, (node) => node.attrs["aria-label"] === "Höhe").value = "10";
  let calls = 0;
  plugin.generateImage = async () => {
    calls += 1;
    return { mime: "image/png", b64: PNG_B64, prompt: "klein" };
  };
  const ab = mock.notices.length;
  await knopf(view, "Bild erzeugen").listeners.click();
  assert.ok(mock.notices.slice(ab).includes("Breite und Höhe liegen zwischen 64 und 2048."));
  assert.equal(calls, 0);
  assert.equal(view.questionEl.value, "klein");
});

test("16:9 hält den Platzhalter im Seitenverhältnis", async () => {
  const { plugin, view } = await offeneSeite();
  let gesehen = null;
  plugin.generateImage = async (prompt, mass) => {
    const platz = find(view.contentEl, (node) => node.attrs["aria-label"] === "Bild wird erzeugt");
    const figur = find(view.contentEl, (node) => node.classList && node.classList.has("is-laden"));
    gesehen = {
      mass,
      aria: platz && platz.attrs["aria-label"],
      ratio: figur && figur.style["--unitedshare-bild-ratio"],
    };
    return { mime: "image/png", b64: PNG_B64, prompt };
  };
  view.questionEl.value = "weit";
  await knopf(view, "16:9").listeners.click();
  assert.deepEqual(gesehen.mass, { breite: 1024, hoehe: 576, format: "png" });
  assert.equal(gesehen.aria, "Bild wird erzeugt");
  assert.equal(gesehen.ratio, "1024 / 576");
});

test("ein Bild bleibt nach dem Neuladen über den Pfad im Tresor", async () => {
  const adapter = chatAdapterMock();
  delete adapter.getBasePath;
  const dateien = new Map();
  const ordner = new Set();
  const { app, plugin, view } = await ansichtMitAdapter(adapter);
  app.vault.getAbstractFileByPath = (notePath) => {
    if (ordner.has(notePath)) return { path: notePath, children: [] };
    if (dateien.has(notePath)) return { path: notePath };
    return null;
  };
  app.vault.createFolder = async (folder) => {
    ordner.add(folder);
  };
  app.vault.createBinary = async (notePath, data) => {
    dateien.set(notePath, data);
    return { path: notePath };
  };
  app.vault.readBinary = async (file) => dateien.get(file.path);
  plugin.generateImage = async (prompt) => ({ mime: "image/png", b64: PNG_B64, prompt, extra: "weg" });
  await view.onOpen();
  view.questionEl.value = "eine rote Kugel";
  await knopf(view, "1:1").listeners.click();

  const pfade = [...adapter.inhalt.keys()].filter((p) => p.startsWith(".vault/chats/"));
  assert.equal(pfade.length, 1);
  const roh = adapter.inhalt.get(pfade[0]);
  assert.equal(roh.includes(PNG_B64), false);
  const abgelegt = JSON.parse(roh);
  assert.match(abgelegt.messages[0].bilder[0].path, /^UnitedShare\/bilder\/bild-\d+\.png$/);

  const neu = plugin.registeredViews[0].factory({ app });
  await neu.onOpen();
  const img = find(neu.contentEl, (node) => node.tag === "img");
  assert.match(img.attrs.src, new RegExp(`^data:image/png;base64,${PNG_B64}`));
});

test("In die Notiz nutzt einen vorhandenen Pfad und schreibt die Datei nicht neu", async () => {
  const { app, view } = await offeneSeite();
  const bild = {
    mime: "image/png",
    b64: PNG_B64,
    path: "UnitedShare/bilder/da.png",
    prompt: "da",
    breite: 1024,
    hoehe: 1024,
  };
  view.activeTab().messages = [{ role: "assistant", content: "da", bilder: [bild] }];
  await view.renderMessages();
  let writes = 0;
  app.vault = {
    getAbstractFileByPath() {
      return null;
    },
    async createFolder() {},
    async createBinary() {
      writes += 1;
    },
  };
  const editor = editorMit("");
  app.workspace.activeView = { editor, file: { path: "Offen.md" } };
  await knopf(view, "In die Notiz").listeners.click();
  assert.equal(writes, 0);
  assert.equal(editor.last.text, "![[UnitedShare/bilder/da.png]]\n*da*");
});

test("eine fehlende Bilddatei lässt keinen Platzhalter stehen", async () => {
  const { plugin, view } = await offeneSeite();
  plugin.readVaultBinary = async () => {
    throw new Error("fehlt");
  };
  view.activeTab().messages = [{
    role: "assistant",
    content: "weg",
    bilder: [{ mime: "image/png", path: "UnitedShare/bilder/fehlt.png", prompt: "weg", breite: 1024, hoehe: 576 }],
  }];
  await view.renderMessages();
  assert.equal(find(view.contentEl, (node) => node.tag === "img"), null);
  assert.equal(find(view.contentEl, (node) => node.classList && node.classList.has("is-laden")), null);
});

test("ein eigenes Format speichert Breite, Höhe und gif vor dem Erzeugen", async () => {
  const { plugin, view } = await offeneSeite();
  find(view.contentEl, (node) => node.classList && node.classList.has("unitedshare-bild-format")).value = "gif";
  find(view.contentEl, (node) => node.attrs["aria-label"] === "Breite").value = "640";
  find(view.contentEl, (node) => node.attrs["aria-label"] === "Höhe").value = "480";
  view.questionEl.value = "eigen";
  let saved = null;
  plugin.generateImage = async () => {
    saved = {
      bildBreite: plugin.settings.bildBreite,
      bildHoehe: plugin.settings.bildHoehe,
      bildFormat: plugin.settings.bildFormat,
    };
    throw new Error("kaputt");
  };
  await knopf(view, "Bild erzeugen").listeners.click();
  assert.deepEqual(saved, { bildBreite: 640, bildHoehe: 480, bildFormat: "gif" });
});

test("ein leeres eigenes Format speichert nichts und lässt das Feld stehen", async () => {
  const { plugin, view } = await offeneSeite();
  view.questionEl.value = "   ";
  const vorher = plugin.settings.bildBreite;
  let calls = 0;
  plugin.generateImage = async () => {
    calls += 1;
    return { mime: "image/png", b64: PNG_B64, prompt: "leer" };
  };
  const ab = mock.notices.length;
  await knopf(view, "Bild erzeugen").listeners.click();
  assert.ok(mock.notices.slice(ab).includes("Beschreibe das Bild."));
  assert.equal(calls, 0);
  assert.equal(plugin.settings.bildBreite, vorher);
  assert.equal(view.questionEl.value, "   ");
});

test("meldeBudget zeigt Verbrauch und Limit als Text und Balken in der Statusleiste", async () => {
  const app = makeApp();
  const plugin = new UnitedSharePlugin(app);
  await plugin.onload();

  plugin.meldeBudget({ verbraucht_tag: 25000000, limit_tag: 100000000 }, null);

  const text = find(plugin.statusBarItem, (n) => n.classList.has("unitedshare-statusbar-text"));
  const fuellung = find(plugin.statusBarItem, (n) => n.classList.has("unitedshare-statusbar-fill"));
  assert.ok(text, "Text im Statusleisten-Element fehlt");
  assert.equal(text.text, "25M/100M");
  assert.ok(fuellung, "Balken im Statusleisten-Element fehlt");
  assert.equal(fuellung.style.width, "25%");
});

test("ohne Verbrauchsdaten bleibt die Statusleiste leer", async () => {
  const app = makeApp();
  const plugin = new UnitedSharePlugin(app);
  await plugin.onload();

  plugin.meldeBudget({ verbraucht_tag: 25000000, limit_tag: 100000000 }, null);
  plugin.meldeBudget(null, null);

  assert.equal(plugin.statusBarItem.children.length, 0, "ein früherer Stand darf nicht stehen bleiben");
});

test("bestaetigeAktion öffnet eine Modal und löst nach dem Klick auf", async () => {
  const app = makeApp();
  const plugin = new UnitedSharePlugin(app);
  await plugin.onload();

  const erlaubtPromise = plugin.bestaetigeAktion({ action: "run", path: "lauf.py" });
  const erlaubtModal = mock.modals[mock.modals.length - 1];
  assert.equal(erlaubtModal.opened, true);
  assert.equal(find(erlaubtModal.contentEl, (n) => n.tag === "h2").text, "Aktion bestätigen");
  const erlaubenKnopf = find(erlaubtModal.contentEl, (n) => n.tag === "button" && n.text === "Erlauben");
  erlaubenKnopf.listeners.click();
  assert.equal(await erlaubtPromise, true);

  const abgelehntPromise = plugin.bestaetigeAktion({ action: "mesh-join", path: "peers/a.json" });
  const abgelehntModal = mock.modals[mock.modals.length - 1];
  const ablehnenKnopf = find(abgelehntModal.contentEl, (n) => n.tag === "button" && n.text === "Ablehnen");
  ablehnenKnopf.listeners.click();
  assert.equal(await abgelehntPromise, false);
});

test("schließt die Modal ohne Entscheidung, zählt das als Ablehnung", async () => {
  const app = makeApp();
  const plugin = new UnitedSharePlugin(app);
  await plugin.onload();

  const promise = plugin.bestaetigeAktion({ action: "sync", peer: "demo", direction: "pull" });
  const modal = mock.modals[mock.modals.length - 1];
  modal.onClose();
  assert.equal(await promise, false);
});

test("Schreibfreigabe zeigt den vorgeschlagenen Inhalt als Text", async () => {
  const app = makeApp();
  const plugin = new UnitedSharePlugin(app);
  await plugin.onload();

  const inhalt = "# Notiz\n<script>untrusted</script>";
  const promise = plugin.bestaetigeAktion({ action: "write", path: "Notiz.md", content: inhalt });
  const modal = mock.modals[mock.modals.length - 1];
  const vorschau = find(modal.contentEl, (n) => n.tag === "pre");
  assert.ok(vorschau);
  assert.equal(vorschau.text, inhalt);
  const ablehnen = find(modal.contentEl, (n) => n.tag === "button" && n.text === "Ablehnen");
  ablehnen.listeners.click();
  assert.equal(await promise, false);
});

test("Schreibfreigabe zeigt alte und neue Zeilen als Änderung", async () => {
  const plugin = new UnitedSharePlugin(makeApp());
  await plugin.onload();
  const promise = plugin.bestaetigeAktion({ action: "write", path: "Notiz.md", previousContent: "gleich\nalt\nende", content: "gleich\nneu\nende" });
  const modal = mock.modals[mock.modals.length - 1];
  const diff = find(modal.contentEl, (n) => n.classList.has("unitedshare-bestaetigung-diff"));
  assert.equal(diff.text, "− alt\n+ neu");
  find(modal.contentEl, (n) => n.tag === "button" && n.text === "Ablehnen").listeners.click();
  assert.equal(await promise, false);
});

test("private Vorlage sendet erst nach Vorschau nur den freigegebenen Text", async () => {
  const app = makeApp();
  app.workspace.getActiveFile = () => ({ path: "privat.md" });
  app.metadataCache = { getFileCache: () => ({ frontmatter: {
    unitedshare_privacy: "template", unitedshare_private_felder: ["kunde"], kunde: "Müller GmbH",
  } }) };
  const plugin = new UnitedSharePlugin(app);
  await plugin.onload();
  const gesendet = [];
  plugin.privateVorlageAnfragen = async (text) => { gesendet.push(text); return "Hallo {{VAR_1}}"; };
  plugin.commands.find((c) => c.id === "private-cloud-vorlage").callback();
  const modal = mock.modals[mock.modals.length - 1];
  find(modal.contentEl, (n) => n.tag === "textarea").value = "Plane für {{VAR_1}}";
  find(modal.contentEl, (n) => n.tag === "button" && n.text === "Versandvorschau").listeners.click();
  assert.deepEqual(gesendet, []);
  assert.ok(find(modal.contentEl, (n) => n.tag === "pre" && n.text === "Plane für {{VAR_1}}"));
  await find(modal.contentEl, (n) => n.tag === "button" && n.text === "Diesen Auftrag senden").listeners.click();
  assert.deepEqual(gesendet, ["Plane für {{VAR_1}}"]);
  assert.ok(find(modal.contentEl, (n) => n.tag === "pre" && n.text === "Hallo Müller GmbH"));
});

test("private Vorlage sendet über den echten Transport keine Properties, Dateinamen oder Historie", async () => {
  const app = makeApp();
  app.workspace.getActiveFile = () => ({ path: "vertraulich-geheim.md" });
  app.metadataCache = { getFileCache: () => ({ frontmatter: {
    unitedshare_privacy: "template", unitedshare_private_felder: ["kunde"], kunde: "Testgeheimnis GmbH",
  } }) };
  const plugin = new UnitedSharePlugin(app);
  await plugin.onload();
  plugin.settings.apiKey = "test-key";
  plugin.settings.model = "test-model";
  const vorher = mock.requests.length;
  plugin.commands.find((c) => c.id === "private-cloud-vorlage").callback();
  const modal = mock.modals[mock.modals.length - 1];
  find(modal.contentEl, (n) => n.tag === "textarea").value = "Prüfe {{VAR_1}}";
  find(modal.contentEl, (n) => n.tag === "button" && n.text === "Versandvorschau").listeners.click();
  assert.equal(mock.requests.length, vorher);
  await find(modal.contentEl, (n) => n.tag === "button" && n.text === "Diesen Auftrag senden").listeners.click();
  assert.equal(mock.requests.length, vorher + 1);
  const body = JSON.parse(mock.requests[vorher].body);
  assert.equal(body.messages.length, 2);
  assert.equal(body.messages[1].content, "Prüfe {{VAR_1}}");
  assert.doesNotMatch(JSON.stringify(body), /Testgeheimnis|vertraulich-geheim|kunde/);
});

test("der Schalter für Schreiben-Bestätigung ist für neue Installationen an", async () => {
  const app = makeApp();
  const plugin = new UnitedSharePlugin(app);
  await plugin.onload();
  assert.equal(plugin.settings.requireWriteConfirm, true);

  plugin.settingTab.display();
  const setting = lastSetting("Schreiben ebenfalls bestätigen");
  assert.ok(setting, "Schalter fehlt in den Einstellungen");
  await setting.toggle.change(false);
  assert.equal(plugin.settings.requireWriteConfirm, false);
});

test("Antwortlänge lässt sich in den Einstellungen wählen", async () => {
  const app = makeApp();
  const plugin = new UnitedSharePlugin(app);
  await plugin.onload();
  plugin.settingTab.display();
  const setting = lastSetting("Wie ausführlich darf die Antwort sein?");
  assert.ok(setting);
  await setting.dropdown.change("4096");
  assert.equal(plugin.settings.antwortTokens, 4096);
});

test("Modellautomatik wählt nur ein eindeutig verfügbares Modell und respektiert manuelle Auswahl", async () => {
  const plugin = new UnitedSharePlugin(makeApp());
  await plugin.onload();
  await plugin.waehleEinzigesModell(["rmxos-sema2026.1"]);
  assert.equal(plugin.settings.model, "rmxos-sema2026.1");
  await plugin.waehleEinzigesModell(["rmxos-mega2026.1"]);
  assert.equal(plugin.settings.model, "rmxos-sema2026.1");
  plugin.settings.model = "";
  await plugin.waehleEinzigesModell(["rmxos-sema2026.1", "rmxos-mega2026.1"]);
  assert.equal(plugin.settings.model, "");
  await plugin.waehleEinzigesModell(["unbekannt"]);
  assert.equal(plugin.settings.model, "");
});

test("ohne eindeutiges Modell erklärt der Auftrag die notwendige Auswahl", async () => {
  const plugin = new UnitedSharePlugin(makeApp());
  await plugin.onload();
  plugin.ensureModels = async () => ["rmxos-sema2026.1", "rmxos-mega2026.1"];
  await assert.rejects(plugin.completeThread([{ role: "user", content: "Hallo" }]), /Einstellungen ein Modell auswählen/);
});

function letzteNutzer(turns) {
  const nutzer = (turns || []).filter((turn) => turn.role === "user");
  return nutzer[nutzer.length - 1];
}

async function enterSeite() {
  const seite = await offeneSeite();
  const { plugin, view } = seite;
  seite.bilder = [];
  seite.asked = [];
  plugin.generateImage = async (prompt, mass) => {
    seite.bilder.push({ prompt, mass });
    return { mime: "image/png", b64: PNG_B64, prompt };
  };
  plugin.completeThread = async (turns) => {
    seite.asked.push(turns);
    return "Antworttext";
  };
  return seite;
}

test("Enter mit zeichne beauftragt das Bild und lässt das Textmodell", async () => {
  const { view, bilder, asked } = await enterSeite();
  view.attachments = ["Bleibt.md"];
  let gesammelt = 0;
  view.collectFiles = async () => {
    gesammelt += 1;
    return [{ path: "Bleibt.md", text: "Hinweis" }];
  };
  view.questionEl.value = "zeichne eine rote Kugel";
  await view.submit();
  assert.equal(gesammelt, 0);
  assert.deepEqual(view.attachments, ["Bleibt.md"]);
  assert.equal(asked.length, 0);
  assert.equal(bilder.length, 1);
  assert.equal(bilder[0].prompt, "rote Kugel");
  assert.deepEqual(bilder[0].mass, { breite: 1024, hoehe: 1024, format: "png" });
  const messages = view.activeTab().messages;
  assert.equal(messages[0].role, "user");
  assert.equal(messages[0].content, "zeichne eine rote Kugel");
  assert.equal(messages[1].role, "assistant");
  assert.equal(messages[1].bilder[0].b64, PNG_B64);
  assert.equal(view.questionEl.value, "");
});

test("Enter mit Zeichnung und Frage beauftragt Bild und Text", async () => {
  const { view, bilder, asked } = await enterSeite();
  const satz = "zeichne eine rote Kugel und nenne den Durchmesser";
  view.questionEl.value = satz;
  await view.submit();
  assert.equal(bilder.length, 1);
  assert.equal(bilder[0].prompt, "rote Kugel");
  assert.equal(asked.length, 1);
  assert.equal(letzteNutzer(asked[0]).content, "nenne den Durchmesser");
  const messages = view.activeTab().messages;
  assert.equal(messages.filter((message) => message.role === "user").length, 1);
  assert.equal(messages[0].content, satz);
  assert.equal(view.askedQuestion, satz);
});

test("Enter mit einer Frage beauftragt nur das Textmodell", async () => {
  const { view, bilder, asked } = await enterSeite();
  view.questionEl.value = "Was steht in der Notiz?";
  await view.submit();
  assert.equal(bilder.length, 0);
  assert.equal(asked.length, 1);
  assert.equal(letzteNutzer(asked[0]).content, "Was steht in der Notiz?");
});

test("Enter mit der Graphansicht beauftragt kein Modell", async () => {
  const { view, bilder, asked } = await enterSeite();
  view.questionEl.value = "zeige die Graphansicht";
  await view.submit();
  assert.equal(bilder.length, 0);
  assert.equal(asked.length, 0);
  assert.equal(view.activeTab().messages.length, 0);
});

test("Enter mit Seitenverhältnis gibt Breite und Höhe an das Bild", async () => {
  const { view, bilder, asked } = await enterSeite();
  view.questionEl.value = "16:9 von der fassade bei nacht";
  await view.submit();
  assert.equal(asked.length, 0);
  assert.equal(bilder.length, 1);
  assert.equal(bilder[0].prompt, "fassade bei nacht");
  assert.equal(bilder[0].mass.breite, 1024);
  assert.equal(bilder[0].mass.hoehe, 576);
});

test("Enter mit einem Sequenzdiagramm bleibt Text", async () => {
  const { view, bilder, asked } = await enterSeite();
  view.questionEl.value = "zeichne ein Sequenzdiagramm";
  await view.submit();
  assert.equal(bilder.length, 0);
  assert.equal(asked.length, 1);
  assert.equal(letzteNutzer(asked[0]).content, "zeichne ein Sequenzdiagramm");
});

test("ein unklarer Satz folgt dem lokalen Embedding", async () => {
  const { plugin, view, bilder, asked } = await enterSeite();
  plugin.absichtEmbed = async () => ({ bild: true, text: false, bildPrompt: "rote Kugel" });
  view.questionEl.value = "eine rote Kugel auf weißem Grund";
  await view.submit();
  assert.equal(bilder.length, 1);
  assert.equal(bilder[0].prompt, "rote Kugel");
  assert.equal(asked.length, 0);
  assert.equal(view.activeTab().messages[0].content, "eine rote Kugel auf weißem Grund");
});

test("eine geteilte Embedding-Antwort beauftragt Bild und Text", async () => {
  const { plugin, view, bilder, asked } = await enterSeite();
  plugin.absichtEmbed = async () => ({
    bild: true,
    text: true,
    bildPrompt: "rote Kugel",
    textPrompt: "nenne die Farbe",
  });
  view.questionEl.value = "eine rote Kugel auf weißem Grund";
  await view.submit();
  assert.equal(bilder[0].prompt, "rote Kugel");
  assert.equal(letzteNutzer(asked[0]).content, "nenne die Farbe");
  assert.equal(view.activeTab().messages[0].content, "eine rote Kugel auf weißem Grund");
  assert.equal(view.askedQuestion, "eine rote Kugel auf weißem Grund");
});

test("eine leere Textseite im Embedding bleibt die Textfrage", async () => {
  const { plugin, view, bilder, asked } = await enterSeite();
  plugin.absichtEmbed = async () => ({ bild: true, text: true, bildPrompt: "rote Kugel", textPrompt: "" });
  view.questionEl.value = "eine rote Kugel auf weißem Grund";
  await view.submit();
  assert.equal(bilder.length, 0);
  assert.equal(asked.length, 1);
  assert.equal(letzteNutzer(asked[0]).content, "eine rote Kugel auf weißem Grund");
});

test("ein werfendes Embedding bleibt die Textfrage", async () => {
  const { plugin, view, bilder, asked } = await enterSeite();
  plugin.absichtEmbed = async () => {
    throw new Error("weg");
  };
  view.questionEl.value = "eine rote Kugel auf weißem Grund";
  await view.submit();
  assert.equal(bilder.length, 0);
  assert.equal(asked.length, 1);
  assert.equal(letzteNutzer(asked[0]).content, "eine rote Kugel auf weißem Grund");
});

test("absichtModell bleibt ein verborgener Schlüssel", async () => {
  const app = makeApp();
  const plugin = new UnitedSharePlugin(app);
  let saved = 0;
  plugin.loadData = async () => ({ absichtModell: "  qwen3:8b  " });
  plugin.saveData = async () => {
    saved += 1;
  };
  await plugin.onload();
  assert.equal(plugin.settings.absichtModell, "qwen3:8b");
  assert.equal(saved, 0);
  const vorher = mock.settings.length;
  await plugin.settingTab.display();
  const neu = mock.settings.slice(vorher);
  assert.equal(neu.some((setting) => /absicht/i.test(String(setting.name || ""))), false);
});

test.after(() => {
  mock.restore();
});
