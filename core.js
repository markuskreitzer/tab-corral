// Tab operations shared by the service worker and the popup.
// Everything here moves existing tabs (never recreates them), so page state,
// history and scroll position survive and nothing can be duplicated.

const NO_GROUP = -1; // chrome.tabGroups.TAB_GROUP_ID_NONE

export const DEFAULTS = {
  dedupeAfterMerge: true,
  ignoreHash: false,
  groupAfterMerge: false,
};

export function getOptions() {
  return chrome.storage.sync.get(DEFAULTS);
}

export function listWindows() {
  return chrome.windows.getAll({ populate: true, windowTypes: ["normal"] });
}

async function resolveTarget(windowId) {
  if (windowId != null) return chrome.windows.get(windowId);
  return chrome.windows.getLastFocused({ windowTypes: ["normal"] });
}

/**
 * Move tabs into a window, keeping order, pinned state and tab groups.
 * A group is moved as a group only when every one of its tabs is in `tabs`;
 * otherwise its tabs move individually and leave the group.
 */
export async function moveTabs(tabs, targetWindowId) {
  const result = { moved: 0, failed: [] };
  const ordered = [...tabs].sort(
    (a, b) => a.windowId - b.windowId || a.index - b.index
  );

  const selectedPerGroup = new Map();
  for (const tab of ordered) {
    if (tab.groupId !== NO_GROUP) {
      selectedPerGroup.set(tab.groupId, (selectedPerGroup.get(tab.groupId) ?? 0) + 1);
    }
  }
  const wholeGroups = new Set();
  for (const [groupId, count] of selectedPerGroup) {
    const members = await chrome.tabs.query({ groupId });
    if (members.length === count) wholeGroups.add(groupId);
  }

  const groupsDone = new Set();
  for (const tab of ordered) {
    if (tab.windowId === targetWindowId) continue;
    try {
      if (wholeGroups.has(tab.groupId)) {
        if (!groupsDone.has(tab.groupId)) {
          groupsDone.add(tab.groupId);
          await chrome.tabGroups.move(tab.groupId, { windowId: targetWindowId, index: -1 });
        }
      } else {
        await chrome.tabs.move(tab.id, { windowId: targetWindowId, index: -1 });
        // Pinned state is dropped when a tab changes window.
        if (tab.pinned) await chrome.tabs.update(tab.id, { pinned: true });
      }
      result.moved++;
    } catch (err) {
      result.failed.push({ title: tab.title, url: tab.url, error: String(err?.message ?? err) });
    }
  }
  return result;
}

/** Merge every other normal window into the target (default: last focused). */
export async function mergeAll({ targetWindowId, sourceWindowIds } = {}) {
  const target = await resolveTarget(targetWindowId);
  const windows = await listWindows();
  const sources = windows.filter(
    (w) =>
      w.id !== target.id &&
      w.incognito === target.incognito && // tabs cannot cross that boundary
      (!sourceWindowIds || sourceWindowIds.includes(w.id))
  );
  const result = await moveTabs(sources.flatMap((w) => w.tabs), target.id);
  return { ...result, windows: sources.length, targetWindowId: target.id };
}

function dedupeKey(tab, ignoreHash) {
  const url = tab.url || tab.pendingUrl;
  if (!url) return null;
  let key = url;
  if (ignoreHash) {
    const hash = key.indexOf("#");
    if (hash !== -1) key = key.slice(0, hash);
  }
  return `${tab.incognito ? "i" : "n"}|${key}`;
}

function keepScore(tab, preferWindowId) {
  return (
    (tab.active ? 16 : 0) +
    (tab.pinned ? 8 : 0) +
    (tab.audible ? 4 : 0) +
    (tab.groupId !== NO_GROUP ? 2 : 0) +
    (tab.windowId === preferWindowId ? 1 : 0)
  );
}

