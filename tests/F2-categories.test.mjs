import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { ROOT } from "../scripts/build.mjs";

const APP = readFileSync(path.join(ROOT, "bookmarks/app.js"), "utf8");
const PAGE = readFileSync(path.join(ROOT, "bookmarks/index.html"), "utf8");

const sandbox = { module: { exports: {} }, URL, JSON, Date, Math, String, Error, Set };
vm.runInNewContext(APP, sandbox);
const api = sandbox.module.exports;

class MemoryStorage {
  constructor() {
    this.data = new Map();
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
    this.data.set(key, String(value));
  }
}

let counter = 0;
const nextId = () => `f2-${String(++counter).padStart(6, "0")}`;

function fakeDocument(html) {
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
  const make = (tagName) => ({
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
    dispatch(type) {
      let prevented = false;
      const e = { preventDefault: () => (prevented = true) };
      for (const fn of this.listeners[type] ?? []) fn(e);
      return prevented;
    },
  });
  const byId = new Map([...ids].map((id) => [id, make("div")]));
  return { getElementById: (id) => byId.get(id) ?? null, createElement: make };
}

function openTab(storage) {
  const doc = fakeDocument(PAGE);
  const listeners = [];
  const win = { addEventListener: (type, fn) => type === "storage" && listeners.push(fn) };
  api.mount(doc, storage, win, nextId);
  const $ = (id) => doc.getElementById(id);
  return {
    $,
    fireStorage: (event) => listeners.forEach((fn) => fn(event)),
    titles: () => $("list").children.map((li) => li.children[0].textContent),
    categories: () => $("list").children.map((li) => li.children[3].textContent),
    options: () => $("filter-category").children.map((o) => [o.value, o.textContent]),
    add(title, url, category = "") {
      $("title").value = title;
      $("url").value = url;
      $("category").value = category;
      return $("add-form").dispatch("submit");
    },
    filter(category, keyword = "") {
      $("filter-category").value = category;
      $("filter-keyword").value = keyword;
      return $("filter-form").dispatch("submit");
    },
  };
}

function seeded() {
  const storage = new MemoryStorage();
  const tab = openTab(storage);
  tab.add("Node Docs", "https://nodejs.org/docs/", "  Work ");
  tab.add("Recipes", "https://food.example/", "生活");
  tab.add("Inbox", "https://mail.example/", "");
  tab.add("MDN", "https://developer.mozilla.org/", "work");
  return { storage, tab };
}

test("F2 添加时可填自由文本分类，留空为未分类，添加成功后清空分类输入", () => {
  const { storage, tab } = seeded();
  assert.deepEqual(tab.titles(), ["Node Docs", "Recipes", "Inbox", "MDN"]);
  assert.deepEqual(tab.categories(), ["Work", "生活", "未分类", "work"]);
  assert.equal(tab.$("category").value, "");
  const stored = Array.from(api.createStore(storage).list(), (r) => r.category);
  assert.deepEqual(stored, ["Work", "生活", "", "work"]);
});

test("F2 刷新后分类保留，分类选项按不区分大小写去重", () => {
  const { storage } = seeded();
  const refreshed = openTab(storage);
  assert.deepEqual(refreshed.categories(), ["Work", "生活", "未分类", "work"]);
  assert.deepEqual(refreshed.options(), [["all", "全部分类"], ["none", "未分类"], ["c:work", "Work"], ["c:生活", "生活"]]);
});

test("F2 只有点筛选才生效；分类筛选不区分大小写", () => {
  const { tab } = seeded();
  tab.$("filter-category").value = "c:work";
  tab.$("filter-keyword").value = "mdn";
  tab.fireStorage({ key: api.PREFIX + "item:x" });
  assert.equal(tab.titles().length, 4, "未点筛选前改了条件也不应生效");
  assert.equal(tab.filter("c:work"), true);
  assert.deepEqual(tab.titles(), ["Node Docs", "MDN"]);
  tab.filter("none");
  assert.deepEqual(tab.titles(), ["Inbox"]);
  tab.filter("all");
  assert.equal(tab.titles().length, 4);
});

