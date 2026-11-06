// 书签单页的全部逻辑。浏览器里作为普通脚本加载并自动挂到页面上；测试里通过 module.exports 拿到同一套函数。
// 数据只存在本机 localStorage。旧数组只读；新增按独立键保存，删除写永久标识，
// 不把过时列表写回，不依赖跨标签页的读改写锁。storage 事件用于刷新视图。
(function (root) {
  "use strict";

  var KEY = "personal-bookmarks:v1";
  var PREFIX = "personal-bookmarks:v2:";
  var ITEM = PREFIX + "item:";
  var DELETED = PREFIX + "del:";
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

  // 旧记录没有分类字段，按未分类读取。
  function categoryOf(record) {
    return record && typeof record.category === "string" ? record.category.trim() : "";
  }

  function matches(record, filter) {
    var category = filter && typeof filter.category === "string" ? filter.category : "all";
    var keyword = filter && typeof filter.keyword === "string" ? filter.keyword.trim().toLowerCase() : "";
    var own = categoryOf(record).toLowerCase();
    if (category === "none" && own) return false;
    if (category.indexOf("c:") === 0 && own !== category.slice(2)) return false;
    if (keyword && record.title.toLowerCase().indexOf(keyword) === -1 &&
        record.url.toLowerCase().indexOf(keyword) === -1) return false;
    return true;
  }

  function isSafeRecord(record) {
    if (!record || typeof record !== "object") return false;
    if (typeof record.id !== "string" || !record.id || typeof record.title !== "string" || typeof record.url !== "string") return false;
    try { encodeURIComponent(record.id); } catch (error) { return false; }
    return validate(record.title, record.url).ok;
  }

  function defaultId() {
    var cryptoApi = root && root.crypto;
    if (cryptoApi && typeof cryptoApi.randomUUID === "function") return cryptoApi.randomUUID();
    if (cryptoApi && typeof cryptoApi.getRandomValues === "function") {
      return Array.from(cryptoApi.getRandomValues(new Uint32Array(4)), function (v) {
        return v.toString(16).padStart(8, "0");
      }).join("");
    }
    return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
  }

  function createStore(storage, newId) {
    var makeId = newId || defaultId;

    function checkStorage() {
      if (!storage) throw new Error("浏览器不允许使用本地存储");
      if (!Number.isInteger(storage.length) || typeof storage.key !== "function") {
        throw new Error("浏览器不支持枚举本地存储，未保存任何改动");
      }
    }

    function readLegacy() {
      checkStorage();
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

    function itemKey(id) { return ITEM + encodeURIComponent(id); }
    function deletedKey(id) { return DELETED + encodeURIComponent(id); }

    function list() {
      var legacy = readLegacy().filter(isSafeRecord);
      var records = [];
      for (var i = 0; i < storage.length; i++) {
        var key = storage.key(i);
        if (typeof key !== "string" || key.indexOf(ITEM) !== 0) continue;
        // Storage access errors must remain visible; only malformed JSON is skipped.
        var raw = storage.getItem(key);
        var record;
        try { record = JSON.parse(raw); } catch (error) { continue; }
        if (!isSafeRecord(record) || key !== itemKey(record.id)) continue;
        records.push(record);
      }
      records.sort(function (a, b) {
        var at = typeof a.createdAt === "string" ? a.createdAt : "";
        var bt = typeof b.createdAt === "string" ? b.createdAt : "";
        return at < bt ? -1 : at > bt ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
      });
      var seen = new Set();
      return legacy.concat(records).filter(function (record) {
        if (seen.has(record.id)) return false;
        seen.add(record.id);
        return storage.getItem(deletedKey(record.id)) === null;
      });
    }

    return {
      list: list,
      add: function (value) {
        var legacy = readLegacy();
        var checked = validate(value.title, value.url);
        if (!checked.ok) throw new Error(checked.error);
        for (var attempt = 0; attempt < 3; attempt++) {
          var id = makeId();
          if (typeof id !== "string" || !id) throw new Error("无法生成书签 ID");
          if (legacy.some(function (r) { return r && r.id === id; }) ||
              storage.getItem(itemKey(id)) !== null || storage.getItem(deletedKey(id)) !== null) continue;
          var record = { id: id, title: checked.value.title, url: checked.value.url,
            category: String(value.category == null ? "" : value.category).trim(), createdAt: new Date().toISOString() };
          storage.setItem(itemKey(id), JSON.stringify(record));
          return record;
        }
        throw new Error("书签 ID 冲突，输入已保留，请重试");
      },
      remove: function (id) {
        checkStorage();
        if (typeof id !== "string" || !id) throw new Error("无效的书签 ID");
        storage.setItem(deletedKey(id), "1");
      },
    };
  }

  function mount(doc, storage, win, newId) {
    var form = doc.getElementById("add-form");
    var titleInput = doc.getElementById("title");
    var urlInput = doc.getElementById("url");
    var categoryInput = doc.getElementById("category");
    var filterForm = doc.getElementById("filter-form");
    var filterCategory = doc.getElementById("filter-category");
    var filterKeyword = doc.getElementById("filter-keyword");
    var message = doc.getElementById("message");
    var list = doc.getElementById("list");
    var empty = doc.getElementById("empty");
    var noMatch = doc.getElementById("no-match");
    var store = createStore(storage, newId);
    // 只有用户点"筛选"/"清除"才会改变生效的条件。
    var applied = { category: "all", keyword: "" };

    function say(text, isError) {
      message.textContent = text;
      message.className = isError ? "error" : "ok";
    }

    function addOption(value, label) {
      var option = doc.createElement("option");
      option.value = value;
      option.textContent = label;
      filterCategory.appendChild(option);
    }

    function renderCategories(items) {
      var current = filterCategory.value || applied.category;
      var seen = new Set();
      filterCategory.textContent = "";
      addOption("all", "全部分类");
      addOption("none", "未分类");
      items.forEach(function (bookmark) {
        var name = categoryOf(bookmark);
        if (!name || seen.has(name.toLowerCase())) return;
        seen.add(name.toLowerCase());
        addOption("c:" + name.toLowerCase(), name);
      });
      if (current !== "all" && current !== "none" && !seen.has(current.slice(2))) {
        addOption(current, current.slice(2));
      }
      filterCategory.value = current;
    }

    function render() {
      var all;
      try {
        all = store.list();
      } catch (error) {
        say(error.message, true);
        return;
      }
      renderCategories(all);
      var items = all.filter(function (bookmark) { return matches(bookmark, applied); });
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
        var tag = doc.createElement("span");
        tag.className = "category";
        tag.textContent = categoryOf(bookmark) || "未分类";
        item.appendChild(link);
        item.appendChild(address);
        item.appendChild(remove);
        item.appendChild(tag);
        list.appendChild(item);
      });
      empty.hidden = all.length > 0;
      noMatch.hidden = all.length === 0 || items.length > 0;
    }

    filterForm.addEventListener("submit", function (event) {
      event.preventDefault();
      applied = { category: filterCategory.value || "all", keyword: filterKeyword.value };
      render();
    });

    filterForm.addEventListener("reset", function (event) {
      event.preventDefault();
      filterCategory.value = "all";
      filterKeyword.value = "";
      applied = { category: "all", keyword: "" };
      render();
    });

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var checked = validate(titleInput.value, urlInput.value);
      if (!checked.ok) {
        say(checked.error, true);
        return;
      }
      try {
        store.add({ title: checked.value.title, url: checked.value.url, category: categoryInput.value });
      } catch (error) {
        say("保存失败：" + error.message + "。输入已保留，可以稍后重试。", true);
        return;
      }
      titleInput.value = "";
      urlInput.value = "";
      categoryInput.value = "";
      say("已添加", false);
      render();
    });

    if (win && typeof win.addEventListener === "function") {
      win.addEventListener("storage", function (event) {
        if (event.key === KEY || event.key === null ||
            (typeof event.key === "string" && event.key.indexOf(PREFIX) === 0)) render();
      });
    }

    render();
    return { render: render };
  }

  var api = { KEY: KEY, PREFIX: PREFIX, validate: validate, matches: matches, createStore: createStore, mount: mount };

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
