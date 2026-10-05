// Opens the colour manager when you pick "Manage colours…" in the right-click menu.
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (sender.id !== chrome.runtime.id) return;
  if (msg && msg.type === "twotone-open-manager") chrome.runtime.openOptionsPage();
});
