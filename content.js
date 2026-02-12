let wideStyleEl = null;

function applyWideMode() {
  chrome.storage.local.get(["wideMode", "wideWidth"], (result) => {
    if (result.wideMode) {
      const width = result.wideWidth || 900;
      if (!wideStyleEl) {
        wideStyleEl = document.createElement("style");
        wideStyleEl.id = "x-video-resume-wide";
      }
      wideStyleEl.textContent = `html .r-1ye8kvj { max-width: ${width}px !important; }`;
      document.documentElement.appendChild(wideStyleEl);
    } else if (wideStyleEl) {
      wideStyleEl.remove();
      wideStyleEl = null;
    }
  });
}

applyWideMode();

chrome.storage.onChanged.addListener((changes) => {
  if (changes.wideMode || changes.wideWidth) applyWideMode();
});

function getVideoKey(video) {
  if (!video.poster) return null;
  const match = video.poster.match(
    /\/(?:ext_tw_video_thumb|amplify_video_thumb)\/(\d+)/,
  );
  return match ? `xvid_${match[1]}` : null;
}

function saveTimestamp(video) {
  const key = getVideoKey(video);
  if (!key) return;

  const time = Math.floor(video.currentTime);
  if (time < 3) return;

  chrome.storage.local.set({ [key]: time });
}

function attachToVideo(video) {
  if (video.dataset.xResumeAttached) return;
  video.dataset.xResumeAttached = "true";

  let saveDebounce = null;

  video.addEventListener("timeupdate", () => {
    if (saveDebounce) clearTimeout(saveDebounce);
    saveDebounce = setTimeout(() => saveTimestamp(video), 1000);
  });

  video.addEventListener("pause", () => saveTimestamp(video));
  video.addEventListener("seeked", () => saveTimestamp(video));

  const saveInterval = setInterval(() => {
    if (!video.paused && !video.ended && video.currentTime > 3) {
      saveTimestamp(video);
    }
  }, 2000);

  video.addEventListener("ended", () => {
    clearInterval(saveInterval);
    const key = getVideoKey(video);
    if (key) {
      chrome.storage.local.remove(key);
    }
  });

  let restored = false;

  function restoreTimestamp() {
    if (restored) {
      return;
    }
    if (video.currentTime > 3) {
      return;
    }

    const k = getVideoKey(video);
    if (!k) return;

    chrome.storage.local.get([k], (result) => {
      const saved = result[k];
      if (saved && saved > 3) {
        const trySeek = () => {
          if (restored) return;
          if (Math.abs(video.currentTime - saved) > 2) {
            video.currentTime = saved;
            restored = true;
          }
        };

        trySeek();
        setTimeout(trySeek, 600);
        setTimeout(trySeek, 1500);
      }
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
