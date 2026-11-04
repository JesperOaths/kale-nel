"use strict";
(() => {
  // Solo remains on the existing Tune Rush page; the S21 only runs the game engine.
  const stage = document.getElementById("solo-stage");
  const frame = document.getElementById("solo-frame");
  const openButton = document.getElementById("solo-launch");
  const backButton = document.getElementById("solo-exit");
  if (!stage || !frame || !openButton || !backButton) return;
  const isSoloURL = () => new URL(location.href).searchParams.get("mode") === "solo";
  function setMode(enabled, updateURL) {
    document.body.classList.toggle("solo-mode-active", enabled);
    stage.hidden = !enabled;
    if (enabled && !frame.hasAttribute("src")) frame.setAttribute("src", frame.dataset.src);
    if (!enabled && frame.contentWindow) {
      frame.contentWindow.postMessage({type:"tunerush-solo-pause"}, location.origin);
    }
    if (updateURL) {
      const url = new URL(location.href);
      if (enabled) {
        url.searchParams.delete("room");
        url.searchParams.set("mode", "solo");
      } else url.searchParams.delete("mode");
      history.pushState({soloMode:enabled}, "", url);
    }
    if (enabled) {
      requestAnimationFrame(() => stage.scrollIntoView({block:"start",behavior:"instant"}));
    }
  }
  openButton.addEventListener("click", event => {
    event.preventDefault();
    setMode(true, !isSoloURL());
  });
  backButton.addEventListener("click", () => setMode(false,true));
  window.addEventListener("popstate", () => setMode(isSoloURL(),false));
  window.addEventListener("message", event => {
    if (event.origin !== location.origin || event.source !== frame.contentWindow) return;
    if (event.data?.type !== "tunerush-solo-iframe-size") return;
    const height = Number(event.data.height);
    if (Number.isFinite(height) && height > 0) {
      frame.style.height = Math.max(700, Math.min(2400,height + 40)) + "px";
    }
  });
  if (isSoloURL()) setMode(true,false);
})();

