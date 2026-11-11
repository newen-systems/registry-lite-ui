"use strict";
// All data is rendered with textContent, never innerHTML, so registry names cannot inject markup.
const $ = (id) => document.getElementById(id);
let cfg = {};
let recent = { events: [], lastChanged: {}, persistent: false, seq: 0 };
let shown = 0; // rows revealed in the current list
let checked = null; // when the server last finished a walk of the registry

// Preferences only, no data or secrets. Storage may be blocked, so every access is guarded.
// expanded and selected are the tree state (node ids and the location hash), sidebar is its width in px.
const DEFAULTS = { theme: "system", repoSort: "name", tagSort: "recent", packageSort: "name", live: true, refresh: 0, interval: 30, pageSize: 50, runtime: "podman", showEmpty: false, treeSizes: false, mapBy: "total", storageView: "map", notify: false, tool: "pip", os: "linux", show: "all", sidebar: 280, selected: "/recent", expanded: [] };
const CHOICES = { mapBy: ["total", "frees"], storageView: ["map", "table"], theme: ["system", "light", "dark"], repoSort: ["name", "recent"], tagSort: ["recent", "version"], packageSort: ["name", "recent"], runtime: ["podman", "docker"], tool: ["pip", "uv"], os: ["linux", "windows"], show: ["all", "containers", "helm", "python"], interval: [10, 30, 60, 300], refresh: [0, 10, 15, 30, 60], pageSize: [25, 50, 100, 200] };
const MAX_EXPANDED = 500;
const SIDEBAR = [180, 640];
let prefs = { ...DEFAULTS };
const pref = {
  expanded: (v) => Array.isArray(v) && v.length <= MAX_EXPANDED && v.every((s) => typeof s === "string" && s.length < 300),
  selected: (v) => typeof v === "string" && v.startsWith("/") && v.length < 300,
  sidebar: (v) => typeof v === "number" && v >= SIDEBAR[0] && v <= SIDEBAR[1],
};
function prefValid(k, v) {
  if (pref[k]) return pref[k](v);
  if (CHOICES[k]) return CHOICES[k].includes(v);
  return typeof v === typeof DEFAULTS[k];
}
function loadPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem("registry-lite-ui") || "{}");
    for (const k of Object.keys(DEFAULTS)) {
      if (prefValid(k, p[k])) prefs[k] = p[k];
    }
    // A browser that stored one sort, picked in Settings (sortSet), keeps it for repositories and packages. Tags take their default.
    if (!("repoSort" in p) && p.sortSet && CHOICES.repoSort.includes(p.sort)) prefs.repoSort = prefs.packageSort = p.sort;
  } catch (e) { /* blocked or corrupt: use defaults */ }
}
function savePrefs() { try { localStorage.setItem("registry-lite-ui", JSON.stringify(prefs)); } catch (e) { /* blocked */ } }
function applyTheme() {
  const c = document.documentElement.classList;
  c.remove("light", "dark");
  if (prefs.theme !== "system") c.add(prefs.theme);
}

function el(tag, props, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) { if (k === "role" || k.includes("-")) n.setAttribute(k, v); else n[k] = v; }
  n.append(...kids.filter((k) => k !== null && k !== undefined));
  return n;
}
const short = (d) => (d || "").slice(0, 19);
function size(n) {
  if (n == null) return "";
  if (n >= 1099511627776) return (n / 1099511627776).toFixed(1) + " TiB";
  if (n >= 1073741824) return (n / 1073741824).toFixed(1) + " GiB";
  return n < 1048576 ? (n / 1024).toFixed(1) + " KiB" : (n / 1048576).toFixed(1) + " MiB";
}
const code = (t) => el("code", { textContent: t });
function ago(t) {
  if (!t) return "";
  const s = Math.max(0, Math.round(Date.now() / 1000 - t));
  if (s < 60) return s + " s ago";
  if (s < 3600) return Math.round(s / 60) + " min ago";
  if (s < 86400) return Math.round(s / 3600) + " h ago";
  return Math.round(s / 86400) + " d ago";
}
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
const byName = (a, b) => collator.compare(a.name, b.name);
const isAtt = (p) => p.os === "unknown" && p.architecture === "unknown"; // buildx attestation manifests, not platforms
const platName = (p) => [p.os, p.architecture, p.variant].filter(Boolean).join("/");

// Icons are built from path data with the DOM API. s marks stroked paths, cut marks the cut-outs that take the background colour.
const SVGNS = "http://www.w3.org/2000/svg";
const ICONS = {
  chev: [["s", "M6 3.5l4.5 4.5L6 12.5"]],
  folder: [["", "M1.5 4a1 1 0 0 1 1-1h3.2l1.6 1.6h6.2a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1z"]],
  folderOpen: [["", "M1.5 4a1 1 0 0 1 1-1h3.2l1.6 1.6h5.2a1 1 0 0 1 1 1V6H4.1a1 1 0 0 0-.95.7L1.5 11.5z"], ["", "M4.3 7.2h10.4a.5.5 0 0 1 .47.67l-1.6 4.4a1 1 0 0 1-.94.65H2.3z"]],
  registry: [["", "M2 2h12a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z"], ["cut", "M4 4.5h8v1.4H4z"]],
  whale: [["", "M1 8.2h11.6c.5-.3.9-.9 1-1.6.6.1 1.1.4 1.4.8-.2.8-.8 1.2-1.5 1.4C11.8 11.6 9.6 13 6.9 13 3.9 13 1.7 11.3 1 8.2z"],
    ["", "M2.6 5.7h1.8v1.8H2.6zM4.8 5.7h1.8v1.8H4.8zM7 5.7h1.8v1.8H7zM9.2 5.7H11v1.8H9.2zM4.8 3.5h1.8v1.8H4.8zM7 3.5h1.8v1.8H7zM7 1.3h1.8v1.8H7z"]],
  chip: [["", "M4.5 4.5h7v7h-7z"], ["s", "M6.5 2v2.5M9.5 2v2.5M6.5 11.5V14M9.5 11.5V14M2 6.5h2.5M2 9.5h2.5M11.5 6.5H14M11.5 9.5H14"]],
  copy: [["s", "M5.5 5.5h7v8h-7zM3.5 10.5v-8h7"]],
  funnel: [["s", "M2 3h12L9.5 8.5V13l-3 1.5v-6z"]],
  sun: [["s", "M8 5.2a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6zM8 1.5v1.4M8 13.1v1.4M1.5 8h1.4M13.1 8h1.4M3.4 3.4l1 1M11.6 11.6l1 1M12.6 3.4l-1 1M4.4 11.6l-1 1"]],
  moon: [["s", "M13 9.4A5.4 5.4 0 0 1 6.6 3a5.4 5.4 0 1 0 6.4 6.4z"]],
  monitor: [["s", "M2.5 3h11v7.5h-11zM6 13.5h4M8 10.5v3"]],
  close: [["s", "M4 4l8 8M12 4l-8 8"]],
  arrow: [["s", "M8 12.5v-9M4.5 7L8 3.5 11.5 7"]],
  chart: [["s", "M8 1.8a6.2 6.2 0 1 0 0 12.4A6.2 6.2 0 0 0 8 1.8zM8 6.4a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2zM8 1.8v4.6M8 9.6v4.6M2.6 4.9l4 2.3M9.4 8.8l4 2.3M2.6 11.1l4-2.3M9.4 7.2l4-2.3"]],
  box: [["s", "M3 3h10v10H3z"]],
  repo: [["", "M8 1.8l6 3-6 3-6-3z"], ["s", "M2 8l6 3 6-3M2 11l6 3 6-3"]], // a repository, beside the folder of a path that is only a parent
  artifact: [["s", "M8 1.8l5.5 3v6.4L8 14.2l-5.5-3V4.8zM2.5 4.8L8 7.8l5.5-3M8 7.8v6.4"]],
  clock: [["s", "M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2zM8 4.8V8l2.2 1.4"]],
  pkg: [["s", "M8 1.8l5.5 3v6.4L8 14.2l-5.5-3V4.8zM2.5 4.8L8 7.8l5.5-3M8 7.8v6.4"]],
  drive: [["s", "M3 4.5h10A1.5 1.5 0 0 1 14.5 6v4a1.5 1.5 0 0 1-1.5 1.5H3A1.5 1.5 0 0 1 1.5 10V6A1.5 1.5 0 0 1 3 4.5zM1.5 8.2h13M11.2 9.9h.01M13 9.9h.01"]], // a hard drive: a box, a rule, two lights
  tag: [["s", "M2 2.5h5.2l6.3 6.3-4.7 4.7L2.5 7.2V2.5zM5 5h.01"]],
  pypi: [["", "M8 1.5l5.6 3.1L8 7.7 2.4 4.6z"], ["s", "M2.4 5.5v5.9L8 14.5V8.6zM13.6 5.5v5.9L8 14.5"]],
  trash: [["s", "M3 4.5h10M6.5 4.5V3a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1v1.5M4.5 4.5l.6 8a1 1 0 0 0 1 .95h3.8a1 1 0 0 0 1-.95l.6-8M6.7 7v4M9.3 7v4"]],
};
const iconCache = new Map();
function icon(name, cls) { // built once per name and class, then cloned: a long tree makes thousands of them
  const key = name + "|" + (cls || "");
  if (!iconCache.has(key)) iconCache.set(key, buildIcon(name, cls));
  return iconCache.get(key).cloneNode(true);
}
function buildIcon(name, cls) {
  const s = document.createElementNS(SVGNS, "svg");
  s.setAttribute("viewBox", "0 0 16 16");
  s.setAttribute("class", "i " + (cls || ""));
  s.setAttribute("aria-hidden", "true");
  for (const [kind, d] of ICONS[name]) {
    const p = document.createElementNS(SVGNS, "path");
    p.setAttribute("d", d);
    if (kind) p.setAttribute("class", kind);
    s.append(p);
  }
  return s;
}

