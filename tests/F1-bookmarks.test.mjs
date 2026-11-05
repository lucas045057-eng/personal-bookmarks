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
  get length() {
    return this.data.size;
  }
  key(index) {
    return [...this.data.keys()][index] ?? null;
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
const nextId = () => `id-${String(++counter).padStart(6, "0")}`;

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
  // Convert the vm realm's array to a host array before strict comparison.
  const titles = () => Array.from(api.createStore(storage).list(), (r) => r.title);
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

// Interleave operations inside a storage read, rather than completing each tab's
// operation sequentially. The returned value remains the caller's stale snapshot.
class HookStorage extends MemoryStorage {
  getItem(key) {
    const old = super.getItem(key);
    if (key === api.KEY && this.afterRead) {
      const hook = this.afterRead;
      this.afterRead = null;
      hook();
    }
    return old;
  }
}

test("F1 并发反例：A读取后B完成新增，再A写入，两条都必须保留", () => {
  const storage = new HookStorage();
  const a = api.createStore(storage, () => "a");
  const b = api.createStore(storage, () => "b");
  storage.afterRead = () => b.add({ title: "B", url: "https://b.example/" });
  a.add({ title: "A", url: "https://a.example/" });
  assert.deepEqual(Array.from(a.list(), r => r.title).sort(), ["A", "B"]);
});

test("F1 并发反例：B读取后A删除，B新增写入不能复活被删记录", () => {
  const storage = new HookStorage();
  const a = api.createStore(storage, () => "a");
  const b = api.createStore(storage, () => "b");
  a.add({ title: "A", url: "https://a.example/" });
  storage.afterRead = () => a.remove("a");
  b.add({ title: "B", url: "https://b.example/" });
  assert.deepEqual(Array.from(api.createStore(storage).list(), r => r.title), ["B"]);
  assert.deepEqual(openTab(storage).items().map(li => li.children[0].textContent), ["B"]);
});

test("F1 旧数组只读：新增删除重开均不改旧字节，删除不会被旧数据复活", () => {
  const storage = new MemoryStorage();
  const old = JSON.stringify([{ id: "old", title: "Old", url: "https://old.example/" }]);
  storage.setItem(api.KEY, old);
  const store = api.createStore(storage, () => "new");
  store.add({ title: "New", url: "https://new.example/" });
  store.remove("old");
  assert.equal(storage.getItem(api.KEY), old);
  assert.deepEqual(Array.from(api.createStore(storage).list(), r => r.title), ["New"]);
  assert.deepEqual(openTab(storage).items().map(li => li.children[0].textContent), ["New"]);
});

test("F1 ID冲突不能覆盖原记录或复用已删除记录的标识", () => {
  const storage = new MemoryStorage();
  const store = api.createStore(storage, () => "same");
  store.add({ title: "First", url: "https://first.example/" });
  assert.throws(() => store.add({ title: "Second", url: "https://second.example/" }), /ID/);
  assert.deepEqual(Array.from(store.list(), r => r.title), ["First"]);
  store.remove("same");
  assert.throws(() => store.add({ title: "Again", url: "https://again.example/" }), /ID/);
  assert.equal(store.list().length, 0);
});

test("F1 新格式危险或损坏记录不渲染，前缀事件刷新，删除失败不误报成功", () => {
  const storage = new MemoryStorage();
  const tab = openTab(storage);
  api.createStore(storage, () => "safe").add({ title: "Safe", url: "https://safe.example/" });
  assert.equal(typeof api.PREFIX, "string");
  const prefix = api.PREFIX;
  storage.setItem(prefix + "item:evil", JSON.stringify({ id: "evil", title: "Evil", url: "javascript:alert(1)" }));
  storage.setItem(prefix + "item:wrong", JSON.stringify({ id: "different", title: "Wrong", url: "https://wrong.example/" }));
  storage.setItem(prefix + "item:broken", "{bad");
  tab.win.fire({ key: prefix + "item:safe" });
  assert.deepEqual(tab.items().map(li => li.children[0].textContent), ["Safe"]);
  storage.failWrites = true;
  tab.items()[0].children[2].dispatch("click");
  assert.match(tab.$("message").textContent, /删除失败/);
  assert.equal(tab.items().length, 1);
  storage.failWrites = false;
  tab.items()[0].children[2].dispatch("click");
  assert.equal(openTab(storage).items().length, 0);
});

test("F1 非法输入不写独立记录，存储不可枚举时明确失败保留输入", () => {
  const storage = new MemoryStorage();
  openTab(storage).add("Bad", "javascript:alert(1)");
  assert.equal(storage.length, 0);
  const tab = openTab({ getItem: () => null, setItem() {} });
  tab.add("Keep", "https://keep.example/");
  assert.equal(tab.$("title").value, "Keep");
  assert.match(tab.$("message").textContent, /保存失败/);
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
