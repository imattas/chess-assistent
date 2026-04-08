// Minimal background script. The engine and watcher live in the tab — this
// only handles the install event so users get a friendly first-run nudge.

self.addEventListener('install', () => {});

if (typeof browser !== 'undefined' && browser.runtime?.onInstalled) {
  browser.runtime.onInstalled.addListener(details => {
    if (details.reason === 'install') {
      browser.tabs.create({ url: browser.runtime.getURL('popup/popup.html') });
    }
  });
} else if (typeof chrome !== 'undefined' && chrome.runtime?.onInstalled) {
  chrome.runtime.onInstalled.addListener(details => {
    if (details.reason === 'install') {
      chrome.tabs.create({ url: chrome.runtime.getURL('popup/popup.html') });
    }
  });
}
