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

// The "Resumed at" notice and the watched-progress bar on thumbnails
const UI_CSS = `
.xresume-notice {
  position: absolute;
  top: 12px;
  left: 12px;
  z-index: 10;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 5px 5px 5px 12px;
  border-radius: 999px;
  background: rgba(15, 20, 25, 0.85);
  color: #fff;
  font: 500 13px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  transition: opacity 0.4s;
}
.xresume-notice.xresume-hide {
  opacity: 0;
}
.xresume-notice button {
  all: unset;
  cursor: pointer;
  padding: 5px 12px;
  border-radius: 999px;
  background: #fff;
  color: #0f1419;
  font-weight: 700;
}
.xresume-notice button:hover {
  background: #d7dbdc;
}
.xresume-notice button:focus-visible {
  outline: 2px solid #1d9bf0;
  outline-offset: 2px;
}
.xresume-progress {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 10;
  height: 4px;
  background: rgba(255, 255, 255, 0.35);
  pointer-events: none;
}
.xresume-progress > div {
  height: 100%;
  background: #1d9bf0;
}
`;

const uiStyleEl = document.createElement("style");
uiStyleEl.id = "x-video-resume-ui";
uiStyleEl.textContent = UI_CSS;
document.documentElement.appendChild(uiStyleEl);

const DEFAULT_REWIND = 3;

const THUMB_RE = /\/(?:ext_tw_video_thumb|amplify_video_thumb)\/(\d+)/;

function isSavedKey(key) {
  return key.startsWith("xvid_") || key.startsWith("xbc_");
}

function hashString(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(36);
}