/** Group tabs by URL and return, per duplicated URL, which to keep and which to close. */
export async function findDuplicates({ windowId, ignoreHash, preferWindowId } = {}) {
  const tabs = await chrome.tabs.query(
    windowId != null ? { windowId } : { windowType: "normal" }
  );
  const byKey = new Map();
  for (const tab of tabs) {
    const key = dedupeKey(tab, ignoreHash);
    if (!key) continue;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(tab);
  }
  const sets = [];
  for (const group of byKey.values()) {
    if (group.length < 2) continue;
    group.sort(
      (a, b) =>
        keepScore(b, preferWindowId) - keepScore(a, preferWindowId) ||
        a.windowId - b.windowId ||
        a.index - b.index
    );
    sets.push({ keep: group[0], close: group.slice(1) });
  }
  return sets;
}

export async function dedupe(opts = {}) {
  const options = await getOptions();
  const sets = await findDuplicates({ ignoreHash: options.ignoreHash, ...opts });
  const ids = sets.flatMap((s) => s.close.map((t) => t.id));
  if (ids.length) await chrome.tabs.remove(ids);
  return { closed: ids.length };
}

export async function mergeAllAndMaybeDedupe(opts = {}) {
  const options = await getOptions();
  const merged = await mergeAll(opts);
  let closed = 0;
  if (options.dedupeAfterMerge) {
    ({ closed } = await dedupe({
      windowId: merged.targetWindowId,
      preferWindowId: merged.targetWindowId,
    }));
  }
  let grouping = {};
  if (options.groupAfterMerge) {
    grouping = await groupBySite({ windowId: merged.targetWindowId });
  }
  return { ...merged, closed, ...grouping };
}

const GROUP_COLORS = ["grey", "blue", "red", "yellow", "green", "pink", "purple", "cyan", "orange"];

/** "gist.github.com" -> "github.com", "www.bbc.co.uk" -> "bbc.co.uk". Null for non-web URLs. */
export function siteOf(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  const host = parsed.hostname;
  const labels = host.split(".");
  if (labels.length <= 2 || /^[\d.]+$/.test(host) || host.includes(":")) return host;
  // No public-suffix list here: treat "co.uk"-shaped endings as a two-part suffix.
  const [second, tld] = labels.slice(-2);
  const keep = tld.length === 2 && second.length <= 3 ? 3 : 2;
  return labels.slice(-keep).join(".");
}

function colorFor(site) {
  let hash = 0;
  for (const ch of site) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return GROUP_COLORS[hash % GROUP_COLORS.length];
}

/**
 * Group a window's loose tabs by site. Sites with two or more tabs get a group
 * named after the site; a group that already has that name is reused. Pinned
 * tabs and tabs already in a group are left alone.
 */
export async function groupBySite({ windowId } = {}) {
  const target = await resolveTarget(windowId);
  const tabs = await chrome.tabs.query({ windowId: target.id });
  const bySite = new Map();
  for (const tab of tabs) {
    if (tab.pinned || tab.groupId !== NO_GROUP) continue;
    const site = siteOf(tab.url || tab.pendingUrl || "");
    if (!site) continue;
    if (!bySite.has(site)) bySite.set(site, []);
    bySite.get(site).push(tab.id);
  }
  const existing = new Map(
    (await chrome.tabGroups.query({ windowId: target.id })).map((g) => [g.title, g.id])
  );
  let grouped = 0;
  let groups = 0;
  for (const [site, tabIds] of bySite) {
    if (existing.has(site)) {
      await chrome.tabs.group({ groupId: existing.get(site), tabIds });
    } else if (tabIds.length >= 2) {
      const groupId = await chrome.tabs.group({ tabIds, createProperties: { windowId: target.id } });
      await chrome.tabGroups.update(groupId, { title: site, color: colorFor(site) });
    } else {
      continue;
    }
    grouped += tabIds.length;
    groups++;
  }
  return { grouped, groups };
}

export async function summary() {
  const options = await getOptions();
  const windows = await listWindows();
  const sets = await findDuplicates({ ignoreHash: options.ignoreHash });
  return {
    windows: windows.length,
    tabs: windows.reduce((n, w) => n + w.tabs.length, 0),
    duplicates: sets.reduce((n, s) => n + s.close.length, 0),
  };
}
