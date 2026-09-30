(function () {
  const bookmarkletLink = document.querySelector("#bookmarkletLink");
  const periodBookmarkletLink = document.querySelector("#periodBookmarkletLink");
  const refreshBookmarkletLink = document.querySelector("#refreshBookmarkletLink");
  const watchBookmarkletLink = document.querySelector("#watchBookmarkletLink");
  const fullBookmarkletLink = document.querySelector("#fullBookmarkletLink");
  const vehicleDetailBookmarkletLink = document.querySelector("#vehicleDetailBookmarkletLink");
  const vehicleDetailBatchBookmarkletLink = document.querySelector("#vehicleDetailBatchBookmarkletLink");
  const copyButton = document.querySelector("#copyBookmarkletBtn");
  const watchIntervalSelect = document.querySelector("#watchIntervalSelect");
  const periodMonthSelect = document.querySelector("#periodMonthSelect");
  const periodYearInput = document.querySelector("#periodYearInput");
  const vehicleDetailScope = document.querySelector("#vehicleDetailScope");
  const statusText = document.querySelector("#helperStatus");
  const appConfig = window.APP_CONFIG || {};
  const googleScriptUrl = appConfig.GOOGLE_SCRIPT_URL;
  const databaseProvider = String(appConfig.DATABASE_PROVIDER || "google-script").toLowerCase();
  const supabaseUrl = appConfig.SUPABASE_URL;
  const supabasePublishableKey = appConfig.SUPABASE_PUBLISHABLE_KEY;
  const syncScriptUrl = new URL("siapp-sync.js", window.location.href).href;
  const vehicleDetailScriptUrl = new URL("siapp-vehicle-detail.js", window.location.href).href;

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

  function getSelectedPeriod() {
    const currentDate = new Date();
    const month = Number(periodMonthSelect && periodMonthSelect.value) || currentDate.getMonth() + 1;
    const year = Number(periodYearInput && periodYearInput.value) || currentDate.getFullYear();
    return { month: month, year: year };
  }

  function initializePeriodControls() {
    const period = getSelectedPeriod();
    if (periodMonthSelect && !periodMonthSelect.value) periodMonthSelect.value = String(period.month);
    if (periodYearInput && !periodYearInput.value) periodYearInput.value = String(period.year);
  }

  function getVehicleDetailScope() {
    return vehicleDetailScope && vehicleDetailScope.value === "production" ? "production" : "taxpayers";
  }

  function buildBookmarklet(mode) {
    const config = {
      googleScriptUrl: googleScriptUrl,
      databaseProvider: databaseProvider,
      supabaseUrl: supabaseUrl,
      supabasePublishableKey: supabasePublishableKey,
      syncScriptUrl: syncScriptUrl,
      syncMode: mode || "quick",
      watchIntervalMs: getWatchIntervalMs(),
      syncPeriod: mode === "period" ? getSelectedPeriod() : null
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

  function buildVehicleDetailBookmarklet(mode) {
    const isBatch = mode === "batch";
    const config = {
      supabaseUrl: supabaseUrl,
      supabasePublishableKey: supabasePublishableKey,
      vehicleDetailMode: isBatch ? "batch" : "current",
      vehicleDetailScope: getVehicleDetailScope()
    };
    const source = [
      "(function(){",
      "function m(t,c){var e=document.getElementById('siapp-vehicle-detail-status');if(!e){e=document.createElement('div');e.id='siapp-vehicle-detail-status';e.style.cssText='position:fixed;right:16px;top:16px;z-index:999999;padding:12px 14px;border-radius:8px;background:rgb(22,35,49);color:white;font:700 13px Arial,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.22);max-width:320px';document.body.appendChild(e);}e.textContent=t;if(c)e.style.background=c;}",
      "try{",
      "window.__WAJIB_PAJAK_VEHICLE_DETAIL_CONFIG=" + JSON.stringify(config) + ";",
      "m(" + JSON.stringify(isBatch ? "Memuat penarikan detail otomatis..." : "Memuat Detail Status SIAPP...") + ");",
      "var old=document.getElementById('siapp-vehicle-detail-loader');if(old)old.remove();",
      "var s=document.createElement('script');s.id='siapp-vehicle-detail-loader';s.src=" + JSON.stringify(vehicleDetailScriptUrl) + "+'?v='+Date.now();",
      "s.onerror=function(){m(" + JSON.stringify(isBatch ? "Script Tarik Detail Otomatis gagal dimuat. Buka ulang aplikasi lalu pasang ulang bookmark." : "Script Detail Status SIAPP gagal dimuat. Buka ulang aplikasi lalu pasang ulang bookmark.") + ",'rgb(180,35,24)');};",
      "document.body.appendChild(s);",
      "}catch(e){alert(" + JSON.stringify(isBatch ? "Tarik Detail Otomatis gagal berjalan: " : "Detail Status SIAPP gagal berjalan: ") + "+e.message);}",
      "}())"
    ].join("");
    return "javascript:" + source;
  }

  function updateBookmarklets() {
    const quickBookmarklet = buildBookmarklet("quick");
    const periodBookmarklet = buildBookmarklet("period");
    const refreshBookmarklet = buildBookmarklet("refresh");
    const watchBookmarklet = buildBookmarklet("watch");
    const fullBookmarklet = buildBookmarklet("full");
    const vehicleDetailBookmarklet = buildVehicleDetailBookmarklet("current");
    const vehicleDetailBatchBookmarklet = buildVehicleDetailBookmarklet("batch");
    if (bookmarkletLink) bookmarkletLink.href = quickBookmarklet;
    if (periodBookmarkletLink) periodBookmarkletLink.href = periodBookmarklet;
    if (refreshBookmarkletLink) refreshBookmarkletLink.href = refreshBookmarklet;
    if (watchBookmarkletLink) {
      watchBookmarkletLink.href = watchBookmarklet;
      watchBookmarkletLink.textContent = "Pantau " + getWatchIntervalLabel();
    }
    if (fullBookmarkletLink) fullBookmarkletLink.href = fullBookmarklet;
    if (vehicleDetailBookmarkletLink) vehicleDetailBookmarkletLink.href = vehicleDetailBookmarklet;
    if (vehicleDetailBatchBookmarkletLink) vehicleDetailBatchBookmarkletLink.href = vehicleDetailBatchBookmarklet;
    showStatus("Tombol siap dipasang. Target Detail Otomatis: " + (getVehicleDetailScope() === "production" ? "seluruh nopol Buku Produksi" : "kartu follow-up") + ". Setelah mengganti target, pasang ulang bookmark Tarik Detail Otomatis.");
    return { quickBookmarklet: quickBookmarklet, periodBookmarklet: periodBookmarklet, refreshBookmarklet: refreshBookmarklet, watchBookmarklet: watchBookmarklet, fullBookmarklet: fullBookmarklet, vehicleDetailBookmarklet: vehicleDetailBookmarklet, vehicleDetailBatchBookmarklet: vehicleDetailBatchBookmarklet };
  }

  if (databaseProvider === "supabase" && (!supabaseUrl || !supabasePublishableKey)) {
    showStatus("Konfigurasi Supabase belum terisi di config.js.");
    if (bookmarkletLink) bookmarkletLink.removeAttribute("href");
    if (periodBookmarkletLink) periodBookmarkletLink.removeAttribute("href");
    if (refreshBookmarkletLink) refreshBookmarkletLink.removeAttribute("href");
    if (watchBookmarkletLink) watchBookmarkletLink.removeAttribute("href");
    if (fullBookmarkletLink) fullBookmarkletLink.removeAttribute("href");
    if (vehicleDetailBookmarkletLink) vehicleDetailBookmarkletLink.removeAttribute("href");
    if (vehicleDetailBatchBookmarkletLink) vehicleDetailBatchBookmarkletLink.removeAttribute("href");
    if (copyButton) copyButton.disabled = true;
    return;
  }

  if (databaseProvider !== "supabase" && !googleScriptUrl) {
    showStatus("URL Google Apps Script belum terisi di config.js.");
    if (bookmarkletLink) bookmarkletLink.removeAttribute("href");
    if (periodBookmarkletLink) periodBookmarkletLink.removeAttribute("href");
    if (refreshBookmarkletLink) refreshBookmarkletLink.removeAttribute("href");
    if (watchBookmarkletLink) watchBookmarkletLink.removeAttribute("href");
    if (fullBookmarkletLink) fullBookmarkletLink.removeAttribute("href");
    if (vehicleDetailBookmarkletLink) vehicleDetailBookmarkletLink.removeAttribute("href");
    if (vehicleDetailBatchBookmarkletLink) vehicleDetailBatchBookmarkletLink.removeAttribute("href");
    if (copyButton) copyButton.disabled = true;
    return;
  }

  initializePeriodControls();
  let bookmarklets = updateBookmarklets();

  if (databaseProvider !== "supabase") {
    [vehicleDetailBookmarkletLink, vehicleDetailBatchBookmarkletLink].forEach(function (link) {
      if (!link) return;
      link.removeAttribute("href");
      link.setAttribute("aria-disabled", "true");
      link.title = "Detail Status SIAPP memerlukan Supabase.";
    });
  }

  [watchIntervalSelect, periodMonthSelect, periodYearInput, vehicleDetailScope].forEach(function (control) {
    if (!control) return;
    control.addEventListener("change", function () {
      bookmarklets = updateBookmarklets();
    });
  });

  if (periodYearInput) {
    periodYearInput.addEventListener("input", function () {
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