async function api(path, body) {
  const opt = body ? { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": cfg.csrf }, body: JSON.stringify(body) } : {};
  const r = await fetch(path, opt);
  const j = await r.json();
  if (!r.ok) throw Object.assign(new Error(j.error || r.statusText), { status: r.status });
  return j;
}

function banner(text, err) {
  $("banner").hidden = !text;
  $("banner").className = err ? "err" : "";
  $("banner").textContent = text || "";
}

// One dialog for every action. fields: {name, label, value, type: text|checkbox|select, options}. Resolves to the values, or null on cancel.
let paneStale = false; // the pane changed while a dialog was open
const modalOpen = () => !!document.querySelector("dialog[open]"); // any dialog: confirm, settings, help, copy, move or delete
// A pane redraw that was held back while a dialog was open runs when the last one closes. (close does not bubble, so listen in the capture phase.)
document.addEventListener("close", () => { if (paneStale && !modalOpen()) { paneStale = false; void renderPane(); } }, true);
// A blocked dialog shows `block` as a warning and leaves Confirm disabled.
function ask(title, lines, fields, danger, block) {
  const form = $("form");
  form.replaceChildren(el("h3", { textContent: title }), ...(block ? [el("p", { className: "dlg-warn", role: "alert", textContent: block })] : []), ...lines.map((l) => el("p", { textContent: l })));
  const option = (f) => (o) => el("option", { value: String(o), textContent: String(o), selected: String(o) === String(f.value) });
  const input = (f) => {
    if (f.type === "checkbox") return el("input", { type: "checkbox", name: f.name, checked: f.value !== false });
    if (f.type === "select") return el("select", { name: f.name }, ...f.options.map(option(f)));
    return el("input", { type: "text", name: f.name, value: f.value, required: true });
  };
  fields.forEach((f) => form.append(el("label", {}, f.label + " ", input(f))));
  form.append(el("menu", {}, el("button", { textContent: "Cancel", value: "cancel" }), el("button", { textContent: "Confirm", value: "ok", className: danger ? "danger" : "", disabled: !!block })));
  return new Promise((resolve) => {
    $("dlg").onclose = () => {
      const v = Object.fromEntries(fields.map((f) => [f.name, f.type === "checkbox" ? form[f.name].checked : form[f.name].value]));
      resolve($("dlg").returnValue === "ok" ? v : null);
      if (paneStale) { paneStale = false; void renderPane(); }
    };
    $("dlg").showModal();
  });
}

// busy: shown while the job runs, so a slow delete or copy does not look like nothing happened.
async function run(job, done, busy) {
  try { banner(busy || ""); await job(); banner(""); await done(); } catch (e) { banner(e.message, true); }
}
const goneVerb = (what) => (cfg.binDays ? `Moving ${what} to the Bin...` : `Deleting ${what}...`);

// A list that shows pageSize rows and a button for more.
function paged(rows, headers) {
  const n = shown || prefs.pageSize;
  const out = [el("table", {}, headers ? el("tr", {}, ...headers.map((h) => el("th", { textContent: h }))) : null, ...rows.slice(0, n))];
  if (rows.length > n) out.push(el("p", {}, el("button", { textContent: `Show more (${rows.length - n} left)`, onclick: () => { shown = n + prefs.pageSize; void renderPane(); } })));
  return out;
}

// ---- Tree model ------------------------------------------------------------------------------------------------
// Nodes: root (the registry), node (a path segment, a folder, a repository or both), tag, plat (one platform of an index).
// Only what is expanded is rendered, and tags and platforms are fetched when their parent first opens.
const tree = {
  root: null, proot: null, byKey: new Map(), byId: new Map(), byPath: new Map(), sel: null, focus: null,
  filter: "", matches: null, closed: new Set(), flashes: new Map(), tagIndex: new Map(), empty: new Set(), emptyKey: "", helm: new Set(), helmKey: "", tm: new Map(), pathHit: new Set(), indexStale: true, truncated: false,
};
const expanded = new Set();
const manifests = new Map(); // "repo@digest" -> manifest JSON; cleared for a repo when it changes
const inflight = new Map();
const repoOf = (ref) => ref.slice(0, ref.lastIndexOf(":"));

function mk(kind, id, name, parent, extra) {
  const n = { kind, id, name, parent, ...extra };
  tree.byId.set(id, n);
  return n;
}
function pathNode(path) {
  let n = tree.byPath.get(path);
  if (n) return n;
  const i = path.lastIndexOf("/");
  const parent = i < 0 ? tree.root : pathNode(path.slice(0, i));
  n = mk("node", "n:" + path, path.slice(i + 1), parent, { path, repo: false, kids: new Map(), tagList: [], tagMap: new Map(), fresh: false, loading: null, err: "", sortedKids: null });
  tree.byPath.set(path, n);
  parent.kids.set(n.name, n);
  parent.sortedKids = null;
  return n;
}
function dropNode(n) {
  tree.byId.delete(n.id);
  for (const t of n.tagList || []) { tree.byId.delete(t.id); for (const p of t.plats || []) tree.byId.delete(p.id); }
}
function pruneUp(n) { // remove a node that is no longer a repository and holds nothing
  while (n?.kind === "node" && !n.repo && !n.kids.size) {
    n.parent.kids.delete(n.name);
    n.parent.sortedKids = null;
    tree.byPath.delete(n.path);
    dropNode(n);
    n = n.parent;
  }
}
// Reconcile the node tree with the catalog. Returns whether anything was added or removed.
function applyCatalog(names, flashNew) {
  const want = new Set(names);
  let changed = false;
  for (const p of names) {
    const n = pathNode(p);
    if (!n.repo) { n.repo = true; changed = true; if (flashNew) flash(n); }
  }
  for (const n of tree.byPath.values()) {
    if (n.repo && !want.has(n.path)) { n.repo = false; n.fresh = false; for (const t of n.tagList) { tree.byId.delete(t.id); } n.tagList = []; n.tagMap.clear(); changed = true; pruneUp(n); }
  }
  tree.names = names;
  tree.matches = null;
  return changed;
}
function kidsOf(n) {
  if (n.kind === "proot") return pkgSort(n.kids);
  if (n.kind === "pkg") return n.verList;
  if (n.kind === "ver") return [];
  if (n.kind === "tag") return n.plats || [];
  if (n.kind === "plat") return [];
  const k = visibleKids(n);
  return n.kind === "node" && n.repo ? [...k, ...n.tagList] : k;
}
function folderKids(n) { // the child folders and repositories, by name or last change, kept until they or the order change
  const key = prefs.repoSort === "recent" ? "r" + recent.seq : "n";
  if (!n.sortedKids || n.sortKey !== key) {
    const kids = [...n.kids.values()], changed = new Map(prefs.repoSort === "recent" ? kids.map((k) => [k, lastChange(k)]) : []);
    n.sortedKids = kids.sort(prefs.repoSort === "recent" ? (a, b) => changed.get(b) - changed.get(a) || byName(a, b) : byName);
    n.sortKey = key;
  }
  return n.sortedKids;
}
// Repositories with no tags are left out unless Settings says to show them. Whether one is empty comes from what is already known: its tags
// if they are loaded, else the poller's list of repositories it walked and found empty (/api/tagnames). Unknown counts as not empty, so it shows.
function isEmptyRepo(n) {
  if (!n.repo) return false;
  if (n.fresh && !n.err) return n.tagList.length === 0;
  return tree.empty.has(n.path) && !tree.tagIndex.has(n.path);
}
let hiddenMemo = new Map();
const resetHidden = () => { hiddenMemo = new Map(); };
// A repository of Helm charts, from the poller's list (/api/tagnames) or the kinds of its loaded tags.
const isHelmRepo = (n) => tree.helm.has(n.path) || n.tagList.some((t) => tagKind(t) === "helm");
const helmOnly = () => prefs.show === "helm", noHelm = () => prefs.show === "containers";
// ponytail: a repository that holds charts and images both counts as a chart repository, so Containers hides it
const wrongKind = (n) => (helmOnly() && !isHelmRepo(n)) || (noHelm() && isHelmRepo(n));
function isHidden(n) { // an empty repository, or a folder that holds only those. With the Helm or Containers filter, a repository of the other kind too.
  if ((prefs.showEmpty && !helmOnly() && !noHelm()) || n.kind !== "node") return false;
  const hide = (!prefs.showEmpty && isEmptyRepo(n)) || wrongKind(n);
  if (!hiddenMemo.has(n.id)) hiddenMemo.set(n.id, (!n.repo || hide) && [...n.kids.values()].every((k) => isHidden(k)));
  return hiddenMemo.get(n.id);
}
const visibleKids = (n) => folderKids(n).filter((k) => !isHidden(k));
function expandable(n) {
  if (n.kind === "root" || n.kind === "proot" || n.kind === "pkg") return true;
  if (n.kind === "node") return n.kids.size > 0 || n.repo;
  if (n.kind === "tag") return n.index !== false && (n.plats === null || n.plats.length > 0); // a tag that is not an index has no platforms to show
  return false;
}
const folderLike = (n) => n.kind === "root" || (n.kind === "node" && !n.repo && n.kids.size > 0);
// A repository that matches only through its tags opens by itself while filtering, as long as few do: each one costs a tags call.
const AUTO_OPEN_MAX = 10;
const tagOnly = (n) => n.kind === "node" && n.repo && tree.tm.has(n.path) && !tree.pathHit.has(n.path);
const autoOpen = (n) => !!tree.filter && (folderLike(n) || (tagOnly(n) && tree.tm.size <= AUTO_OPEN_MAX) || (n.kind === "pkg" && verHit(n, tree.filter.toLowerCase())));
function isOpen(n) {
  if (autoOpen(n)) return !tree.closed.has(n.id);
  return expanded.has(n.id);
}
// What the filter keeps: repository paths and the folders above them (matches), and for each repository the tag names that
// match (tm). Tag names come from the poller's index, plus the tags of any repository already loaded.
function matchSet() {
  if (tree.matches) return tree.matches;
  const term = tree.filter.toLowerCase(), set = new Set(), tm = new Map(), hit = new Set();
  const up = (p) => { for (let q = p; q; q = q.includes("/") ? q.slice(0, q.lastIndexOf("/")) : "") set.add(q); };
  for (const p of tree.names || []) {
    if (p.toLowerCase().includes(term)) { hit.add(p); up(p); }
    const loaded = tree.byPath.get(p);
    const names = new Set([...(tree.tagIndex.get(p) || []), ...(loaded ? loaded.tagMap.keys() : [])]);
    const found = [...names].filter((t) => t.toLowerCase().includes(term));
    if (found.length) { tm.set(p, new Set(found)); up(p); }
  }
  tree.tm = tm;
  tree.pathHit = hit;
  tree.matches = set;
  return set;
}
let indexLoading = null;
function loadTagIndex() { // one small request, made when the filter is first used and again after a change
  if (indexLoading) return;
  indexLoading = api("/api/tagnames").then((o) => {
    tree.tagIndex = new Map(Object.entries(o.repos));
    tree.truncated = o.truncated;
    const empty = o.empty || [], key = empty.join("\n");
    const helm = o.helm || [], helmKey = helm.join("\n");
    const changed = key !== tree.emptyKey || helmKey !== tree.helmKey;
    tree.empty = new Set(empty);
    tree.emptyKey = key;
    tree.helm = new Set(helm);
    tree.helmKey = helmKey;
    drawTypes();
    tree.indexStale = false;
    tree.matches = null;
    if (changed) { resetHidden(); void renderPane(); } // what is hidden changed, so the lists change too
  }).catch(() => { /* the filter then matches repository names only */ }).finally(() => { indexLoading = null; scheduleTree(); });
}

// ---- Loading -------------------------------------------------------------------------------------------------------
function flash(n) {
  const now = Date.now();
  for (let x = n; x && x !== tree.root; x = x.parent) tree.flashes.set(x.id, now);
  setTimeout(() => { for (const [k, t] of tree.flashes) if (Date.now() - t > 4000) tree.flashes.delete(k); }, 4200);
}
function ensureTags(n, force) {
  if (n.fresh && !force) return Promise.resolve();
  if (n.loading) return force ? n.loading.then(() => ensureTags(n, true)) : n.loading; // a forced reload must not take an answer read before the change
  n.loading = api("/api/tags?repo=" + encodeURIComponent(n.path)).then((rows) => {
    const first = !n.tagList.length && !n.tagMap.size;
    reconcileTags(n, rows, !first);
    n.err = "";
    n.fresh = true;
    if (tree.filter) tree.matches = null;
  }).catch((e) => { n.err = e.message; n.fresh = true; }).finally(() => { n.loading = null; scheduleTree(); });
  scheduleTree();
  return n.loading;
}
function dropTag(t) {
  tree.byId.delete(t.id);
  for (const p of t.plats || []) tree.byId.delete(p.id);
}
function upsertTag(n, r, flashChanges) {
  let t = n.tagMap.get(r.tag);
  if (!t) {
    t = mk("tag", `t:${n.path}:${r.tag}`, r.tag, n, { tag: r.tag, digest: r.digest, changed: r.changed, index: r.index, akind: r.kind, plats: null });
    n.tagMap.set(r.tag, t);
    if (flashChanges) flash(t);
  } else if (t.digest !== r.digest) {
    for (const p of t.plats || []) tree.byId.delete(p.id);
    Object.assign(t, { digest: r.digest, plats: null });
    if (flashChanges) flash(t);
  }
  Object.assign(t, { changed: r.changed, index: r.index, akind: r.kind }); // what the tag list says is right on first render, before any manifest is read
}
function reconcileTags(n, rows, flashChanges) {
  const seen = new Set(rows.map((r) => r.tag));
  for (const r of rows) upsertTag(n, r, flashChanges);
  for (const [k, t] of n.tagMap) {
    if (!seen.has(k)) { n.tagMap.delete(k); dropTag(t); }
  }
  sortTags(n);
}
const sortTags = (n) => { n.tagList = [...n.tagMap.values()].sort(tagDefault); };
function getManifest(path, ref, digest, fresh) {
  const key = `${path}@${digest}`;
  if (!fresh && manifests.has(key)) return Promise.resolve(manifests.get(key));
  if (!fresh && inflight.has(key)) return inflight.get(key);
  // tags=0 skips the server's tag lookup (one listing and a HEAD per tag). Only a fresh read, for delete and move, asks for it.
  const p = api(`/api/manifest?repo=${encodeURIComponent(path)}&ref=${encodeURIComponent(ref)}${fresh ? "" : "&tags=0"}`).then((m) => { manifests.set(key, m); scheduleTree(); return m; }).finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}
function ensurePlats(t) {
  if (t.plats) return Promise.resolve();
  return getManifest(t.parent.path, t.tag, t.digest).then((m) => {
    const real = m.platforms.filter((p) => !isAtt(p));
    t.atts = m.platforms.length - real.length;
    t.plats = m.index ? real.map((p) => mk("plat", `p:${t.parent.path}:${t.tag}@${p.digest}`, platName(p) || short(p.digest), t, { digest: p.digest })) : [];
  }).catch(() => { t.plats = []; }).finally(scheduleTree);
}
// After our own change, reload what it touched now instead of waiting for the poller's event.
async function touch(...paths) {
  void binCount();
  await sync();
  await Promise.all(paths.map((p) => { const n = tree.byPath.get(p); dropManifests(p); return n?.repo ? ensureTags(Object.assign(n, { fresh: false }), true) : null; }));
}
function dropManifests(path) {
  for (const k of manifests.keys()) {
    if (k.startsWith(path + "@")) manifests.delete(k);
  }
}

// ---- Tree rendering ----------------------------------------------------------------------------------------------
const RECENT = { kind: "recent", id: "recent", name: "Recent" };
const STORAGE = { kind: "storage", id: "storage", name: "Storage" };
const BIN = { kind: "bin", id: "bin", name: "Bin" };
const PSEUDO = { recent: RECENT, storage: STORAGE, bin: BIN }; // views with a header link or a first tree row, not a node in the tree
let rows = []; // visible entries, in order
function visible() {
  rows = [];
  const filtering = !!tree.filter, ok = filtering ? matchSet() : null;
  if (tree.indexStale && (filtering || !prefs.showEmpty || helmOnly() || noHelm() || !tree.helmKey)) loadTagIndex();
  if (filtering && !ok.size && showsType("containers")) { rows.push({ info: "No repositories or tags match" + (tree.truncated ? " (tag search covers only the first 5000 tags)" : ""), depth: 0, anc: [], last: true }); pypiRows(); return; }
  const walk = (n, depth, anc, pos, count, last) => {
    rows.push({ n, depth, anc, pos, count, last });
    if (!isOpen(n)) return;
    if (n.kind === "node" && n.repo && !n.fresh) { void ensureTags(n); }
    if (n.kind === "tag" && n.plats === null) { void ensurePlats(n); }
    let kids = kidsOf(n);
    if (filtering && (n.kind === "root" || n.kind === "node")) {
      const tags = tagOnly(n) ? tree.tm.get(n.path) : null;
      kids = kids.filter((k) => (k.kind === "tag" ? !tags || tags.has(k.tag) : k.kind !== "node" || ok.has(k.path)));
    }
    const down = depth === 0 ? [] : [...anc, !last];
    kids.forEach((k, i) => walk(k, depth + 1, down, i + 1, kids.length, i === kids.length - 1));
    if (n.kind === "node" && n.repo && (n.loading || n.err)) rows.push({ info: n.err || "Loading...", depth: depth + 1, anc: down, last: true });
    if (n.kind === "tag" && n.plats === null) rows.push({ info: "Loading...", depth: depth + 1, anc: down, last: true });
  };
  if (showsType("containers")) walk(tree.root, 0, [], 2, topCount(), true);
  pypiRows();
  if (filtering && tree.truncated) rows.push({ info: "Tag search covers only the first 5000 tags.", depth: 0, anc: [], last: true });
}
function guidesFor(r) { // the connector lines of a row: a vertical for each ancestor with more siblings, then the elbow
  const guides = [];
  for (let i = 0; i < r.depth - 1; i++) guides.push(el("span", { className: "g" + (r.anc[i] ? " v" : "") }));
  if (r.depth) guides.push(el("span", { className: "g e" + (r.last ? " last" : "") }));
  return guides;
}
function iconFor(n, open) {
  if (n.kind === "root") return icon("registry");
  if (n.kind === "proot") return icon("pypi");
  if (n.kind === "pkg") return icon("pkg");
  if (n.kind === "ver") return icon("tag");
  if (n.kind === "tag") return kindIcon(tagKind(n));
  if (n.kind === "plat") return icon("chip");
  return icon(n.repo ? "repo" : open ? "folderOpen" : "folder");
}
function rowTitle(n) {
  if (n.kind === "root") return cfg.registry || "";
  if (n.kind === "proot") return pypiLabel();
  return n.kind === "node" ? n.path : n.name;
}
const rowLabel = (n) => (n.kind === "root" ? (cfg.registry || "Registry").replace(/^https?:\/\//, "") : n.kind === "proot" ? pypiLabel() : n.name);
function rowEl(r) {
  const n = r.n, guides = guidesFor(r);
  if (r.info) return el("div", { className: "row info", role: "none" }, ...guides, el("span", { className: "chev" }), el("span", { className: "lbl", textContent: r.info }));
  const open = expandable(n) && isOpen(n);
  const row = el("div", {
    className: "row", role: "treeitem", id: "ti-" + n.id, tabIndex: n.id === tree.focus ? 0 : -1,
    "aria-level": r.depth + 1, "aria-posinset": r.pos, "aria-setsize": r.count, "aria-selected": String(n.id === tree.sel),
  }, ...guides, el("span", { className: "chev" }, expandable(n) ? icon("chev") : null), iconFor(n, open), el("span", { className: "lbl", textContent: rowLabel(n) }));
  row.dataset.id = n.id;
  const info = prefs.treeSizes && n.kind === "node" ? storage.paths.get(n.path) : null; // size of a folder or repository, with a thin bar against the largest
  const fig = info ? figureOf(info, prefs.mapBy) : 0;
  if (info && fig > 0) {
    const lbl = row.querySelector(".lbl"), wrap = el("span", { className: "lblwrap" });
    lbl.replaceWith(wrap);
    wrap.append(lbl);
    const pct = Math.round((100 * fig) / (storage.maxBy[prefs.mapBy] || 1));
    if (pct >= 3) { // below that the bar would be a dot
      const bar = el("span", { className: "nbar" });
      bar.style.width = pct + "%";
      wrap.append(bar);
    }
    row.append(el("span", { className: "nsz", title: prefs.mapBy === "total" ? `${size(fig)} total: every byte this ${n.repo ? "repository" : "folder"} uses, including layers other repositories also use. Size by on the Storage map switches to the unique bytes.`
      : `${size(fig)} unique: only this ${n.repo ? "repository" : "folder"} holds them, so deleting it frees them. Size by on the Storage map switches to the total.`, textContent: size(fig) }));
  }
  if (expandable(n)) row.setAttribute("aria-expanded", String(open));
  const t = tree.flashes.get(n.id);
  if (t && Date.now() - t < 4000) { row.classList.add("flash"); row.style.animationDelay = `-${(Date.now() - t) / 1000}s`; }
  return row;
}
const topCount = () => 1 + (cfg.usage ? 1 : 0) + (showsType("containers") ? 1 : 0) + (cfg.pypi && showsType("python") ? 1 : 0); // Recent, Storage and each root shown
const tops = () => [RECENT, ...(cfg.usage ? [STORAGE] : [])];
function topEl(n, pos) { // the rows above the registry: Recent, and Storage with the fill of the disk
  const pct = n === STORAGE ? diskPct() : null;
  const row = el("div", { className: "row", role: "treeitem", id: "ti-" + n.id, tabIndex: tree.focus === n.id ? 0 : -1, "aria-level": 1, "aria-posinset": pos, "aria-setsize": topCount(), "aria-selected": String(tree.sel === n.id) },
    el("span", { className: "chev" }), icon(n === STORAGE ? "drive" : "clock"), el("span", { className: "lbl", textContent: n.name }),
    ...(pct === null ? [] : [el("span", { className: "nsz " + (pct >= 95 ? "crit" : pct >= 80 ? "warn" : ""), textContent: pct + "%" })]));
  row.dataset.id = n.id;
  return row;
}
let rowCache = new Map(); // rows are reused between renders when nothing about them changed
let treeQueued = false;
function scheduleTree() { if (!treeQueued) { treeQueued = true; requestAnimationFrame(() => { treeQueued = false; renderTree(); }); } }
function rowSig(r) { // what a row looks like, so an unchanged one is reused
  const n = r.n;
  const own = n ? [isOpen(n), n.kind === "node" && n.repo, n.id === tree.sel, n.id === tree.focus, rowLabel(n), expandable(n), n.kind === "tag" && tagKind(n), prefs.treeSizes && n.kind === "node" && storage.paths.has(n.path) && prefs.mapBy + ":" + figureOf(storage.paths.get(n.path), prefs.mapBy) + ":" + storage.maxBy[prefs.mapBy]] : [];
  return [r.depth, r.anc.join(""), r.last, r.pos, r.count, ...own].join("|");
}
function cachedRow(r, keep) {
  const id = r.n ? r.n.id : "info:" + r.depth + ":" + r.info;
  const flashing = !!r.n && tree.flashes.has(r.n.id);
  const sig = rowSig(r), old = rowCache.get(id);
  const e = old?.sig === sig && !flashing && !old.flashing ? old.e : rowEl(r);
  keep.set(id, { sig, e, flashing });
  return e;
}
function renderTree() {
  resetHidden();
  const box = $("tree");
  const hadFocus = box.contains(document.activeElement);
  const top = box.scrollTop;
  visible();
  const ids = new Set(rows.map((r) => (r.n ? r.n.id : "")));
  for (const t of tops()) ids.add(t.id);
  if (!tree.focus || !ids.has(tree.focus)) tree.focus = ids.has(tree.sel) ? tree.sel : "recent";
  const keep = new Map();
  const els = rows.map((r) => cachedRow(r, keep));
  rowCache = keep;
  box.replaceChildren(...tops().map((t, i) => topEl(t, i + 1)), ...els);
  box.scrollTop = top;
  if (hadFocus) $("ti-" + tree.focus)?.focus();
}
function select(id, reveal) {
  tree.sel = id;
  tree.focus = id;
  renderTree();
  if (reveal) $("ti-" + id)?.scrollIntoView({ block: "nearest" });
}

function hashOf(n) {
  if (n.kind === "recent") return "#/recent";
  if (n.kind === "storage") return "#/storage";
  if (n.kind === "bin") return "#/bin";
  if (n.kind === "proot") return "#/pypi";
  if (n.kind === "pkg") return "#/pypi/" + n.key;
  if (n.kind === "ver") return `#/pypi/${n.parent.key}@${n.version}`;
  if (n.kind === "root") return "#/";
  if (n.kind === "node") return (n.repo ? "#/repo/" : "#/dir/") + n.path;
  if (n.kind === "tag") return `#/repo/${n.parent.path}:${n.tag}`;
  return `#/repo/${n.parent.parent.path}:${n.parent.tag}@${n.digest}`;
}
function go(n) { if (location.hash === hashOf(n)) void navigate(); else location.hash = hashOf(n); }
function toggle(n, force) {
  const open = force === undefined ? !isOpen(n) : force;
  const set = autoOpen(n) ? tree.closed : expanded; // while filtering, a folder's state is kept apart from the saved one
  const add = autoOpen(n) ? !open : open;
  if (add) set.add(n.id);
  else set.delete(n.id);
  prefs.expanded = [...expanded].slice(-MAX_EXPANDED);
  savePrefs();
  renderTree();
}
const rowOf = (target) => target.closest(".row[data-id]");
// The full path is a tooltip only while the label is cut off, so it never covers the row above for a name that fits.
$("tree").addEventListener("mouseover", (e) => {
  const row = rowOf(e.target), n = row && tree.byId.get(row.dataset.id), lbl = row?.querySelector(".lbl");
  if (!n || !lbl) return;
  if (lbl.scrollWidth > lbl.clientWidth) row.title = rowTitle(n);
  else row.removeAttribute("title");
});
$("tree").addEventListener("click", (e) => {
  const row = rowOf(e.target);
  if (!row) return;
  const n = PSEUDO[row.dataset.id] || tree.byId.get(row.dataset.id);
  if (!n) return;
  if (e.target.closest(".chev")) {
    tree.focus = n.id;
    if (expandable(n)) {
      toggle(n);
    } else {
      renderTree();
    }
    return;
  }
  go(n);
});
$("tree").addEventListener("dblclick", (e) => {
  const row = rowOf(e.target), n = row && tree.byId.get(row.dataset.id);
  if (n && expandable(n) && !e.target.closest(".chev")) toggle(n);
});
// Where an arrow key goes from list[i], for the main tree and the folder picker. ops: {expandable, isOpen, setOpen}.
// Returns the node to focus, null to stay (opening or closing is done here), or undefined for a key it does not handle.
function arrowTarget(key, list, i, ops) {
  switch (key) {
    case "ArrowDown": return list[Math.min(i + 1, list.length - 1)].n;
    case "ArrowUp": return list[Math.max(i - 1, 0)].n;
    case "Home": return list[0].n;
    case "End": return list.at(-1).n;
    case "ArrowRight": return arrowRight(list, i, ops);
    case "ArrowLeft": return arrowLeft(list[i].n, ops);
    default: return undefined;
  }
}
function arrowRight(list, i, ops) {
  const n = list[i].n;
  if (!ops.expandable(n)) return null;
  if (!ops.isOpen(n)) { ops.setOpen(n, true); return null; }
  const next = list[i + 1];
  return next && next.depth > list[i].depth ? next.n : null;
}
function arrowLeft(n, ops) {
  if (ops.expandable(n) && ops.isOpen(n)) { ops.setOpen(n, false); return null; }
  return n.parent || null;
}
const treeOps = { expandable, isOpen, setOpen: toggle };
function focusRow(n) {
  tree.focus = n.id;
  renderTree();
  const row = $("ti-" + n.id);
  row?.focus();
  row?.scrollIntoView({ block: "nearest" });
}
$("tree").addEventListener("keydown", (e) => {
  const row = rowOf(e.target);
  if (!row || e.altKey || e.ctrlKey || e.metaKey) return;
  const list = [...tops().map((t) => ({ n: t })), ...rows.filter((r) => r.n)];
  const i = list.findIndex((r) => r.n.id === row.dataset.id);
  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(list[i].n); return; }
  const to = arrowTarget(e.key, list, i, treeOps);
  if (to === undefined) return;
  e.preventDefault();
  if (to) focusRow(to);
});
let filterTimer = 0;
$("filter").addEventListener("input", () => {
  clearTimeout(filterTimer);
  filterTimer = setTimeout(() => { tree.filter = $("filter").value.trim(); tree.matches = null; tree.closed.clear(); renderTree(); }, 80);
});

// ---- Sidebar width and phone drawer ------------------------------------------------------------------------------
function setWidth(px, save) {
  prefs.sidebar = Math.round(Math.min(SIDEBAR[1], Math.max(SIDEBAR[0], px)));
  document.documentElement.style.setProperty("--sw", prefs.sidebar + "px");
  if (save) savePrefs();
}
$("grip").addEventListener("pointerdown", (e) => {
  $("grip").setPointerCapture(e.pointerId);
  $("grip").classList.add("drag");
});
$("grip").addEventListener("pointermove", (e) => { if ($("grip").hasPointerCapture(e.pointerId)) setWidth(e.clientX - $("side").getBoundingClientRect().left, false); });
$("grip").addEventListener("pointerup", (e) => { $("grip").releasePointerCapture(e.pointerId); $("grip").classList.remove("drag"); savePrefs(); });
$("grip").addEventListener("keydown", (e) => {
  const step = { ArrowLeft: -16, ArrowRight: 16 }[e.key];
  if (step) { e.preventDefault(); setWidth(prefs.sidebar + step, true); }
});
function drawer(open) {
  document.body.classList.toggle("drawer", open);
  $("menu").setAttribute("aria-expanded", String(open));
}
$("menu").onclick = () => drawer(!document.body.classList.contains("drawer"));
$("scrim").onclick = () => drawer(false);
addEventListener("keydown", (e) => { if (e.key === "Escape") drawer(false); });

// ---- Command helpers: Pull, Push and Configure tabs, each a code block with a Copy button ------------------------------
let cmdTab = "pull";
// Copies with the clipboard API. Where it is missing (a page that is neither localhost nor HTTPS) the text is selected instead,
// and false tells the caller to ask the user to press Ctrl/Cmd+C.
async function copyText(text, node) {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) { /* refused: fall back to selecting */ }
  }
  const range = document.createRange(), sel = getSelection();
  range.selectNodeContents(node);
  sel.removeAllRanges();
  sel.addRange(range);
  return false;
}
// A value with a small copy button beside it: the text alone, no command around it.
// An icon button with its "Copied" note. node is what gets selected when the clipboard API is missing, so it must hold the copied text.
function copyControls(text, label, node) {
  let timer = 0;
  const done = el("span", { className: "done", "aria-live": "polite" });
  const btn = el("button", { type: "button", className: "iconbtn", "aria-label": label, title: label }, icon("copy"));
  btn.onclick = async (e) => {
    e.stopPropagation(); // a copy icon in a table row must not act on the row
    done.textContent = (await copyText(text, node)) ? "Copied" : "Press Ctrl/Cmd+C";
    clearTimeout(timer);
    timer = setTimeout(() => { done.textContent = ""; }, 1600);
  };
  return [btn, done];
}
function copyValue(text, label, shown) { // shown: what to display when it is shorter than what is copied
  const value = code(shown || text);
  return el("span", { className: "copyval" }, value, ...copyControls(text, label, value));
}
// A copy icon that shows on row hover or focus, with the full text kept (invisibly) as the thing to select.
function rowCopy(text, label) {
  const full = el("span", { className: "vh", textContent: text, "aria-hidden": "true" }); // selectable, but not read out twice
  return el("span", { className: "rowcopy" }, ...copyControls(text, label, full), full);
}
function codeBlock(label, lines) {
  const text = lines.join("\n");
  const pre = el("pre", { tabIndex: 0 }, ...lines.map((l) => {
    const i = l.indexOf(" ");
    return el("span", { className: "ln" }, el("span", { className: "cmd", textContent: l.slice(0, i) }), l.slice(i));
  }));
  let timer = 0;
  const btn = el("button", { type: "button", className: "copy", textContent: "Copy", "aria-label": "Copy " + label, "aria-live": "polite" });
  btn.onclick = async () => {
    const ok = await copyText(text, pre);
    btn.textContent = ok ? "Copied" : "Press Ctrl/Cmd+C";
    btn.classList.toggle("ok", ok);
    clearTimeout(timer);
    timer = setTimeout(() => { btn.textContent = "Copy"; btn.classList.remove("ok"); }, 1600);
  };
  return el("figure", { className: "code" }, el("figcaption", {}, el("span", { textContent: label }), btn), pre);
}
// tag is empty at repository level, where <TAG> stands in. digest is empty unless a tag is selected.
// The command tabs for each kind of thing a tag can be. ctx: {host, path, tag, digest}; tag is "" at repository level. Returns the tabs,
// what each shows (given the podman or docker choice), whether that choice matters, and a heading.
const cmdNote = (t) => el("p", { className: "mut", textContent: t });
function imageCommands({ host, path, tag, digest }) {
  const image = `${host}/${path}:${tag || "<TAG>"}`;
  return {
    heading: tag ? "Use this image" : "Use this repository", tool: true,
    names: [["pull", "Pull"], ["push", "Push"], ["configure", "Configure"]],
    content: {
      pull: (rt) => [cmdNote(`Run ${rt} pull with the image and tag.`), codeBlock("Pull by tag", [`${rt} pull ${image}`]),
        ...(digest ? [cmdNote("A digest always gives the same image, even if the tag is later moved."), codeBlock("Pull by digest", [`${rt} pull ${host}/${path}@${digest}`])] : [])],
      push: (rt) => [cmdNote("Tag a local image with the registry address, then push it."), codeBlock("Tag and push", [`${rt} tag <local-image> ${image}`, `${rt} push ${image}`])],
      configure: (rt) => {
        const dir = (rt === "docker" ? "/etc/docker" : "/etc/containers") + "/certs.d/" + host;
        return [cmdNote(`If the registry uses a certificate your machine does not trust, put its CA certificate where ${rt} looks for it.`),
          codeBlock("Trust the registry certificate", [`sudo mkdir -p ${dir}`, `sudo cp ca.crt ${dir}/ca.crt`]),
          cmdNote("When the registry needs a login, sign in once."), codeBlock("Log in", [`${rt} login ${host}`])];
      },
    },
  };
}
function helmCommands({ host, path, tag }) {
  const parent = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
  const version = tag || "<VERSION>", chart = path.slice(path.lastIndexOf("/") + 1).replace(/[^a-z0-9-]/g, "-").slice(0, 53).replace(/-+$/, ""); // what a release name allows
  return {
    heading: tag ? "Use this chart" : "Use this repository", tool: false,
    names: [["pull", "Pull"], ["push", "Push"], ["configure", "Configure"]],
    content: {
      pull: () => [cmdNote("The tag is the chart version."), codeBlock("Pull the chart", [`helm pull oci://${host}/${path} --version ${version}`]),
        cmdNote(`Install it straight from the registry. The release is named ${chart}. Give it another name to install the chart twice.`),
        codeBlock("Install the chart", [`helm install ${chart} oci://${host}/${path} --version ${version}`])],
      push: () => [cmdNote(`Package the chart, then push the archive. The chart's name is added to the path, so it lands in ${path}.`),
        codeBlock("Push the chart", [`helm push <chart>.tgz oci://${host}${parent ? "/" + parent : ""}`])],
      configure: () => [cmdNote("When the registry needs a login, sign in once."), codeBlock("Log in", [`helm registry login ${host}`]),
        cmdNote("If the registry uses a certificate your machine does not trust, add --ca-file with its CA certificate to each helm command."),
        codeBlock("With a private CA", [`helm registry login ${host} --ca-file ca.crt`, `helm pull oci://${host}/${path} --version ${version} --ca-file ca.crt`])],
    },
  };
}
function artifactCommands({ host, path, tag, digest }) {
  return {
    heading: "Use this artifact", tool: false, names: [["pull", "Pull"]],
    content: { pull: () => [cmdNote("An OCI artifact, not an image. Pull it with oras."), codeBlock("Pull by tag", [`oras pull ${host}/${path}:${tag || "<TAG>"}`]),
      ...(digest ? [codeBlock("Pull by digest", [`oras pull ${host}/${path}@${digest}`])] : [])] },
  };
}
const COMMAND_SETS = { image: imageCommands, helm: helmCommands, artifact: artifactCommands };
function commandsEl(path, tag, digest, kind = "image") {
  const host = cfg.registryHost || "<REGISTRY>";
  const sets = COMMAND_SETS[kind]({ host, path, tag, digest }), names = sets.names;
  const tabs = el("div", { role: "tablist", className: "tabs", "aria-label": "Command helpers" });
  const seg = el("div", { className: "seg", role: "group", "aria-label": "Command line tool", hidden: !sets.tool });
  const panel = el("div", { role: "tabpanel", className: "cmd-panel" });
  const draw = () => {
    const cur = names.some(([k]) => k === cmdTab) ? cmdTab : names[0][0];
    tabs.replaceChildren(...names.map(([k, text]) => el("button", {
      type: "button", role: "tab", textContent: text, id: "tab-" + k, tabIndex: k === cur ? 0 : -1, "aria-selected": String(k === cur), "aria-controls": "cmd-panel",
      onclick: () => { cmdTab = k; draw(); },
      onkeydown: (e) => {
        const d = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
        if (!d) return;
        e.preventDefault();
        cmdTab = names[(names.findIndex((x) => x[0] === k) + d + names.length) % names.length][0];
        draw();
        $("tab-" + cmdTab).focus();
      },
    })));
    seg.replaceChildren(...CHOICES.runtime.map((rt) => el("button", {
      type: "button", textContent: rt, "aria-pressed": String(rt === prefs.runtime),
      onclick: () => { prefs.runtime = rt; savePrefs(); draw(); },
    })));
    panel.id = "cmd-panel";
    panel.setAttribute("aria-labelledby", "tab-" + cur);
    panel.replaceChildren(...sets.content[cur](prefs.runtime),
      ...(cfg.registryHostSet ? [] : [el("p", { className: "hint", textContent: `The address ${host} comes from REGISTRY_URL because UI_REGISTRY_HOST is not set. Set it to the address your clients use.` })]));
  };
  draw();
  return el("section", { className: "cmds" }, el("h3", { textContent: sets.heading }), el("div", { className: "cmd-bar" }, tabs, seg), panel);
}

// ---- Right pane --------------------------------------------------------------------------------------------------
let paneSeq = 0;
function crumbs(n) {
  const parts = [];
  for (let x = n; x && x.kind !== "root"; x = x.parent) parts.unshift(x);
  return crumbNav((cfg.registry || "Registry").replace(/^https?:\/\//, ""), parts.map((x, i) => ({ text: crumbText(x), href: hashOf(x), cls: i === parts.length - 1 ? (x.kind === "node" ? "" : "t") : (x.kind === "tag" ? "t" : "") })));
}
function crumbText(x) {
  if (x.kind === "tag") return ":" + x.name;
  return x.kind === "plat" ? "@" + x.name : x.name;
}
function lastChange(n) {
  if (n.kind === "node" && n.repo && recent.lastChanged[n.path]) return recent.lastChanged[n.path];
  return Math.max(0, ...[...(n.kids || [])].map(([, k]) => lastChange(k)));
}
const link = (n, text) => el("a", { href: hashOf(n), textContent: text || n.name });
function showMain(...kids) { $("main").replaceChildren(...kids); }

// ---- Sortable, filterable, paged lists: the tags of a repository and the folders and repositories under a folder -----------------
// Sort state is kept per view in memory only. A header click cycles ascending, descending, then back to the default order.
const viewState = new Map();
function stateOf(id) {
  if (!viewState.has(id)) viewState.set(id, { sort: null, filter: "", shown: 0 });
  return viewState.get(id);
}
function resetShown() {
  shown = 0;
  for (const st of viewState.values()) st.shown = 0;
}
// Tag order that knows versions: 1.10.0 after 1.9.0, a pre-release before its release, then names that are not versions.
const SEMVER = /^v?(\d+(?:\.\d+)*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;
function parseTag(tag) {
  const m = SEMVER.exec(tag);
  if (!m) return null;
  return { nums: m[1].split(".").map(Number), pre: m[2] ? m[2].split(".") : [] };
}
function cmpNums(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] || 0) - (b[i] || 0);
    if (d) return d;
  }
  return 0;
}
function cmpPreId(x, y) {
  const xn = /^\d+$/.test(x), yn = /^\d+$/.test(y);
  if (xn && yn) return Number(x) - Number(y);
  if (xn) return -1;
  if (yn) return 1;
  return x.localeCompare(y);
}
function cmpPre(a, b) {
  if (!a.length || !b.length) return b.length - a.length; // no pre-release sorts after one
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const d = cmpPreId(a[i], b[i]);
    if (d) return d;
  }
  return a.length - b.length;
}
function tagCompare(a, b) {
  const pa = parseTag(a), pb = parseTag(b);
  if (pa && pb) return cmpNums(pa.nums, pb.nums) || cmpPre(pa.pre, pb.pre) || collator.compare(a, b);
  if (pa) return -1;
  if (pb) return 1;
  return collator.compare(a, b);
}
const numCmp = (x, y) => x - y;
const loadedManifest = (t) => manifests.get(`${t.parent.path}@${t.digest}`);
// What a manifest holds, from the media type of its config: a container image (also what an index and an unknown manifest count as),
// a Helm chart, or some other OCI artifact.
const IMAGE_CONFIGS = new Set(["application/vnd.docker.container.image.v1+json", "application/vnd.oci.image.config.v1+json"]);
const HELM_CONFIG = "application/vnd.cncf.helm.config.v1+json";
function artifactKind(m) {
  const type = m?.configType;
  if (!type || IMAGE_CONFIGS.has(type)) return "image";
  return type === HELM_CONFIG ? "helm" : "artifact";
}
const tagKind = (t) => { const m = loadedManifest(t); return m ? artifactKind(m) : t.akind || "unknown"; }; // unknown until the poller has read it
const KIND_ICON = { image: ["whale", "whale"], helm: ["chart", "chart"], artifact: ["artifact", ""], unknown: ["box", ""] };
const kindIcon = (kind) => icon(...KIND_ICON[kind]);
const KIND_LABEL = { image: "Container image", helm: "Helm chart", artifact: "OCI artifact" };
const createdMs = (m) => (m?.created ? Date.parse(m.created) : Number.NaN);
const createdOf = (t) => { const ms = createdMs(loadedManifest(t)); return Number.isNaN(ms) ? null : ms; };
const sizeOf = (t) => { const m = loadedManifest(t); return m && !m.index ? layersTotal(m) : null; };
const platformsOf = (t) => { const m = loadedManifest(t); return m ? detailCells(m)[0] || null : null; };
// Columns: val(item) is the sort key or null (a row without one goes last in either direction), cmp compares two keys.
const TAG_COLUMNS = [
  { key: "tag", label: "Tag", val: (t) => t.tag, cmp: tagCompare },
  { key: "digest", label: "Digest", tip: "Groups the tags that share a digest", val: (t) => t.digest, cmp: collator.compare },
  { key: "size", label: "Size", tip: "Sorts loaded rows. A multi-arch index has no size of its own.", val: sizeOf, cmp: numCmp },
  { key: "platforms", label: "Platforms", tip: "Sorts loaded rows", val: platformsOf, cmp: collator.compare },
  { key: "created", label: "Created", tip: "Sorts loaded rows. When the image was built, from its config. A multi-arch index has none.", val: createdOf, cmp: numCmp },
  { key: "changed", label: "Pushed", tip: "When this UI saw the tag take its digest: the push, to within one walk of the registry. A tag already there when the UI started has its storage file time, or is blank when that is not known.", val: (t) => t.changed || null, cmp: numCmp },
];
const USED_TIP = "When the newest blob of the tag was last used, from the registry storage: the access time where the host records it, else the modification time. Sorts oldest first. As of the last usage scan.";
const USED_COLUMN = { key: "used", label: "Last used", tip: USED_TIP, val: (t) => t.parent.ages?.[t.tag]?.[0] ?? null, cmp: numCmp };
const hasAges = () => !!(cfg.storageMount && cfg.usage); // the ages come from the usage scan
const tagColumns = () => (hasAges() ? [...TAG_COLUMNS, USED_COLUMN] : TAG_COLUMNS);
// Recent push: when the poller saw the tag take its digest. A tag it has not seen yet came after its last walk, so it goes first.
const pushedAt = (t) => t.changed ?? Infinity;
const tagDefault = (a, b) => (prefs.tagSort === "recent" ? pushedAt(b) - pushedAt(a) : 0) || tagCompare(b.tag, a.tag); // then newest version first
function sortItems(items, col, dir, tie) {
  const keyed = items.filter((i) => col.val(i) != null);
  const blank = items.filter((i) => col.val(i) == null);
  keyed.sort((a, b) => dir * col.cmp(col.val(a), col.val(b)) || tie(a, b));
  return [...keyed, ...blank.sort(tie)];
}
function cycleSort(st, key) {
  if (st.sort?.key !== key) st.sort = { key, dir: 1 };
  else if (st.sort.dir === 1) st.sort.dir = -1;
  else st.sort = null;
}
const FILTER_MIN = 1; // the filter and count show for any list with more than one row
function sortHeader(st, col, redraw) {
  const active = st.sort?.key === col.key;
  const dir = st.sort?.dir;
  const direction = dir < 0 ? "desc" : "";
  const button = el("button", { type: "button", className: "thbtn", title: col.tip || "", onclick: () => { cycleSort(st, col.key); redraw(); } }, col.label, active ? icon("arrow", direction) : null);
  let aria = "none";
  if (active) aria = dir < 0 ? "descending" : "ascending";
  return el("th", { "aria-sort": aria }, button);
}
function orderedItems(spec, st, list) {
  if (!st.sort) return [...list].sort(spec.defaultCmp);
  return sortItems(list, spec.columns.find((c) => c.key === st.sort.key), st.sort.dir, spec.tie);
}
const countText = (shownN, total, all, filtered) => `Showing ${shownN} of ${total}` + (filtered ? ` matching, ${all} in all` : "");
const noMatches = (cols) => el("tr", {}, el("td", { colSpan: cols, className: "mut", textContent: "No matches." }));
// spec: {id, items, columns, defaultCmp, tie, match(item, lowerText), row(item) -> tr, placeholder, onDraw(visibleItems),
// lateKeys (columns whose data arrives after drawing) and onLate(redraw) to be told how to redraw once it has,
// lead (a header cell put before the columns, for a column the rows add themselves)}
function listView(spec) {
  const st = stateOf(spec.id);
  const input = el("input", { type: "search", className: "listfilter", placeholder: spec.placeholder, "aria-label": spec.placeholder, value: st.filter, autocomplete: "off", spellcheck: false });
  const count = el("p", { className: "mut listcount" });
  const head = el("tr"), body = el("tbody"), more = el("p");
  function draw() {
    const text = st.filter.toLowerCase();
    const list = text ? spec.items.filter((i) => spec.match(i, text)) : spec.items;
    const page = st.shown || prefs.pageSize;
    const visible = orderedItems(spec, st, list).slice(0, page);
    head.replaceChildren(...(spec.lead ? [spec.lead] : []), ...spec.columns.map((c) => sortHeader(st, c, draw)));
    body.replaceChildren(...(visible.length ? visible.map((item) => spec.row(item)) : [noMatches(spec.columns.length + (spec.lead ? 1 : 0))]));
    count.textContent = countText(visible.length, list.length, spec.items.length, !!text);
    const left = list.length - visible.length;
    more.replaceChildren(...(left > 0 ? [el("button", { type: "button", textContent: `Show more (${left} left)`, onclick: () => { st.shown = page + prefs.pageSize; draw(); } })] : []));
    spec.onDraw?.(visible);
  }
  input.oninput = () => { st.filter = input.value.trim(); st.shown = 0; draw(); };
  spec.onLate?.(() => { if (st.sort && spec.lateKeys.includes(st.sort.key)) draw(); });
  draw();
  return [...(spec.items.length > FILTER_MIN ? [input, count] : []), el("table", { className: "sortable" }, el("thead", {}, head), body), more];
}

