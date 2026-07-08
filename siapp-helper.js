(function () {
  const bookmarkletLink = document.querySelector("#bookmarkletLink");
  const watchBookmarkletLink = document.querySelector("#watchBookmarkletLink");
  const fullBookmarkletLink = document.querySelector("#fullBookmarkletLink");
  const copyButton = document.querySelector("#copyBookmarkletBtn");
  const watchIntervalSelect = document.querySelector("#watchIntervalSelect");
  const statusText = document.querySelector("#helperStatus");
  const googleScriptUrl = window.APP_CONFIG && window.APP_CONFIG.GOOGLE_SCRIPT_URL;
  const syncScriptUrl = new URL("siapp-sync.js", window.location.href).href;

  function showStatus(message) {
    if (statusText) statusText.textContent = message;
  }

  function getWatchIntervalMs() {
    const value = Number(watchIntervalSelect && watchIntervalSelect.value);
    return value || 300000;
  }

  function getWatchIntervalLabel() {
    const minutes = Math.max(1, Math.round(getWatchIntervalMs() / 60000));
    return minutes + " menit";
  }

  function buildBookmarklet(mode) {
    const config = {
      googleScriptUrl: googleScriptUrl,
      syncScriptUrl: syncScriptUrl,
      syncMode: mode || "quick",
      watchIntervalMs: getWatchIntervalMs()
    };
    const source = [
      "(function(){",
      "function m(t,c){var e=document.getElementById('siapp-sync-status');if(!e){e=document.createElement('div');e.id='siapp-sync-status';e.style.cssText='position:fixed;right:16px;top:16px;z-index:999999;padding:12px 14px;border-radius:8px;background:rgb(22,35,49);color:white;font:700 13px Arial,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.22);max-width:320px';document.body.appendChild(e);}e.textContent=t;if(c)e.style.background=c;}",
      "try{",
      "window.__WAJIB_PAJAK_SYNC_CONFIG=" + JSON.stringify(config) + ";",
      "m('Memuat Sinkron SIAPP...');",
      "var old=document.getElementById('siapp-sync-loader');if(old)old.remove();",
      "var s=document.createElement('script');s.id='siapp-sync-loader';s.src=" + JSON.stringify(syncScriptUrl) + "+'?v='+Date.now();",
      "s.onerror=function(){m('Script Sinkron SIAPP gagal dimuat. Buka ulang aplikasi, pasang ulang bookmark, lalu coba lagi.','rgb(180,35,24)');};",
      "document.body.appendChild(s);",
      "}catch(e){alert('Sinkron SIAPP gagal berjalan: '+e.message);}",
      "}())"
    ].join("");
    return "javascript:" + source;
  }

  function updateBookmarklets() {
    const quickBookmarklet = buildBookmarklet("quick");
    const watchBookmarklet = buildBookmarklet("watch");
    const fullBookmarklet = buildBookmarklet("full");
    if (bookmarkletLink) bookmarkletLink.href = quickBookmarklet;
    if (watchBookmarkletLink) {
      watchBookmarkletLink.href = watchBookmarklet;
      watchBookmarkletLink.textContent = "Pantau " + getWatchIntervalLabel();
    }
    if (fullBookmarkletLink) fullBookmarkletLink.href = fullBookmarklet;
    showStatus("Tombol siap dipasang. Pantau Otomatis akan cek SIAPP tiap " + getWatchIntervalLabel() + ".");
    return { quickBookmarklet: quickBookmarklet, watchBookmarklet: watchBookmarklet, fullBookmarklet: fullBookmarklet };
  }

  if (!googleScriptUrl) {
    showStatus("URL Google Apps Script belum terisi di config.js.");
    if (bookmarkletLink) bookmarkletLink.removeAttribute("href");
    if (watchBookmarkletLink) watchBookmarkletLink.removeAttribute("href");
    if (fullBookmarkletLink) fullBookmarkletLink.removeAttribute("href");
    if (copyButton) copyButton.disabled = true;
    return;
  }

  let bookmarklets = updateBookmarklets();

  if (watchIntervalSelect) {
    watchIntervalSelect.addEventListener("change", function () {
      bookmarklets = updateBookmarklets();
    });
  }

  if (copyButton) {
    copyButton.addEventListener("click", async function () {
      try {
        await navigator.clipboard.writeText(bookmarklets.quickBookmarklet);
        showStatus("Kode Sinkron Cepat berhasil dicopy. Buat bookmark baru lalu tempel di kolom URL.");
      } catch (error) {
        showStatus("Gagal copy otomatis. Tarik tombol Sinkron Cepat ke bookmark bar.");
      }
    });
  }
})();
