import { DEFAULTS, getOptions, summary } from "./core.js";

const $ = (id) => document.getElementById(id);
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

async function refresh() {
  const s = await summary();
  $("summary").textContent =
    `${plural(s.windows, "window")} · ${plural(s.tabs, "tab")} · ${plural(s.duplicates, "duplicate")}`;
  $("merge").disabled = s.windows < 2 && s.duplicates === 0;
  $("dedupe").disabled = s.duplicates === 0;
  $("group").disabled = false;
  $("dedupe").textContent = s.duplicates
    ? `Close ${plural(s.duplicates, "duplicate tab")}`
    : "No duplicate tabs";
}

function setStatus(text, isError = false) {
  $("status").textContent = text;
  $("status").classList.toggle("error", isError);
}

async function run(action) {
  $("merge").disabled = $("dedupe").disabled = $("group").disabled = true;
  setStatus("Working…");
  const { id: windowId } = await chrome.windows.getCurrent();
  const reply = await chrome.runtime.sendMessage({ action, windowId });
  if (!reply?.ok) {
    setStatus(reply?.error ?? "No response from the extension.", true);
  } else {
    const r = reply.result;
    const parts = [];
    if (r.moved != null) parts.push(`Moved ${plural(r.moved, "tab")} from ${plural(r.windows, "window")}`);
    if (r.closed) parts.push(`closed ${plural(r.closed, "duplicate")}`);
    if (r.grouped) parts.push(`grouped ${plural(r.grouped, "tab")} into ${plural(r.groups, "group")}`);
    if (r.failed?.length) parts.push(`${plural(r.failed.length, "tab")} could not be moved`);
    const text = parts.join(", ") || "Nothing to do";
    setStatus(text[0].toUpperCase() + text.slice(1) + ".", Boolean(r.failed?.length));
    if (r.failed?.length) console.warn("Tab Corral: tabs not moved", r.failed);
  }
  await refresh();
}

$("merge").addEventListener("click", () => run("merge-all"));
$("dedupe").addEventListener("click", () => run("dedupe"));
$("group").addEventListener("click", () => run("group-by-site"));

const options = await getOptions();
for (const key of Object.keys(DEFAULTS)) {
  $(key).checked = options[key];
  $(key).addEventListener("change", async (e) => {
    await chrome.storage.sync.set({ [key]: e.target.checked });
    await refresh();
  });
}
await refresh();
