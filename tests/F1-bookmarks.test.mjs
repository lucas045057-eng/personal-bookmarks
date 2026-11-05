import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { build, ROOT } from "../scripts/build.mjs";

const APP = readFileSync(path.join(ROOT, "bookmarks/app.js"), "utf8");
const PAGE = readFileSync(path.join(ROOT, "bookmarks/index.html"), "utf8");

function loadApi() {
  const sandbox = { module: { exports: {} }, URL, JSON, Date, Math, String, Error };
  vm.runInNewContext(APP, sandbox);
  return sandbox.module.exports;
}
const api = loadApi();

class MemoryStorage {
  constructor() {
    this.data = new Map();
    this.failWrites = false;
  }
  getItem(key) {
    return this.data.has(key) ? this.data.get(key) : null;
  }
  setItem(key, value) {
    if (this.failWrites) throw new Error("存储空间已满");
    this.data.set(key, String(value));
  }
}

let counter = 0;
const nextId = () => `id-${++counter}`;

// 极简假 DOM：只实现 app.js 用到的那些接口，页面里没有的 id 返回 null（和浏览器一致）
function fakeDocument(html) {
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
  const make = (tagName) => {
    const el = {
      tagName: tagName.toUpperCase(),
      children: [],
      listeners: {},
      value: "",
      hidden: false,
      className: "",
      _text: "",
      get textContent() {
        return this._text + this.children.map((c) => c.textContent).join("");
      },
      set textContent(v) {
        this._text = String(v);
        this.children = [];
      },
      appendChild(child) {
        this.children.push(child);
        return child;
      },
      addEventListener(type, fn) {
        (this.listeners[type] ??= []).push(fn);
      },
      dispatch(type, event = {}) {
        let prevented = false;
        const e = { ...event, preventDefault: () => (prevented = true) };
        for (const fn of this.listeners[type] ?? []) fn(e);
        return prevented;
      },
    };
    return el;
  };
  const byId = new Map([...ids].map((id) => [id, make("div")]));
  return { getElementById: (id) => byId.get(id) ?? null, createElement: make };
}

function fakeWindow() {
  const listeners = [];
  return { addEventListener: (type, fn) => type === "storage" && listeners.push(fn), fire: (event) => listeners.forEach((fn) => fn(event)) };
}

function openTab(storage) {
  const doc = fakeDocument(PAGE);
  const win = fakeWindow();
  api.mount(doc, storage, win, nextId);
  const $ = (id) => doc.getElementById(id);
  return {
    doc,
    win,
    $,
    items: () => $("list").children,
    add(title, url) {
      $("title").value = title;
      $("url").value = url;
      return $("add-form").dispatch("submit");
    },
  };
}

test("F1 校验：标题非空，链接只收 http/https，危险协议被拒并提示", () => {
  assert.equal(api.validate("", "https://a.com").ok, false);
  assert.equal(api.validate("   ", "https://a.com").error, "请填写标题");
  assert.equal(api.validate("A", "").error, "请填写链接");
  assert.match(api.validate("A", "example.com").error, /http/);
  for (const bad of ["javascript:alert(1)", "JavaScript:alert(1)", " data:text/html,<b>x</b>", "vbscript:x", "file:///etc/passwd", "ftp://a.com"]) {
    const r = api.validate("A", bad);
    assert.equal(r.ok, false, bad);
    assert.match(r.error, /只支持 http/, bad);
  }
  assert.deepEqual({ ...api.validate("  标题 ", " https://a.com/x ").value }, { title: "标题", url: "https://a.com/x" });
  assert.equal(api.validate("A", "http://a.com").ok, true);
});

test("F1 添加后列表显示、在新标签页打开、可删除，刷新后保留", () => {
  const storage = new MemoryStorage();
  const tab = openTab(storage);
  assert.equal(tab.$("empty").hidden, false);
  assert.equal(tab.add("示例", "https://example.com/"), true, "提交要 preventDefault，不能真的提交表单");
  assert.equal(tab.items().length, 1);
  const [link, , remove] = tab.items()[0].children;
  assert.equal(link.tagName, "A");
  assert.equal(link.textContent, "示例");
  assert.equal(link.href, "https://example.com/");
  assert.equal(link.target, "_blank");
  assert.match(link.rel, /noopener/);
  assert.equal(tab.$("title").value, "");
  assert.equal(tab.$("url").value, "");
  assert.equal(tab.$("empty").hidden, true);

  tab.add("第二个", "http://b.example/");
  const refreshed = openTab(storage);
  assert.deepEqual(refreshed.items().map((li) => li.children[0].textContent), ["示例", "第二个"]);

  refreshed.items()[0].children[2].dispatch("click");
  assert.deepEqual(refreshed.items().map((li) => li.children[0].textContent), ["第二个"]);
  assert.deepEqual(openTab(storage).items().map((li) => li.children[0].textContent), ["第二个"]);
  assert.ok(remove);
});

