// 书签单页的全部逻辑。浏览器里作为普通脚本加载并自动挂到页面上；测试里通过 module.exports 拿到同一套函数。
// 数据只存在本机 localStorage。每次增删都先重新读取存储里的最新数据再写回，
// 所以两个标签页交错操作不会互相覆盖，也不会把对方删掉的书签写回来。
(function (root) {
  "use strict";

  var KEY = "personal-bookmarks:v1";
  var ALLOWED = ["http:", "https:"];

  function validate(title, link) {
    var cleanTitle = String(title == null ? "" : title).trim();
    var cleanLink = String(link == null ? "" : link).trim();
    if (!cleanTitle) return { ok: false, error: "请填写标题" };
    if (!cleanLink) return { ok: false, error: "请填写链接" };
    var parsed;
    try {
      parsed = new URL(cleanLink);
    } catch (error) {
      return { ok: false, error: "链接格式不正确，请填写以 http:// 或 https:// 开头的完整网址" };
    }
    if (ALLOWED.indexOf(parsed.protocol) === -1) {
      return { ok: false, error: "不允许 " + parsed.protocol + " 链接，只支持 http:// 或 https://" };
    }
    return { ok: true, value: { title: cleanTitle, url: parsed.href } };
  }

  function isSafeRecord(record) {
    if (!record || typeof record !== "object") return false;
    if (typeof record.id !== "string" || typeof record.title !== "string" || typeof record.url !== "string") return false;
    return validate(record.title, record.url).ok;
  }

  function defaultId() {
    var cryptoApi = root && root.crypto;
    if (cryptoApi && typeof cryptoApi.randomUUID === "function") return cryptoApi.randomUUID();
    return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
  }

  function createStore(storage, newId) {
    var makeId = newId || defaultId;

    function readAll() {
      if (!storage) throw new Error("浏览器不允许使用本地存储");
      var raw = storage.getItem(KEY);
      if (raw === null || raw === undefined) return [];
      var data;
      try {
        data = JSON.parse(raw);
      } catch (error) {
        throw new Error("已保存的书签数据无法读取，为避免丢失没有做任何改动");
      }
      if (!Array.isArray(data)) throw new Error("已保存的书签数据无法读取，为避免丢失没有做任何改动");
      return data;
    }

    function writeAll(records) {
      storage.setItem(KEY, JSON.stringify(records));
    }

    return {
      list: function () {
        return readAll().filter(isSafeRecord);
      },
      add: function (value) {
        var records = readAll();
        var record = { id: makeId(), title: value.title, url: value.url, createdAt: new Date().toISOString() };
        records.push(record);
        writeAll(records);
        return record;
      },
      remove: function (id) {
        var records = readAll();
        var rest = records.filter(function (record) {
          return !record || record.id !== id;
        });
        if (rest.length !== records.length) writeAll(rest);
      },
    };
  }

  function mount(doc, storage, win, newId) {
    var form = doc.getElementById("add-form");
    var titleInput = doc.getElementById("title");
    var urlInput = doc.getElementById("url");
    var message = doc.getElementById("message");
    var list = doc.getElementById("list");
    var empty = doc.getElementById("empty");
    var store = createStore(storage, newId);

    function say(text, isError) {
      message.textContent = text;
      message.className = isError ? "error" : "ok";
    }

    function render() {
      var items;
      try {
        items = store.list();
      } catch (error) {
        say(error.message, true);
        return;
      }
      list.textContent = "";
      items.forEach(function (bookmark) {
        var item = doc.createElement("li");
        var link = doc.createElement("a");
        link.textContent = bookmark.title;
        link.href = bookmark.url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        var address = doc.createElement("span");
        address.className = "url";
        address.textContent = bookmark.url;
        var remove = doc.createElement("button");
        remove.type = "button";
        remove.textContent = "删除";
        remove.addEventListener("click", function () {
          try {
            store.remove(bookmark.id);
          } catch (error) {
            say("删除失败：" + error.message, true);
            return;
          }
          say("已删除", false);
          render();
        });
        item.appendChild(link);
        item.appendChild(address);
        item.appendChild(remove);
        list.appendChild(item);
      });
      empty.hidden = items.length > 0;
    }

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var checked = validate(titleInput.value, urlInput.value);
      if (!checked.ok) {
        say(checked.error, true);
        return;
      }
      try {
        store.add(checked.value);
      } catch (error) {
        say("保存失败：" + error.message + "。输入已保留，可以稍后重试。", true);
        return;
      }
      titleInput.value = "";
      urlInput.value = "";
      say("已添加", false);
      render();
    });

    if (win && typeof win.addEventListener === "function") {
      win.addEventListener("storage", function (event) {
        if (event.key === KEY || event.key === null) render();
      });
    }

    render();
    return { render: render };
  }

  var api = { KEY: KEY, validate: validate, createStore: createStore, mount: mount };

  if (typeof module === "object" && module && module.exports) {
    module.exports = api;
  } else if (root && root.document) {
    var storage = null;
    try {
      storage = root.localStorage;
    } catch (error) {
      storage = null;
    }
    mount(root.document, storage, root);
  }
})(this);
