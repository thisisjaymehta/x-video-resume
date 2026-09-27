let wideStyleEl = null;

// Pin the nav and right sidebar to the window edges and let the primary
// column fill the space between them
const WIDE_CSS = `
header[role="banner"] {
  flex-grow: 0 !important;
  align-items: flex-start !important;
}
header[role="banner"] > div {
  margin-left: 0 !important;
}
main[role="main"] {
  align-items: stretch !important;
}
main[role="main"] > div,
div:has(> [data-testid="primaryColumn"]) {
  width: 100% !important;
  max-width: none !important;
}
[data-testid="primaryColumn"] {
  flex: 1 1 0 !important;
  width: auto !important;
  min-width: 0 !important;
  max-width: none !important;
}
[data-testid="primaryColumn"] .r-1ye8kvj {
  max-width: none !important;
}
[data-testid="sidebarColumn"] {
  margin-right: 0 !important;
}
`;

function applyWideMode() {
  chrome.storage.local.get(["wideMode"], (result) => {
    if (result.wideMode) {
      if (!wideStyleEl) {
        wideStyleEl = document.createElement("style");
        wideStyleEl.id = "x-video-resume-wide";
        wideStyleEl.textContent = WIDE_CSS;
      }
      document.documentElement.appendChild(wideStyleEl);
    } else if (wideStyleEl) {
      wideStyleEl.remove();
      wideStyleEl = null;
    }
  });
}

applyWideMode();

chrome.storage.onChanged.addListener((changes) => {
  if (changes.wideMode) applyWideMode();
});

function hashString(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(36);
}

function getVideoKey(video) {
  if (!video.poster) return null;
  const match = video.poster.match(
    /\/(?:ext_tw_video_thumb|amplify_video_thumb)\/(\d+)/,
  );
  if (match) return `xvid_${match[1]}`;

  // Broadcasts (Periscope/Media Studio replays) use pscp.tv thumbnails
  let posterUrl;
  try {
    posterUrl = new URL(video.poster);
  } catch {
    return null;
  }
  if (!posterUrl.hostname.endsWith("pscp.tv")) return null;

  const broadcastMatch = location.pathname.match(/^\/i\/broadcasts\/(\w+)/);
  if (broadcastMatch) return `xbc_${broadcastMatch[1]}`;

  // Broadcast embedded in a tweet: the thumbnail path is stable per broadcast
  return `xbc_p${hashString(posterUrl.pathname)}`;
}

function isLive(video) {
  return video.duration === Infinity;
}

function saveTimestamp(video) {
  if (isLive(video)) return;
  const key = getVideoKey(video);
  if (!key) return;

  const time = Math.floor(video.currentTime);
  if (time < 3) return;

  chrome.storage.local.set({ [key]: { t: time, muted: video.muted } });
}

// Entries saved by older versions are a plain number of seconds
function parseSaved(saved) {
  if (typeof saved === "number") return { t: saved };
  return saved && typeof saved.t === "number" ? saved : null;
}

// Restore retries stop once the user interacts, so they never undo the
// user's own seek or mute toggle
let lastUserInput = 0;
for (const type of ["pointerdown", "keydown"]) {
  document.addEventListener(type, () => (lastUserInput = Date.now()), true);
}

function applyMuted(video, muted) {
  if (typeof muted !== "boolean" || video.muted === muted) return;
  // Chrome pauses a video unmuted before the user has interacted with the
  // page, so only unmute once the page has had a click or key press
  if (!muted && !navigator.userActivation?.hasBeenActive) return;
  video.muted = muted;
}

function attachToVideo(video) {
  if (video.dataset.xResumeAttached) return;
  video.dataset.xResumeAttached = "true";

  // Track per key: X reuses the same <video> element across SPA navigations
  let restoredKey = null;

  // Don't save until the restore check for this video has run, otherwise
  // autoplay would overwrite the saved position before we can resume it
  function save() {
    const k = getVideoKey(video);
    if (k && restoredKey === k) saveTimestamp(video);
  }

  let saveDebounce = null;

  video.addEventListener("timeupdate", () => {
    restoreTimestamp();
    if (saveDebounce) clearTimeout(saveDebounce);
    saveDebounce = setTimeout(save, 1000);
  });

  video.addEventListener("pause", save);
  video.addEventListener("seeked", save);
  video.addEventListener("volumechange", save);

  const saveInterval = setInterval(() => {
    if (!video.paused && !video.ended && video.currentTime > 3) {
      save();
    }
  }, 2000);

  video.addEventListener("ended", () => {
    clearInterval(saveInterval);
    const key = getVideoKey(video);
    if (key) {
      chrome.storage.local.remove(key);
    }
  });

  let pendingKey = null;

  function restoreTimestamp() {
    const k = getVideoKey(video);
    if (!k || restoredKey === k || pendingKey === k) return;
    if (isLive(video)) return;

    pendingKey = k;
    chrome.storage.local.get([k], (result) => {
      pendingKey = null;
      if (getVideoKey(video) !== k) return;
      restoredKey = k;

      const saved = parseSaved(result[k]);
      if (!saved || saved.t <= 3) return;

      if (Math.abs(video.currentTime - saved.t) > 2) {
        video.currentTime = saved.t;
      }
      applyMuted(video, saved.muted);

      // Players may reset the position (notably the HLS broadcast player) or
      // re-mute (X mutes videos it autoplays) right after load, so re-apply
      const restoredAt = Date.now();
      const retry = () => {
        if (getVideoKey(video) !== k || lastUserInput > restoredAt) return;
        if (video.currentTime < 3) video.currentTime = saved.t;
        applyMuted(video, saved.muted);
      };
      setTimeout(retry, 600);
      setTimeout(retry, 1500);
      setTimeout(retry, 3000);
    });
  }

  video.addEventListener("loadedmetadata", restoreTimestamp);
  video.addEventListener("play", () => setTimeout(restoreTimestamp, 300));

  if (video.readyState >= 2) restoreTimestamp();
}

const observer = new MutationObserver((mutations) => {
  mutations.forEach((mutation) => {
    mutation.addedNodes.forEach((node) => {
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      if (node.tagName === "VIDEO") attachToVideo(node);
      node.querySelectorAll &&
        node.querySelectorAll("video").forEach(attachToVideo);
    });
  });
});

observer.observe(document.documentElement, { childList: true, subtree: true });

document.querySelectorAll("video").forEach(attachToVideo);