// Size and platforms of the rows on screen are filled in as they scroll into view: one manifest request per row, tags=0, at most four at once.
const LAZY_MAX = 4;
const lazy = { queue: [], active: 0, io: null, seen: new WeakSet(), redraw: null }; // redraw: re-sort a list sorted by a column the fill just completed
function lazyReset() {
  lazy.redraw = null;
  lazy.io?.disconnect();
  lazy.queue = [];
  lazy.seen = new WeakSet();
  lazy.io = window.IntersectionObserver ? new IntersectionObserver(lazyHit, { root: $("main"), rootMargin: "150px" }) : null;
}
function lazyHit(entries) {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    lazy.io.unobserve(e.target);
    lazy.queue.push(e.target.rowEntry);
  }
  lazyPump();
}
function lazyPump() {
  while (lazy.active < LAZY_MAX && lazy.queue.length) {
    const r = lazy.queue.shift();
    if (r.done || (r.t && !tree.byId.has(r.t.id))) continue;
    lazy.active++;
    (r.load ? r.load() : getManifest(r.t.parent.path, r.t.tag, r.t.digest)).then(r.apply).catch(() => { /* the row keeps its blanks */ }).finally(() => { lazy.active--; lazyPump(); if (!lazy.active && !lazy.queue.length) lazy.redraw?.(); });
  }
}
function lazyWatch(r) {
  if (r.done || lazy.seen.has(r)) return;
  lazy.seen.add(r);
  if (lazy.io) {
    r.tr.rowEntry = r;
    lazy.io.observe(r.tr);
  } else {
    lazy.queue.push(r); // no IntersectionObserver: fill the rows that are shown
    lazyPump();
  }
}

function tagRow(t) { // a table row for a tag, whose kind, size, platforms and build time fill in later
  const plat = el("td", { className: "mut" }), sz = el("td", { className: "mut" }), built = el("td", { className: "mut" });
  const ico = el("span", { className: "ico" }, kindIcon(tagKind(t)), link(t, t.tag));
  const r = { t, done: false, link: el("span", { className: "dlink" }) };
  r.apply = (m) => {
    [plat.textContent, sz.textContent] = detailCells(m);
    const ms = createdMs(m);
    built.textContent = Number.isNaN(ms) ? "" : ago(ms / 1000);
    built.title = Number.isNaN(ms) ? "" : new Date(ms).toLocaleString();
    ico.firstChild.replaceWith(kindIcon(artifactKind(m)));
    r.done = true;
  };
  const cached = loadedManifest(t);
  if (cached) r.apply(cached);
  const ref = `${cfg.registryHost || "<REGISTRY>"}/${t.parent.path}:${t.tag}`;
  r.tr = el("tr", {}, el("td", {}, ico, rowCopy(ref, `Copy image reference for ${t.tag}`)),
    el("td", { className: "nw dcell" }, code(short(t.digest)), rowCopy(t.digest, `Copy digest for ${t.tag}`), r.link), sz, plat, built, el("td", { className: "mut", textContent: ago(t.changed) }),
    ...(hasAges() ? [usedCell(t.parent.ages?.[t.tag])] : []));
  return r;
}
// The mark in the Digest column of each row whose digest another tag shares, wherever that tag is in the list. Neighbouring
// rows on one digest are joined by a line (start, mid and end of each run), any other shared row gets the dot alone (solo).
function digestLinks(digests, counts) {
  return digests.map((d, i) => {
    const up = digests[i - 1] === d, down = digests[i + 1] === d;
    if (up || down) return up && down ? "mid" : up ? "end" : "start";
    return counts.get(d) > 1 ? "solo" : null;
  });
}
// Hovering a marked row lights up every row on its digest.
function linkDigests(n, rs) {
  const tags = new Map();
  for (const t of n.tagList) tags.set(t.digest, [...(tags.get(t.digest) || []), t.tag]);
  const links = digestLinks(rs.map((r) => r.t.digest), new Map([...tags].map(([d, ts]) => [d, ts.length])));
  const same = (d) => rs.forEach((x) => x.tr.classList.toggle("same", x.t.digest === d));
  rs.forEach((r, i) => {
    if (links[i]) r.tr.dataset.link = links[i];
    else delete r.tr.dataset.link;
    r.link.title = links[i] ? "Same manifest: " + tags.get(r.t.digest).join(", ") : "";
    r.tr.onmouseenter = links[i] ? () => same(r.t.digest) : null;
    r.tr.onmouseleave = links[i] ? () => same(null) : null;
  });
}
function tagsList(n) {
  lazyReset();
  const pick = canWrite() ? pickBar({ id: "tags:" + n.path, key: (t) => t.tag, keep: (k) => n.tagMap.has(k), noun: "tag", max: Infinity, // deleteTags splits into batches; no checkboxes for a user who cannot delete
    onDelete: (keys) => deleteTags(n, n.tagList.filter((t) => keys.has(t.tag))) }) : null;
  const rowsOf = new Map();
  const entry = (t) => {
    if (!rowsOf.has(t)) {
      const r = tagRow(t);
      pick?.row(r.tr, t);
      rowsOf.set(t, r);
    }
    return rowsOf.get(t);
  };
  const list = listView({
    id: "tags:" + n.path, items: n.tagList, columns: tagColumns(), defaultCmp: tagDefault, tie: (a, b) => tagCompare(b.tag, a.tag),
    match: (t, text) => t.tag.toLowerCase().includes(text), placeholder: "Filter tags", lead: pick?.head,
    row: (t) => entry(t).tr, onDraw: (vis) => { linkDigests(n, vis.map(entry)); vis.forEach((t) => lazyWatch(entry(t))); pick?.shown(vis); },
    lateKeys: ["size", "platforms", "created"], onLate: (redraw) => { lazy.redraw = redraw; },
  });
  return pick ? [pick.bar, ...list] : list;
}

// Bulk delete: a checkbox per row, one for every row shown, and a bar with the count and Delete selected. A shift-click selects
// or clears every row shown from the last row clicked to this one. The picks are kept per list while the page is open, and one that is gone drops out.
// o: {id (the list's view state), key(item), keep(key) (whether it still exists), noun, cost(keys) (what the batch cap counts, else the picks),
// costNoun, onDelete(keys), nouns (the plural, when not noun + "s"), deleteText, hint, more: [[text, fn(keys)]] (other buttons for the selection)}
function pickBar(o) {
  const st = stateOf(o.id);
  st.picked ??= new Set();
  for (const k of st.picked) if (!o.keep(k)) st.picked.delete(k);
  const max = o.max ?? (cfg.maxBatch || 100);
  const boxes = new Map();
  let vis = [];
  const all = el("input", { type: "checkbox", "aria-label": `Select every ${o.noun} shown` });
  const count = el("span", { className: "mut", role: "status" });
  const go = el("button", { type: "button", className: "danger", textContent: o.deleteText || "Delete selected", onclick: () => void o.onDelete(new Set(st.picked)) });
  const more = (o.more || []).map(([text, fn]) => el("button", { type: "button", textContent: text, onclick: () => void fn(new Set(st.picked)) }));
  const clear = el("button", { type: "button", className: "linkbtn", textContent: "Clear selection", onclick: () => { st.picked.clear(); update(); all.focus(); } });
  function update() {
    const on = vis.filter((i) => st.picked.has(o.key(i))).length;
    all.checked = vis.length > 0 && on === vis.length;
    all.indeterminate = on > 0 && on < vis.length;
    for (const [k, b] of boxes) { b.checked = st.picked.has(k); b.closest("tr")?.classList.toggle("on", b.checked); }
    const k = st.picked.size, cost = o.cost ? o.cost(st.picked) : k;
    count.textContent = k ? `${plural(k, o.noun, o.nouns)} selected` + (cost !== k ? `, ${plural(cost, o.costNoun)}` : "") + (cost > max ? `, at most ${max} at once` : "")
      : o.hint || `Select ${o.noun}s to delete several at once. Shift-click selects a range.`;
    go.disabled = !k || cost > max;
    for (const b of more) b.disabled = !k;
    clear.hidden = !k;
  }
  const set = (k, on) => { if (on) st.picked.add(k); else st.picked.delete(k); };
  const pick = (item, on, range) => {
    const keys = vis.map(o.key), from = keys.indexOf(st.anchor), to = keys.indexOf(o.key(item));
    if (range && from >= 0 && to >= 0) keys.slice(Math.min(from, to), Math.max(from, to) + 1).forEach((k) => set(k, on));
    else set(o.key(item), on);
    st.anchor = o.key(item);
    update();
  };
  all.onchange = () => { for (const i of vis) set(o.key(i), all.checked); update(); };
  // A checkbox cell first in the row. A click elsewhere on the row, away from its links, buttons and selected text, ticks it too.
  const row = (tr, item) => {
    const k = o.key(item);
    const b = el("input", { type: "checkbox", "aria-label": `Select ${k}`, checked: st.picked.has(k) });
    b.onclick = (e) => pick(item, b.checked, e.shiftKey);
    boxes.set(k, b);
    tr.prepend(el("td", { className: "pick" }, b));
    tr.classList.add("pickable");
    tr.addEventListener("mousedown", (e) => { if (e.shiftKey && !e.target.closest("a, button, input")) e.preventDefault(); }); // no text selection on shift-click
    tr.addEventListener("click", (e) => {
      if (e.target.closest("a, button, input") || String(getSelection())) return;
      pick(item, !st.picked.has(k), e.shiftKey);
    });
  };
  return { bar: el("div", { className: "bar bulk" }, count, ...more, go, clear), head: el("th", { className: "pick" }, all), row, shown: (v) => { vis = v; update(); } };
}

function childrenList(n) {
  const items = visibleKids(n);
  const changed = new Map(items.map((k) => [k, lastChange(k)]));
  const kindOf = (k) => (k.repo ? "repository" : "folder");
  const byRecent = (a, b) => changed.get(b) - changed.get(a) || byName(a, b);
  return listView({
    id: "kids:" + n.id, items, tie: byName, defaultCmp: prefs.repoSort === "recent" ? byRecent : byName,
    columns: [
      { key: "name", label: "Name", val: (k) => k.name, cmp: collator.compare },
      { key: "type", label: "Type", val: kindOf, cmp: collator.compare },
      { key: "changed", label: "Last change", val: (k) => changed.get(k) || null, cmp: numCmp },
    ],
    match: (k, text) => k.name.toLowerCase().includes(text), placeholder: "Filter",
    row: (k) => el("tr", {}, el("td", {}, el("span", { className: "ico" }, icon(k.repo ? "repo" : "folder"), link(k, k.name))), el("td", { className: "mut", textContent: kindOf(k) }), el("td", { className: "mut", textContent: ago(changed.get(k)) })),
  });
}

const SEED_NOTE = { storage: "Already in the registry when the UI started. Pushed at this time, from the tag's file time in the registry storage.",
  config: "Already in the registry when the UI started. This is when the image was built, from its config: the push may be later." };
function recentPane() {
  // Container changes come from the poller's history; PyPI uploads carry GitLab's upload time. One list, newest first.
  const items = [];
  if (showsType("containers")) {
    for (const e of recent.events) if (tree.helm.has(repoOf(e.ref)) ? !noHelm() : !helmOnly()) items.push({ t: e.t, el: () => el("tr", {},
      el("td", { textContent: ago(e.t), title: new Date(e.t * 1000).toLocaleString() }),
      el("td", {}, el("span", { className: "ico" }, icon("whale", "whale")), el("span", { className: "badge " + e.type, textContent: e.type }),
        ...(e.src ? [el("span", { className: "mut src", title: SEED_NOTE[e.src], textContent: ` ${e.src === "storage" ? "storage time" : "build time"}` })] : [])),
      el("td", {}, e.type === "deleted" ? code(e.ref) : el("a", { href: "#/repo/" + e.ref, textContent: e.ref })),
      el("td", {}, code(short(e.digest || e.prev)))) });
  }
  if (cfg.pypi && showsType("python") && pypi.loaded) {
    for (const u of pypi.packages) {
      const pkg = tree.byKey.get(u.key), ver = pkg?.versions.get(u.version);
      items.push({ t: secs(u.created) || 0, el: () => el("tr", {},
        el("td", { textContent: ago(secs(u.created)), title: u.created ? new Date(u.created).toLocaleString() : "" }),
        el("td", {}, el("span", { className: "ico" }, icon("pypi")), el("span", { className: "badge new", textContent: "upload" })),
        el("td", {}, ver ? link(ver, `${u.name}==${u.version}`) : code(`${u.name}==${u.version}`)),
        el("td", { className: "mut", textContent: u.project })) });
    }
  }
  items.sort((x, y) => y.t - x.t);
  const page = shown || prefs.pageSize; // rows are built for the page shown only: a group can hold 20000 uploads
  const parts = [];
  if (showsType("containers")) parts.push((recent.persistent ? "Container history is saved to disk." : "Container history is in memory only and resets when the UI restarts.")
    + ` Watching since ${new Date(recent.since * 1000).toLocaleString()}. Rows without a mark are when the UI saw the change. Rows marked storage time or build time were already there at a start, and take their time from the registry's files or the image.`);
  if (cfg.pypi && showsType("python")) parts.push(pypi.denied ? "Log in to see Python uploads." : "Python upload times come from GitLab.");
  const empty = recent.baselined ? "No changes seen yet." : "Reading the registry for the first time.";
  showMain(el("h2", { textContent: "Recent changes" }), el("p", { className: "mut", textContent: parts.join(" ") }),
    ...(items.length ? [el("table", {}, el("tr", {}, ...["When", "Change", "Item", "Detail"].map((h) => el("th", { textContent: h }))), ...items.slice(0, page).map((i) => i.el())),
      ...(items.length > page ? [el("p", {}, el("button", { textContent: `Show more (${items.length - page} left)`, onclick: () => { shown = page + prefs.pageSize; void renderPane(); } }))] : [])]
      : [el("p", { className: "mut", textContent: empty })]));
}
function rootPane(n) {
  const repos = tree.names.filter((p) => !isHidden(tree.byPath.get(p))).length, hidden = tree.names.length - repos;
  const hiddenNote = hidden ? ` (${hidden} ${helmOnly() ? "without Helm charts" : noHelm() ? (prefs.showEmpty ? "" : "empty or ") + "with Helm charts" : "empty"} hidden)` : "";
  showMain(crumbs(n), el("h2", { textContent: "Repositories" }), el("p", { className: "mut", textContent: `${repos} repositories${hiddenNote}, ${recent.tags} tags known to the poller.` }),
    ...(visibleKids(n).length ? childrenList(n) : [el("p", { className: "mut", textContent: "The catalog is empty." })]));
}
// size and platforms of a tag, from its manifest. Fetched on demand, because the manifest call lists every tag in the repo.
const layersTotal = (m) => m.layers.reduce((a, l) => a + (l.size || 0), 0);
function detailCells(m) {
  if (m.index) { // attestation manifests show as unknown/unknown and are not platforms
    const names = [...new Set(m.platforms.map((p) => platName(p)).filter((p) => p !== "unknown/unknown"))];
    return [names.length > 4 ? names.slice(0, 4).join(", ") + ` +${names.length - 4}` : names.join(", "), ""];
  }
  return [m.platform ? `${m.platform.os}/${m.platform.architecture}` : "", size(layersTotal(m))];
}
function repoKind(n) { // a repository of charts or artifacts, as far as the loaded tags tell
  return n.tagList.map((t) => tagKind(t)).find((k) => k !== "image" && k !== "unknown") || "image";
}
const trimSlash = (p) => (p.endsWith("/") ? p.slice(0, -1) : p);
// A volume name is not a path: relative to the current directory it could delete the wrong thing, so ask the tool where the volume is.
function rmRepoCommand(repo) {
  const sub = `/docker/registry/v2/repositories/${repo}`;
  const storage = cfg.registryStorage || "<registry-storage>";
  if (cfg.registryStorage && !storage.startsWith("/")) return `rm -r "$(${prefs.runtime} volume inspect -f '{{.Mountpoint}}' '${storage}')${sub}"`;
  return `rm -r '${trimSlash(storage)}${sub}'`;
}
const storageHint = () => (cfg.registryStorage ? [] : [el("p", { className: "hint", textContent: "UI_REGISTRY_STORAGE is not set, so the command has the placeholder <registry-storage>. Replace it with the host path or volume name of the registry data, or set UI_REGISTRY_STORAGE." })]);
// The registry API cannot delete a repository, and the catalog lists one whose tags are all gone. Its directory has to be removed with the registry stopped.
function emptyRepoNote(n) {
  if (!n.fresh || n.loading) return [el("p", { className: "mut", textContent: "Loading..." })];
  const note = el("p", { className: "mut", textContent: "No tags. The registry API cannot delete a repository. To remove it, stop the registry and delete its directory." });
  if (repoError(n.path)) return [note]; // never put an odd name into a command
  return [note, codeBlock("Remove the empty repository (registry stopped)", [rmRepoCommand(n.path)]), ...storageHint()];
}
function repoPane(n, tab = "tags") {
  const head = [crumbs(n), el("h2", {}, el("span", { className: "ico" }, icon("repo")), n.path), el("p", { className: "reporef" }, copyValue(`${cfg.registryHost || "<REGISTRY>"}/${n.path}`, "Copy repository reference")),
    ...(n.err ? [el("p", { className: "mut", textContent: n.err })] : []), ...repoTabs(n, tab)];
  if (tab === "storage") return showMain(...head, ...repoStorage(n));
  const tags = n.tagList.length ? tagsList(n) : n.err ? [] : emptyRepoNote(n); // an error (no tags yet, during a push) is not an empty repository to remove
  const kids = visibleKids(n).length ? [el("h3", { textContent: "Folders" }), ...childrenList(n)] : [];
  showMain(...head, ...tags, ...kids, commandsEl(n.path, "", "", repoKind(n)));
}
function folderPane(n, tab = "folders") {
  const head = [crumbs(n), el("h2", {}, el("span", { className: "ico" }, icon("folderOpen")), n.path), ...folderTabs(n, tab)];
  if (tab === "storage") return showMain(...head, ...folderStorage(n));
  showMain(...head, ...(visibleKids(n).length ? childrenList(n) : []));
}

