(function () {
  const MAX_AGE_MS = 15000;

  function deliver(text) {
    window.dispatchEvent(new CustomEvent("la-historia:import", { detail: { text } }));
  }

  function consumePending(pending) {
    if (!pending || !pending.text) return;
    chrome.storage.local.remove("pendingText");
    if (Date.now() - pending.ts <= MAX_AGE_MS) deliver(pending.text);
  }

  chrome.storage.local.get("pendingText", (result) => consumePending(result.pendingText));

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.pendingText?.newValue) {
      consumePending(changes.pendingText.newValue);
    }
  });
})();
