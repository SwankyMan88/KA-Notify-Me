/** Sends to the service worker and never throws -- callers check `ok`. */
export async function send(message) {
  try {
    return await chrome.runtime.sendMessage(message);
  } catch (error) {
    return { ok: false, error: String(error?.message ?? error) };
  }
}