test("F1 非法输入不保存、有提示、输入保留", () => {
  const storage = new MemoryStorage();
  const tab = openTab(storage);
  tab.add("坏链接", "javascript:alert(1)");
  assert.equal(tab.items().length, 0);
  assert.equal(tab.$("message").className, "error");
  assert.match(tab.$("message").textContent, /只支持 http/);
  assert.equal(tab.$("url").value, "javascript:alert(1)");
  assert.equal(storage.getItem(api.KEY), null);
});

test("F1 标题按纯文本展示，不用 innerHTML", () => {
  const storage = new MemoryStorage();
  const tab = openTab(storage);
  const evil = '<img src=x onerror="alert(1)">';
  tab.add(evil, "https://a.com/");
  assert.equal(tab.items()[0].children[0].textContent, evil);
  assert.doesNotMatch(APP, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
});

test("F1 存储里被篡改的危险链接不会渲染成可点链接", () => {
  const storage = new MemoryStorage();
  storage.setItem(api.KEY, JSON.stringify([{ id: "x", title: "坏", url: "javascript:alert(1)" }, { id: "y", title: "好", url: "https://ok.example/" }]));
  const tab = openTab(storage);
  assert.deepEqual(tab.items().map((li) => li.children[0].href), ["https://ok.example/"]);
});

test("F1 存储失败：保留输入并明确提示", () => {
  const storage = new MemoryStorage();
  const tab = openTab(storage);
  storage.failWrites = true;
  tab.add("留着", "https://keep.example/");
  assert.equal(tab.$("title").value, "留着");
  assert.equal(tab.$("url").value, "https://keep.example/");
  assert.equal(tab.$("message").className, "error");
  assert.match(tab.$("message").textContent, /保存失败.*存储空间已满.*输入已保留/);
  assert.equal(tab.items().length, 0);

  const noStorage = openTab(null);
  noStorage.add("留着", "https://keep.example/");
  assert.equal(noStorage.$("title").value, "留着");
  assert.match(noStorage.$("message").textContent, /保存失败/);
});

test("F1 已保存数据损坏时不覆盖", () => {
  const storage = new MemoryStorage();
  storage.setItem(api.KEY, "{坏的");
  const tab = openTab(storage);
  assert.match(tab.$("message").textContent, /无法读取/);
  tab.add("新", "https://n.example/");
  assert.equal(storage.getItem(api.KEY), "{坏的");
  assert.equal(tab.$("title").value, "新");
});

test("F1 两个标签页交错添加/删除不覆盖、不复活彼此的数据", () => {
  const storage = new MemoryStorage();
  const a = openTab(storage);
  const b = openTab(storage); // b 打开时还是空的，之后不刷新
  a.add("A1", "https://a1.example/");
  b.add("B1", "https://b1.example/");
  const titles = () => api.createStore(storage).list().map((r) => r.title);
  assert.deepEqual(titles(), ["A1", "B1"], "b 的添加不能覆盖 a 的");

  // a 删掉 A1，b 页面上还显示着 A1（过期），再添加 B2：A1 不能复活
  const a1 = a.items().find((li) => li.children[0].textContent === "A1");
  a1.children[2].dispatch("click");
  b.add("B2", "https://b2.example/");
  assert.deepEqual(titles(), ["B1", "B2"]);

  // 过期页面里删一个已不存在的 / 别人刚加的都不受影响
  a.add("A2", "https://a2.example/");
  const staleB1 = b.items().find((li) => li.children[0].textContent === "B1");
  staleB1.children[2].dispatch("click");
  assert.deepEqual(titles(), ["B2", "A2"]);

  // 另一标签页改了存储时，本页收到 storage 事件后刷新列表
  a.win.fire({ key: api.KEY });
  assert.deepEqual(a.items().map((li) => li.children[0].textContent), ["B2", "A2"]);
});

test("F1 页面：只加载同目录脚本，CSP 不放行内联脚本，元素齐全", () => {
  assert.match(PAGE, /^<!doctype html>/i);
  assert.match(PAGE, /<script src="\.\/app\.js"><\/script>/);
  const csp = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(PAGE)?.[1] ?? "";
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /script-src 'self'(;|$)/);
  assert.doesNotMatch(PAGE, /(?:src|href)\s*=\s*["']https?:\/\//i);
  for (const id of ["add-form", "title", "url", "message", "list", "empty"]) assert.match(PAGE, new RegExp(`id="${id}"`), id);
  assert.doesNotMatch(APP + PAGE, /\bdebugger\b|console\.(log|debug)\(/);
});

test("F1 构建产物带上 bookmarks/", () => {
  const out = mkdtempSync(path.join(tmpdir(), "dist-"));
  try {
    build(path.join(out, "dist"), { GITHUB_SHA: "b".repeat(40), GITHUB_REPOSITORY: "me/app" });
    for (const f of ["bookmarks/index.html", "bookmarks/app.js"]) assert.ok(existsSync(path.join(out, "dist", f)), f);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});
