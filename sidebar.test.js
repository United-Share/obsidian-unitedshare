"use strict";

const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");

const VIEW_TYPE = "unitedshare-sidebar";
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
    addRibbonIcon(icon, title, callback) {
      this.ribbons.push({ icon, title, callback });
    }
    addCommand(command) {
      this.commands.push(command);
    }
    addSettingTab(tab) {
      this.settingTab = tab;
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
  class Modal {
    constructor(app) {
      this.app = app;
      this.contentEl = createNode("div");
    }
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

  const obsidian = {
    ItemView,
    MarkdownView,
    MarkdownRenderer,
    Modal,
    Notice,
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
        text: "Antwort aus messages",
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
    settings,
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

test("onload zeigt UnitedShare in der rechten Seitenleiste und in der linken Leiste", async () => {
  const app = makeApp();
  const plugin = new UnitedSharePlugin(app);
  await plugin.onload();

  assert.equal(plugin.registeredViews.length, 1);
  assert.equal(plugin.registeredViews[0].type, VIEW_TYPE);
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
  assert.deepEqual(app.workspace.detached, [VIEW_TYPE]);
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
  const insertButton = find(view.contentEl, (node) => node.tag === "button" && node.attrs["aria-label"] === "In die Notiz");
  const newConversation = find(view.contentEl, (node) => node.tag === "button" && node.attrs["aria-label"] === "Neues Gespräch");
  const privacy = find(view.contentEl, (node) => node.tag === "a" && node.attrs.href === "https://unitedshare.ai/privacy");
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
  assert.ok(privacy);

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
  const labels = ["Fragen", "In die Notiz", "Aktive Notiz", "Neuer Tab", "Neues Gespräch", "Verlauf"];
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

test("eine erwähnte Notiz geht als Text mit, die aktive Notiz wird als @-Pfad eingesetzt", async () => {
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
  const attach = find(view.contentEl, (node) => node.tag === "button" && node.attrs["aria-label"] === "Aktive Notiz");
  assert.ok(attach, "Schaltfläche Aktive Notiz fehlt");
  await attach.listeners.click();
  assert.equal(view.questionEl.value, '@"Notizen/Heute.md"');

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

test("completeThread geht an /v1/messages ohne Werkzeuge", async () => {
  const app = makeApp();
  const plugin = new UnitedSharePlugin(app);
  await plugin.onload();
  plugin.settings.apiKey = "test-key";
  plugin.settings.model = "rmxos-mega2026.1";
  const before = mock.requests.length;
  const text = await plugin.completeThread([{ role: "user", content: "Hallo" }]);
  const call = mock.requests[before];
  assert.equal(call.url, "https://api.unitedshare.ai/v1/messages");
  const body = JSON.parse(call.body);
  assert.equal(body.model, "rmxos-mega2026.1");
  assert.equal(body.stream, true);
  assert.equal(call.headers["Content-Length"], String(Buffer.byteLength(call.body)));
  assert.equal(Object.hasOwn(body, "tools"), false);
  assert.equal(body.messages[0].content[0].type, "text");
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
  assert.deepEqual(model.dropdown.order, [
    "",
    "rmxos-sema2026.1",
    "rmxos-mega2026.1",
    "rmxos-mobil2026.1",
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
    ["", "rmxos-sema2026.1", "rmxos-mega2026.1", "rmxos-mobil2026.1"],
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
  plugin.loadData = async () => ({ apiKey: "", baseUrl: "https://api.example.test/v1", model: "rmxos-mobil2026.1" });
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
  assert.equal(lastSetting("Modell").dropdown.value, "rmxos-mobil2026.1");
  assert.equal(lastSetting("Modell").dropdown.options.devstral, undefined);

  await key.text.change("rejected-key");
  await new Promise((resolve) => setTimeout(resolve, 500));
  const failed = lastSetting("Modell");
  assert.equal(failed.dropdown, null);
  assert.match(failed.desc, /abgelehnt/);
  assert.equal(failed.text.value, "rmxos-mobil2026.1");
  assert.equal(plugin.settings.model, "rmxos-mobil2026.1");
});

function nodeTexts(node, acc = []) {
  if (node && node.text) acc.push(node.text);
  for (const child of (node && node.children) || []) nodeTexts(child, acc);
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
  assert.deepEqual(model.dropdown.order, ["", "rmxos-sema2026.1", "rmxos-mega2026.1", "rmxos-mobil2026.1"]);
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
  const mesh = find(view.contentEl, (node) => node.classList && node.classList.has("unitedshare-mesh"));
  assert.ok(mesh, "die Seitenleiste zeigt das direkte Netz");
  const sideText = nodeTexts(mesh).join("\n");
  assert.match(sideText, /Modell: mini:qwen, mesh-only-model/);
  assert.match(sideText, /Agent: mini:schreiber/);
  assert.match(sideText, /Oberfläche: tafel/);
  const select = find(view.contentEl, (node) => node.tag === "select");
  assert.deepEqual(
    select.children.filter((node) => node.tag === "option").map((node) => node.attrs.value),
    ["", "rmxos-sema2026.1", "rmxos-mega2026.1", "rmxos-mobil2026.1"],
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

test.after(() => {
  mock.restore();
});
