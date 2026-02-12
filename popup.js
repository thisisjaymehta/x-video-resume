const wideToggle = document.getElementById("wideToggle");
const widthInput = document.getElementById("widthInput");
const widthRow = document.getElementById("widthRow");
const status = document.getElementById("status");

chrome.storage.local.get(["wideMode", "wideWidth"], (result) => {
  wideToggle.checked = result.wideMode || false;
  widthInput.value = result.wideWidth || 900;
  widthRow.style.display = wideToggle.checked ? "flex" : "none";
});

function showStatus(msg) {
  status.textContent = msg;
  setTimeout(() => (status.textContent = ""), 1500);
}

wideToggle.addEventListener("change", () => {
  const enabled = wideToggle.checked;
  widthRow.style.display = enabled ? "flex" : "none";
  chrome.storage.local.set({ wideMode: enabled }, () => {
    showStatus(enabled ? "Wide mode enabled" : "Wide mode disabled");
  });
});

let widthDebounce = null;
widthInput.addEventListener("input", () => {
  if (widthDebounce) clearTimeout(widthDebounce);
  widthDebounce = setTimeout(() => {
    const val = Math.max(
      600,
      Math.min(1400, parseInt(widthInput.value) || 900),
    );
    widthInput.value = val;
    chrome.storage.local.set({ wideWidth: val }, () => {
      showStatus(`Width set to ${val}px`);
    });
  }, 400);
});
