/* Pale Moon Bridge - restartless add-on. Polls the local bridge for commands. */
"use strict";
var Cc = Components.classes, Ci = Components.interfaces;

var BASE = "http://127.0.0.1:18765";
var running = false;
var token = "";

function getToken() {
  // Set in about:config: extensions.palemoonbridge.token
  try {
    var p = Cc["@mozilla.org/preferences-service;1"].getService(Ci.nsIPrefBranch);
    return p.getCharPref("extensions.palemoonbridge.token");
  } catch (e) { return ""; }
}
function getBase() {
  try {
    var p = Cc["@mozilla.org/preferences-service;1"].getService(Ci.nsIPrefBranch);
    return p.getCharPref("extensions.palemoonbridge.url");
  } catch (e) { return BASE; }
}

function xhr(method, path, body, cb) {
  var x = Cc["@mozilla.org/xmlextras/xmlhttprequest;1"].createInstance(Ci.nsIXMLHttpRequest);
  x.open(method, getBase() + path, true);
  x.setRequestHeader("X-Bridge-Token", token);
  x.onload = function () { cb(x.status === 200 ? x.responseText : null); };
  x.onerror = function () { cb(null); };
  x.send(body || null);
}

function win() {
  return Cc["@mozilla.org/appshell/window-mediator;1"].getService(Ci.nsIWindowMediator)
    .getMostRecentWindow("navigator:browser");
}
function tabOf(w, i) {
  var tabs = w.gBrowser.tabs;
  if (i === null || i === undefined) return w.gBrowser.selectedTab;
  if (i < 0 || i >= tabs.length) throw new Error("no such tab " + i);
  return tabs[i];
}

function waitLoad(browser, cb) {
  // Poll until the document is fully loaded (or give up after 20s).
  var start = Date.now();
  (function check() {
    var d = browser.contentDocument;
    if (d && d.readyState === "complete" && browser.currentURI.spec !== "about:blank") return cb();
    if (Date.now() - start > 20000) return cb();
    setTimeout(check, 300);
  })();
}

function sel(doc, s) {
  var el = doc.querySelector(s);
  if (!el) throw new Error("no element matches " + s);
  return el;
}
function cssPath(el) {
  if (el.id) return "#" + el.id;
  var parts = [];
  while (el && el.nodeType === 1 && el.tagName !== "HTML") {
    var i = 1, s = el;
    while ((s = s.previousElementSibling)) if (s.tagName === el.tagName) i++;
    parts.unshift(el.tagName.toLowerCase() + ":nth-of-type(" + i + ")");
    el = el.parentElement;
  }
  return parts.join(" > ");
}

// Each handler gets (params, reply(data)); throw to report an error.
var handlers = {
  list_tabs: function (p, reply) {
    var w = win(), out = [];
    for (var i = 0; i < w.gBrowser.tabs.length; i++) {
      var t = w.gBrowser.tabs[i], b = t.linkedBrowser;
      out.push({ index: i, title: t.label, url: b.currentURI.spec, selected: t === w.gBrowser.selectedTab });
    }
    reply(out);
  },
  navigate: function (p, reply) {
    var w = win(), t = tabOf(w, p.tab), b = t.linkedBrowser;
    w.gBrowser.selectedTab = t;
    waitLoad(b, function () { reply({ url: b.currentURI.spec, title: b.contentTitle }); });
    b.loadURI(p.url);
  },
  new_tab: function (p, reply) {
    var w = win(), t = w.gBrowser.addTab(p.url);
    w.gBrowser.selectedTab = t;
    reply({ index: w.gBrowser.tabs.length - 1 });
  },
  close_tab: function (p, reply) {
    var w = win(); w.gBrowser.removeTab(tabOf(w, p.tab)); reply({ closed: true });
  },
  get_text: function (p, reply) {
    var d = tabOf(win(), p.tab).linkedBrowser.contentDocument;
    var text = d.body ? (d.body.innerText || d.body.textContent) : "";
    var max = p.max_chars || 20000;
    reply({ url: d.location.href, title: d.title, text: text.slice(0, max), truncated: text.length > max });
  },
  get_elements: function (p, reply) {
    var d = tabOf(win(), p.tab).linkedBrowser.contentDocument;
    var els = d.querySelectorAll("a[href],button,input,textarea,select,[role=button]"), out = [];
    for (var i = 0; i < els.length && out.length < 200; i++) {
      var e = els[i];
      out.push({
        selector: cssPath(e), tag: e.tagName.toLowerCase(), type: e.type || null,
        text: (e.innerText || e.value || e.getAttribute("aria-label") || e.placeholder || "").trim().slice(0, 80),
        href: e.href || null
      });
    }
    reply(out);
  },
  click: function (p, reply) {
    var el = sel(tabOf(win(), p.tab).linkedBrowser.contentDocument, p.selector);
    el.scrollIntoView(); el.click(); reply({ clicked: p.selector });
  },
  type: function (p, reply) {
    var d = tabOf(win(), p.tab).linkedBrowser.contentDocument, el = sel(d, p.selector);
    el.focus(); el.value = p.text;
    el.dispatchEvent(new d.defaultView.Event("input", { bubbles: true }));
    el.dispatchEvent(new d.defaultView.Event("change", { bubbles: true }));
    if (p.submit && el.form) el.form.submit ? (el.form.requestSubmit ? el.form.requestSubmit() : el.form.submit()) : 0;
    reply({ typed: p.selector });
  }
};

function handle(cmd) {
  function send(obj) { obj.id = cmd.id; xhr("POST", "/result", JSON.stringify(obj), function () {}); }
  try {
    var h = handlers[cmd.action];
    if (!h) throw new Error("unknown action " + cmd.action);
    h(cmd.params || {}, function (data) { send({ data: data }); });
  } catch (e) {
    var msg = String(e && e.message || e);
    send({ error: msg + (e && e.stack ? "\n" + e.stack : "") });
  }
}

function poll() {
  if (!running) return;
  token = getToken();
  xhr("GET", "/poll", null, function (text) {
    if (text) { try { var c = JSON.parse(text); if (c.id) handle(c); } catch (e) {} }
    setTimeout(poll, text === null ? 3000 : 0); // back off when bridge is down
  });
}

function setTimeout(fn, ms) {
  var t = Cc["@mozilla.org/timer;1"].createInstance(Ci.nsITimer);
  timers.push(t);
  t.initWithCallback({ notify: function () { var i = timers.indexOf(t); if (i >= 0) timers.splice(i, 1); fn(); } }, ms, Ci.nsITimer.TYPE_ONE_SHOT);
}
var timers = [];

function startup() { running = true; poll(); }
function shutdown() { running = false; timers.forEach(function (t) { t.cancel(); }); timers = []; }
function install() {}
function uninstall() {}
