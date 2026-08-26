/**
 * Isolated-world half of the site filter. The page-world script cannot reach
 * chrome.storage, and this cannot patch the page's `fetch`, so this reads the
 * room keys and hands them across via postMessage.
 */

function keysFrom(chats) {
  const keys = [];
  for (const chat of chats ?? []) {
    if (chat.expandKey) keys.push(chat.expandKey);
    for (const message of chat.messages ?? []) {
      if (message.expandKey) keys.push(message.expandKey);
    }
  }
  return keys;
}

async function publish() {
  const { chats, hideChatOnSite } = await chrome.storage.local.get(['chats', 'hideChatOnSite']);

  window.postMessage(
    {
      source: 'kanm-filter',
      enabled: Boolean(hideChatOnSite),
      keys: keysFrom(chats),
    },
    window.location.origin,
  );
}

publish();

// New messages mean new keys, so keep the page-world copy current.
chrome.storage.onChanged.addListener((changes) => {
  if (changes.chats || changes.hideChatOnSite) publish();
});