// The tagged indexes this digest is a child of. The server refuses the delete or move anyway, this says so before the click.
async function parentInfo(repo, digest) {
  try {
    return await api(`/api/parents?repo=${encodeURIComponent(repo)}&digest=${encodeURIComponent(digest)}`);
  } catch (e) {
    return null; // no warning then: the server refuses a bad delete or move itself
  }
}
function blockText(r) {
  if (!r?.parents.length) return "";
  const plats = [...new Set(r.parents.map((p) => p.platform).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const tags = r.parents.map((p) => p.tag).join(", ") + (r.more ? ` and ${r.more} more` : "");
  return `This manifest is ${plats.length ? plats.join(", ") : "a child"} inside ${tags}. Delete or retag those first.`;
}
// Delete one manifest with the usual confirmation. `after` runs when it went, and by default opens the repository.
async function deleteManifest(repo, ref, digest, after) {
  let m;
  try { m = await getManifest(repo, ref, digest, true); } catch (e) { banner(e.message, true); return; }
  const info = await parentInfo(repo, digest);
  const v = await confirmDelete({ repo, ref, digest, m, info, block: blockText(info) });
  if (v) await run(() => api("/api/delete", { repo, digest, children: v.children }), async () => { await touch(repo); await (after || (() => { location.hash = "#/repo/" + repo; }))(); }, goneVerb(`${repo}:${ref}`));
}
function actions(repo, ref, digest) {
  const copy = (move) => async () => {
    let m;
    try { m = await getManifest(repo, ref, digest, move); } catch (e) { banner(e.message, true); return; } // a move needs the authoritative tag list
    const v = await transfer({ move, repo, ref, digest, m, sharing: move ? m.tags : [], block: move ? blockText(await parentInfo(repo, digest)) : "" });
    if (v) await run(() => api(move ? "/api/move" : "/api/copy", { src: repo, srcRef: ref, dst: v.dst, dstRef: v.dstRef }), async () => { await touch(repo, v.dst); location.hash = `#/repo/${v.dst}:${v.dstRef}`; },
      `${move ? "Moving" : "Copying"} ${repo}:${ref} to ${v.dst}:${v.dstRef}...`);
  };
  const b = (text, fn, cls) => el("button", { textContent: text, className: cls || "", onclick: fn });
  return el("div", { className: "bar" }, ...(!canWrite() ? [] : [b("Copy to...", copy(false)), b("Move to...", copy(true)), b("Delete", () => deleteManifest(repo, ref, digest), "danger")]));
}

const tableRow = (k, v) => el("tr", {}, el("th", { textContent: k }), el("td", {}, v));
const subTable = (title, head, items) => (items.length ? [el("h3", { textContent: title }), el("table", {}, el("tr", {}, ...head.map((h) => el("th", { textContent: h }))), ...items)] : []);
function manifestProps(n, m, path, sharing) {
  const host = cfg.registryHost || "<REGISTRY>";
  const props = [];
  const kind = artifactKind(m);
  if (kind !== "image") props.push(tableRow("Type", kind === "helm" ? KIND_LABEL.helm : `${KIND_LABEL.artifact}, ${m.configType}`));
  if (n.kind === "tag") props.push(tableRow("Image", copyValue(`${host}/${path}:${n.tag}`, "Copy image reference")),
    tableRow("Pinned tag", copyValue(`${host}/${path}:${n.tag}@${m.digest}`, "Copy tag reference pinned to its digest")));
  props.push(tableRow("Pinned", copyValue(`${host}/${path}@${m.digest}`, "Copy pinned image reference")), tableRow(...digestRow(n, m)),
    tableRow("Media type", code(m.mediaType)), tableRow("Manifest size", size(m.size)));
  if (m.layers.length) props.push(tableRow("Layers size", size(layersTotal(m))));
  if (m.created) props.push(tableRow("Created", el("span", { title: new Date(m.created).toLocaleString(), textContent: ago(createdMs(m) / 1000) })));
  props.push(tableRow("Tags", sharing.join(", ") || "none"));
  if (n.kind === "tag" && n.changed) props.push(tableRow("Changed", el("span", { title: new Date(n.changed * 1000).toLocaleString(), textContent: ago(n.changed) })));
  if (n.kind === "tag" && hasAges()) props.push(tableRow("Last used", usedEl(n.parent.ages?.[n.tag])));
  if (m.platform) props.push(tableRow("Platform", `${m.platform.os}/${m.platform.architecture}`));
  if (m.config) props.push(tableRow("Config", code(m.config)));
  return props;
}
// An index digest and a platform digest are different numbers for one image, and a pull by tag, Renovate and a mirror that
// copies one platform each show one of them, so the label says which this is.
function digestRow(n, m) {
  const [label, note] = m.index ? ["Index digest", "multi-arch index: what a pull by tag resolves to, and what Renovate pins"]
    : n.kind === "tag" ? ["Manifest digest", "one platform, no index: a mirror that copied one platform of a multi-arch image has this digest, not the index digest of the source"]
      : ["Platform digest", "one platform inside the index"];
  return [label, el("span", {}, copyValue(m.digest, "Copy digest"), el("span", { className: "mut note", textContent: note }))];
}
// What the tag pointed at before, from the registry storage: each digest it took, when, and whether that manifest is still there.
function historySection(path, m, history) {
  if (!history?.length) return [];
  const host = cfg.registryHost || "<REGISTRY>";
  const state = (h) => (h.digest === m.digest ? "current" : h.present ? "pullable by digest" : "deleted");
  return subTable("Tag history", ["Digest", "Took the tag", "State"], history.map((h) => el("tr", {},
    el("td", { className: "nw" }, code(short(h.digest)), rowCopy(`${host}/${path}@${h.digest}`, "Copy pinned reference")),
    el("td", { title: new Date(h.time * 1000).toLocaleString(), textContent: ago(h.time) }), el("td", { className: "mut", textContent: state(h) }))));
}
const LAYER_COLUMNS = [
  { key: "n", label: "#", tip: "Order in the manifest, base layer first", val: (l) => l.n, cmp: numCmp },
  { key: "digest", label: "Digest", val: (l) => l.digest, cmp: collator.compare },
  { key: "size", label: "Size", val: (l) => l.size, cmp: numCmp },
  { key: "pushed", label: "Pushed", tip: "When the registry first stored the layer, from its file time. A layer shared with older images keeps its first push.", val: (l) => l.pushed ?? null, cmp: numCmp },
  { key: "used", label: "Last used", tip: "The access time of the layer's file where the host records it, else its modification time. Sorts oldest first.", val: (l) => l.used?.[0] ?? null, cmp: numCmp },
];
function layersSection(m) {
  if (!m.layers.length) return [];
  const timed = !!cfg.storageMount, items = m.layers.map((l, i) => ({ ...l, n: i + 1 }));
  const when = (t) => el("td", { className: "mut", title: t ? new Date(t * 1000).toLocaleString() : "", textContent: t ? ago(t) : "" });
  const row = (l) => el("tr", {}, el("td", { className: "mut", textContent: String(l.n) }), el("td", {}, code(l.digest)), el("td", { textContent: size(l.size) }), ...(timed ? [when(l.pushed), usedCell(l.used)] : []));
  const hint = timed ? [] : [el("p", { className: "hint", textContent: "Mount the registry storage read-only and set UI_REGISTRY_STORAGE_MOUNT to see when each layer was pushed and last used." })];
  return [el("h3", { textContent: "Layers" }), ...listView({ id: "layers:" + m.digest, items, columns: timed ? LAYER_COLUMNS : LAYER_COLUMNS.slice(0, 3),
    defaultCmp: (a, b) => a.n - b.n, tie: (a, b) => a.n - b.n, match: (l, text) => l.digest.includes(text), placeholder: "Filter layers", row }), ...hint];
}
function platformSections(n, m) {
  const real = m.platforms.filter((p) => !isAtt(p)), atts = m.platforms.length - real.length;
  const node = (p) => (n.kind === "tag" && n.plats ? n.plats.find((x) => x.digest === p.digest) : null);
  const row = (p) => el("tr", {}, el("td", {}, node(p) ? link(node(p), platName(p)) : platName(p)), el("td", { className: "nw" }, code(short(p.digest)), rowCopy(p.digest, `Copy digest for ${platName(p)}`)), el("td", { textContent: size(p.size) }));
  const note = `+${atts} attestation${atts > 1 ? "s" : ""}, hidden from the list. Copy and delete handle them with the image.`;
  return [...subTable("Platforms", ["Platform", "Platform digest", "Size"], real.map((p) => row(p))), ...(atts ? [el("p", { className: "mut", textContent: note })] : [])];
}
function manifestHeading(n, t, path, kind) {
  const isTag = n.kind === "tag";
  return el("h2", {}, el("span", { className: "ico" }, isTag ? kindIcon(kind) : icon("chip")), isTag ? `${path}:${n.tag}` : `${path}:${t.tag} ${n.name}`);
}
async function manifestPane(n, seq) {
  const t = n.kind === "tag" ? n : n.parent, path = t.parent.path;
  const ref = n.kind === "tag" ? n.tag : n.digest;
  const m = await getManifest(path, ref, n.digest);
  if (n.kind === "tag") await ensurePlats(n);
  const history = n.kind === "tag" && cfg.storageMount ? await api(`/api/history?repo=${encodeURIComponent(path)}&tag=${encodeURIComponent(n.tag)}`).catch(() => []) : [];
  if (n.kind === "tag") await loadAges(t.parent);
  if (seq !== paneSeq) return;
  const sharing = t.parent.tagList.filter((x) => x.digest === m.digest).map((x) => x.tag); // from the tag list the pane already holds
  showMain(crumbs(n), manifestHeading(n, t, path, artifactKind(m)), actions(path, ref, m.digest), el("table", { className: "props" }, ...manifestProps(n, m, path, sharing)),
    ...(n.kind === "tag" ? [commandsEl(path, n.tag, m.digest, artifactKind(m))] : []), ...platformSections(n, m), ...historySection(path, m, history), ...layersSection(m));
}

function notFoundPane() {
  showMain(el("h2", { textContent: "Not found" }), el("p", { className: "mut" }, "That repository or tag is not in the registry. ", el("a", { href: "#/", textContent: "Back to the registry" })));
}
async function drawPane(n, seq) {
  resetHidden();
  if (!n) return notFoundPane();
  if (n === RECENT) return recentPane();
  if (n === STORAGE) return storagePane(seq);
  if (n === BIN) return binPane(seq);
  if (n.kind === "root") return rootPane(n);
  if (n.kind === "proot") return prootPane(n);
  if (n.kind === "pkg") return pkgPane(n);
  if (n.kind === "ver") return verPane(n);
  if (n.kind !== "node") return manifestPane(n, seq);
  if (!n.repo) {
    const ftab = folderTab();
    if (ftab === "storage") await loadStorage();
    if (seq === paneSeq) folderPane(n, ftab);
    return;
  }
  const tab = repoTab();
  await Promise.all([ensureTags(n), loadAges(n), tab === "storage" ? Promise.all([loadStorage(), loadDetail(n)]) : null]);
  if (seq === paneSeq) repoPane(n, tab);
}
async function renderPane(force) { // force: a setting changed under an open panel and the page behind it should show the effect
  if (!force && modalOpen()) { paneStale = true; return; }
  const seq = ++paneSeq, n = PSEUDO[tree.sel] || tree.byId.get(tree.sel);
  try {
    await drawPane(n, seq);
  } catch (e) { if (seq === paneSeq) banner(e.message, true); }
}

const canWrite = () => !cfg.readonly && (!cfg.login || cfg.user); // with an auth proxy, changes need a login
function notice() {
  const memory = lastSeq !== null && !recent.persistent ? "Container history is kept in memory only (the state directory is not set or not writable), so it is rebuilt from storage times at every restart. Mount a volume at /state to keep it. " : "";
  if (cfg.readonly) return memory + "Read-only mode.";
  if (!canWrite()) return memory + "Log in to copy, move or delete.";
  return memory + (cfg.deleteEnabled !== false ? "" : "Deletion is disabled on this registry (REGISTRY_STORAGE_DELETE_ENABLED is not true). Move and Delete will fail.");
}

// ---- Storage: the disk map, last used times and the repository Storage tab ---------------------------------------------------
// The numbers come from the usage scan (usage.py): sizes count each layer once, at the lowest level that holds all of its users.
const AGE_SOURCE = { atime: "last read", mtime: "last written", created: "created" };
const ageNote = (u) => `${AGE_SOURCE[u[1]] || u[1]} (${u[1]}), ${new Date(u[0] * 1000).toLocaleString()}`;
// u: [seconds, atime|mtime|created] from the server, else null. The source stays beside the time, because an mtime is a push time.
function usedEl(u) {
  if (!u) return el("span", { className: "mut", textContent: "unknown" });
  return el("span", { title: ageNote(u) }, ago(u[0]), el("span", { className: "src", textContent: " " + u[1] }));
}
const usedCell = (u) => el("td", { className: "mut nw" }, usedEl(u));
async function loadAges(n) { // the ages of every tag in a repository, from the last usage scan
  if (!cfg.storageMount || !cfg.usage) return;
  try { n.ages = (await api("/api/ages?repo=" + encodeURIComponent(n.path))).tags; } catch (e) { n.ages = {}; }
}

const storage = { data: null, fs: null, at: 0, paths: new Map(), maxBy: { total: 0, frees: 0 } };
let storageLoading = null;
// Size and oldest last-used of every folder and repository, by path, from the map the server sends. A folder adds the repositories
// under it, and a top-level folder also the layers shared inside it.
function pathSizes(top) {
  const out = new Map();
  const walk = (n) => {
    if (n.path) out.set(n.path, { size: n.size, held: n.held, oldest: n.oldest });
    for (const k of n.kids || []) if (k.kind === "folder" || k.kind === "repo") walk(k);
  };
  if (top) walk(top);
  return out;
}
// The two measures: Total is every byte a node uses, shared layers included, Frees the unique bytes only it holds. One figure for a folder
// in the tree and for the line above the map, so the two always agree.
function figureOf(x, by) {
  return by === "total" ? x.held : x.size;
}
function loadStorage(force) {
  if (!cfg.usage) return Promise.resolve(null);
  if (!force && storage.data && Date.now() - storage.at < 60000) return Promise.resolve(storage.data);
  storageLoading ??= api("/api/usage").then((u) => {
    storage.data = u; storage.fs = u.fs; storage.at = Date.now();
    storageUI.gone.clear(); // rows hidden after a delete come back with the scan, which no longer has them or still does
    storage.paths = pathSizes(u.tree);
    storage.maxBy = { total: Math.max(0, ...[...storage.paths.values()].map((p) => p.held)), frees: Math.max(0, ...[...storage.paths.values()].map((p) => p.size)) };
    drawDisk();
    scheduleTree();
    return u;
  }).catch(() => null).finally(() => { storageLoading = null; });
  return storageLoading;
}
async function refreshDisk() { // the filesystem fill, which moves with every push and is cheap to ask
  if (!cfg.storageMount) return;
  try { storage.fs = (await api("/api/disk")).fs; drawDisk(); } catch (e) { /* the pill keeps what it shows */ }
}
const diskPct = () => (storage.fs?.total ? Math.round((100 * storage.fs.used) / storage.fs.total) : null);
function drawDisk() {
  const b = $("disk"), pct = diskPct();
  b.hidden = pct === null;
  if (pct === null) return;
  const fill = el("span", { className: "dfill" });
  fill.style.width = pct + "%";
  b.className = pct >= 95 ? "crit" : pct >= 80 ? "warn" : "";
  b.replaceChildren(icon("drive"), el("span", { className: "dbar" }, fill), `Disk ${pct}%, ${size(storage.fs.used)} of ${size(storage.fs.total)}`);
  b.title = "Fill of the filesystem that holds the registry storage. Space freed by deleting comes back only after garbage collection.";
  scheduleTree(); // the Storage row shows the same percentage
}

// Age classes: how long ago the oldest tag under a node was used. Stale data is the red end.
const AGE_STEPS = [[7, "under 7 days"], [30, "7 to 30 days"], [90, "30 to 90 days"], [180, "90 to 180 days"], [Infinity, "over 180 days"]];
function ageClass(used, nowSecs) {
  if (!used) return "a-none";
  const days = Math.max(0, (nowSecs - used[0]) / 86400);
  return "a" + AGE_STEPS.findIndex(([limit]) => days < limit);
}
const ageDays = (used) => (used ? Math.max(0, Math.round((Date.now() / 1000 - used[0]) / 86400)) : null);
// What deleting some tags of a repository frees. detail: {blobs: [[size, holders]], tags: [{tag, digest, blobs}]} from /api/storage/repo, picked: tag names.
// The registry deletes by digest, so every tag on a picked digest goes. A layer is freed when every image that uses it goes.
function freedBytes(detail, picked) {
  const digests = new Set(detail.tags.filter((t) => picked.has(t.tag)).map((t) => t.digest));
  const count = new Map();
  for (const t of detail.tags) if (digests.has(t.digest)) for (const i of t.blobs) count.set(i, (count.get(i) || 0) + 1);
  let bytes = 0;
  for (const [i, c] of count) if (c === detail.blobs[i][1]) bytes += detail.blobs[i][0];
  const extra = detail.tags.filter((t) => digests.has(t.digest) && !picked.has(t.tag)).length;
  return { bytes, extra, digests: digests.size };
}
const ageWord = () => (storage.data?.atime === false ? "pushed" : "pulled"); // atime frozen: every age is a push time
const ageHead = () => (storage.data?.atime === false ? "Push time (access time not recorded)" : "Last pulled");
const sparkline = (points) => {
  const svg = document.createElementNS(SVGNS, "svg");
  svg.setAttribute("viewBox", "0 0 160 24");
  svg.setAttribute("class", "spark");
  svg.setAttribute("aria-hidden", "true");
  const lo = Math.min(...points), hi = Math.max(...points), span = hi - lo || 1;
  const line = document.createElementNS(SVGNS, "polyline");
  line.setAttribute("points", points.map((v, i) => `${(points.length > 1 ? (i / (points.length - 1)) * 160 : 80).toFixed(1)},${(22 - ((v - lo) / span) * 20).toFixed(1)}`).join(" "));
  svg.append(line);
  return svg;
};
const card = (label, value, ...more) => el("div", { className: "card" }, el("div", { className: "mut", textContent: label }), el("div", { className: "big" }, ...(Array.isArray(value) ? value : [value])), ...more);
function growthCard(h) {
  if (h.length < 2) return card("Growth, last 30 days", "collecting", el("div", { className: "mut", textContent: "A scan adds a point each interval." }));
  const last = h[h.length - 1], from = h.find((p) => p.t >= last.t - 30 * 86400) || h[0];
  const d = last.total - from.total, days = Math.max(1, Math.round((last.t - from.t) / 86400));
  return card(days >= 30 ? "Growth, last 30 days" : `Growth, last ${plural(days, "day")}`, `${d >= 0 ? "+" : "-"}${size(Math.abs(d))}`, sparkline(h.slice(-60).map((p) => p.total)));
}
const reposOf = (top) => (top ? [...(top.kind === "repo" ? [top] : []), ...top.kids.filter((k) => k.kind === "folder" || k.kind === "repo").flatMap(reposOf)] : []);
const repoHash = (repo) => `#/repo/${repo}?tab=storage`;

// The map: one folder level at a time. A block per folder, repository or tag, area is unique bytes, colour is the oldest last-used tag under it.
// Click a folder to open it. Squarified treemap (Bruls, Huizing, van Wijk): sizes largest first, all above 0. Returns one {x, y, w, h} per
// size, in order, that tile the w by h box with areas in proportion to the sizes and rows as close to square as the order allows.
function squarify(sizes, w, h) {
  const total = sizes.reduce((a, b) => a + b, 0);
  if (!(total > 0) || !(w > 0) || !(h > 0)) return sizes.map(() => ({ x: 0, y: 0, w: 0, h: 0 }));
  const areas = sizes.map((s) => (s * w * h) / total), out = [];
  const worst = (row, side) => {
    const sum = row.reduce((a, b) => a + b, 0);
    return Math.max((side * side * Math.max(...row)) / (sum * sum), (sum * sum) / (side * side * Math.min(...row)));
  };
  let x = 0, y = 0, rw = w, rh = h, i = 0;
  while (i < areas.length) {
    const side = Math.min(rw, rh), row = [areas[i]];
    let j = i + 1;
    while (j < areas.length && worst([...row, areas[j]], side) <= worst(row, side)) row.push(areas[j++]);
    const sum = row.reduce((a, b) => a + b, 0);
    if (rw >= rh) { // a column down the left edge
      const cw = sum / rh;
      let cy = y;
      for (const a of row) { out.push({ x, y: cy, w: cw, h: a / cw }); cy += a / cw; }
      x += cw; rw -= cw;
    } else { // a row along the top edge
      const rowH = sum / rw;
      let cx = x;
      for (const a of row) { out.push({ x: cx, y, w: a / rowH, h: rowH }); cx += a / rowH; }
      y += rowH; rh -= rowH;
    }
    i = j;
  }
  return out;
}
// The node a path leads to in the map, or null. "" is the top.
function nodeAt(top, path) {
  let n = top;
  for (const part of path ? path.split("/") : []) {
    n = n?.kids.find((k) => k.name === part && (k.kind === "folder" || k.kind === "repo"));
    if (!n) return null;
  }
  return n;
}
// Blocks under `min` of the total become one block, so no label is squeezed into a few pixels. Returns the blocks, largest first.
function groupSmall(kids, total, min, weight = (k) => k.size) {
  const live = kids.filter((k) => weight(k) > 0).sort((a, b) => weight(b) - weight(a));
  const small = live.filter((k) => weight(k) < total * min);
  if (small.length < 2 || small.length === live.length) return live; // nothing to group, or everything is small and a single block would hide it all
  const rest = live.filter((k) => !small.includes(k));
  const olds = small.map((k) => k.oldest).filter(Boolean).sort((a, b) => a[0] - b[0]);
  const sum = (f) => small.reduce((a, k) => a + (f(k) || 0), 0);
  return [...rest, { name: `${small.length} smaller items`, kind: "other", size: sum((k) => k.size), held: sum((k) => k.held), tags: sum((k) => k.tags), oldest: olds[0] || null, newest: null, kids: [], names: small.map((k) => k.name) }]
    .sort((a, b) => weight(b) - weight(a));
}
// The shared crumb: the registry, then one link per path segment, the last one plain. items: [{text, href}]
function crumbNav(root, items, rootHref = "#/") {
  return el("nav", { className: "crumbs", "aria-label": "Path" }, el("a", { href: rootHref, textContent: root }),
    ...items.map((x, i) => (i === items.length - 1 ? el("span", { className: x.cls || "", textContent: x.text }) : el("a", { href: x.href, className: x.cls || "", textContent: x.text }))));
}
// The segments of a path as crumb items, each linking to the map at that folder: "a/b" -> a, b.
function pathCrumbs(path, base) {
  const parts = path ? path.split("/") : [];
  return parts.map((text, i) => ({ text, href: `${base}/${parts.slice(0, i + 1).join("/")}` }));
}
const regLabel = () => (cfg.registry || "Registry").replace(/^https?:\/\//, "");
const storagePath = () => { // the folder the map shows, from #/storage/<path>
  let h = location.hash;
  try { h = decodeURIComponent(h); } catch (e) { /* the raw hash is used */ }
  const m = /^#\/storage\/(.+?)\/?$/.exec(h);
  return m ? m[1] : "";
};
const MAP_W = 1000, MAP_H = 480, MIN_BLOCK = 0.02;
const typeWord = (t) => (t === "helm" ? "chart" : t === "artifact" ? "artifact" : "");
// by: "total" sizes a block by every byte it uses, shared layers included (so a repository whose layers are all shared still has a block, and
// the "shared" blocks, which would count those layers twice, are left out), "frees" by the bytes only it holds, which deleting it frees.
// What a block is sized by, which blocks are drawn, and their sum, which is the figure the line above the map gives.
function blockWeight(by) {
  return by === "total" ? (k) => k.held : (k) => k.size;
}
function mapKids(node, by) {
  return node.kids.filter((k) => by === "frees" || k.kind !== "shared");
}
function diskMap(u, node, nowSecs, onShared, onOther, by = "total") {
  const weight = blockWeight(by);
  const shown = mapKids(node, by);
  const kids = groupSmall(shown, shown.reduce((a, k) => a + weight(k), 0), MIN_BLOCK, weight), boxes = squarify(kids.map(weight), MAP_W, MAP_H);
  const box = el("div", { className: "dmap" });
  kids.forEach((k, i) => {
    const b = boxes[i], big = (b.w / MAP_W) * (b.h / MAP_H);
    const drill = (k.kind === "folder" || k.kind === "repo") && k.kids.some((x) => x.kind === "folder" || x.kind === "repo");
    const href = k.kind === "tag" ? `#/repo/${k.repo}:${k.tag}` : drill ? `#/storage/${k.path}` : k.kind === "repo" ? repoHash(k.repo) : k.kind === "folder" ? `#/storage/${k.path}` : null;
    const tile = href ? el("a", { href }) : k.kind === "shared" ? el("button", { type: "button", onclick: () => onShared(k) }) : k.kind === "other" ? el("button", { type: "button", onclick: onOther }) : el("div");
    tile.className = `dblk ${ageClass(k.oldest, nowSecs)}${k.kind === "shared" ? " shared" : ""}`;
    Object.assign(tile.style, { left: (100 * b.x) / MAP_W + "%", top: (100 * b.y) / MAP_H + "%", width: (100 * b.w) / MAP_W + "%", height: (100 * b.h) / MAP_H + "%" });
    const old = k.oldest ? `oldest ${ageWord() === "pulled" ? "pull" : "push"} ${ageDays(k.oldest)} d` : "age unknown";
    tile.title = `${k.kind === "other" ? "Click to list them in the table. " : ""}${k.name}: ${size(k.size)} only ${k.kind === "other" ? "these hold" : "this holds"}${k.held > k.size ? `, ${size(k.held)} in all` : ""}${k.names ? `. ${k.names.slice(0, 12).join(", ")}${k.names.length > 12 ? " and more" : ""}` : ""}`;
    if (b.w < 80 || b.h < 22) { tile.setAttribute("aria-label", `${k.name}, ${size(weight(k))}`); return box.append(tile); } // too small for a readable label: the tooltip and the screen reader name it
    tile.append(el("span", { className: "dname", textContent: k.name }));
    const shownSize = weight(k), what = by === "total" ? " total" : "";
    if (b.w < 120 && big > 0.004) tile.append(el("span", { className: "dsub", textContent: size(shownSize) }));
    else if (big > 0.012) tile.append(el("span", { className: "dsub", textContent: `${size(shownSize)}${what}${k.tags && k.kind !== "tag" ? `, ${plural(k.tags, "tag")}` : ""}${typeWord(k.type) ? `, ${typeWord(k.type)}` : ""}` }), el("span", { className: "dsub", textContent: old }));
    else if (big > 0.004) tile.append(el("span", { className: "dsub", textContent: size(shownSize) }));
    box.append(tile);
  });
  return box;
}

// The table: folder, folder, repository, tag, each level sorted by the chosen column. One tag row is a digest, named by its tags.
const STORAGE_COLS = [
  { key: "name", label: "Name", val: (n) => n.name, cmp: (a, b) => collator.compare(a, b) },
  { key: "size", label: "Unique size", tip: "Bytes only this node holds. A layer several tags use counts once, at the lowest level that holds all of them.", val: (n) => n.size, cmp: numCmp },
  { key: "shared", label: "Shared size", tip: "Bytes this node uses that something outside it uses too.", val: (n) => Math.max(0, n.held - n.size), cmp: numCmp },
  { key: "tags", label: "Tags", val: (n) => n.tags, cmp: numCmp },
  { key: "oldest", label: "Oldest used", tip: "The tag under this node that was used longest ago. Sorts oldest first.", val: (n) => n.oldest?.[0] ?? null, cmp: numCmp },
  { key: "newest", label: "Newest used", val: (n) => n.newest?.[0] ?? null, cmp: numCmp },
];
// The Map or Table choice is a preference, so a reload keeps it.
const setStorageView = (v) => { prefs.storageView = v; savePrefs(); };
const storageUI = { open: new Set(), sort: { key: "size", dir: -1 }, sharedKey: null, gone: new Set() };
// The rows below a shared item: the folders or repositories that use those layers, with the bytes each uses.
const sharerRows = (n) => (n.sharers || []).map(([name, bytes]) => ({ name, kind: "sharer", size: bytes, held: bytes, tags: 0, oldest: null, newest: null, kids: [], path: name === "(this repository)" ? "" : n.path ? `${n.path}/${name}` : name }));
const rowIcon = (n) => (n.kind === "folder" ? icon("folder") : n.kind === "repo" || n.kind === "tag" ? kindIcon(n.type || "image") : n.kind === "shared" ? icon("box") : null);
function storageTable(u, top, redraw) {
  const col = STORAGE_COLS.find((c) => c.key === storageUI.sort.key), dir = storageUI.sort.dir;
  const order = (kids) => sortItems(kids, col, dir, (a, b) => collator.compare(a.name, b.name));
  const rows = [];
  const kidsOf = (n) => (n.kind === "shared" ? sharerRows(n) : n.kids.filter((k) => k.size > 0 || k.tags));
  const walk = (n, depth, key) => {
    const kids = order(kidsOf(n)), open = storageUI.open.has(key);
    const toggle = kids.length ? el("button", { type: "button", className: "linkbtn chevbtn", "data-fk": "c:" + key, "aria-expanded": String(open), "aria-label": `${open ? "Collapse" : "Expand"} ${n.name}`,
      onclick: () => { if (open) storageUI.open.delete(key); else storageUI.open.add(key); redraw(); } }, icon("chev", open ? "open" : "")) : el("span", { className: "chevgap" });
    // The name is the one way into a row: a folder opens in this view, a repository opens its Storage tab, where its tags are picked.
    const href = n.kind === "tag" ? `#/repo/${n.repo}:${n.tag}` : n.kind === "repo" ? repoHash(n.repo) : (n.kind === "sharer" || n.kind === "folder") && n.path ? `#/storage/${n.path}` : null;
    const name = href ? el("a", { href, textContent: n.name }) : el("span", { textContent: n.name });
    const actions = [];
    if (n.kind === "tag" && canWrite()) actions.push(el("button", { type: "button", className: "danger", textContent: "Delete", onclick: () => void deleteManifest(n.repo, n.tag, n.digest, async () => { storageUI.gone.add(`${n.repo}@${n.digest}`); banner("Deleted. Sizes update at the next usage scan."); redraw(); }) }));
    const indent = el("span", { className: "indent" }, toggle, ...(rowIcon(n) ? [el("span", { className: "ico" }, rowIcon(n))] : []));
    indent.style.paddingLeft = depth * 18 + "px";
    if (!(n.kind === "tag" && storageUI.gone.has(`${n.repo}@${n.digest}`))) rows.push(el("tr", { className: "depth" + depth },
      el("td", { className: "nm" }, indent, name),
      el("td", { textContent: size(n.size) }), el("td", { className: "mut", textContent: n.kind === "sharer" ? "" : size(Math.max(0, n.held - n.size)) }), el("td", { className: "mut", textContent: n.tags || "" }),
      usedCell(n.oldest), usedCell(n.newest), el("td", { className: "nw" }, ...actions)));
    if (open) for (const k of kids) walk(k, depth + 1, key + "/" + (k.digest || k.name + (k.kind === "shared" ? "!" : "")));
  };
  for (const k of order(kidsOf(top))) walk(k, 0, k.name + (k.kind === "shared" ? "!" : ""));
  const head = STORAGE_COLS.map((c) => {
    const on = storageUI.sort.key === c.key;
    return el("th", { "aria-sort": on ? (dir < 0 ? "descending" : "ascending") : "none" }, el("button", { type: "button", className: "thbtn", title: c.tip || "", "data-fk": "s:" + c.key,
      onclick: () => { storageUI.sort = on ? { key: c.key, dir: -dir } : { key: c.key, dir: c.key === "name" || c.key === "oldest" ? 1 : -1 }; redraw(); } }, c.key === "oldest" ? ageHead() === "Last pulled" ? c.label : "Oldest push" : c.label, on ? icon("arrow", dir < 0 ? "desc" : "") : null));
  });
  return el("table", { className: "sortable" }, el("thead", {}, el("tr", {}, ...head, el("th", {}))), el("tbody", {}, ...rows));
}

async function storagePane(seq) {
  const u = await loadStorage(true);
  if (seq !== paneSeq) return;
  const nowSecs = Date.now() / 1000, path = storagePath();
  if (!u || !u.updated) {
    showMain(crumbNav(regLabel(), [{ text: "Storage", href: "#/storage" }]), el("h2", { textContent: "Storage" }),
      el("p", { className: "mut", textContent: "The first scan runs once the first full walk of the registry has finished." }));
    return;
  }
  const node = nodeAt(u.tree, path) || u.tree, shownPath = node === u.tree ? "" : path;
  const repos = reposOf(u.tree), own = (r) => r.own_size ?? r.size, biggest = [...repos].sort((a, b) => own(b) - own(a))[0];
  const stale = u.stale;
  const cards = el("div", { className: "cards" },
    card("Largest repository", biggest ? [el("a", { href: repoHash(biggest.repo), textContent: biggest.repo }), `, ${size(own(biggest))}`] : "none"),
    card(`Not ${ageWord()} in 180 days`, stale ? el("span", { className: stale.tags ? "warnfg" : "", textContent: `${size(stale.frees)}, ${plural(stale.tags, "tag")}` }) : "needs the storage mount",
      stale ? el("div", { className: "mut", textContent: "What garbage collection frees if all of them go." }) : null),
    card("Untagged layers (GC frees now)", u.unreferenced != null ? size(u.unreferenced) : "needs the storage mount", u.unreferenced != null ? null : el("div", { className: "mut", textContent: "Set UI_REGISTRY_STORAGE_MOUNT." })),
    growthCard(u.history));
  const redraw = () => keepFocus(holder, () => void body());
  const holder = el("div"), sharedBox = el("div");
  const legend = el("span", { className: "legendrow" }, `${ageHead()}:`, ...(u.mount ? AGE_STEPS.map(([, text], i) => el("span", { className: "legend" }, el("i", { className: "sw a" + i }), text)) : [el("span", { className: "legend" }, el("i", { className: "sw a-none" }), "unknown, needs the storage mount")]));
  const toggleBtn = (view, text) => el("button", { type: "button", "aria-pressed": String(prefs.storageView === view), textContent: text, onclick: () => { setStorageView(view); void paint(); } });
  const bar = el("div", { className: "bar" });
  const showShared = (k) => { // which folders use the layers a shared block stands for
    sharedBox.replaceChildren(el("h3", { textContent: k.name }), el("p", { className: "mut", textContent: `${size(k.size)} held once and used by more than one item${k.path ? ` in ${k.path}` : ""}. Bytes each of them uses:` }),
      el("table", { className: "sortable" }, el("tbody", {}, ...sharerRows(k).map((r) => el("tr", {}, el("td", {}, r.path ? el("a", { href: `#/storage/${r.path}`, textContent: r.name }) : r.name), el("td", { textContent: size(r.size) }))))));
  };
  const body = () => {
    holder.replaceChildren(prefs.storageView === "map" ? diskMap(u, node, nowSecs, showShared, () => { setStorageView("table"); void paint(); }, prefs.mapBy) : storageTable(u, node, redraw));
    return Promise.resolve();
  };
  const foot = el("p", { className: "mut" });
  const paint = () => {
    sharedBox.replaceChildren();
    foot.replaceChildren(prefs.storageView === "map" ? `Click a folder to open it, a repository to pick tags to delete. ${prefs.mapBy === "total" ? "Area is every byte a block uses, so a layer used by two blocks counts in both and the blocks add up to more than the disk holds." : "Area is the bytes only a block holds, which deleting it frees. A layer several items use counts once, in a block named for what shares it, at the lowest folder that holds them all."}`
      : "Click a name to open it: a folder opens here, a repository opens its Storage tab to pick tags. Click a header to sort each level. Shared size is what a node uses that something outside it uses too.");
    const byBtn = (v, text, tip) => el("button", { type: "button", title: tip, "aria-pressed": String(prefs.mapBy === v), textContent: text, onclick: () => { prefs.mapBy = v; savePrefs(); scheduleTree(); void renderPane(); } }); // the pane is drawn again: the line above the map follows too
    bar.replaceChildren(el("div", { role: "group", "aria-label": "View", className: "seg" }, toggleBtn("map", "Map"), toggleBtn("table", "Table")),
      ...(prefs.storageView === "map" ? [el("span", { className: "mut" }, "Size by ", el("div", { role: "group", "aria-label": "Size by", className: "seg" },
        byBtn("total", "Total", "Every byte the block uses, shared layers included"), byBtn("frees", "Frees", "Only the bytes that deleting it frees")))] : []), legend);
    return body();
  };
  await paint();
  const note = u.atime === false ? " No layer has an access time newer than its write time, so ages are push times: either access time is not recorded on this storage (noatime, or an NFS server that does not update it) or nothing has been pulled since it was pushed." : "";
  const unread = u.unread?.count ? [el("p", { className: "hint", textContent: `${plural(u.unread.count, "tag")} could not be read and ${u.unread.count === 1 ? "is" : "are"} not counted (${u.unread.first.join(", ")}${u.unread.count > 5 ? ", ..." : ""}). The registry did not return their manifests.` })] : [];
  const pypi = cfg.pypi && !cfg.pypi.locked ? [el("p", { className: "mut", textContent: "Python packages are stored in GitLab, not on this registry's disk, so they are not counted here." })] : [];
  const hollow = node.kids.filter((k) => k.size === 0 && k.tags > 0).length;
  const here = [...(hollow && prefs.storageView === "map" && prefs.mapBy === "frees" ? [el("p", { className: "mut", textContent: `${plural(hollow, "item")} here ${hollow === 1 ? "holds" : "hold"} no bytes of their own (every layer is shared), so this map has no block for ${hollow === 1 ? "it" : "them"}. Size by Total shows ${hollow === 1 ? "it" : "them"}, and so does the table.` })] : []),
    ...(shownPath ? [el("p", { className: "mut" }, `${size(figureOf(node, prefs.mapBy))} ${prefs.mapBy === "total" ? "total" : "unique"} in ${plural(node.tags, "tag")} under ${shownPath}. `, ...(node.kind === "repo" ? [el("a", { href: repoHash(node.repo), textContent: "Open the repository" })] : []))] : [])];
  showMain(crumbNav(regLabel(), [{ text: "Storage", href: "#/storage" }, ...pathCrumbs(shownPath, "#/storage")]),
    el("div", { className: "storagehead" }, el("h2", { textContent: "Storage" }),
      el("span", { className: "mut", textContent: `${size(u.total)} in ${plural(u.tags, "tag")} across ${plural(repos.length, "repository", "repositories")}. Sizes count each layer once. Scanned ${ago(u.updated)}.${note}` })),
    ...unread, ...pypi, cards, bar, ...here, holder, sharedBox, foot);
}

// The Storage tab of a repository: tags by last use with what deleting each frees, a selection, and the existing delete.
async function loadDetail(n) {
  try { n.detail = await api("/api/storage/repo?repo=" + encodeURIComponent(n.path)); } catch (e) { n.detail = null; n.detailErr = e.message; }
}
const repoTab = () => tabFromHash() || "tags";
function repoTabs(n, tab) {
  if (!cfg.usage) return [];
  const t = (label, href, on) => el("a", { role: "tab", href, "aria-selected": String(on), textContent: label });
  return [el("div", { className: "tabbar" }, el("div", { role: "tablist", className: "tabs" }, t("Tags", hashOf(n), tab === "tags"), t("Storage", repoHash(n.path), tab === "storage")))];
}
const tabFromHash = () => {
  let h = location.hash;
  try { h = decodeURIComponent(h); } catch (e) { /* the raw hash is tested */ }
  return /\?tab=storage$/.test(h) && cfg.usage ? "storage" : "";
};
const folderTab = () => tabFromHash() || "folders";
function folderTabs(n, tab) {
  if (!cfg.usage) return [];
  const t = (label, href, on) => el("a", { role: "tab", href, "aria-selected": String(on), textContent: label });
  return [el("div", { className: "tabbar" }, el("div", { role: "tablist", className: "tabs" }, t("Folders", hashOf(n), tab === "folders"), t("Storage", hashOf(n) + "?tab=storage", tab === "storage")))];
}
// The tags a quick-select choice picks: "none", "keep10", or a number of days not used. Null (nothing changes) for anything else.
function quickSelect(value, rows, nowSecs) {
  if (value === "none") return new Set();
  if (value === "keep10") return allButNewest(rows, 10);
  const days = Number(value);
  if (value === "" || !Number.isFinite(days) || days <= 0) return null;
  return new Set(rows.filter((t) => t.used && t.used[0] < nowSecs - days * 86400).map((t) => t.tag));
}
// The tags to delete to keep the `keep` newest images. The registry deletes by digest, so images are ranked and every tag of an old one is picked.
function allButNewest(rows, keep) {
  const newest = new Map();
  for (const t of rows) newest.set(t.digest, Math.max(newest.get(t.digest) ?? 0, t.pushed ?? 0));
  const kept = new Set([...newest].sort((a, b) => b[1] - a[1]).slice(0, keep).map(([d]) => d));
  return new Set(rows.filter((t) => !kept.has(t.digest)).map((t) => t.tag));
}
// A redraw replaces the control that has focus, so focus the new control with the same data-fk.
function keepFocus(box, fn) {
  const key = document.activeElement?.dataset?.fk;
  fn();
  if (key) box.querySelector(`[data-fk="${CSS.escape(key)}"]`)?.focus();
}
const STALE_OPTIONS = [["180", "Not used in 180 days"], ["90", "Not used in 90 days"], ["30", "Not used in 30 days"], ["keep10", "All but the newest 10"], ["none", "None"]];
function repoStorage(n) {
  const d = n.detail, u = storage.data;
  if (!d || !d.updated) return [el("p", { className: "mut", textContent: n.detailErr || "No scan has covered this repository yet. The first one runs after the first full walk of the registry." })];
  const st = stateOf("rstor:" + n.path);
  st.picked ??= new Set();
  st.sort ??= { key: "used", dir: 1 };
  const rows = d.tags.filter((t) => n.tagMap.has(t.tag));
  const gone = d.tags.length - rows.length;
  for (const k of st.picked) if (!n.tagMap.has(k)) st.picked.delete(k);
  const node = reposOf(u?.tree).find((k) => k.repo === n.path);
  const cut = (days) => Date.now() / 1000 - days * 86400;
  const staleNames = (days) => new Set(rows.filter((t) => t.used && t.used[0] < cut(days)).map((t) => t.tag));
  const staleFrees = freedBytes(d, staleNames(180));
  const word = ageWord();
  const src = u?.atime === true ? "last access (atime)" : u?.atime === false ? "push time (access time not recorded)" : "unknown, needs the storage mount";
  const cards = el("div", { className: "cards" }, card("Repository size, shared layers included", `${size(node?.own_held ?? node?.held ?? rows.reduce((a, t) => a + t.size, 0))}, ${plural(rows.length, "tag")}`),
    card("Unique size, layers only this repo uses (the tree)", size(node?.own_size ?? node?.size ?? 0)),
    card(`Not ${word} in 180 days`, el("span", { className: staleNames(180).size ? "warnfg" : "", textContent: `${plural(staleNames(180).size, "tag")}, frees ${size(staleFrees.bytes)}` })),
    card("Age source", src));
  const sum = rows.reduce((a, t) => a + t.frees, 0) || 1, top = Math.max(1, ...rows.map((t) => t.frees)) / sum;
  const choose = el("select", { "aria-label": "Quick select", onchange: () => {
    const picked = quickSelect(choose.value, rows, Date.now() / 1000);
    choose.selectedIndex = 0; // an action menu: the same choice can be made again
    if (!picked) return;
    st.picked = picked;
    draw();
  } }, el("option", { value: "", disabled: true, selected: true, hidden: true, textContent: "Choose..." }), ...STALE_OPTIONS.map(([v, text]) => el("option", { value: v, textContent: v === "180" || v === "90" || v === "30" ? text.replace("used", word) : text })));
  const cols = [
    { key: "tag", label: "Tag", val: (t) => t.tag, cmp: tagCompare }, { key: "frees", label: "Frees", tip: "Bytes only this image holds, which garbage collection frees once it is deleted.", val: (t) => t.frees, cmp: numCmp },
    { key: "size", label: "Size", val: (t) => t.size, cmp: numCmp }, { key: "share", label: "Share of repo", tip: "This tag's frees against the frees of every tag in the repository.", val: (t) => t.frees, cmp: numCmp },
    { key: "used", label: ageHead(), tip: USED_TIP, val: (t) => t.used?.[0] ?? null, cmp: numCmp }, { key: "pushed", label: "Pushed", val: (t) => t.pushed ?? null, cmp: numCmp },
  ];
  const holder = el("div"), sel = el("div", { className: "bar bulk selbar" });
  const draw = () => keepFocus(holder, paintRows);
  const paintRows = () => {
    const col = cols.find((c) => c.key === st.sort.key);
    const list = sortItems(rows, col, st.sort.dir, (a, b) => tagCompare(b.tag, a.tag));
    const keys = list.map((t) => t.tag);
    const pick = (tag, on, range) => { // shift-click selects or clears the range from the last clicked row to this one
      const from = keys.indexOf(st.anchor), to = keys.indexOf(tag);
      const span = range && from >= 0 && to >= 0 ? keys.slice(Math.min(from, to), Math.max(from, to) + 1) : [tag];
      for (const k of span) if (on) st.picked.add(k); else st.picked.delete(k);
      st.anchor = tag;
      draw();
    };
    const head = cols.map((c) => {
      const on = st.sort.key === c.key;
      return el("th", { "aria-sort": on ? (st.sort.dir < 0 ? "descending" : "ascending") : "none" }, el("button", { type: "button", className: "thbtn", title: c.tip || "", "data-fk": "s:" + c.key,
        onclick: () => { st.sort = on ? { key: c.key, dir: -st.sort.dir } : { key: c.key, dir: c.key === "tag" || c.key === "used" ? 1 : -1 }; draw(); } }, c.label, on ? icon("arrow", st.sort.dir < 0 ? "desc" : "") : null));
    });
    const all = el("input", { type: "checkbox", "aria-label": "Select every tag", "data-fk": "all", checked: list.length > 0 && list.every((t) => st.picked.has(t.tag)),
      onchange: () => { for (const t of list) if (all.checked) st.picked.add(t.tag); else st.picked.delete(t.tag); draw(); } });
    const tr = (t) => {
      const on = st.picked.has(t.tag);
      const stale = on || (t.used && t.used[0] < cut(180));
      const b = el("input", { type: "checkbox", checked: on, "aria-label": `Select ${t.tag}`, "data-fk": "t:" + t.tag });
      b.onclick = (e) => pick(t.tag, b.checked, e.shiftKey);
      const bar = el("span", { className: "sbar" }, el("span", { className: "sfill" + (stale ? " old" : "") }));
      bar.firstChild.style.width = Math.round((100 * (t.frees / sum)) / top) + "%";
      bar.title = `${((100 * t.frees) / sum).toFixed(1)}% of what this repository's tags free`;
      return el("tr", { className: on ? "pickable on" : "" }, el("td", { className: "pick" }, b), el("td", {}, el("a", { href: `#/repo/${n.path}:${t.tag}`, textContent: t.tag })),
        el("td", { className: "num", textContent: t.shares ? `0 B, shares ${t.shares}` : size(t.frees) }), el("td", { className: "mut num", textContent: size(t.size) }), el("td", {}, bar),
        usedCell(t.used), el("td", { className: "mut nw", title: t.pushed ? new Date(t.pushed * 1000).toLocaleString() : "", textContent: t.pushed ? ago(t.pushed) : "" }));
    };
    holder.replaceChildren(el("table", { className: "sortable" }, el("thead", {}, el("tr", {}, el("th", { className: "pick" }, all), ...head)), el("tbody", {}, ...list.map(tr))));
    const k = st.picked.size, f = freedBytes(d, st.picked);
    sel.hidden = !k;
    const go = el("button", { type: "button", className: "danger", textContent: cfg.binDays ? `Move ${plural(k, "tag")} to bin` : `Delete ${plural(k, "tag")}`, disabled: !canWrite(),
      onclick: () => void deleteTags(n, rows.filter((t) => st.picked.has(t.tag)).map((t) => n.tagMap.get(t.tag))) });
    sel.replaceChildren(el("span", { className: "selcount", textContent: `${plural(k, "tag")} selected` }),
      el("span", { textContent: `Frees about ${size(f.bytes)} after garbage collection. Layers other tags still use are kept.` + (f.extra ? ` ${plural(f.extra, "more tag")} on the same digest go too.` : "") }),
      el("span", { className: "grow" }), el("button", { type: "button", textContent: "Clear", onclick: () => { st.picked.clear(); choose.value = ""; draw(); } }), ...(canWrite() ? [go] : []));
  };
  paintRows();
  return [cards, el("div", { className: "bar" }, el("label", { className: "mut" }, "Select ", choose), el("span", { className: "mut", textContent: `Sorted by ${st.sort.key === "used" ? `last ${word}, oldest first` : st.sort.key}.`
    + (gone ? ` ${plural(gone, "tag")} deleted since the scan.` : "") + (u?.updated ? ` Scanned ${ago(u.updated)}.` : "") })), holder, sel];
}

// The Storage tab of a folder: the same disk map and table as the Storage view, scoped to this folder, so browsing a folder
// answers "what does this hold" without leaving the tree. Shared-layer detail and growth stay on the full Storage view.
function folderStorage(n) {
  const u = storage.data;
  if (!u || !u.updated) return [el("p", { className: "mut", textContent: "No scan has covered this folder yet. The first one runs after the first full walk of the registry." })];
  const node = nodeAt(u.tree, n.path);
  if (!node || !(node.kids || []).length) return [el("p", { className: "mut", textContent: "Nothing under this folder has been scanned yet." })];
  const nowSecs = Date.now() / 1000;
  const holder = el("div");
  const draw = () => keepFocus(holder, () => {
    const press = (on) => String(on);
    const toggleBtn = (view, text) => el("button", { type: "button", "data-fk": "v:" + view, "aria-pressed": press(prefs.storageView === view), textContent: text, onclick: () => { setStorageView(view); draw(); } });
    const byBtn = (v, text, tip) => el("button", { type: "button", "data-fk": "b:" + v, title: tip, "aria-pressed": press(prefs.mapBy === v), textContent: text, onclick: () => { prefs.mapBy = v; savePrefs(); scheduleTree(); draw(); } });
    const bar = el("div", { className: "bar" }, el("div", { role: "group", "aria-label": "View", className: "seg" }, toggleBtn("map", "Map"), toggleBtn("table", "Table")),
      ...(prefs.storageView === "map" ? [el("span", { className: "mut" }, "Size by ", el("div", { role: "group", "aria-label": "Size by", className: "seg" },
        byBtn("total", "Total", "Every byte the block uses, shared layers included"), byBtn("frees", "Frees", "Only the bytes that deleting it frees")))] : []));
    const content = prefs.storageView === "map"
      ? diskMap(u, node, nowSecs, () => { location.hash = "#/storage/" + n.path; }, () => { setStorageView("table"); draw(); }, prefs.mapBy)
      : storageTable(u, node, draw);
    const summary = el("p", { className: "mut" }, `${size(figureOf(node, prefs.mapBy))} ${prefs.mapBy === "total" ? "total" : "unique"} in ${plural(node.tags, "tag")} under ${n.path}. `,
      el("a", { href: "#/storage/" + n.path, textContent: "Open in the Storage view" }), " for shared layers and growth.");
    holder.replaceChildren(bar, summary, content);
  });
  draw();
  return [holder];
}

// ---- Recycle bin: a delete keeps the manifest in the state file, so Restore can push it back ------------------------------------
const binNote = () => (cfg.binDays ? `The tag goes to the Bin and can be restored for ${plural(cfg.binDays, "day")}. ` : "");
async function binCount() { // the number on the header button
  if (!cfg.binDays) return;
  try {
    const n = (await api("/api/bin")).entries.length;
    $("bin").textContent = n ? `Bin (${n})` : "Bin";
  } catch (e) { /* the button keeps its label */ }
}
async function binPane(seq) {
  const b = await api("/api/bin");
  if (seq !== paneSeq) return;
  $("bin").textContent = b.entries.length ? `Bin (${b.entries.length})` : "Bin";
  const write = canWrite();
  const left = (e) => { const d = Math.max(0, Math.ceil((e.expires - Date.now() / 1000) / 86400)); return d <= 1 ? "under 1 day" : `${d} days`; };
  const act = async (e, path, text) => { // Restore and Delete forever act on one entry
    banner("");
    try { await api(path, { id: e.id }); } catch (err) { banner(err.message, true); void renderPane(); return false; }
    return true;
  };
  const restore = async (e) => {
    if (!(await act(e, "/api/bin/restore"))) return;
    await touch(e.repo);
    location.hash = `#/repo/${e.repo}:${e.tag}`;
  };
  const forget = async (e) => {
    if (!(await ask("Delete forever", [`Remove ${e.repo}:${e.tag} from the Bin? It can no longer be restored. Disk space is freed by garbage collection.`], [], true))) return;
    if (await act(e, "/api/bin/delete")) void renderPane();
  };
  // Restore or Delete forever for each picked entry, one call each, in list order. A failure is reported and the rest still go.
  const each = async (ids, path, verb) => {
    const list = b.entries.filter((e) => ids.has(e.id)), failed = [];
    for (const [i, e] of list.entries()) {
      banner(`${verb} ${i + 1} of ${list.length}...`);
      try { await api(path, { id: e.id }); } catch (err) { failed.push(`${e.repo}:${e.tag} (${err.message})`); }
    }
    const done = list.length - failed.length;
    banner(failed.length ? `${done} of ${list.length} done. Failed: ${failed.join("; ")}` : "", failed.length > 0);
    return list;
  };
  const restoreMany = async (ids) => {
    const list = await each(ids, "/api/bin/restore", "Restoring");
    await touch(...new Set(list.map((e) => e.repo))).catch(() => { /* the next sync shows it */ });
    void renderPane();
  };
  const forgetMany = async (ids) => {
    if (!(await ask("Delete forever", [`Remove ${plural(ids.size, "entry", "entries")} from the Bin? ${ids.size === 1 ? "It" : "They"} can no longer be restored. Disk space is freed by garbage collection.`], [], true))) return;
    await each(ids, "/api/bin/delete", "Deleting");
    void renderPane();
  };
  // Checkboxes and shift-click ranges as in the Tags view and the Storage tab.
  const pick = write ? pickBar({ id: "bin", key: (e) => e.id, keep: (id) => b.entries.some((e) => e.id === id), noun: "entry", nouns: "entries", deleteText: "Delete forever",
    hint: "Select entries to restore or delete several at once. Shift-click selects a range.", onDelete: forgetMany, max: Infinity, more: [["Restore selected", restoreMany]] }) : null;
  const row = (e) => {
    const tr = el("tr", {}, el("td", {}, code(`${e.repo}:${e.tag}`)), el("td", { className: "nw" }, code(short(e.digest))), el("td", { textContent: size(e.size) }),
      el("td", { className: "mut", title: new Date(e.t * 1000).toLocaleString(), textContent: ago(e.t) }), el("td", { className: "mut", textContent: left(e) }),
      ...(write ? [el("td", { className: "nw" }, el("button", { type: "button", textContent: "Restore", onclick: () => void restore(e) }), " ",
        el("button", { type: "button", className: "danger", textContent: "Delete forever", onclick: () => void forget(e) }))] : []));
    pick?.row(tr, e);
    return tr;
  };
  const empty = async () => {
    if (!(await ask("Empty the Bin", [`Remove all ${plural(b.entries.length, "entry", "entries")} from the Bin? None of them can be restored afterwards. This frees no disk space by itself: run garbage collection next.`], [], true))) return;
    try { await api("/api/bin/empty", {}); } catch (err) { banner(err.message, true); }
    void renderPane();
  };
  const rows = b.entries.map(row);
  pick?.shown(b.entries);
  showMain(el("h2", {}, el("span", { className: "ico" }, icon("trash")), "Bin"),
    el("p", { className: "mut", textContent: `A deleted tag stays here for ${plural(b.days, "day")}. Its tag and manifest are already gone from the registry, but its layers stay on disk, so Restore can push the same manifest back to its tag.` }),
    el("p", { className: "mut", textContent: "To free the space: empty the Bin (or let entries expire), then run garbage collection. Garbage collection does not know about the Bin: it frees the layers of everything here too, and Restore then fails for those images. So run it only once nothing here needs restoring. Empty and Delete forever only forget entries, they free nothing until garbage collection runs." }),
    ...(write && b.entries.length ? [el("div", { className: "bar" }, el("button", { type: "button", className: "danger", textContent: "Empty bin", onclick: () => void empty() }))] : []),
    ...(pick && b.entries.length ? [pick.bar] : []),
    b.entries.length ? el("table", {}, el("thead", {}, el("tr", {}, ...(pick ? [pick.head] : []), ...["Image", "Digest", "Size", "Deleted", "Expires in", ...(write ? [""] : [])].map((h) => el("th", { textContent: h })))), el("tbody", {}, ...rows))
      : el("p", { className: "mut", textContent: "The Bin is empty." }));
}

// ---- Routing: #/ (registry), #/recent, #/dir/<path>, #/repo/<name>[:<tag>[@<digest>]] ---------------------------------------
function parseHash() {
  let h = "/";
  try { h = decodeURIComponent(location.hash.slice(1)) || prefs.selected; } catch (e) { /* malformed escape: show the registry */ }
  const m = /^\/(?:repo|dir)\/([^:@]+)(?::([^@]+))?(?:@(.+))?$/.exec(h.replace(/\?tab=storage$/, ""));
  if (h === "/recent") return { kind: "recent" };
  if (h === "/storage" || h === "/usage" || h.startsWith("/storage/")) return { kind: "storage" };
  if (h === "/bin") return { kind: "bin" };
  if (h === "/pypi") return { kind: "proot" };
  const py = /^\/pypi\/([^@]+)(?:@(.+))?$/.exec(h);
  if (py) return { kind: "pypi", key: py[1].toLowerCase().replace(/[-_.]+/g, "-"), version: py[2] };
  return m ? { kind: "path", path: m[1], tag: m[2], digest: m[3] } : { kind: "root" };
}
let navSeq = 0;
async function resolve(r) {
  if (r.kind === "recent") return RECENT;
  if (r.kind === "storage") return cfg.usage ? STORAGE : tree.root;
  if (r.kind === "bin") return cfg.binDays ? BIN : tree.root;
  if (r.kind === "root") return tree.root;
  if (r.kind === "proot") return cfg.pypi ? tree.proot : null;
  if (r.kind === "pypi") {
    if (!cfg.pypi) return null;
    if (!pypi.loaded) await pypiSync();
    if (pypi.denied || !pypi.loaded) return tree.proot; // the root shows the login or error notice
    const p = tree.byKey.get(r.key);
    return p && r.version ? p.versions.get(r.version) : p;
  }
  let n = tree.byPath.get(r.path);
  if (!n) { await sync(); n = tree.byPath.get(r.path); }
  if (!n || !r.tag) return n;
  await ensureTags(n);
  let t = n.tagMap.get(r.tag);
  const missedAt = n.missing?.get(r.tag);
  const recentlyMissing = missedAt !== undefined && missedAt > Date.now() - 30000;
  if (!t && !recentlyMissing) { // a link to a tag that is not there is checked once, then remembered for 30 s
    await ensureTags(n, true);
    t = n.tagMap.get(r.tag);
    if (!t) {
      if (!n.missing) n.missing = new Map();
      n.missing.set(r.tag, Date.now());
    }
  }
  if (!t || !r.digest) return t;
  await ensurePlats(t);
  return (t.plats || []).find((p) => p.digest === r.digest);
}
async function navigate() {
  if ($("dlg").open) return;
  const seq = ++navSeq;
  const n = await resolve(parseHash());
  if (seq !== navSeq) return;
  if (n) {
    for (let x = n.parent; x && x !== tree.root.parent; x = x.parent) expanded.add(x.id);
    prefs.expanded = [...expanded].slice(-MAX_EXPANDED);
  }
  if (n) prefs.selected = hashOf(n).slice(1);
  savePrefs();
  select(n ? n.id : null, true);
  resetShown();
  drawer(false);
  void renderPane();
}

// ---- Live updates ---------------------------------------------------------------------------------------------------
// Server-Sent Events from the poller. Plain polling of /api/recent is the fallback while the stream is down.
// SSE was kept because the stdlib server needs only one thread per client and nginx needs two proxy settings (see auth/nginx-basic.conf).
// Each event is applied to the tree in place: the catalog, and the tags of every repository that changed and is open.
let es = null;
let state = "off";
let lastSeq = null;
let syncing = null, again = false;
// The time of the last completed check of the registry, which moves every walk. The last change seen is in the tooltip.
function liveLabel() {
  const t = checked ? `, checked ${checked.toLocaleTimeString()}` : "";
  const label = { live: "live", off: "auto-refresh off" }[state] || "reconnecting";
  $("live").textContent = label + t;
  const last = recent.events[0]?.t;
  $("live").title = last ? `Last change seen ${new Date(last * 1000).toLocaleString()}` : "No change seen yet";
}
function setChecked(ago) { // ago: seconds, from the server, or null before its first walk
  if (ago == null) return;
  checked = new Date(Date.now() - ago * 1000);
  liveLabel();
}
function sync() {
  if (syncing) { again = true; return syncing; }
  syncing = doSync().catch((e) => banner(e.message, true)).finally(() => { syncing = null; if (again) { again = false; void sync(); } });
  return syncing;
}
function pathFromId(id) { // the repository path in a node id such as t:lab/app:1.0 or p:lab/app:1.0@sha256:...
  const rest = id.slice(2), cut = rest.search(/[:@]/);
  return cut < 0 ? rest : rest.slice(0, cut);
}
function refreshTouched(touched, gap) { // reload the tags of every changed repository that is loaded, and flash the ones that are not
  const jobs = [];
  for (const n of tree.byPath.values()) {
    if (!n.repo || !(gap || touched.has(n.path))) continue;
    dropManifests(n.path);
    // reconciling flashes what changed. A repository that answered an error (no tags yet, during a push) loads again too.
    if (n.tagList.length || n.loading || n.err) jobs.push(ensureTags(Object.assign(n, { fresh: false }), true));
    else flash(n);
  }
  return Promise.all(jobs);
}
function leaveGoneNode() { // the selected node is gone: fall back to what holds it
  if (!tree.sel || PSEUDO[tree.sel] || tree.byId.has(tree.sel)) return;
  const n = tree.byPath.get(pathFromId(tree.sel));
  location.hash = n ? hashOf(n) : "#/";
}
// A desktop notification for the pushes in one sync, while the page is not the window in focus: push, switch away, hear when it lands.
const canNotify = () => "Notification" in window && window.isSecureContext; // the browser offers it on HTTPS and localhost only
function notifyPushes(evs) {
  const refs = evs.filter((e) => e.type === "new" || e.type === "retagged").map((e) => e.ref); // a restore is not a push
  if (!refs.length || !prefs.notify || document.hasFocus() || !canNotify() || Notification.permission !== "granted") return;
  const more = refs.length > 5 ? ` and ${refs.length - 5} more` : "";
  const note = new Notification(refs.length === 1 ? "Pushed " + refs[0] : `${refs.length} pushes`, { body: refs.slice(0, 5).join("\n") + more, tag: "registry-push", icon: "/favicon.svg" });
  note.onclick = () => { window.focus(); location.hash = refs.length === 1 ? "#/repo/" + refs[0] : "#/recent"; note.close(); };
}
async function doSync() {
  const [rc, names] = await Promise.all([api("/api/recent"), api("/api/repos")]);
  const first = lastSeq === null;
  recent = rc;
  const newer = first ? [] : rc.events.filter((e) => e.seq > lastSeq);
  const evs = newer.filter((e) => !e.src); // tags the UI found at its start are not pushes
  const gap = !first && rc.seq - lastSeq > newer.length; // history was pruned, so refresh everything open
  lastSeq = rc.seq;
  const grew = applyCatalog(names, !first);
  const touched = new Set(evs.map((e) => repoOf(e.ref)));
  if (evs.length || gap) { tree.indexStale = true; tree.matches = null; }
  notifyPushes(evs);
  await refreshTouched(touched, gap);
  leaveGoneNode();
  banner(notice());
  renderTree();
  if (pickerSync) pickerSync();
  if (!first && (grew || evs.length || gap)) void renderPane();
  setChecked(rc.checkedAgo);
  liveLabel();
  void refreshDisk();
  if (cfg.usage && Date.now() - storage.at > 300000) void loadStorage(true); // the sizes in the tree follow the scans
}
let stale = false;
let syncTimer = 0;
function syncSoon() { // a burst of events (a multi-arch push is many) becomes one sync: one catalog read and one tag list per open repository
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => void sync(), 400);
}
function startLive() {
  if (es) es.close();
  es = null;
  state = "off";
  if (prefs.live && window.EventSource) {
    state = "connecting";
    // A refresh interval picked in Settings goes with the stream, and only while this tab is visible: the server drops it when the stream closes.
    es = new EventSource("/api/events" + (prefs.refresh && !document.hidden ? "?interval=" + prefs.refresh : ""));
    es.onopen = () => { state = "live"; liveLabel(); };
    es.onmessage = () => {
      if (document.hidden) stale = true;
      else syncSoon();
    };
    es.onerror = () => { state = "connecting"; liveLabel(); pollCountdown(); }; // the browser reconnects by itself
    es.addEventListener("pypi", () => { if (document.hidden) stale = true; else void pypiSync(); });
    es.addEventListener("poll", (e) => { try { const p = JSON.parse(e.data); countdown(p.left, p.wait); setChecked(p.checkedAgo); } catch (err) { /* a bad event: keep the line */ } });
  }
  if (!prefs.live) countdown(0, 0);
  liveLabel();
}
// The countdown pie beside "live, checked": the time to the next walk of the registry (sent on the stream as it is scheduled, so it
// follows UI_POLL_INTERVAL, the burst during a push and the back-off), or to the next fallback poll while the stream is down.
// The accent slice shrinks clockwise and the refresh comes when it is gone. With reduced motion it moves in one-second steps.
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
let tickTimer = 0;
function countdown(left, wait) { // seconds
  const pie = $("tick");
  clearInterval(tickTimer);
  pie.hidden = !prefs.live || !(wait > 0);
  if (pie.hidden) return;
  const end = Date.now() + left * 1000, part = () => Math.min(1, Math.max(0, end - Date.now()) / 1000 / wait);
  const draw = () => { pie.style.setProperty("--p", part()); if (!part()) clearInterval(tickTimer); };
  draw();
  tickTimer = setInterval(draw, reducedMotion.matches ? 1000 : 100);
}
let pollTimer = 0, pollNext = 0;
const pollSecs = () => Math.max(5, prefs.interval);
const pollCountdown = () => { if (state !== "live") countdown(Math.max(0, pollNext - Date.now()) / 1000, pollSecs()); };
function startPoll() { // the fallback while the stream is down, every `interval` seconds. Restarted when the interval changes.
  clearInterval(pollTimer);
  pollNext = Date.now() + 1000 * pollSecs();
  pollCountdown();
  pollTimer = setInterval(async () => {
    pollNext = Date.now() + 1000 * pollSecs();
    pollCountdown();
    if (!prefs.live || document.hidden || modalOpen()) return;
    if (state === "live") return;
    try { const r = await api("/api/recent?limit=1"); setChecked(r.checkedAgo); if (r.seq !== lastSeq) void sync(); } catch (e) { /* shown by the next sync() */ }
    if (cfg.pypi && !pypi.denied) try { const r = await api("/api/pypi/seq"); if (r.seq !== pypi.seq) void pypiSync(); } catch (e) { /* shown by the next pypiSync() */ }
  }, 1000 * pollSecs());
}
document.addEventListener("visibilitychange", () => { if (prefs.refresh && prefs.live) startLive(); }); // ask for the interval only while visible
document.addEventListener("visibilitychange", () => { if (!document.hidden && stale) { stale = false; void sync(); void pypiSync(); } });

// ---- Copy to / Move to: source card, destination repository and tag, a folder picker, promote chips and a preview -----------------
// The same name rules as the server (registry.py), so a bad name is caught while typing. The server stays the authority.
const REPO_PART = /^[a-z0-9]+(?:(?:\.|_|__|-+)[a-z0-9]+)*$/;
const TAG_NAME = /^\w[\w.-]{0,127}$/;
const DIGEST_REF = /^(?:sha256:[a-f0-9]{64}|sha512:[a-f0-9]{128})$/;
function repoError(path) {
  if (!path) return "Enter a destination repository.";
  if (path.length > 255 || !path.split("/").every((p) => REPO_PART.test(p))) return "Use lowercase letters, digits and . _ - in each part, parts separated by /.";
  return "";
}
const tagError = (t) => (TAG_NAME.test(t) || DIGEST_REF.test(t) ? "" : "A tag starts with a letter, digit or _ and holds letters, digits, . _ and - (up to 128).");
let pickerSync = null; // set while the dialog is open, so live changes to the catalog reach its picker

// The card at the top of the transfer and delete dialogs: what is being acted on.
function sourceCard(o, copyDigest) {
  const [platforms, sizeText] = o.m ? detailCells(o.m) : ["", ""];
  const digest = copyDigest ? copyValue(o.digest, "Copy digest", short(o.digest) + "...") : el("span", { textContent: short(o.digest) + "..." });
  return el("div", { className: "srccard" },
    el("div", { className: "srcname" }, el("span", { className: "ico" }, icon("whale", "whale")), el("code", { textContent: `${o.repo}:${o.ref}` })),
    el("div", { className: "srcmeta mut" }, digest, ...(platforms ? [el("span", { textContent: platforms })] : []), ...(sizeText ? [el("span", { textContent: sizeText })] : [])));
}

// The same delete as a call to this UI's own API, for a script. The repository and digest are checked first, so nothing odd is put in the command.
// It is the UI's origin on purpose: the call keeps every guard of the button. The registry's own DELETE is not shown.
function deleteScript(repo, digest, children) {
  const origin = location.origin;
  if (origin === "null" || repoError(repo) || !DIGEST_REF.test(digest)) return null;
  const body = `{"repo":"${repo}","digest":"${digest}"${children ? ',"children":true' : ""}}`;
  return [`TOKEN=$(curl -s "${origin}/api/config" | jq -r .csrf)`,
    `curl -X POST "${origin}/api/delete" -H "Origin: ${origin}" -H "X-CSRF-Token: $TOKEN" -H 'Content-Type: application/json' -d '${body}'`];
}
function scriptSection(o, children) { // children: a function that says whether the platform images switch is on
  const holder = el("div");
  const draw = () => {
    const lines = deleteScript(o.repo, o.digest, children());
    holder.replaceChildren(...(lines ? [codeBlock("Delete from a script", lines)] : []));
  };
  draw();
  const box = el("details", { className: "script" }, el("summary", { textContent: "Delete from a script" }),
    el("p", { className: "mut", textContent: "The call keeps the same guards as the button: the CSRF token, read-only mode and the refusal to delete a child of an index. With an auth override in front of the UI it needs credentials too." }), holder);
  box.redraw = draw;
  return box;
}

// The tags of one bulk delete in calls of at most `max` (the server's cap). Indexes go first, so a platform child is not refused
// while its index waits in a later call, and every tag of one digest stays in one call, so the later ones are not reported as skipped.
function batches(picked, max) {
  const groups = new Map();
  for (const t of [...picked].sort((a, b) => (b.index ? 1 : 0) - (a.index ? 1 : 0))) groups.set(t.digest, [...(groups.get(t.digest) || []), t]);
  const out = [];
  for (const g of groups.values()) {
    for (let i = 0; i < g.length; i += max) {
      const part = g.slice(i, i + max);
      if (!out.length || out.at(-1).length + part.length > max) out.push([]);
      out.at(-1).push(...part);
    }
  }
  return out;
}
// Delete several tags: one confirm that lists them and the other tags that share their digests, calls of at most the server's cap,
// then what happened to each. A call that fails stops the rest, and what went before it is still reported.
async function deleteTags(n, picked) {
  const v = await confirmDeleteTags(n, picked);
  if (!v) return;
  const parts = batches(picked, cfg.maxBatch || 100), results = [];
  try {
    for (const [i, part] of parts.entries()) {
      banner(goneVerb(plural(picked.length, "tag")) + (parts.length > 1 ? ` (call ${i + 1} of ${parts.length})` : ""));
      results.push(...(await api("/api/delete-tags", { repo: n.path, tags: part.map((t) => t.tag), children: v.children })).results);
    }
    banner("");
  } catch (e) {
    banner(e.message, true);
    if (!results.length) return;
  }
  // Both the Tags and the Storage tab pick tags; a failed tag stays picked in each, to retry or look at
  for (const id of ["tags:", "rstor:"]) for (const r of results) if (r.status !== "failed") stateOf(id + n.path).picked?.delete(r.tag);
  await touch(n.path).catch(() => { /* the next sync shows it */ });
  await deleteResults(n.path, results, "tag");
  await renderPane();
  $("main").querySelector(".bulk button:not(:disabled), .pick input")?.focus();
}
const MAX_NAMED = 30; // tag names shown in a dialog before "and N more"
function chipsOf(tags) {
  const shown = tags.slice(0, MAX_NAMED).map((t) => el("span", { className: "tagchip", textContent: t }));
  return el("div", { className: "tagchips" }, ...shown, ...(tags.length > MAX_NAMED ? [el("span", { className: "mut", textContent: `and ${tags.length - MAX_NAMED} more` })] : []));
}
const namesOf = (tags) => tags.slice(0, MAX_NAMED).join(", ") + (tags.length > MAX_NAMED ? ` and ${tags.length - MAX_NAMED} more` : "");
// What deleting by digest does to the tag list the pane holds: tags not picked that go too, and picked tags that share one digest.
function sharedDigests(n, picked) {
  const names = new Set(picked.map((t) => t.tag)), digests = new Set(picked.map((t) => t.digest));
  const extra = n.tagList.filter((t) => digests.has(t.digest) && !names.has(t.tag)).map((t) => t.tag);
  const per = new Map();
  for (const t of picked) per.set(t.digest, [...(per.get(t.digest) || []), t.tag]);
  return { extra, groups: [...per.values()].filter((g) => g.length > 1) };
}
// Resolves to {children} or null.
function confirmDeleteTags(n, picked) {
  return new Promise((resolve) => {
    let result = null, children = false;
    const { extra, groups } = sharedDigests(n, picked);
    const anyIndex = picked.some((t) => t.index);
    const sw = el("button", { type: "button", role: "switch", className: "switch", "aria-labelledby": "b-sw", "aria-checked": "false",
      onclick: () => { children = !children; sw.setAttribute("aria-checked", String(children)); } });
    const total = picked.length + extra.length;
    const go = el("button", { type: "button", className: "primary dangerfill", textContent: `Delete ${plural(picked.length, "tag")}` });
    go.onclick = () => { result = { children }; dlg.close(); };
    const cancel = el("button", { type: "button", textContent: "Cancel", onclick: () => dlg.close() });
    const warn = [];
    // Every tag in the repository goes (select all is one click away): the name has to be typed before Delete is enabled.
    const everything = total > 1 && total >= n.tagList.length;
    const typed = el("input", { type: "text", autocomplete: "off", spellcheck: false, "aria-label": `Type ${n.path} to confirm`, oninput: () => { go.disabled = typed.value.trim() !== n.path; } });
    if (everything) {
      go.disabled = true;
      warn.push(el("p", { className: "dlg-warn", role: "alert", textContent: `This deletes every tag in ${n.path} (${plural(total, "tag")}), so nothing is left in the repository.` }),
        el("label", { className: "confirmname" }, "Type ", el("code", { textContent: n.path }), " to confirm ", typed));
    }
    if (extra.length) warn.push(el("p", { className: "dlg-warn", role: "alert", textContent: `The registry deletes by digest, so ${plural(extra.length, "tag")} you did not select ${extra.length === 1 ? "goes" : "go"} too, sharing a digest with a selected tag: ${namesOf(extra)}.` }));
    for (const g of groups.slice(0, 5)) warn.push(el("p", { className: "dlg-warn", textContent: `${g.length === 2 ? g.join(" and ") : namesOf(g)} share one digest. It is deleted once, and each of them is reported deleted.` }));
    if (groups.length > 5) warn.push(el("p", { className: "dlg-warn", textContent: `${groups.length - 5} more groups of selected tags share a digest.` }));
    const dlg = el("dialog", { className: "settings transfer", "aria-labelledby": "b-title", "aria-describedby": "b-scope" },
      el("div", { className: "shead" }, el("h2", { id: "b-title", textContent: `Delete ${plural(picked.length, "tag")}` }),
        el("button", { type: "button", className: "iconbtn", "aria-label": "Close", onclick: () => dlg.close() }, icon("close"))),
      el("div", { className: "sbody" },
        el("div", { className: "srccard" }, el("div", { className: "srcname" }, el("span", { className: "ico" }, icon("whale", "whale")), el("code", { textContent: n.path })),
          el("div", { className: "srcmeta mut" }, el("span", { textContent: `${plural(picked.length, "tag")} selected` }), el("span", { textContent: `${plural(new Set(picked.map((t) => t.digest)).size, "digest")}` }), el("span", { textContent: `${plural(total, "tag")} removed in all` }))),
        ...warn,
        el("p", { className: "scope", id: "b-scope", textContent: `Deletes the manifest of each tag from ${n.path} only, with the same checks as a single delete. Other repositories are not affected.` }),
        el("div", { className: "xlabel", textContent: "Selected tags" }), chipsOf(picked.map((t) => t.tag)),
        ...(anyIndex ? [el("div", { className: "srow" }, switchLabel(sw, el("div", { className: "slabel", id: "b-sw", textContent: "Also delete platform images" }),
          el("div", { className: "sdesc", textContent: "For each selected index, the children that no other tag in this repository uses." })), el("div", { className: "sctl" }, sw))] : []),
        el("p", { className: "mut", textContent: "A tag whose manifest a tagged index uses as a platform is refused and reported, as a single delete is. " + binNote() + "Disk space is freed by garbage collection, not by this action." })),
      el("div", { className: "sfoot" }, cancel, go));
    dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
    dlg.addEventListener("close", () => { dlg.remove(); resolve(result); });
    document.body.append(dlg);
    dlg.showModal();
    cancel.focus(); // several manifests go at once: Enter does not delete
  });
}
const RESULT_TEXT = { deleted: "Deleted", failed: "Failed", skipped: "Skipped" };
const RESULT_CLASS = { deleted: "new", failed: "deleted", skipped: "mut" };
function resultDetail(r) {
  if (r.error) return r.error;
  if (r.detail) return r.detail;
  if (r.with) return `Same digest as ${r.with}`;
  return r.deleted?.length > 1 ? `${short(r.digest)}, and ${plural(r.deleted.length - 1, "platform image")}` : short(r.digest);
}
function deleteResults(repo, results, noun) {
  const Noun = noun[0].toUpperCase() + noun.slice(1);
  return new Promise((resolve) => {
    const n = (s) => results.filter((r) => r.status === s).length;
    const close = el("button", { type: "button", className: "primary", textContent: "Close", onclick: () => dlg.close() });
    const rows = results.map((r) => el("tr", {}, el("td", {}, code(r.tag)), el("td", {}, el("span", { className: "badge " + RESULT_CLASS[r.status], textContent: RESULT_TEXT[r.status] })), el("td", { className: "mut", textContent: resultDetail(r) })));
    const dlg = el("dialog", { className: "settings transfer", "aria-labelledby": "r-title", "aria-describedby": "r-sum" },
      el("div", { className: "shead" }, el("h2", { id: "r-title", textContent: n("failed") ? `Some ${noun}s were not deleted` : `${Noun}s deleted` }),
        el("button", { type: "button", className: "iconbtn", "aria-label": "Close", onclick: () => dlg.close() }, icon("close"))),
      el("div", { className: "sbody" },
        el("p", { className: "scope", id: "r-sum", textContent: `${repo}: ${n("deleted")} deleted, ${n("failed")} failed, ${n("skipped")} skipped.` }),
        el("table", { className: "results" }, el("thead", {}, el("tr", {}, el("th", { textContent: Noun }), el("th", { textContent: "Result" }), el("th", { textContent: "Detail" }))), el("tbody", {}, ...rows))),
      el("div", { className: "sfoot" }, el("span"), close));
    dlg.addEventListener("close", () => { dlg.remove(); resolve(); });
    document.body.append(dlg);
    dlg.showModal();
    close.focus();
  });
}

// Delete: says what goes and what does not. o: {repo, ref, digest, m (a fresh manifest, with its tags), block, info (the /api/parents answer)}.
// Resolves to {children} or null.
function confirmDelete(o) {
  return new Promise((resolve) => {
    let result = null, children = false;
    const m = o.m, isIndex = !!m.index, removable = o.info ? o.info.removable : 0;
    const others = tree.names.filter((p) => p !== o.repo);
    const example = others.find((p) => p.split("/")[0] !== o.repo.split("/")[0]) || others[0];
    const suchAs = example ? ", such as " + example : "";
    const sw = el("button", { type: "button", role: "switch", className: "switch", "aria-labelledby": "d-sw", "aria-checked": "false", disabled: !removable,
      onclick: () => { children = !children; sw.setAttribute("aria-checked", String(children)); script.redraw(); } });
    const script = scriptSection(o, () => children);
    const go = el("button", { type: "button", className: "primary dangerfill", textContent: "Delete", disabled: !!o.block });
    go.onclick = () => {
      if (go.disabled) return;
      result = { children };
      dlg.close();
    };
    const dlg = el("dialog", { className: "settings transfer", "aria-labelledby": "d-title" },
      el("div", { className: "shead" }, el("h2", { id: "d-title", textContent: "Delete manifest" }),
        el("button", { type: "button", className: "iconbtn", "aria-label": "Close", onclick: () => dlg.close() }, icon("close"))),
      el("div", { className: "sbody" },
        sourceCard(o, true),
        ...(o.block ? [el("p", { className: "dlg-warn", role: "alert", textContent: o.block })] : []),
        el("p", { className: "scope", textContent: `Deletes this manifest from ${o.repo} only. Other repositories${suchAs}, are not affected, even if they hold the same image.` }),
        el("div", { className: "xlabel", textContent: "Tags removed with it" }),
        el("div", { className: "tagchips" }, ...(m.tags.length ? m.tags.map((t) => el("span", { className: "tagchip", textContent: t })) : [el("span", { className: "mut", textContent: "none, this digest has no tag" })])),
        ...(isIndex ? [el("div", { className: "srow" }, switchLabel(sw, el("div", { className: "slabel", id: "d-sw", textContent: "Also delete platform images" }),
          el("div", { className: "sdesc", textContent: removable ? `Index children that no other tag in this repository uses. ${removable} of ${o.info.children} would be removed.` : "Every child is used by another tag in this repository, so none would be removed." })), el("div", { className: "sctl" }, sw))] : []),
        el("p", { className: "mut", textContent: binNote() + "Disk space is freed by garbage collection, not by this action." }), script),
      el("div", { className: "sfoot" }, el("button", { type: "button", textContent: "Cancel", onclick: () => dlg.close() }), go));
    dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
    dlg.addEventListener("close", () => { dlg.remove(); resolve(result); });
    document.body.append(dlg);
    dlg.showModal();
    (o.block ? dlg.querySelector(".sfoot button") : go).focus(); // never land on Delete by default when it is blocked
  });
}

// The destination folder picker: folders and repositories from the main tree's data, no tags. Click selects, the chevron opens.
function createPicker(st, onChoose) {
  const open = new Set(); // ids of open folders
  let focusId = null;
  const box = el("div", { className: "picker", role: "tree", "aria-label": "Folders and repositories" });
  // The node st.path names, else the folder it would go inside (a picked folder takes the source name, a path not there yet).
  const chosen = () => tree.byPath.get(st.path) || tree.byPath.get(st.path.slice(0, st.path.lastIndexOf("/")));
  const flat = () => {
    const out = [];
    const walk = (n, depth, anc, last) => {
      out.push({ n, depth, anc, last });
      if (!open.has(n.id)) return;
      const k = visibleKids(n);
      const below = depth === 0 ? [] : [...anc, !last];
      k.forEach((c, i) => walk(c, depth + 1, below, i === k.length - 1));
    };
    const top = visibleKids(tree.root);
    top.forEach((n, i) => walk(n, 0, [], i === top.length - 1));
    return out;
  };
  const rowFor = (r) => {
    const n = r.n, isOpen = open.has(n.id);
    const row = el("div", {
      className: "row", role: "treeitem", id: "px-" + n.id, tabIndex: n.id === focusId ? 0 : -1,
      "aria-level": r.depth + 1, "aria-selected": String(n === chosen()),
    }, ...guidesFor(r), el("span", { className: "chev" }, n.kids.size ? icon("chev") : null), icon(n.repo ? "repo" : isOpen ? "folderOpen" : "folder"), el("span", { className: "lbl", textContent: n.name }));
    row.dataset.id = n.id;
    if (n.kids.size) row.setAttribute("aria-expanded", String(isOpen));
    return row;
  };
  const draw = () => {
    const hadFocus = box.contains(document.activeElement);
    const rows = flat(), ids = rows.map((r) => r.n.id);
    const sel = tree.byPath.get(st.path);
    if (!ids.includes(focusId)) focusId = ids.includes(sel?.id) ? sel.id : ids[0];
    box.replaceChildren(...rows.map((r) => rowFor(r)));
    if (hadFocus) $("px-" + focusId)?.focus();
  };
  const reveal = (path) => { // open every existing folder above the longest existing prefix of path
    for (let q = path; q; q = q.includes("/") ? q.slice(0, q.lastIndexOf("/")) : "") {
      const n = tree.byPath.get(q);
      if (!n) continue;
      for (let x = n.parent; x && x !== tree.root; x = x.parent) open.add(x.id);
      return;
    }
  };
  const show = (node) => { // highlight node (if any), open the way to the path and scroll to it
    reveal(st.path);
    if (node) focusId = node.id;
    draw();
    $("px-" + node?.id)?.scrollIntoView({ block: "nearest" });
  };
  const nodeOf = (target) => { const r = target.closest(".row[data-id]"); return r && tree.byId.get(r.dataset.id); };
  const setOpen = (n, value) => {
    if (value) {
      open.add(n.id);
    } else {
      open.delete(n.id);
    }
    focusId = n.id;
    draw();
  };
  const ops = { expandable: (n) => n.kids.size > 0, isOpen: (n) => open.has(n.id), setOpen };
  box.addEventListener("click", (e) => {
    const n = nodeOf(e.target);
    if (!n) return;
    focusId = n.id; // else the redraw puts focus, and the scroll, back on the row focused before
    if (e.target.closest(".chev")) setOpen(n, !open.has(n.id)); // a click on a repository only selects, on a folder it also opens
    else {
      if (!n.repo) open.add(n.id);
      onChoose(n);
    }
  });
  box.addEventListener("keydown", (e) => {
    const n = nodeOf(e.target);
    if (!n) return;
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); focusId = n.id; onChoose(n); return; }
    const list = flat(), to = arrowTarget(e.key, list, list.findIndex((r) => r.n === n), ops);
    if (to === undefined) return;
    e.preventDefault();
    if (to && to !== tree.root) { focusId = to.id; draw(); $("px-" + to.id)?.focus(); }
  });
  return { box, show };
}

