import { dedupe, groupBySite, mergeAllAndMaybeDedupe } from "./core.js";

// The popup delegates here so an operation keeps running if the popup closes.
const actions = {
  "merge-all": (msg) => mergeAllAndMaybeDedupe({ targetWindowId: msg?.windowId }),
  dedupe: (msg) => dedupe({ preferWindowId: msg?.windowId }),
  "group-by-site": (msg) => groupBySite({ windowId: msg?.windowId }),
};

chrome.commands.onCommand.addListener((command) => {
  actions[command]?.();
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const action = actions[msg?.action];
  if (!action) return false;
  action(msg).then(
    (result) => sendResponse({ ok: true, result }),
    (err) => sendResponse({ ok: false, error: String(err?.message ?? err) })
  );
  return true;
});