test("F2 关键词按标题或链接搜索、不区分大小写，并与分类叠加", () => {
  const { tab } = seeded();
  tab.filter("all", "  NODE ");
  assert.deepEqual(tab.titles(), ["Node Docs"]);
  tab.filter("all", "MOZILLA.ORG");
  assert.deepEqual(tab.titles(), ["MDN"], "关键词能命中链接");
  tab.filter("c:work", "example");
  assert.deepEqual(tab.titles(), [], "分类与关键词同时满足才显示");
  tab.filter("c:生活", "EXAMPLE");
  assert.deepEqual(tab.titles(), ["Recipes"]);
  tab.filter("none", "mail");
  assert.deepEqual(tab.titles(), ["Inbox"]);
});

test("F2 筛选结果为空时有提示，与「还没有书签」区分；清除后恢复", () => {
  const storage = new MemoryStorage();
  const tab = openTab(storage);
  assert.equal(tab.$("empty").hidden, false);
  assert.equal(tab.$("no-match").hidden, true, "没有书签时不显示无匹配提示");
  tab.add("A", "https://a.example/", "x");
  tab.filter("all", "zzz");
  assert.deepEqual(tab.titles(), []);
  assert.equal(tab.$("no-match").hidden, false);
  assert.equal(tab.$("empty").hidden, true);
  assert.match(PAGE, /id="no-match"[^>]*>[^<]*没有符合条件/);
  tab.$("filter-form").dispatch("reset");
  assert.deepEqual(tab.titles(), ["A"]);
  assert.equal(tab.$("no-match").hidden, true);
  assert.equal(tab.$("filter-keyword").value, "");
  assert.equal(tab.$("filter-category").value, "all");
});

test("F2 筛选生效时其它标签页的新增按当前条件刷新", () => {
  const storage = new MemoryStorage();
  const a = openTab(storage);
  const b = openTab(storage);
  a.add("Work 1", "https://w1.example/", "Work");
  b.fireStorage({ key: api.PREFIX + "item:x" });
  b.filter("c:work");
  a.add("Home", "https://home.example/", "Home");
  a.add("Work 2", "https://w2.example/", "WORK");
  b.fireStorage({ key: api.PREFIX + "item:y" });
  assert.deepEqual(b.titles(), ["Work 1", "Work 2"]);
  assert.equal(b.$("filter-category").value, "c:work");
});

test("F2 既有无分类记录（旧数组与 F1 独立记录）仍可读取并归为未分类", () => {
  const storage = new MemoryStorage();
  storage.setItem(api.KEY, JSON.stringify([{ id: "old", title: "Legacy", url: "https://legacy.example/" }]));
  storage.setItem(
    api.PREFIX + "item:f1",
    JSON.stringify({ id: "f1", title: "F1 record", url: "https://f1.example/", createdAt: "2026-11-01T00:00:00.000Z" }),
  );
  storage.setItem(
    api.PREFIX + "item:odd",
    JSON.stringify({ id: "odd", title: "Odd", url: "https://odd.example/", category: 42, createdAt: "2026-11-02T00:00:00.000Z" }),
  );
  const tab = openTab(storage);
  assert.deepEqual(tab.titles(), ["Legacy", "F1 record", "Odd"]);
  assert.deepEqual(tab.categories(), ["未分类", "未分类", "未分类"]);
  tab.filter("none");
  assert.deepEqual(tab.titles(), ["Legacy", "F1 record", "Odd"]);
  tab.add("New", "https://new.example/", "Tools");
  tab.filter("c:tools");
  assert.deepEqual(tab.titles(), ["New"]);
});

test("F2 分类按纯文本显示，不改变 F1 的列表结构", () => {
  const storage = new MemoryStorage();
  const tab = openTab(storage);
  const evil = "<img src=x onerror=alert(1)>";
  tab.add("T", "https://t.example/", evil);
  const [link, address, remove, tag] = tab.$("list").children[0].children;
  assert.equal(link.tagName, "A");
  assert.equal(address.className, "url");
  assert.equal(remove.textContent, "删除");
  assert.equal(tag.textContent, evil);
  assert.deepEqual(tab.options().at(-1), ["c:" + evil, evil]);
  assert.doesNotMatch(APP, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
});

test("F2 页面：分类输入、筛选表单齐全，窄屏换行不溢出", () => {
  for (const id of ["category", "filter-form", "filter-category", "filter-keyword", "no-match"]) {
    assert.match(PAGE, new RegExp(`id="${id}"`), id);
  }
  assert.match(PAGE, /li \{[^}]*flex-wrap: wrap/);
  assert.match(PAGE, /\.filters \{[^}]*flex-wrap: wrap/);
  assert.match(PAGE, /name="viewport" content="width=device-width/);
});