function getVideoKey(video) {
  if (!video.poster) return null;
  const match = video.poster.match(THUMB_RE);
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

// Close enough to the end to count as watched: the last 5% (end cards,
// credits) up to a minute for long broadcasts, or the last 5s (10% for
// clips under 50s)
function isNearEnd(t, d) {
  if (!Number.isFinite(d) || d <= 0) return false;
  return d - t <= Math.max(Math.min(d * 0.05, 60), Math.min(5, d * 0.1));
}

function saveTimestamp(video) {
  if (isLive(video)) return;
  const key = getVideoKey(video);
  if (!key) return;

  const time = Math.floor(video.currentTime);
  if (time < 3) return;

  const duration = video.duration;
  if (isNearEnd(time, duration)) {
    chrome.storage.local.remove(key);
    return;
  }

  const entry = {
    t: time,
    muted: video.muted,
    volume: video.volume,
    rate: video.playbackRate,
    at: Date.now(),
  };
  if (Number.isFinite(duration)) entry.d = Math.round(duration);
  chrome.storage.local.set({ [key]: entry });
}

// Entries saved by older versions are a plain number of seconds
function parseSaved(saved) {
  if (typeof saved === "number") return { t: saved };
  return saved && typeof saved.t === "number" ? saved : null;
}

// Saved positions are otherwise only removed when a video plays to the end,
// so drop ones untouched for a month and cap the total, keeping storage
// well under its quota
const MAX_AGE = 30 * 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 1000;
const PRUNE_INTERVAL = 24 * 60 * 60 * 1000;

function pruneSaved() {
  chrome.storage.local.get(null, (all) => {
    const now = Date.now();
    if (now - (all.lastPrune || 0) < PRUNE_INTERVAL) return;

    const updates = { lastPrune: now };
    const remove = [];
    const kept = [];
    for (const [key, value] of Object.entries(all)) {
      if (!isSavedKey(key)) continue;
      const saved = parseSaved(value);
      if (!saved) {
        remove.push(key);
      } else if (typeof saved.at !== "number") {
        // Entries from older versions have no timestamp: start their clock now
        updates[key] = { ...saved, at: now };
        kept.push([key, now]);
      } else if (now - saved.at > MAX_AGE) {
        remove.push(key);
      } else {
        kept.push([key, saved.at]);
      }
    }

    kept.sort((a, b) => b[1] - a[1]);
    for (const [key] of kept.slice(MAX_ENTRIES)) {
      remove.push(key);
      delete updates[key];
    }

    chrome.storage.local.set(updates);
    if (remove.length) chrome.storage.local.remove(remove);
  });
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

function applyPlayback(video, saved) {
  applyMuted(video, saved.muted);
  if (typeof saved.volume === "number" && video.volume !== saved.volume) {
    video.volume = saved.volume;
  }
  if (typeof saved.rate === "number" && video.playbackRate !== saved.rate) {
    video.playbackRate = saved.rate;
  }
}

function formatTime(seconds) {
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

function playerContainer(video) {
  return video.closest('[data-testid="videoPlayer"]') || video.parentElement;
}

// Overlays are absolutely positioned against the element they're added to
function ensurePositioned(el) {
  if (getComputedStyle(el).position === "static") el.style.position = "relative";
}

function showResumeNotice(video, key, time) {
  const container = playerContainer(video);
  if (!container) return;
  container.querySelector(":scope > .xresume-notice")?.remove();

  const notice = document.createElement("div");
  notice.className = "xresume-notice";
  const label = document.createElement("span");
  label.textContent = `Resumed at ${formatTime(time)}`;
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "Start over";
  notice.append(label, button);

  // Keep clicks from reaching X's player, which would pause or open the video
  for (const type of ["click", "pointerdown", "pointerup", "mousedown", "mouseup"]) {
    notice.addEventListener(type, (e) => e.stopPropagation());
  }
  button.addEventListener("click", () => {
    notice.remove();
    if (getVideoKey(video) !== key) return;
    chrome.storage.local.remove(key);
    video.currentTime = 0;
  });

  ensurePositioned(container);
  container.appendChild(notice);
  setTimeout(() => notice.classList.add("xresume-hide"), 5000);
  setTimeout(() => notice.remove(), 5500);
}

function removeProgressBar(container) {
  container.querySelector(":scope > .xresume-progress")?.remove();
}

function setProgressBar(container, key, saved) {
  const fraction = saved && saved.d ? saved.t / saved.d : 0;
  if (!fraction) {
    removeProgressBar(container);
    return;
  }

  let bar = container.querySelector(":scope > .xresume-progress");
  if (!bar) {
    bar = document.createElement("div");
    bar.className = "xresume-progress";
    bar.appendChild(document.createElement("div"));
    ensurePositioned(container);
    container.appendChild(bar);
  }
  bar.dataset.key = key;
  bar.firstChild.style.width = `${Math.min(fraction, 1) * 100}%`;
}

// isCurrent re-checks after the async read, since X reuses elements
function showProgressBar(container, key, isCurrent) {
  chrome.storage.local.get([key], (result) => {
    if (isCurrent()) setProgressBar(container, key, parseSaved(result[key]));
  });
}

// Only before a video first plays: after that X's own progress bar shows
function refreshVideoBar(video) {
  const container = playerContainer(video);
  if (!container) return;
  const k = getVideoKey(video);
  if (!k || !video.paused || video.played.length) {
    removeProgressBar(container);
    return;
  }
  showProgressBar(
    container,
    k,
    () => getVideoKey(video) === k && video.paused && !video.played.length,
  );
}

// Thumbnail images, e.g. in a profile's media grid
function attachToThumbnail(img) {
  const container = img.parentElement;
  if (!container || img.closest('[data-testid="videoPlayer"]')) return;

  const id = img.src.match(THUMB_RE)?.[1];
  if (!id) {
    removeProgressBar(container);
    return;
  }
  showProgressBar(
    container,
    `xvid_${id}`,
    () => img.src.match(THUMB_RE)?.[1] === id,
  );
}

function attachToVideo(video) {
  if (video.dataset.xResumeAttached) return;
  video.dataset.xResumeAttached = "true";

  // Track per key: X reuses the same <video> element across SPA navigations
  let restoredKey = null;

  // Resuming rewinds to before the saved position. Hold that position until
  // playback passes it or the user seeks, or each visit would creep it back
  let rewindHold = null;

  // Don't save until the restore check for this video has run, otherwise
  // autoplay would overwrite the saved position before we can resume it
  function save() {
    const k = getVideoKey(video);
    if (!k || restoredKey !== k) return;
    if (rewindHold) {
      if (
        rewindHold.key === k &&
        video.currentTime < rewindHold.t &&
        lastUserInput <= rewindHold.at
      ) {
        return;
      }
      rewindHold = null;
    }
    saveTimestamp(video);
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
  video.addEventListener("ratechange", save);

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
    chrome.storage.local.get([k, "rewindSeconds"], (result) => {
      pendingKey = null;
      if (getVideoKey(video) !== k) return;
      restoredKey = k;

      const saved = parseSaved(result[k]);
      if (!saved || saved.t <= 3) return;

      // Stopped during the end cards or credits: start fresh next time
      if (isNearEnd(saved.t, saved.d || video.duration)) {
        chrome.storage.local.remove(k);
        return;
      }

      // Back up a little so the viewer picks up the context
      const rewind = result.rewindSeconds ?? DEFAULT_REWIND;
      const target = Math.max(saved.t - rewind, 3);
      const restoredAt = Date.now();

      if (Math.abs(video.currentTime - saved.t) > 2) {
        rewindHold = { key: k, t: saved.t, at: restoredAt };
        video.currentTime = target;
        showResumeNotice(video, k, target);
      }
      applyPlayback(video, saved);

      // Players may reset the position (notably the HLS broadcast player) or
      // re-mute (X mutes videos it autoplays) right after load, so re-apply
      const retry = () => {
        if (getVideoKey(video) !== k || lastUserInput > restoredAt) return;
        if (video.currentTime < 3) video.currentTime = target;
        applyPlayback(video, saved);
      };
      setTimeout(retry, 600);
      setTimeout(retry, 1500);
      setTimeout(retry, 3000);
    });
  }

  video.addEventListener("loadedmetadata", restoreTimestamp);
  video.addEventListener("play", () => {
    refreshVideoBar(video);
    setTimeout(restoreTimestamp, 300);
  });

  if (video.readyState >= 2) restoreTimestamp();
  refreshVideoBar(video);
}

chrome.storage.onChanged.addListener((changes) => {
  if (changes.wideMode) applyWideMode();

  for (const [key, { newValue }] of Object.entries(changes)) {
    if (!isSavedKey(key)) continue;
    const saved = parseSaved(newValue);
    const selector = `.xresume-progress[data-key="${CSS.escape(key)}"]`;
    for (const bar of document.querySelectorAll(selector)) {
      setProgressBar(bar.parentElement, key, saved);
    }
  }
});

const THUMB_SELECTOR =
  'img[src*="/ext_tw_video_thumb/"], img[src*="/amplify_video_thumb/"]';

const observer = new MutationObserver((mutations) => {
  mutations.forEach((mutation) => {
    // X swaps a reused element's poster or src when it shows another video
    if (mutation.type === "attributes") {
      const el = mutation.target;
      if (el.tagName === "VIDEO" && el.dataset.xResumeAttached) {
        refreshVideoBar(el);
      } else if (el.tagName === "IMG") {
        attachToThumbnail(el);
      }
      return;
    }

    mutation.addedNodes.forEach((node) => {
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      if (node.tagName === "VIDEO") attachToVideo(node);
      if (node.matches(THUMB_SELECTOR)) attachToThumbnail(node);
      if (!node.querySelectorAll) return;
      node.querySelectorAll("video").forEach(attachToVideo);
      node.querySelectorAll(THUMB_SELECTOR).forEach(attachToThumbnail);
    });
  });
});

observer.observe(document.documentElement, {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ["poster", "src"],
});

document.querySelectorAll("video").forEach(attachToVideo);
document.querySelectorAll(THUMB_SELECTOR).forEach(attachToThumbnail);

pruneSaved();