// The promote shortcuts. UI_ENVIRONMENTS is an ordered list of lifecycle stages, each a path prefix (prod, or team-a/prod). A chip
// replaces the stage prefix of the source with its own. A stage with no repositories yet is still offered, marked new.
const stageList = () => cfg.environments || [];
function stageOf(path) { // the longest stage that path is, or sits under
  const hits = stageList().filter((s) => path === s || path.startsWith(s + "/"));
  return hits.sort((a, b) => b.length - a.length)[0] || null;
}
const stageHasRepos = (s) => tree.names.some((p) => p === s || p.startsWith(s + "/"));
function stageChip(stage, o, from, next, st, focusStage) {
  const empty = !stageHasRepos(stage);
  return el("button", {
    type: "button", className: "chip" + (empty ? " empty" : ""), disabled: stage === from, tabIndex: stage === focusStage ? 0 : -1,
    "aria-pressed": String(stage === stageOf(st.path)), "aria-label": stage + (empty ? ", no repositories yet" : "") + (stage === next ? ", next stage" : ""), // for screen readers, nothing extra on screen
  }, stage);
}
function createChips(st, o, onPick) {
  const box = el("div", { className: "chips", role: "group", "aria-label": "Promote to" });
  const wrap = el("div", { className: "xchips" }, el("span", { className: "xlabel", textContent: "Promote to" }), box);
  const from = stageOf(o.repo), stages = stageList();
  wrap.hidden = !from;
  const draw = () => {
    if (!from) return;
    const next = stages[stages.indexOf(from) + 1];
    const focusStage = next ?? stages.find((s) => s !== from); // the next stage is where Tab lands
    box.replaceChildren(...stages.map((s) => stageChip(s, o, from, next, st, focusStage)));
  };
  box.addEventListener("click", (e) => {
    const stage = e.target.closest(".chip")?.firstChild?.textContent;
    if (stage && stage !== from) onPick(stage + o.repo.slice(from.length));
  });
  box.addEventListener("keydown", (e) => {
    const d = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
    const chips = [...box.querySelectorAll(".chip:not(:disabled)")], i = chips.indexOf(document.activeElement);
    if (!d || i < 0) return;
    e.preventDefault();
    chips.forEach((c) => { c.tabIndex = -1; });
    const to = chips[(i + d + chips.length) % chips.length];
    to.tabIndex = 0;
    to.focus();
  });
  return { wrap, draw };
}

