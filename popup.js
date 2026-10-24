const wideToggle = document.getElementById("wideToggle");
const rewindSelect = document.getElementById("rewindSelect");
const status = document.getElementById("status");

const DEFAULT_REWIND = 3;

chrome.storage.local.get(["wideMode", "rewindSeconds"], (result) => {
  wideToggle.checked = result.wideMode || false;
  rewindSelect.value = String(result.rewindSeconds ?? DEFAULT_REWIND);
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

rewindSelect.addEventListener("change", () => {
  const seconds = Number(rewindSelect.value);
  chrome.storage.local.set({ rewindSeconds: seconds }, () => {
    showStatus(seconds ? `Rewinding ${seconds}s on resume` : "Rewind off");
  });
});
