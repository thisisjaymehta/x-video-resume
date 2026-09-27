const wideToggle = document.getElementById("wideToggle");
const status = document.getElementById("status");

chrome.storage.local.get(["wideMode"], (result) => {
  wideToggle.checked = result.wideMode || false;
});

function showStatus(msg) {
  status.textContent = msg;
  setTimeout(() => (status.textContent = ""), 1500);
}

wideToggle.addEventListener("change", () => {
  const enabled = wideToggle.checked;
  chrome.storage.local.set({ wideMode: enabled }, () => {
    showStatus(enabled ? "Wide mode enabled" : "Wide mode disabled");
  });
});