const destError = (o, path) => repoError(path) || (o.move && path === o.repo ? "Move needs a different repository than the source." : "");
// What the destination tag says: an error, or a warning when the tag is already there, and whether that blocks the action.
function tagNote(o, st, node, dstErr, tErr) {
  if (tErr) return { cls: "xerr", text: tErr, block: true };
  if (dstErr) return null;
  if (!o.move && st.path === o.repo && st.tag === o.ref) return { cls: "xerr", text: "The destination is the source.", block: true };
  const there = node?.repo ? node.tagMap.get(st.tag) : null;
  if (!there) return null;
  const name = `${st.path}:${st.tag}`;
  if (there.digest !== o.digest) return { cls: "xwarn", text: `${name} exists (${short(there.digest)}...). ${o.move ? "Moving" : "Copying"} replaces it.` };
  if (o.move) return { cls: "xwarn", text: `${name} already holds this digest. Only the source is removed.` };
  return { cls: "xwarn", text: `${name} is already identical, nothing to copy.`, block: true };
}
function pathBadge(o, path, dstErr, node) {
  if (dstErr) return el("span", { className: "xerr", textContent: dstErr });
  if (node && folderLike(node)) return el("span", { className: "xwarn", textContent: `${path} is a folder. ${o.move ? "Moving" : "Copying"} here makes a repository named ${path} beside what it holds.` });
  const exists = !!node?.repo;
  return el("span", { className: "tagbadge" + (exists ? "" : " new"), textContent: exists ? "existing repository" : "new repository" });
}
function transferLead(o) {
  if (!o.move) return "Blobs are mounted, so no data is uploaded.";
  const goes = o.sharing.length ? ` Tags that go with it: ${o.sharing.join(", ")}.` : "";
  return "The source digest is deleted after the copy is verified." + goes;
}
function previewEls(err, ref) {
  return [el("span", { className: "mut", textContent: "Result" }), err ? el("span", { className: "mut", textContent: "Fix the errors above." }) : copyValue(ref, "Copy resulting reference")];
}

// o: {move, repo, ref, digest, m (manifest), sharing (tags that go with the digest), block (why a move is refused, or "")}.
// Resolves to {dst, dstRef} or null.
function transfer(o) {
  return new Promise((resolve) => {
    const verb = o.move ? "Move" : "Copy";
    const st = { path: o.repo, tag: o.ref };
    let result = null;
    const pathIn = el("input", { type: "text", className: "xin", id: "x-path", value: st.path, autocomplete: "off", spellcheck: false, "aria-describedby": "x-pathstat" });
    const tagIn = el("input", { type: "text", className: "xin", id: "x-tag", value: st.tag, autocomplete: "off", spellcheck: false, "aria-describedby": "x-tagstat" });
    const pathStat = el("span", { id: "x-pathstat", "aria-live": "polite" });
    const tagStat = el("span", { id: "x-tagstat", "aria-live": "polite" });
    const preview = el("div", { className: "preview" });
    const go = el("button", { type: "button", className: "primary", textContent: verb });
    const setPath = (path) => { st.path = path; pathIn.value = path; update(); };
    const picker = createPicker(st, (n) => setPath(n.repo ? n.path : `${n.path}/${o.repo.split("/").pop()}`)); // a folder takes the source name inside it
    const chips = createChips(st, o, setPath);
    function update() {
      const dstErr = destError(o, st.path), tErr = tagError(st.tag);
      const node = tree.byPath.get(st.path), exists = !dstErr && !!node?.repo;
      // The destination exists but its tag list has not loaded yet, so whether the tag is taken is unknown. Block until it is,
      // otherwise a fast click copies or moves onto an existing tag with no warning.
      const pending = exists && !node.fresh && !tErr;
      const note = tagNote(o, st, node, dstErr, tErr);
      pathStat.replaceChildren(pathBadge(o, st.path, dstErr, node));
      tagStat.replaceChildren(...(pending ? [el("span", { className: "mut", textContent: "Checking the destination..." })]
        : note ? [el("span", { className: note.cls, textContent: note.text })] : []));
      go.disabled = !!(o.block || dstErr || note?.block || pending);
      preview.replaceChildren(...previewEls(dstErr || tErr, `${cfg.registryHost || "<REGISTRY>"}/${st.path}:${st.tag}`));
      if (exists && !node.fresh) void ensureTags(node).then(update); // the tags of an existing destination, to tell whether the tag is taken
      chips.draw();
      picker.show(dstErr ? null : node);
    }
    pickerSync = update;
    pathIn.oninput = () => { st.path = pathIn.value.trim(); update(); };
    tagIn.oninput = () => { st.tag = tagIn.value.trim(); update(); };
    const confirm = () => {
      if (go.disabled) return;
      result = { dst: st.path, dstRef: st.tag };
      dlg.close();
    };
    go.onclick = confirm;
    for (const i of [pathIn, tagIn]) i.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); confirm(); } });
    const lead = transferLead(o);
    const dlg = el("dialog", { className: "settings transfer", "aria-labelledby": "x-title" },
      el("div", { className: "shead" }, el("h2", { id: "x-title", textContent: verb + " to..." }),
        el("button", { type: "button", className: "iconbtn", "aria-label": "Close", onclick: () => dlg.close() }, icon("close"))),
      el("div", { className: "sbody" },
        sourceCard(o, false),
        ...(o.block ? [el("p", { className: "dlg-warn", role: "alert", textContent: o.block })] : []),
        el("p", { className: "mut", textContent: lead }),
        el("div", { className: "xpair" }, // repository and tag side by side, as they read in the result
          el("label", { className: "xlabel", htmlFor: "x-path", textContent: "Destination repository" }), el("span"), el("label", { className: "xlabel", htmlFor: "x-tag", textContent: "Tag" }),
          pathIn, el("span", { className: "xcolon", textContent: ":" }), tagIn),
        el("div", { className: "xstat" }, pathStat, tagStat), picker.box, chips.wrap,
        preview),
      el("div", { className: "sfoot" }, el("button", { type: "button", textContent: "Cancel", onclick: () => dlg.close() }), go));
    dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
    dlg.addEventListener("close", () => { pickerSync = null; dlg.remove(); resolve(result); });
    document.body.append(dlg);
    update();
    dlg.showModal();
    pathIn.focus();
    pathIn.select();
  });
}

