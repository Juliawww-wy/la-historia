const SITE_PATTERNS = ["https://la-historia.vercel.app/*", "http://localhost:3000/*"];
const SITE_URL = "https://la-historia.vercel.app/";
const MENU_ID = "la-historia-lookup";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: MENU_ID,
    title: '用 La Historia 查词 "%s"',
    contexts: ["selection"],
  });
});

chrome.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId !== MENU_ID) return;
  const text = info.selectionText?.trim();
  if (!text) return;

  await chrome.storage.local.set({ pendingText: { text, ts: Date.now() } });

  const existingTabs = await chrome.tabs.query({ url: SITE_PATTERNS });
  const existing = existingTabs[0];
  if (existing?.id != null) {
    await chrome.tabs.update(existing.id, { active: true });
    if (existing.windowId != null) {
      await chrome.windows.update(existing.windowId, { focused: true });
    }
  } else {
    await chrome.tabs.create({ url: SITE_URL });
  }
});