// ---- Help: how to free disk space with garbage collection, and the keys. Room for more sections later. -------------------------------
// The same registry:2 digest as compose.yml. The command is shown for the host to run, never run from here, and never with --delete-untagged
// (in registry:2.8 it deletes the child manifests of multi-arch images).
const REGISTRY_IMAGE = "registry:2@sha256:a3d8aaa63ed8681a604f1dea0aa03f100d5895b6a58ace528858a7b332415373";
function gcCommand(tool, storage, dry) {
  return `${tool} run --rm -v ${storage}:/var/lib/registry:Z ${REGISTRY_IMAGE} registry garbage-collect${dry ? " --dry-run" : ""} /etc/docker/registry/config.yml`;
}
// The same in a running compose service, by its name (UI_REGISTRY_SERVICE).
function composeGcCommand(compose, service, dry) {
  return `${compose} exec ${service} registry garbage-collect${dry ? " --dry-run" : ""} /etc/docker/registry/config.yml`;
}
let gcForm = null; // run (a container of its own) or compose, for this page's life
function gcSteps(tool, storage) {
  if (gcForm === "run") {
    return [el("li", { textContent: "Stop the registry the way you normally do (systemd, compose or Quadlet)." }),
      el("li", {}, "Dry run, which lists what would be deleted.", codeBlock("Dry run", [gcCommand(tool, storage, true)])),
      el("li", {}, "Collect.", codeBlock("Collect", [gcCommand(tool, storage, false)])),
      el("li", { textContent: "Start the registry again." })];
  }
  const compose = tool === "docker" ? "docker compose" : "podman-compose", service = cfg.registryService || "<registry-service>";
  return [el("li", { textContent: "Make sure nothing pushes while it runs: this collects inside the running registry, and a push in progress can lose layers." }),
    el("li", {}, "Dry run, which lists what would be deleted.", codeBlock("Dry run", [composeGcCommand(compose, service, true)])),
    el("li", {}, "Collect.", codeBlock("Collect", [composeGcCommand(compose, service, false)])),
    el("li", {}, "Restart the registry, so it forgets the deleted blobs it has cached.", codeBlock("Restart", [`${compose} restart ${service}`]))];
}
function gcSection() {
  const box = el("div", { className: "gcsteps" });
  const draw = () => {
    const storage = cfg.registryStorage || "<registry-storage>";
    const tool = prefs.runtime;
    gcForm ??= cfg.registryService ? "compose" : "run";
    const seg = el("div", { className: "seg", role: "group", "aria-label": "Command line tool" }, ...CHOICES.runtime.map((rt) => el("button", {
      type: "button", textContent: rt, "aria-pressed": String(rt === tool), onclick: () => { applyPrefs({ runtime: rt }); draw(); },
    })));
    const form = el("div", { className: "seg", role: "group", "aria-label": "How the registry runs" }, ...[["run", "Container"], ["compose", "Compose"]].map(([k, text]) => el("button", {
      type: "button", textContent: text, "aria-pressed": String(k === gcForm), onclick: () => { gcForm = k; draw(); },
    })));
    const hints = [];
    if (gcForm === "compose" && !cfg.registryService) hints.push("UI_REGISTRY_SERVICE is not set, so the commands have the placeholder <registry-service>. Replace it with the compose service name of the registry, or set UI_REGISTRY_SERVICE.");
    if (!cfg.registryStorage) hints.push("UI_REGISTRY_STORAGE is not set, so the command has the placeholder <registry-storage>. Replace it with the host path or volume name of the registry data, or set UI_REGISTRY_STORAGE.");
    box.replaceChildren(
      el("p", { textContent: "Garbage collection frees disk space from deleted images. It runs on the host, not from this page." }),
      el("div", { className: "segs" }, form, seg),
      el("ol", { className: "steps" }, ...gcSteps(tool, storage)),
      ...(cfg.binDays ? [el("p", { className: "mut", textContent: "Deleted tags wait in the Bin. Their layers stay in the registry until this runs, so run it after emptying the Bin: a layer it frees can no longer be restored." })] : []),
      el("p", { className: "mut", textContent: "Never add --delete-untagged: it deletes the child manifests of multi-arch images and breaks them." }),
      el("p", { className: "slabel", textContent: "Remove an empty repository (registry stopped)" }),
      el("p", { className: "mut", textContent: "The registry API cannot delete a repository, and garbage collection leaves its empty directory behind. With the registry stopped, remove the directory yourself:" }),
      codeBlock("Remove an empty repository", [rmRepoCommand("<repo>")]),
      ...hints.map((h) => el("p", { className: "hint", textContent: h })));
  };
  draw();
  return el("section", {}, el("h3", { className: "ssec", textContent: "Garbage collection" }), box);
}
const SHORTCUTS = [
  ["Up, Down", "Move through the tree"], ["Right", "Open a folder, repository or tag, then move to its first child"], ["Left", "Close it, then move to its parent"],
  ["Home, End", "First or last row"], ["Enter, Space", "Select the row and show its details"], ["Esc", "Close a panel, or the tree on a phone"],
];
function shortcutsSection() {
  return el("section", {}, el("h3", { className: "ssec", textContent: "Shortcuts" }),
    el("table", { className: "keys" }, ...SHORTCUTS.map(([k, what]) => el("tr", {}, el("th", {}, el("kbd", { textContent: k })), el("td", { textContent: what })))));
}
function helpPanel() {
  const dlg = el("dialog", { className: "settings help", "aria-labelledby": "h-title" },
    el("div", { className: "shead" }, el("h2", { id: "h-title", textContent: "Help" }),
      el("button", { type: "button", className: "iconbtn", "aria-label": "Close help", onclick: () => dlg.close() }, icon("close"))),
    el("div", { className: "sbody" }, gcSection(), shortcutsSection()),
    el("div", { className: "sfoot" }, el("span"), el("button", { type: "button", className: "primary", textContent: "Done", onclick: () => dlg.close() })));
  dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
  dlg.addEventListener("close", () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
}

// ---- Settings: one panel, changes apply as you make them ----------------------------------------------------------------
const SETTING_KEYS = ["theme", "runtime", "tool", "os", "show", "repoSort", "tagSort", "packageSort", "live", "refresh", "interval", "pageSize", "showEmpty", "treeSizes", "notify"];
const SORT_KEYS = ["repoSort", "tagSort", "packageSort"];
function segmented(labelId, options, key, apply) { // options: [value, text, iconName?]. Arrow keys move and select, like radio buttons.
  const box = el("div", { className: "seg", role: "radiogroup", "aria-labelledby": labelId });
  const draw = () => box.replaceChildren(...options.map(([v, text, ico]) => el("button", {
    type: "button", role: "radio", tabIndex: v === prefs[key] ? 0 : -1, "aria-checked": String(v === prefs[key]),
    onclick: () => { apply({ [key]: v }); },
    onkeydown: (e) => {
      const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
      if (!d) return;
      e.preventDefault();
      const next = options[(options.findIndex((o) => o[0] === v) + d + options.length) % options.length][0];
      apply({ [key]: next });
      box.querySelector("[aria-checked=true]").focus();
    },
  }, ...(ico ? [icon(ico)] : []), text)));
  box.draw = draw;
  draw();
  return box;
}
function switchEl(labelId, key, apply) {
  const b = el("button", { type: "button", role: "switch", className: "switch", "aria-labelledby": labelId, onclick: () => apply({ [key]: !prefs[key] }) });
  b.draw = () => b.setAttribute("aria-checked", String(prefs[key]));
  b.draw();
  return b;
}
// The label text of a switch row flips the switch too. The button keeps role=switch, so Space and Enter still work on it.
const switchLabel = (sw, ...kids) => el("div", { className: "tap", onclick: () => { if (!sw.disabled) sw.click(); } }, ...kids);
function selectEl(labelId, key, values, text, apply, unusable) { // unusable(v): an option shown but not offered
  const sel = el("select", { "aria-labelledby": labelId, onchange: () => apply({ [key]: +sel.value }) }, ...values.map((v) => el("option", { value: String(v), textContent: text(v), disabled: !!unusable?.(v) })));
  const wrap = el("span", { className: "selwrap" }, sel, icon("chev"));
  wrap.draw = (off = false) => { sel.value = String(prefs[key]); sel.disabled = off; };
  wrap.draw(false);
  return wrap;
}
function lifecycleRow() { // read only: the stages are set by the server
  const stages = stageList();
  return el("div", { className: "srow" }, el("div", {}, el("div", { className: "slabel", textContent: "Lifecycle" }), el("div", { className: "sdesc", textContent: "Set by the server (UI_ENVIRONMENTS)." })),
    el("div", { className: "sctl" }, el("code", { className: "stages", textContent: stages.length ? stages.join(" \u2192 ") : "none" })));
}
function applyPrefs(change) { // save a change and do what it needs, at once
  const before = { ...prefs };
  Object.assign(prefs, change);
  savePrefs();
  if (prefs.theme !== before.theme) applyTheme();
  if (prefs.live !== before.live || prefs.refresh !== before.refresh) startLive();
  if (prefs.interval !== before.interval) startPoll();
  if (prefs.showEmpty !== before.showEmpty || prefs.show !== before.show) { resetHidden(); renderTree(); drawTypes(); }
  if (prefs.treeSizes !== before.treeSizes) renderTree();
  const sorted = SORT_KEYS.some((k) => prefs[k] !== before[k]);
  if (prefs.tagSort !== before.tagSort) for (const n of tree.byPath.values()) sortTags(n);
  if (sorted) renderTree(); // the tree follows the sorts too
  if (sorted || prefs.runtime !== before.runtime || prefs.tool !== before.tool || prefs.os !== before.os || prefs.show !== before.show || prefs.pageSize !== before.pageSize || prefs.showEmpty !== before.showEmpty) { resetShown(); void renderPane(true); }
}
function settings() {
  const controls = [];
  const apply = (change) => {
    applyPrefs(change);
    controls.forEach((c) => c.draw());
    pollCtl.draw(!prefs.live); // the poll only runs while the stream is down, so it means nothing with auto-refresh off
    pollRow.dataset.off = String(!prefs.live);
    refreshCtl.draw(!prefs.live);
    refreshRow.dataset.off = String(!prefs.live);
  };
  const row = (id, label, desc, control) => {
    controls.push(control);
    const text = [el("div", { className: "slabel", id, textContent: label }), el("div", { className: "sdesc", textContent: desc })];
    return el("div", { className: "srow" }, control.getAttribute?.("role") === "switch" ? switchLabel(control, ...text) : el("div", {}, ...text), el("div", { className: "sctl" }, control));
  };
  const section = (title, ...rows) => el("section", {}, el("h3", { className: "ssec", textContent: title }), ...rows);
  // Permission is asked on the click that turns it on, as browsers require. Refused, the switch stays off.
  const notifyCtl = switchEl("s-notify", "notify", async (c) => {
    if (c.notify && Notification.permission !== "granted" && await Notification.requestPermission() !== "granted") { banner("This browser blocks notifications for this page. Allow them in its site settings.", true); return; }
    apply(c);
  });
  notifyCtl.disabled = !canNotify();
  const pollCtl = selectEl("s-poll", "interval", CHOICES.interval, (v) => v + " s", apply);
  const pollRow = row("s-poll", "Poll while disconnected", "Only while the live stream is down: seconds between checks of this page.", pollCtl);
  // Server default is UI_POLL_INTERVAL. A choice can only make the walk faster, and never faster than UI_POLL_MIN.
  const refreshCtl = selectEl("s-refresh", "refresh", CHOICES.refresh, (v) => (v ? v + " s" : `Server default (${cfg.pollInterval} s)`), apply,
    (v) => v && (v >= cfg.pollInterval || v < cfg.pollMin));
  const refreshRow = row("s-refresh", "Refresh interval", "Applies to every viewer while this tab is open.", refreshCtl);
  const dlg = el("dialog", { className: "settings", "aria-labelledby": "s-title" },
    el("div", { className: "shead" }, el("h2", { id: "s-title", textContent: "Settings" }),
      el("button", { type: "button", className: "iconbtn", "aria-label": "Close settings", onclick: () => dlg.close() }, icon("close"))),
    el("div", { className: "sbody" },
      el("p", { className: "mut", textContent: "Saved in this browser only." }),
      section("Appearance", row("s-theme", "Theme", "System, light or dark.", segmented("s-theme", [["system", "System", "monitor"], ["light", "Light", "sun"], ["dark", "Dark", "moon"]], "theme", apply))),
      section("Commands", row("s-rt", "Container tool", "Used in the copyable container commands.", segmented("s-rt", [["podman", "podman"], ["docker", "docker"]], "runtime", apply)),
        ...(cfg.pypi ? [row("s-tool", "Python installer", "Used in the copyable Python commands.", segmented("s-tool", [["pip", "pip"], ["uv", "uv"]], "tool", apply)),
          row("s-os", "Operating system", "Linux and macOS get shell commands, Windows gets PowerShell.", segmented("s-os", [["linux", "Linux/macOS"], ["windows", "Windows"]], "os", apply))] : [])),
      section("Lists", row("s-rsort", "Repositories", "Order of folders and repositories.", segmented("s-rsort", [["name", "Name"], ["recent", "Recent"]], "repoSort", apply)),
        row("s-tsort", "Tags", "Order of a repository's tags. A push is when this UI saw it.", segmented("s-tsort", [["recent", "Recent push"], ["version", "Version"]], "tagSort", apply)),
        ...(cfg.pypi ? [row("s-psort", "Python packages", "Order of packages.", segmented("s-psort", [["name", "Name"], ["recent", "Recent"]], "packageSort", apply))] : []),
        row("s-rows", "Rows per page", "Rows a list shows before Show more.", selectEl("s-rows", "pageSize", CHOICES.pageSize, String, apply)),
        row("s-empty", "Show empty repositories", "Repositories with no tags. The registry cannot delete them.", switchEl("s-empty", "showEmpty", apply)),
        ...(cfg.usage ? [row("s-sizes", "Show sizes in the tree", "The size of each folder and repository, with a bar against the largest. It follows Size by on the Storage map: the total it uses, or the unique bytes only it holds, which deleting it frees.", switchEl("s-sizes", "treeSizes", apply))] : [])),
      section("Lifecycle", lifecycleRow()),
      section("Live updates", row("s-live", "Auto-refresh", "Update the tree and lists as the registry changes.", switchEl("s-live", "live", apply)), refreshRow, pollRow,
        row("s-notify", "Notify on push", canNotify() ? "A desktop notification for each push while this window is not in focus." : "Needs the page on HTTPS or localhost.", notifyCtl))),
    el("div", { className: "sfoot" },
      el("button", { type: "button", className: "linkbtn", textContent: "Reset to defaults", onclick: () => apply(Object.fromEntries(SETTING_KEYS.map((k) => [k, DEFAULTS[k]]))) }),
      el("button", { type: "button", className: "primary", textContent: "Done", onclick: () => dlg.close() })));
  dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); }); // a click on the backdrop
  dlg.addEventListener("close", () => dlg.remove());
  document.body.append(dlg);
  apply({}); // draws the poll row state
  dlg.showModal();
}

// ---- PyPI source: one GitLab group's PyPI packages (server/pypi.py), shown as a second root in the tree ----------------------------
// Nodes: proot (the group), pkg (a project name, as pip normalises it), ver (one version of it, across every GitLab project).
let pypi = { packages: [], seq: 0, group: null, truncated: false, loaded: null, error: "", denied: false };
const pypiFiles = new Map(); // upload id -> files, or a promise while loading
const secs = (iso) => (iso ? Date.parse(iso) / 1000 : null);
const when = (iso, never = "") => (iso ? el("span", { title: new Date(iso).toLocaleString(), textContent: ago(secs(iso)) }) : never);
const uniq = (xs) => [...new Set(xs.filter(Boolean))];
const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;
const shortProject = (p) => p.split("/").pop();
// The sidebar's type filter. Helm charts are in the registry, so that filter shows it too.
const showsType = (t) => prefs.show === "all" || prefs.show === t || (t === "containers" && (prefs.show === "helm" || !cfg.pypi)) || (t === "python" && !cfg.pypi);

// Versions in PEP 440 order: 1.0.dev1 < 1.0a1 < 1.0b2 < 1.0rc1 < 1.0 < 1.0.post1, numeric parts compared as numbers.
const PEP440 = /^v?(?:(\d+)!)?(\d+(?:\.\d+)*)(?:[-_.]?(a|alpha|b|beta|c|rc|pre|preview)[-_.]?(\d*))?(?:-(\d+)|[-_.]?(?:post|rev|r)[-_.]?(\d*))?(?:[-_.]?dev[-_.]?(\d*))?(?:\+[a-z0-9]+(?:[-_.][a-z0-9]+)*)?$/i;
const PRE = { a: 0, alpha: 0, b: 1, beta: 1, c: 2, rc: 2, pre: 2, preview: 2 };
const verKeys = new Map();
function verKey(v) {
  if (verKeys.has(v)) return verKeys.get(v);
  const m = PEP440.exec(v);
  let k = null;
  if (m) {
    const post = m[5] ?? m[6], dev = m[7];
    const pre = m[3] ? [PRE[m[3].toLowerCase()], +(m[4] || 0)] : dev !== undefined && post === undefined ? [-1, 0] : [3, 0];
    k = { epoch: +(m[1] || 0), rel: m[2].split(".").map(Number), rest: [...pre, post === undefined ? -1 : +(post || 0), dev === undefined ? 1 : 0, +(dev || 0)] };
  }
  verKeys.set(v, k);
  return k;
}
function verCompare(a, b) { // ascending; versions pip cannot parse go after those it can
  const x = verKey(a), y = verKey(b);
  if (x && y) return x.epoch - y.epoch || cmpNums(x.rel, y.rel) || cmpNums(x.rest, y.rest) || collator.compare(a, b);
  if (x) return -1;
  if (y) return 1;
  return collator.compare(a, b);
}
const isPre = (v) => { const k = verKey(v); return !!k && (k.rest[0] < 3 || k.rest[3] === 0); }; // a pre-release or dev release

const latestUpload = (rows) => rows.reduce((a, b) => ((b.created || "") > (a.created || "") ? b : a));
// Rebuild packages and versions from the upload list. Nodes keep their identity, so open ones stay open. Returns the ids that are new.
function applyPypi(list, flashNew) {
  const fresh = new Set(), groups = new Map();
  for (const p of list) {
    if (!groups.has(p.key)) groups.set(p.key, []);
    groups.get(p.key).push(p);
  }
  for (const [key, uploads] of groups) {
    let n = tree.byKey.get(key);
    if (!n) {
      n = mk("pkg", "k:" + key, uploads[0].name, tree.proot, { key, versions: new Map() });
      tree.byKey.set(key, n);
      fresh.add(n.id);
    }
    n.uploads = uploads;
    n.name = latestUpload(uploads).name; // the spelling of the newest upload
    const byVer = new Map();
    for (const u of uploads) {
      if (!byVer.has(u.version)) byVer.set(u.version, []);
      byVer.get(u.version).push(u);
    }
    for (const [v, us] of byVer) {
      let vn = n.versions.get(v);
      if (!vn) {
        vn = mk("ver", `v:${key}@${v}`, v, n, { version: v });
        n.versions.set(v, vn);
        fresh.add(vn.id);
      }
      vn.uploads = us.sort((a, b) => (b.created || "").localeCompare(a.created || "") || a.project.localeCompare(b.project));
      vn.created = vn.uploads[0].created;
      vn.downloaded = us.map((u) => u.downloaded).filter(Boolean).sort().pop() || null;
    }
    for (const [v, vn] of n.versions) if (!byVer.has(v)) { n.versions.delete(v); tree.byId.delete(vn.id); }
    n.verList = [...n.versions.values()].sort((a, b) => verCompare(b.version, a.version));
    n.latest = (n.verList.find((x) => !isPre(x.version)) || n.verList[0]).version; // what pip installs without --pre
    n.created = n.uploads.map((u) => u.created).filter(Boolean).sort().pop() || null;
    n.downloaded = n.uploads.map((u) => u.downloaded).filter(Boolean).sort().pop() || null;
    n.projects = [...new Set(n.uploads.map((u) => u.project))].sort();
  }
  for (const [key, n] of tree.byKey) {
    if (!groups.has(key)) { tree.byKey.delete(key); tree.byId.delete(n.id); for (const vn of n.versions.values()) tree.byId.delete(vn.id); }
  }
  tree.proot.kids = [...tree.byKey.values()];
  if (flashNew) for (const id of fresh) flash(tree.byId.get(id));
  return fresh;
}
const pypiLabel = () => "PyPI" + (pypi.scope ? " · " + pypi.scope.path : cfg.pypi?.ref ? " · " + cfg.pypi.ref : "");
const projectScope = () => pypi.scope?.kind === "project"; // one project's index, not a group's
const pkgSort = (list) => [...list].sort(prefs.packageSort === "recent" ? (a, b) => (b.created || "").localeCompare(a.created || "") || byName(a, b) : byName);
const pkgHit = (n, term) => n.key.includes(term) || n.name.toLowerCase().includes(term);
const verHit = (n, term) => !pkgHit(n, term) && n.verList.some((v) => v.version.toLowerCase().includes(term));
// The PyPI rows of the tree, after the registry's: the same row shape, so rendering and keys work unchanged.
function pypiRows() {
  if (!cfg.pypi || !showsType("python")) return;
  const term = tree.filter.toLowerCase(), root = tree.proot;
  rows.push({ n: root, depth: 0, anc: [], pos: topCount(), count: topCount(), last: true });
  if (!isOpen(root)) return;
  if (pypi.denied) { rows.push({ info: "Log in to see Python packages", depth: 1, anc: [], last: true }); return; }
  if (!pypi.loaded) { rows.push({ info: pypi.error || "Loading...", depth: 1, anc: [], last: true }); return; }
  let kids = pkgSort(root.kids);
  if (term) kids = kids.filter((k) => pkgHit(k, term) || verHit(k, term));
  if (term && !kids.length) rows.push({ info: "No packages or versions match", depth: 1, anc: [], last: true });
  kids.forEach((k, i) => {
    const last = i === kids.length - 1;
    rows.push({ n: k, depth: 1, anc: [], pos: i + 1, count: kids.length, last });
    if (!isOpen(k)) return;
    const vers = term && verHit(k, term) ? k.verList.filter((v) => v.version.toLowerCase().includes(term)) : k.verList;
    vers.forEach((v, j) => rows.push({ n: v, depth: 2, anc: [!last], pos: j + 1, count: vers.length, last: j === vers.length - 1 }));
  });
}

// ---- PyPI files: fetched per upload when a row scrolls into view, through the same lazy queue as the registry's manifests ---------
function filesOf(u) {
  if (!pypiFiles.has(u.id)) {
    const p = api(`/api/pypi/files?id=${u.id}`).then((fs) => { pypiFiles.set(u.id, fs); return fs; }, (e) => { pypiFiles.delete(u.id); throw e; });
    pypiFiles.set(u.id, p);
  }
  return Promise.resolve(pypiFiles.get(u.id));
}
const loadedFiles = (u) => { const f = pypiFiles.get(u.id); return Array.isArray(f) ? f : null; };
const platLabel = (p) => (p.os === "any" ? "any" : `${p.os.split(" ")[0]} ${p.arch}`);
const summary = (fs) => ({
  platforms: uniq(fs.flatMap((f) => f.platforms.map(platLabel))).join(", "),
  requires: uniq(fs.map((f) => f.requires)).join(", "),
  built: uniq(fs.map((f) => f.python)).join(", "),
  size: fs.reduce((n, f) => n + (f.size || 0), 0),
  count: fs.length,
});
// A version over every copy of it: Requires-Python as recorded by any copy, and how many copies lack it.
function versionSummary(v) {
  const all = v.uploads.map(loadedFiles);
  if (all.some((fs) => !fs)) return null;
  const s = summary(all[0]);
  s.missing = all.filter((fs) => fs.length && fs.every((f) => !f.requires)).length;
  s.requires = uniq(all.flat().map((f) => f.requires)).join(", ");
  return s;
}

// ---- PyPI commands: Install, Configure and Upload, for pip or uv, on Linux/macOS (shell) or Windows (PowerShell) ----------------
// Checked against pip 26.2, uv 0.13 and twine 7.0: uv takes --default-index and UV_DEFAULT_INDEX (UV_INDEX_URL is deprecated),
// and pip and uv both read ~/.netrc on every OS. <TOKEN> marks where a token goes; this page never holds one.
const pypiHost = () => (cfg.pypi?.gitlab || "").replace(/^https?:\/\//, "");
const groupIndex = () => (pypi.scope ? `${cfg.pypi.gitlab}/api/v4${projectScope() ? `/projects/${pypi.scope.id}/packages/pypi/simple` : `/groups/${pypi.scope.id}/-/packages/pypi/simple`}` : "<INDEX_URL>");
const projectIndex = (id) => `${cfg.pypi.gitlab}/api/v4/projects/${id}/packages/pypi/simple`;
const publicIndex = () => cfg.pypi?.indexAuth === "none"; // GitLab serves the index without a login
const withToken = (url) => (publicIndex() ? url : url.replace(/^(https?:\/\/)/, "$1__token__:<TOKEN>@"));
let pyTab = "install";
function pypiCommandSets({ name, version, project }) {
  const spec = name ? (version ? `${name}==${version}` : name) : "<package>";
  const index = withToken(groupIndex());
  const win = prefs.os === "windows";
  const pipOf = (tool) => (tool === "uv" ? "uv pip" : win ? "py -m pip" : "python3 -m pip");
  const indexFlag = (tool) => (tool === "uv" ? "--default-index" : "--index-url");
  const install = (tool) => [
    cmdNote(projectScope() ? "From the project's index. GitLab asks pypi.org for anything it does not hold, if the project allows it." : "From the group index, which lists every project's packages. GitLab asks pypi.org for anything it does not hold, if the group allows it."),
    codeBlock("Install", [`${pipOf(tool)} install ${indexFlag(tool)} ${index} ${spec}`]),
    ...(version ? [cmdNote(tool === "uv" ? "Download the files only, without installing. uv has no download command, so this is pip." : "Download the files only, without installing."),
      codeBlock("Download", [`${pipOf("pip")} download --no-deps --index-url ${index} ${spec}`])] : []),
    ...(project && !projectScope() ? [cmdNote("From one project's index only, when several projects hold the same version."), codeBlock("Install from this project", [`${pipOf(tool)} install ${indexFlag(tool)} ${withToken(projectIndex(project))} ${spec}`])] : [])];
  const netrcLine = `machine ${pypiHost().split("/")[0]} login __token__ password <TOKEN>`;
  const configure = (tool) => {
    const idx = tool === "uv"
      ? (win ? codeBlock("uv (PowerShell, kept for your user)", [`[Environment]::SetEnvironmentVariable("UV_DEFAULT_INDEX", "${groupIndex()}", "User")`])
        : codeBlock("uv (add to ~/.profile to keep it)", [`export UV_DEFAULT_INDEX=${groupIndex()}`]))
      : codeBlock("pip (written to your user's pip config)", [`${pipOf("pip")} config --user set global.index-url ${groupIndex()}`]);
    const netrc = win
      ? [cmdNote("Keep the token out of the URL and out of shell history: put it in %USERPROFILE%\\.netrc, which pip and uv both read."),
        codeBlock(".netrc (PowerShell)", [`Add-Content -Path "$HOME\\.netrc" -Value "${netrcLine}"`])]
      : [cmdNote("Keep the token out of the URL and out of shell history: put it in ~/.netrc, which pip and uv both read."),
        codeBlock("~/.netrc", [`printf '%s\\n' '${netrcLine}' >> ~/.netrc`, "chmod 600 ~/.netrc"])];
    return [cmdNote("Set the index once instead of passing it every time. Prefer index-url over extra-index-url: with an extra index, pip may take a public package of the same name instead of yours."),
      idx, ...(publicIndex() ? [] : netrc), ...(win ? [cmdNote("Open a new PowerShell window afterwards: a variable set for your user reaches new windows only.")] : [])];
  };
  const upload = () => {
    const url = `${cfg.pypi.gitlab}/api/v4/projects/${project || "<PROJECT_ID>"}/packages/pypi`;
    return [cmdNote(project ? `Upload to the project that holds the newest ${name}. A token with write_package_registry.` : "Upload to a project's index: its numeric id is on the project page. A token with write_package_registry."),
      win ? codeBlock("twine (PowerShell)", ['$env:TWINE_USERNAME = "__token__"', '$env:TWINE_PASSWORD = "<TOKEN>"', `py -m twine upload --repository-url ${url} dist\\*`])
        : codeBlock("twine", [`TWINE_USERNAME=__token__ TWINE_PASSWORD=<TOKEN> python3 -m twine upload --repository-url ${url} dist/*`]),
      cmdNote("In a GitLab pipeline the username must be gitlab-ci-token, with the job's own token."),
      codeBlock("twine in .gitlab-ci.yml", ["TWINE_USERNAME=gitlab-ci-token TWINE_PASSWORD=${CI_JOB_TOKEN} python3 -m twine upload --repository-url ${CI_API_V4_URL}/projects/${CI_PROJECT_ID}/packages/pypi dist/*"]),
      cmdNote("twine sends Requires-Python from the wheel's metadata. A bare curl upload does not, and pip then cannot tell which Python a version needs.")];
  };
  return { names: [["install", "Install"], ["configure", "Configure"], ["upload", "Upload"]], content: { install, configure, upload } };
}
function pypiCommandsEl(ctx, heading) {
  const names = pypiCommandSets(ctx).names;
  const tabs = el("div", { role: "tablist", className: "tabs", "aria-label": "Command helpers" });
  const seg = el("div", { className: "seg", role: "group", "aria-label": "Installer" });
  const osSeg = el("div", { className: "seg", role: "group", "aria-label": "Operating system" });
  const panel = el("div", { role: "tabpanel", className: "cmd-panel" });
  const draw = () => {
    const cur = names.some(([k]) => k === pyTab) ? pyTab : names[0][0];
    tabs.replaceChildren(...names.map(([k, text]) => el("button", {
      type: "button", role: "tab", textContent: text, id: "ptab-" + k, tabIndex: k === cur ? 0 : -1, "aria-selected": String(k === cur), "aria-controls": "pcmd-panel",
      onclick: () => { pyTab = k; draw(); },
      onkeydown: (e) => {
        const d = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
        if (!d) return;
        e.preventDefault();
        pyTab = names[(names.findIndex((x) => x[0] === k) + d + names.length) % names.length][0];
        draw();
        $("ptab-" + pyTab).focus();
      },
    })));
    seg.hidden = cur === "upload";
    seg.replaceChildren(...CHOICES.tool.map((t) => el("button", { type: "button", textContent: t, "aria-pressed": String(t === prefs.tool), onclick: () => { prefs.tool = t; savePrefs(); draw(); } })));
    osSeg.replaceChildren(...[["linux", "Linux/macOS"], ["windows", "Windows"]].map(([o, text]) => el("button", { type: "button", textContent: text, "aria-pressed": String(o === prefs.os), onclick: () => { prefs.os = o; savePrefs(); draw(); } })));
    panel.id = "pcmd-panel";
    panel.setAttribute("aria-labelledby", "ptab-" + cur);
    panel.replaceChildren(...pypiCommandSets(ctx).content[cur](prefs.tool)); // built again: the OS choice changes every command
  };
  draw();
  return el("section", { className: "cmds" }, el("h3", { textContent: heading }), el("div", { className: "cmd-bar" }, tabs, el("div", { className: "segs" }, osSeg, seg)), panel);
}

// ---- PyPI panes ----------------------------------------------------------------------------------------------------------
function pypiCrumbs(n) {
  const parts = [];
  for (let x = n; x && x.kind !== "proot"; x = x.parent) parts.unshift(x);
  return crumbNav(pypiLabel(), parts.map((x) => (x.kind === "ver" ? { text: "==" + x.name, href: hashOf(x), cls: "t" } : { text: x.name, href: hashOf(x) })), "#/pypi");
}
const gitlabLink = (path, text) => (path ? el("a", { href: cfg.pypi.gitlab + path, target: "_blank", rel: "noopener noreferrer", textContent: text }) : null);
const stats = (...items) => el("p", { className: "stats" }, ...items.filter(Boolean).map((t) => el("span", { className: "stat", textContent: t })));
const paneTabs = new Map(); // the chosen tab per view, for this page's life
function tabSet(id, tabs) { // tabs: [key, label, build() -> nodes]
  const bar = el("div", { role: "tablist", className: "tabs panetabs", "aria-label": "Sections" }), panel = el("div", { role: "tabpanel", className: "tabpanel" });
  const draw = (focus) => {
    const cur = tabs.some(([k]) => k === paneTabs.get(id)) ? paneTabs.get(id) : tabs[0][0];
    bar.replaceChildren(...tabs.map(([k, label]) => el("button", {
      type: "button", role: "tab", textContent: label, id: `pt-${k}`, tabIndex: k === cur ? 0 : -1, "aria-selected": String(k === cur),
      onclick: () => { paneTabs.set(id, k); draw(); },
      onkeydown: (e) => {
        const d = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
        if (!d) return;
        e.preventDefault();
        paneTabs.set(id, tabs[(tabs.findIndex((t) => t[0] === k) + d + tabs.length) % tabs.length][0]);
        draw(true);
      },
    })));
    panel.setAttribute("aria-labelledby", "pt-" + cur);
    lazyReset();
    panel.replaceChildren(...[tabs.find((t) => t[0] === cur)[2]()].flat());
    if (focus) bar.querySelector("[aria-selected=true]").focus();
  };
  draw();
  return [bar, panel];
}
function pypiNotice(n) { // in place of a pane when the list cannot be shown
  if (pypi.denied) return [pypiCrumbs(n), el("h2", { textContent: "Python packages" }), el("p", { className: "mut" }, "Log in to see the Python packages. ", ...(cfg.login ? [el("a", { href: cfg.login, textContent: "Log in" })] : []))];
  if (!pypi.loaded) return [pypiCrumbs(n), el("h2", { textContent: "Python packages" }), el("p", { className: "mut", textContent: pypi.error || "Reading the group from GitLab..." })];
  return null;
}
function prootPane(n) {
  const blocked = pypiNotice(n);
  if (blocked) return showMain(...blocked);
  const pkgs = n.kids, projects = uniq(pypi.packages.map((u) => u.project));
  showMain(pypiCrumbs(n), el("h2", {}, el("span", { className: "ico" }, icon("pypi")), pypiLabel()),
    stats(plural(pkgs.length, "package"), plural(pypi.packages.length, "upload"), plural(projects.length, "project"), pypi.truncated ? "newest uploads only (UI_PYPI_MAX_PACKAGES)" : ""),
    el("p", { className: "reporef" }, copyValue(groupIndex(), "Copy the index URL")),
    ...listView({
      id: "pkgs", items: pkgs, tie: byName, defaultCmp: prefs.packageSort === "recent" ? (a, b) => (b.created || "").localeCompare(a.created || "") || byName(a, b) : byName,
      columns: [
        { key: "name", label: "Package", val: (p) => p.key, cmp: collator.compare },
        { key: "latest", label: "Latest", val: (p) => p.latest, cmp: verCompare },
        { key: "versions", label: "Versions", val: (p) => p.verList.length, cmp: numCmp },
        { key: "projects", label: "Projects", val: (p) => p.projects.length, cmp: numCmp, tip: "GitLab projects that hold a copy" },
        { key: "created", label: "Last upload", val: (p) => secs(p.created), cmp: numCmp },
        { key: "downloaded", label: "Last download", val: (p) => secs(p.downloaded), cmp: numCmp },
      ],
      match: (p, t) => pkgHit(p, t), placeholder: "Filter packages",
      row: (p) => el("tr", {}, el("td", {}, el("span", { className: "ico" }, icon("pkg"), link(p))), el("td", { className: "nw" }, code(p.latest)),
        el("td", { textContent: p.verList.length }), el("td", { className: "mut", textContent: p.projects.length }),
        el("td", { className: "mut" }, when(p.created)), el("td", { className: "mut" }, when(p.downloaded, "never"))),
    }),
    pypiCommandsEl({ name: "", version: "", project: projectScope() ? pypi.scope.id : "" }, "Use this index"));
}
function versionRow(v) { // a table row for a version, whose Python, platforms, files and size fill in from its copies
  const req = el("td", { className: "mut nw" }), built = el("td", { className: "mut" }), plat = el("td", { className: "mut" }), count = el("td", { className: "mut" }), sz = el("td", { className: "mut nw" });
  const r = { done: false, load: () => Promise.all(v.uploads.map(filesOf)) };
  r.apply = () => {
    const s = versionSummary(v);
    if (!s) return;
    req.replaceChildren(s.requires || "not recorded", ...(s.requires && s.missing ? [el("span", { className: "badge deleted", textContent: ` missing in ${s.missing} of ${v.uploads.length}` })] : []));
    req.title = s.missing ? "Some copies were uploaded without Requires-Python, so pip cannot tell from them which Python this version needs" : "Requires-Python";
    built.textContent = s.built;
    plat.textContent = s.platforms;
    count.textContent = s.count;
    sz.textContent = size(s.size);
    r.done = true;
  };
  r.apply();
  r.tr = el("tr", {}, el("td", {}, el("span", { className: "ico" }, icon("tag"), link(v, v.version)), rowCopy(`${v.parent.name}==${v.version}`, `Copy ${v.parent.name}==${v.version}`)),
    req, built, plat, count, sz, el("td", { className: "mut", textContent: v.uploads.length }),
    el("td", { className: "mut" }, when(v.created)), el("td", { className: "mut" }, when(v.downloaded, "never")));
  return r;
}
const fileSort = (key) => (v) => { const s = versionSummary(v); return s ? s[key] || null : null; };
function projectsList(n) { // which GitLab projects hold a copy of the package, and of which versions
  const rows = n.projects.map((path) => {
    const ups = n.uploads.filter((u) => u.project === path);
    const vers = ups.map((u) => u.version).sort(verCompare).reverse();
    return { path, vers, created: ups.map((u) => u.created).filter(Boolean).sort().pop() || null, downloaded: ups.map((u) => u.downloaded).filter(Boolean).sort().pop() || null };
  });
  return listView({
    id: "projects:" + n.key, items: rows, tie: (a, b) => collator.compare(a.path, b.path), defaultCmp: (a, b) => collator.compare(a.path, b.path),
    columns: [
      { key: "path", label: "Project", val: (r) => r.path, cmp: collator.compare },
      { key: "count", label: "Versions", val: (r) => r.vers.length, cmp: numCmp },
      { key: "newest", label: "Newest held", val: (r) => r.vers[0], cmp: verCompare },
      { key: "created", label: "Last upload", val: (r) => secs(r.created), cmp: numCmp },
      { key: "downloaded", label: "Last download", val: (r) => secs(r.downloaded), cmp: numCmp },
    ],
    match: (r, t) => r.path.toLowerCase().includes(t), placeholder: "Filter projects",
    row: (r) => el("tr", {}, el("td", {}, gitlabLink(`/${r.path}/-/packages`, r.path)), el("td", { textContent: r.vers.length, title: r.vers.join(", ") }),
      el("td", {}, link(n.versions.get(r.vers[0]), r.vers[0])), el("td", { className: "mut" }, when(r.created)), el("td", { className: "mut" }, when(r.downloaded, "never"))),
  });
}
function pkgPane(n) {
  const blocked = pypiNotice(n);
  if (blocked) return showMain(...blocked);
  const versions = () => {
    const pick = canDeletePypi() ? pickBar({ id: "vers:" + n.key, key: (v) => v.version, keep: (k) => n.versions.has(k), noun: "version",
      cost: (keys) => uploadsOf(n, keys).length, costNoun: "upload", onDelete: (keys) => deleteVersions(n, keys) }) : null;
    const entries = new Map();
    const entry = (v) => {
      if (!entries.has(v)) {
        entries.set(v, versionRow(v));
        pick?.row(entries.get(v).tr, v);
      }
      return entries.get(v);
    };
    const list = listView({
    id: "vers:" + n.key, items: n.verList, tie: (a, b) => verCompare(b.version, a.version), defaultCmp: (a, b) => verCompare(b.version, a.version),
    columns: [
      { key: "version", label: "Version", val: (v) => v.version, cmp: verCompare },
      { key: "requires", label: "Requires Python", val: fileSort("requires"), cmp: collator.compare, tip: "Sorts loaded rows. Requires-Python, as the uploader recorded it" },
      { key: "built", label: "Built for", val: fileSort("built"), cmp: collator.compare, tip: "Sorts loaded rows. From the wheel tags" },
      { key: "platforms", label: "Platforms", val: fileSort("platforms"), cmp: collator.compare, tip: "Sorts loaded rows" },
      { key: "count", label: "Files", val: fileSort("count"), cmp: numCmp, tip: "Sorts loaded rows" },
      { key: "size", label: "Size", val: fileSort("size"), cmp: numCmp, tip: "Sorts loaded rows. All files of the newest copy" },
      { key: "copies", label: "Copies", val: (v) => v.uploads.length, cmp: numCmp, tip: "GitLab projects that hold this version" },
      { key: "created", label: "Uploaded", val: (v) => secs(v.created), cmp: numCmp },
      { key: "downloaded", label: "Last download", val: (v) => secs(v.downloaded), cmp: numCmp },
    ],
    match: (v, t) => v.version.toLowerCase().includes(t), placeholder: "Filter versions", lead: pick?.head,
    row: (v) => entry(v).tr, onDraw: (vis) => { vis.forEach((v) => lazyWatch(entry(v))); pick?.shown(vis); },
    lateKeys: ["requires", "built", "platforms", "count", "size"], onLate: (redraw) => { lazy.redraw = redraw; },
    });
    return pick ? [pick.bar, ...list] : list;
  };
  showMain(pypiCrumbs(n), el("h2", {}, el("span", { className: "ico" }, icon("pkg")), `${n.name} `, el("span", { className: "mut", textContent: n.latest })),
    stats(plural(n.verList.length, "version"), plural(n.uploads.length, "upload"), plural(n.projects.length, "project")),
    ...tabSet("pkg", [["versions", "Versions", versions], ["projects", `Projects (${n.projects.length})`, () => projectsList(n)]]),
    pypiCommandsEl({ name: n.name, version: "", project: latestUpload(n.uploads).projectId }, "Use this package"));
}
function filesTable(fs) {
  return el("table", {}, el("tr", {}, ...["File", "Type", "Requires Python", "Built for", "ABI", "Platform", "Size", "SHA-256"].map((h) => el("th", { textContent: h }))),
    ...fs.map((f) => el("tr", {},
      el("td", {}, code(f.name), rowCopy(f.name, "Copy file name")), el("td", { className: "mut", textContent: f.kind }),
      el("td", { className: "nw", textContent: f.requires || "", title: f.requires ? "" : "Not recorded by the uploader" }), el("td", { textContent: f.python }),
      el("td", {}, code(f.abi)), el("td", { textContent: f.platforms.map((p) => (p.os === "any" ? "any" : `${p.os} ${p.arch}`)).join(", ") }),
      el("td", { className: "nw", textContent: size(f.size) }), el("td", { className: "nw" }, f.sha256 ? copyValue(f.sha256, "Copy SHA-256", f.sha256.slice(0, 12) + "…") : ""))));
}
function uploadSection(u) {
  const body = el("div", {}, el("p", { className: "mut", textContent: "Loading files..." }));
  const props = el("table", { className: "props" },
    tableRow("Project", u.project), tableRow("Uploaded", when(u.created)), tableRow("Last download", when(u.downloaded, "never")),
    tableRow("Links", el("span", {}, gitlabLink(u.webPath, "Package in GitLab"),
      ...(u.pipeline ? [" · ", gitlabLink(`/${u.project}/-/pipelines/${u.pipeline.id}`, `Pipeline ${u.pipeline.id}`), u.pipeline.sha ? el("span", { className: "mut", textContent: ` (${u.pipeline.ref} ${u.pipeline.sha.slice(0, 8)})` }) : null] : [el("span", { className: "mut", textContent: " · uploaded outside a pipeline" })]))));
  filesOf(u).then((fs) => {
    const s = summary(fs);
    props.append(tableRow("Files", `${s.count}, ${size(s.size)} in all`), tableRow("Requires Python", s.requires || "not recorded by the uploader"),
      tableRow("Built for", s.built), tableRow("Platforms", s.platforms));
    body.replaceChildren(filesTable(fs));
  }, (e) => body.replaceChildren(el("p", { className: "mut", textContent: e.message })));
  return el("section", { className: "upload" }, props, body);
}
// One row per project that holds the version: filtered and paged like every list, so a thousand copies stay one table.
function copiesList(n) {
  const detail = el("div", { className: "copydetail" }), rowsOf = new Map();
  const show = (u) => {
    for (const [id, tr] of rowsOf) tr.setAttribute("aria-selected", String(id === u.id));
    detail.replaceChildren(el("h3", { textContent: u.project }), uploadSection(u));
  };
  const rowOf = (u) => {
    if (!rowsOf.has(u.id)) {
      rowsOf.set(u.id, el("tr", { className: "pick", tabIndex: 0, "aria-selected": "false", onclick: () => show(u), onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); show(u); } } },
        el("td", { textContent: u.project }), el("td", { className: "mut" }, when(u.created)), el("td", { className: "mut" }, when(u.downloaded, "never")),
        el("td", { className: "mut", textContent: u.pipeline ? `pipeline ${u.pipeline.id}` : "outside a pipeline" })));
    }
    return rowsOf.get(u.id);
  };
  const list = listView({
    id: "copies:" + n.id, items: n.uploads, tie: (a, b) => collator.compare(a.project, b.project), defaultCmp: (a, b) => (b.created || "").localeCompare(a.created || "") || collator.compare(a.project, b.project),
    columns: [
      { key: "project", label: "Project", val: (u) => u.project, cmp: collator.compare },
      { key: "created", label: "Uploaded", val: (u) => secs(u.created), cmp: numCmp },
      { key: "downloaded", label: "Last download", val: (u) => secs(u.downloaded), cmp: numCmp },
      { key: "by", label: "Uploaded by", val: (u) => (u.pipeline ? "pipeline" : "other"), cmp: collator.compare },
    ],
    match: (u, t) => u.project.toLowerCase().includes(t), placeholder: "Filter projects", row: rowOf,
  });
  show(n.uploads[0]);
  return [el("h3", { textContent: `Copies (${n.uploads.length})` }), el("p", { className: "mut", textContent: "Select a copy to see its files." }), ...list, detail];
}
function verPane(n) {
  const blocked = pypiNotice(n);
  if (blocked) return showMain(...blocked);
  const pkg = n.parent, newer = pkg.verList.filter((x) => verCompare(x.version, n.version) > 0 && !isPre(x.version));
  showMain(pypiCrumbs(n), el("h2", {}, el("span", { className: "ico" }, icon("tag")), `${pkg.name} ${n.version}`),
    el("p", { className: "reporef" }, copyValue(`${pkg.name}==${n.version}`, "Copy requirement")),
    ...(isPre(n.version) ? [el("p", { className: "hint", textContent: "A pre-release: pip installs it only when asked for this version or given --pre." })] : []),
    ...(newer.length ? [el("p", { className: "mut" }, "Newer: ", ...newer.slice(-3).reverse().flatMap((x, i) => [i ? ", " : "", link(x, x.version)]))] : []),
    stats(n.uploads.length > 1 ? `${n.uploads.length} copies` : "", "uploaded " + ago(secs(n.created)), n.downloaded ? "downloaded " + ago(secs(n.downloaded)) : "never downloaded"),
    ...(n.uploads.length > 1 ? [el("p", { className: "hint", textContent: "Several projects hold this version. The group index serves one of them, and their files can differ." })] : []),
    pypiCommandsEl({ name: pkg.name, version: n.version, project: n.uploads[0].projectId }, "Use this version"),
    ...(n.uploads.length > 1 ? copiesList(n) : [el("h3", { textContent: "Files" }), uploadSection(n.uploads[0])]));
}

// ---- PyPI delete: versions of one package, every copy of each, with the delete token (GITLAB_DELETE_TOKEN_FILE) on the server ----------
const canDeletePypi = () => canWrite() && !!cfg.pypi?.delete;
const uploadsOf = (n, keys) => n.verList.filter((v) => keys.has(v.version)).flatMap((v) => v.uploads);
async function deleteVersions(n, keys) {
  const vers = n.verList.filter((v) => keys.has(v.version)), uploads = uploadsOf(n, keys);
  if (!(await confirmDeleteVersions(n, vers, uploads))) return;
  let results;
  try {
    banner("");
    results = (await api("/api/pypi/delete", { ids: uploads.map((u) => u.id) })).results;
  } catch (e) { banner(e.message, true); return; }
  const failed = new Set(results.filter((r) => r.status === "failed").map((r) => r.version));
  const st = stateOf("vers:" + n.key);
  for (const k of keys) if (!failed.has(k)) st.picked.delete(k); // a failed version stays picked, to retry or look at
  await pypiSync();
  await deleteResults(n.name, results.map((r) => ({ ...r, tag: r.name ? `${r.name}==${r.version}` : `upload ${r.id}`, detail: r.project })), "upload");
  await renderPane();
}
// Resolves to true or false.
function confirmDeleteVersions(n, vers, uploads) {
  return new Promise((resolve) => {
    let result = false;
    const projects = uniq(uploads.map((u) => u.project)), shared = vers.filter((v) => v.uploads.length > 1);
    const go = el("button", { type: "button", className: "primary dangerfill", textContent: `Delete ${plural(vers.length, "version")}` });
    go.onclick = () => { result = true; dlg.close(); };
    const cancel = el("button", { type: "button", textContent: "Cancel", onclick: () => dlg.close() });
    const warn = [];
    if (vers.length === n.verList.length) warn.push(el("p", { className: "dlg-warn", role: "alert", textContent: `These are all the versions of ${n.name}, so the package leaves the index.` }));
    if (shared.length) warn.push(el("p", { className: "dlg-warn", textContent: `${plural(shared.length, "version")} ${shared.length === 1 ? "is" : "are"} held by several projects, and every copy goes: ${namesOf(shared.map((v) => v.version))}.` }));
    const dlg = el("dialog", { className: "settings transfer", "aria-labelledby": "y-title", "aria-describedby": "y-scope" },
      el("div", { className: "shead" }, el("h2", { id: "y-title", textContent: `Delete ${plural(vers.length, "version")}` }),
        el("button", { type: "button", className: "iconbtn", "aria-label": "Close", onclick: () => dlg.close() }, icon("close"))),
      el("div", { className: "sbody" },
        el("div", { className: "srccard" }, el("div", { className: "srcname" }, el("span", { className: "ico" }, icon("pkg")), el("code", { textContent: n.name })),
          el("div", { className: "srcmeta mut" }, el("span", { textContent: `${plural(vers.length, "version")} selected` }), el("span", { textContent: plural(uploads.length, "upload") }), el("span", { textContent: plural(projects.length, "project") }))),
        ...warn,
        el("p", { className: "scope", id: "y-scope", textContent: "Deletes each upload and its files from GitLab. This cannot be undone: pip can no longer install these versions from this index." }),
        el("div", { className: "xlabel", textContent: "Selected versions" }), chipsOf(vers.map((v) => v.version)),
        el("div", { className: "xlabel", textContent: "Projects" }), chipsOf(projects)),
      el("div", { className: "sfoot" }, cancel, go));
    dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
    dlg.addEventListener("close", () => { dlg.remove(); resolve(result); });
    document.body.append(dlg);
    dlg.showModal();
    cancel.focus(); // several uploads go at once: Enter does not delete
  });
}

// ---- PyPI live updates: a named "pypi" event on the same stream, and /api/pypi/seq while the stream is down ----------------
let pypiSyncing = null;
async function pypiSync() {
  if (!cfg.pypi) return;
  if (pypiSyncing) return pypiSyncing;
  pypiSyncing = (async () => {
    try {
      const snap = await api("/api/pypi/packages");
      const first = !pypi.loaded;
      if (!first && snap.seq === pypi.seq && snap.error === pypi.error) return;
      pypi = { ...snap, denied: false };
      if (!snap.loaded) { setTimeout(() => void pypiSync(), 2000); renderTree(); return; }
      const fresh = applyPypi(snap.packages, !first);
      if (tree.sel && /^[kv]:/.test(tree.sel) && !tree.byId.has(tree.sel)) { location.hash = "#/pypi"; return; } // the package or version is gone
      renderTree();
      if (first || fresh.size || /^(proot|[kv]:)/.test(tree.sel || "") || tree.sel === "recent") void renderPane();
    } catch (e) {
      pypi.denied = e.status === 401;
      pypi.error = e.message;
      renderTree();
    } finally { pypiSyncing = null; }
  })();
  return pypiSyncing;
}

// The sidebar's type filter: all, containers, Helm charts or python. A funnel beside Filter, shown when there is more than one type
// to pick from, opens the choices as a popover. It stays open while the choice changes, and Escape or a click outside closes it.
// The funnel takes the accent while it filters.
function drawTypes() {
  const box = $("types"), btn = $("typesbtn"), helm = tree.helm.size > 0 || helmOnly();
  btn.hidden = !cfg.pypi && !helm;
  if (btn.hidden) { if (box.matches(":popover-open")) box.hidePopover(); return; }
  const opts = [["all", "All types"], ["containers", "Containers", () => kindIcon("image")], ...(helm ? [["helm", "Helm charts", () => kindIcon("helm")]] : []), ...(cfg.pypi ? [["python", "Python packages", () => icon("pypi")]] : [])];
  const label = "Show: " + (opts.find(([v]) => v === prefs.show) || opts[0])[1];
  btn.classList.toggle("on", prefs.show !== "all");
  btn.title = label; btn.setAttribute("aria-label", label);
  if (!btn.firstChild) btn.append(icon("funnel"));
  const focused = box.contains(document.activeElement); // redrawn on each change, so keep the keyboard's place
  box.replaceChildren(el("fieldset", {}, el("legend", { textContent: "Show" }), ...opts.map(([v, text, ic]) => el("label", {},
    el("input", { type: "radio", name: "show", value: v, checked: v === prefs.show, onchange: () => applyPrefs({ show: v }) }),
    ic ? ic() : el("span", { className: "noicon" }), text))));
  if (focused) box.querySelector("input:checked").focus();
}
$("types").addEventListener("toggle", (e) => { // under the funnel, kept inside the window
  if (e.newState !== "open") return;
  const box = $("types"), r = $("typesbtn").getBoundingClientRect();
  box.style.top = r.bottom + 6 + "px";
  box.style.left = Math.max(8, Math.min(r.left, innerWidth - box.offsetWidth - 8)) + "px";
});

loadPrefs(); applyTheme();
setWidth(prefs.sidebar, false);
for (const id of prefs.expanded) expanded.add(id);
$("prefs").onclick = () => settings();
$("help").onclick = () => helpPanel();
$("disk").onclick = () => { location.hash = "#/storage"; };
$("bin").onclick = () => { location.hash = "#/bin"; };
tree.root = { kind: "root", id: "root", name: "Registry", parent: null, kids: new Map(), sortedKids: null };
tree.byId.set("root", tree.root);
tree.proot = { kind: "proot", id: "proot", name: "PyPI", parent: null, kids: [] };
tree.byId.set("proot", tree.proot);
tree.names = [];
try { cfg = await api("/api/config"); $("reg").textContent = cfg.registry; $("ver").textContent = `v${cfg.version} · ${cfg.revision.slice(0, 7)}`; banner(notice()); $("bin").hidden = !cfg.binDays; void binCount(); void loadStorage(true);
  if (cfg.login) $("who").replaceChildren(...(cfg.user ? [cfg.user, " ", el("a", { href: cfg.logout, textContent: "Log out", className: "btn" })] : [el("a", { href: cfg.login, textContent: "Log in", className: "btn" })]));
}  catch (e) { banner(e.message, true); }
expanded.add("root");
expanded.add("proot");
drawTypes();
await sync();
await pypiSync();
addEventListener("hashchange", () => void navigate());
startLive();
startPoll();
await navigate();
