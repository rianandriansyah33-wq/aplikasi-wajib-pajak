(function () {
  "use strict";

  const config = window.__WAJIB_PAJAK_VEHICLE_DETAIL_CONFIG || {};
  const supabaseUrl = String(config.supabaseUrl || "").replace(/\/$/, "");
  const publishableKey = String(config.supabasePublishableKey || "");
  const LETTER_RANK = { SPOS: 1, NPP: 2, NTP: 3 };
  // Only this page and detail endpoint have been verified in SIAPP's Network tab.
  const VERIFIED_NTP_PAGE = "/idxstaf.php?id=32";
  const VERIFIED_NTP_DETAIL = "/view/vstatntp.php";
  const LETTER_TYPES = ["NTP", "NPP", "SPOS"];
  const BATCH_SIZE = 3;
  const BATCH_PAUSE_MS = 300;
  const PREFLIGHT_SAMPLE_LIMIT = 6;
  const statusPageEndpointCache = new Map();
  const scriptTextCache = new Map();
  const unavailableEndpoints = new Set();
  const REQUEST_TIMEOUT_MS = 15000;

  function notify(message, color) {
    let element = document.getElementById("siapp-vehicle-detail-status");
    if (!element) {
      element = document.createElement("div");
      element.id = "siapp-vehicle-detail-status";
      element.style.cssText = "position:fixed;right:16px;top:16px;z-index:999999;padding:12px 14px;border-radius:8px;background:rgb(22,35,49);color:white;font:700 13px Arial,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.22);max-width:360px";
      document.body.appendChild(element);
    }
    element.textContent = message;
    element.style.background = color || "rgb(22,35,49)";
    element.style.maxHeight = "70vh";
    element.style.overflowY = "auto";
  }

  function normalize(value) {
    return String(value || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  }

  function readableText(element) {
    return normalize(element && (element.innerText || element.textContent));
  }

  function normalizeLabel(value) {
    return normalize(value).toUpperCase().replace(/[.:]/g, "");
  }

  function normalizeLetterType(value) {
    const text = normalize(value).toUpperCase();
    if (text.includes("SPSO") || text.includes("SPOS")) return "SPOS";
    if (text.includes("NPP")) return "NPP";
    if (text.includes("NTP")) return "NTP";
    return "";
  }

  function letterRank(letterType) {
    return LETTER_RANK[normalizeLetterType(letterType)] || 0;
  }

  function getTextLines(root) {
    const element = root && root.body ? root.body : root;
    return String(element && (element.innerText || element.textContent) || "")
      .replace(/\u00a0/g, " ")
      .split(/\r?\n/)
      .map(normalize)
      .filter(Boolean);
  }

  function findValueInTables(label, root) {
    const expected = normalizeLabel(label);
    const rows = Array.from(root.querySelectorAll("tr"));
    for (let index = 0; index < rows.length; index += 1) {
      const cells = Array.from(rows[index].querySelectorAll(":scope > th, :scope > td"));
      if (cells.length < 3 || normalizeLabel(readableText(cells[0])) !== expected) continue;
      const value = readableText(cells[2]);
      if (value) return value;
    }
    return "";
  }

  function findLabelValue(label, root) {
    const tableValue = findValueInTables(label, root);
    if (tableValue) return tableValue;

    const expected = normalizeLabel(label);
    const lines = getTextLines(root);
    const fieldLabels = new Set([
      "NOPOL", "NAMA", "ALAMAT", "KECAMATAN/DESA", "JENIS", "MERK/TYPE", "TH BUAT/WARNA",
      "KOHIR", "TGL MASA LAKU", "TGL MASA STNK", "TGL NTP", "PKB", "OPSEN", "JUMLAH"
    ]);

    for (let index = 0; index < lines.length; index += 1) {
      const current = normalizeLabel(lines[index]);
      if (current !== expected && !current.startsWith(expected + " ")) continue;
      const inlineValue = normalize(lines[index].slice(lines[index].indexOf(":") + 1));
      if (lines[index].includes(":") && inlineValue && normalizeLabel(inlineValue) !== expected) return inlineValue;
      for (let offset = 1; offset <= 4 && index + offset < lines.length; offset += 1) {
        const candidate = normalize(lines[index + offset]);
        const candidateLabel = normalizeLabel(candidate);
        if (!candidate || candidate === ":") continue;
        if (fieldLabels.has(candidateLabel)) break;
        return candidate.replace(/^:\s*/, "").trim();
      }
    }
    return "";
  }

  function getNopolInputValue(root) {
    const input = Array.from(root.querySelectorAll("input")).find(function (item) {
      const identifier = [item.name, item.id, item.placeholder, item.getAttribute("aria-label")].join(" ").toLowerCase();
      return /nopol|nomor.*polisi|plat/.test(identifier) && normalize(item.value);
    });
    return input ? normalize(input.value) : "";
  }

  function formatPlate(value) {
    const compact = String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    const match = compact.match(/^([A-Z]{1,2})(\d{1,4})([A-Z]{1,3})$/);
    return match ? [match[1], match[2], match[3]].join(" ") : normalize(value).toUpperCase();
  }

  function plateKey(value) {
    return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  }

  function parseDate(value) {
    const match = String(value || "").match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (!match) return null;
    return match[3] + "-" + match[2].padStart(2, "0") + "-" + match[1].padStart(2, "0");
  }

  function parseAmount(value) {
    const digits = String(value || "").replace(/[^0-9]/g, "");
    return digits ? Number(digits) : 0;
  }

  function normalizePhone(value) {
    let digits = String(value || "").replace(/[^0-9]/g, "");
    if (digits.startsWith("0")) digits = "62" + digits.slice(1);
    if (digits.startsWith("8")) digits = "62" + digits;
    if (!/^62\d{8,14}$/.test(digits)) return "";
    return "+" + digits;
  }

  function tableDetail(root) {
    const table = Array.from(root.querySelectorAll("table")).find(function (item) {
      const text = normalizeLabel(readableText(item));
      return text.includes("KOHIR") && text.includes("PKB") && text.includes("OPSEN") && text.includes("JUMLAH");
    });
    if (!table) return {};

    const rows = Array.from(table.querySelectorAll("tr"));
    const headerRow = rows.find(function (row) {
      const text = normalizeLabel(readableText(row));
      return text.includes("KOHIR") && text.includes("JUMLAH");
    });
    const valueRow = rows.find(function (row) {
      return row.querySelectorAll(":scope > td").length >= 5 && row !== headerRow;
    });
    if (!headerRow || !valueRow) return {};

    const headers = Array.from(headerRow.querySelectorAll(":scope > th, :scope > td")).map(function (item) { return normalizeLabel(readableText(item)); });
    const values = Array.from(valueRow.querySelectorAll(":scope > td")).map(function (item) { return readableText(item); });
    function valueFor(label) {
      const position = headers.findIndex(function (item) { return item === label; });
      return position >= 0 ? values[position] || "" : "";
    }
    function valueForStatusDate() {
      const position = headers.findIndex(function (item) { return /^TGL (SPOS|SPSO|NPP|NTP)$/.test(item); });
      return position >= 0 ? values[position] || "" : "";
    }
    return {
      kohir: valueFor("KOHIR"),
      taxValidDate: valueFor("TGL MASA LAKU"),
      stnkValidDate: valueFor("TGL MASA STNK"),
      letterDate: valueForStatusDate(),
      pkbAmount: valueFor("PKB"),
      opsenAmount: valueFor("OPSEN"),
      totalAmount: valueFor("JUMLAH")
    };
  }

  function collectDetail(root, sourcePlate, sourceLetterType) {
    const table = tableDetail(root);
    const plateNumber = formatPlate(sourcePlate || getNopolInputValue(root) || findLabelValue("Nopol", root));
    const letterType = normalizeLetterType(sourceLetterType);
    return {
      plate_key: plateKey(plateNumber),
      plate_number: plateNumber,
      owner_name: findLabelValue("Nama", root),
      address: findLabelValue("Alamat", root),
      district_village: findLabelValue("Kecamatan/Desa", root),
      phone: "",
      vehicle_type: findLabelValue("Jenis", root),
      brand_model: findLabelValue("Merk/Type", root),
      manufacture_year_color: findLabelValue("Th Buat/Warna", root),
      source_letter_type: letterType,
      kohir: table.kohir || "",
      tax_valid_date: parseDate(table.taxValidDate),
      stnk_valid_date: parseDate(table.stnkValidDate),
      letter_date: parseDate(table.letterDate),
      ntp_date: letterType === "NTP" ? parseDate(table.letterDate) : null,
      pkb_amount: parseAmount(table.pkbAmount),
      opsen_amount: parseAmount(table.opsenAmount),
      total_amount: parseAmount(table.totalAmount)
    };
  }

  function hasVehicleData(detail) {
    return Boolean(detail && (detail.owner_name || detail.vehicle_type || detail.ntp_date || detail.total_amount));
  }

  function isDetailUsable(detail) {
    return Boolean(detail && detail.plate_key && (hasVehicleData(detail) || detail.phone));
  }

  async function requestSupabase(path, options) {
    const response = await fetch(supabaseUrl + "/rest/v1/" + path, Object.assign({}, options || {}, {
      headers: Object.assign({
        apikey: publishableKey,
        Authorization: "Bearer " + publishableKey
      }, options && options.headers || {})
    }));
    if (!response.ok) {
      const message = await response.text();
      throw new Error("Supabase " + response.status + (message ? ": " + message : ""));
    }
    if (response.status === 204) return [];
    const text = await response.text();
    return text ? JSON.parse(text) : [];
  }

  async function upsertDetails(details) {
    if (!details.length) return;
    await requestSupabase("vehicle_details?on_conflict=plate_key", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal"
      },
      body: JSON.stringify(details)
    });
  }

  function mergeDetail(existing, incoming) {
    const current = existing || {};
    const hasIncomingAmounts = Boolean(incoming.pkb_amount || incoming.opsen_amount || incoming.total_amount);
    return {
      plate_key: incoming.plate_key,
      plate_number: incoming.plate_number || current.plate_number || "",
      owner_name: incoming.owner_name || current.owner_name || "",
      address: incoming.address || current.address || "",
      district_village: incoming.district_village || current.district_village || "",
      phone: incoming.phone || current.phone || "",
      vehicle_type: incoming.vehicle_type || current.vehicle_type || "",
      brand_model: incoming.brand_model || current.brand_model || "",
      manufacture_year_color: incoming.manufacture_year_color || current.manufacture_year_color || "",
      source_letter_type: incoming.source_letter_type || current.source_letter_type || "",
      kohir: incoming.kohir || current.kohir || "",
      tax_valid_date: incoming.tax_valid_date || current.tax_valid_date || null,
      stnk_valid_date: incoming.stnk_valid_date || current.stnk_valid_date || null,
      letter_date: incoming.letter_date || current.letter_date || null,
      ntp_date: incoming.ntp_date || current.ntp_date || null,
      pkb_amount: hasIncomingAmounts ? incoming.pkb_amount : Number(current.pkb_amount || 0),
      opsen_amount: hasIncomingAmounts ? incoming.opsen_amount : Number(current.opsen_amount || 0),
      total_amount: hasIncomingAmounts ? incoming.total_amount : Number(current.total_amount || 0)
    };
  }

  async function fillMissingTaxpayerPhones(details, taxpayersByPlate) {
    const updates = details.map(function (detail) {
      const taxpayer = taxpayersByPlate.get(plateKey(detail.plate_key));
      if (!taxpayer || taxpayer.phone || !detail.phone) return null;
      return { id: taxpayer.id, phone: detail.phone, plateKey: plateKey(detail.plate_key) };
    }).filter(Boolean);
    if (!updates.length) return 0;

    await Promise.all(updates.map(function (item) {
      return requestSupabase("taxpayers?id=eq." + encodeURIComponent(item.id), {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Prefer: "return=minimal"
        },
        body: JSON.stringify({ phone: item.phone })
      });
    }));
    updates.forEach(function (item) {
      const taxpayer = taxpayersByPlate.get(item.plateKey);
      if (taxpayer) taxpayer.phone = item.phone;
    });
    return updates.length;
  }

  async function listSupabaseRows(table, fields) {
    const rows = [];
    const pageSize = 1000;
    for (let from = 0; ; from += pageSize) {
      const page = await requestSupabase(table + "?select=" + fields + "&order=updated_at.desc", {
        headers: { Range: from + "-" + (from + pageSize - 1) }
      });
      rows.push.apply(rows, page);
      if (page.length < pageSize) return rows;
    }
  }

  function siappUrl(value, baseUrl) {
    try {
      const url = new URL(String(value || "").trim(), baseUrl || location.href);
      return url.origin === location.origin && /^https?:$/.test(url.protocol) ? url.href : "";
    } catch (error) {
      return "";
    }
  }

  function findStatusPageUrl(letterType) {
    const expected = normalizeLetterType(letterType);
    const link = Array.from(document.querySelectorAll("a[href]")).find(function (item) {
      const label = normalize(readableText(item)).toUpperCase();
      return /^STATUS\s+(SPOS|SPSO|NPP|NTP)$/.test(label) && normalizeLetterType(label) === expected;
    });
    if (link) return siappUrl(link.getAttribute("href"), document.baseURI);
    if (detectCurrentLetterType(document) === expected) return location.href;
    return expected === "NTP" ? siappUrl(VERIFIED_NTP_PAGE) : "";
  }

  function endpointsFromScript(source, letterType, baseUrl) {
    const result = { detail: [], phone: [] };
    // Capture the whole quoted URL so relative directory names are preserved.
    const literals = String(source || "").matchAll(/["']([^"'\s<>]+\.php(?:\?[^"'\s<>]*)?)["']/gi);
    for (const match of literals) {
      const url = siappUrl(match[1], baseUrl);
      if (!url) continue;
      const filename = new URL(url).pathname.split("/").pop();
      if (normalizeLetterType(filename) !== normalizeLetterType(letterType)) continue;
      if (/^vstat[a-z0-9_]*\.php$/i.test(filename)) result.detail.push(url);
      if (/^gethp[a-z0-9_]*\.php$/i.test(filename)) result.phone.push(url);
    }
    return result;
  }

  async function readSiappResponse(url, options) {
    const controller = new AbortController();
    const timer = window.setTimeout(function () { controller.abort(); }, REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, Object.assign({ credentials: "same-origin" }, options, { signal: controller.signal }));
      const html = await response.text();
      if (!response.ok) {
        const error = new Error("SIAPP " + response.status + " di " + new URL(url, location.href).pathname);
        error.status = response.status;
        throw error;
      }
      const root = new DOMParser().parseFromString(html, "text/html");
      if (root.querySelector('input[type="password"]') || /(?:^|\/)login(?:\.php|\/|$)/i.test(new URL(response.url || url, location.href).pathname)) {
        const error = new Error("Sesi SIAPP berakhir. Login kembali lalu jalankan bookmark.");
        error.sessionExpired = true;
        throw error;
      }
      return { html: html, root: root, url: response.url || url };
    } catch (error) {
      if (error.name === "AbortError") throw new Error("SIAPP tidak merespons dalam 15 detik.");
      throw error;
    } finally {
      window.clearTimeout(timer);
    }
  }

  async function loadStatusPageEndpoints(letterType) {
    const pageUrl = findStatusPageUrl(letterType);
    if (!pageUrl) return { detail: [], phone: [] };
    const page = pageUrl === location.href
      ? { root: document, url: pageUrl }
      : await readSiappResponse(pageUrl);
    const baseElement = page.root.querySelector("base[href]");
    const baseUrl = baseElement ? siappUrl(baseElement.getAttribute("href"), page.url) || page.url : page.url;
    const result = { detail: [], phone: [] };
    for (const script of page.root.querySelectorAll("script")) {
      let source = script.textContent || "";
      if (script.hasAttribute("src")) {
        const scriptUrl = siappUrl(script.getAttribute("src"), baseUrl);
        if (!scriptUrl) continue;
        if (!scriptTextCache.has(scriptUrl)) {
          scriptTextCache.set(scriptUrl, readSiappResponse(scriptUrl).then(function (response) { return response.html; }).catch(function (error) {
            if (error.sessionExpired) throw error;
            return "";
          }));
        }
        source = await scriptTextCache.get(scriptUrl);
      }
      const endpoints = endpointsFromScript(source, letterType, baseUrl);
      result.detail.push.apply(result.detail, endpoints.detail);
      result.phone.push.apply(result.phone, endpoints.phone);
    }
    return { detail: Array.from(new Set(result.detail)), phone: Array.from(new Set(result.phone)) };
  }

  async function getStatusPageEndpoints(letterType) {
    const type = normalizeLetterType(letterType) || "NTP";
    if (!statusPageEndpointCache.has(type)) {
      statusPageEndpointCache.set(type, loadStatusPageEndpoints(type).catch(function (error) {
        if (error.sessionExpired) throw error;
        return { detail: [], phone: [], error: error.message };
      }));
    }
    return statusPageEndpointCache.get(type);
  }

  async function getDetailEndpoints(letterType) {
    const found = await getStatusPageEndpoints(letterType);
    const verified = letterType === "NTP" ? [siappUrl(VERIFIED_NTP_DETAIL)] : [];
    return Array.from(new Set(found.detail.concat(verified)));
  }

  async function getPhoneEndpoints(letterType) {
    return (await getStatusPageEndpoints(letterType)).phone;
  }

  async function fetchSiappText(endpoint, plateNumber) {
    if (unavailableEndpoints.has(endpoint)) throw new Error("Alamat SIAPP tidak tersedia: " + new URL(endpoint).pathname);
    let response;
    try {
      response = await readSiappResponse(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          "X-Requested-With": "XMLHttpRequest"
        },
        body: "nopol=" + encodeURIComponent(plateKey(plateNumber))
      });
    } catch (error) {
      if (error.status === 404 || error.status === 410) unavailableEndpoints.add(endpoint);
      throw error;
    }
    return response.html;
  }

  function phoneFromObject(value) {
    if (!value || typeof value !== "object") return "";
    const directKey = Object.keys(value).find(function (key) { return /^(hp|phone|no_?hp|nomor_?hp)$/i.test(key); });
    if (directKey) {
      const directPhone = normalizePhone(value[directKey]);
      if (directPhone) return directPhone;
    }
    return Object.keys(value).reduce(function (result, key) {
      return result || phoneFromObject(value[key]);
    }, "");
  }

  function parsePhoneResponse(responseText) {
    const raw = String(responseText || "").trim();
    if (!raw) return "";
    try {
      const json = JSON.parse(raw);
      const fromJson = typeof json === "string" || typeof json === "number" ? normalizePhone(json) : phoneFromObject(json);
      if (fromJson) return fromJson;
      return "";
    } catch (error) {
      // SIAPP may return a plain value or a short HTML fragment instead of JSON.
    }
    const parsed = new DOMParser().parseFromString(raw, "text/html");
    const input = Array.from(parsed.querySelectorAll("input")).find(function (item) {
      return /hp|phone|nomor.*hp/i.test([item.name, item.id, item.placeholder].join(" ")) && normalizePhone(item.value);
    });
    if (input) return normalizePhone(input.value);
    // Do not mistake numbers elsewhere in an HTML response for the requested HP.
    return /^[+\d\s().-]+$/.test(raw) ? normalizePhone(raw) : "";
  }

  async function fetchPhoneValue(source, letterType) {
    const endpoints = await getPhoneEndpoints(letterType || source.letterType);
    for (let index = 0; index < endpoints.length; index += 1) {
      try {
        const responseText = await fetchSiappText(endpoints[index], source.plateNumber);
        const phone = parsePhoneResponse(responseText);
        if (phone) return phone;
      } catch (error) {
        if (error.sessionExpired) throw error;
      }
    }
    return "";
  }

  async function fetchVehicleDetailForLetter(source, letterType) {
    const endpoints = await getDetailEndpoints(letterType);
    const phone = await fetchPhoneValue(source, letterType);
    let phoneOnlyDetail = null;
    const errors = [];
    if (phone) {
      phoneOnlyDetail = collectDetail(new DOMParser().parseFromString("", "text/html"), source.plateNumber, "");
      phoneOnlyDetail.phone = phone;
    }
    for (let index = 0; index < endpoints.length; index += 1) {
      try {
        const html = await fetchSiappText(endpoints[index], source.plateNumber);
        const parsed = new DOMParser().parseFromString(html, "text/html");
        const responsePlate = findLabelValue("Nopol", parsed);
        if (!responsePlate || plateKey(responsePlate) !== plateKey(source.plateNumber)) {
          throw new Error("Respons " + new URL(endpoints[index]).pathname + " tidak memuat detail nopol yang diminta");
        }
        const detail = collectDetail(parsed, source.plateNumber, letterType);
        detail.phone = phone;
        if (hasVehicleData(detail)) return detail;
        if (isDetailUsable(detail)) phoneOnlyDetail = detail;
        errors.push("respons " + endpoints[index] + " tidak berisi detail kendaraan");
      } catch (error) {
        if (error.sessionExpired) throw error;
        errors.push(error && error.message ? error.message : "respons tidak dapat dibaca");
      }
    }
    if (phoneOnlyDetail) return phoneOnlyDetail;
    throw new Error("Status " + (letterType || "SIAPP") + ": " + (errors.length ? errors.join(" | ") : "alamat baca detail belum ditemukan pada menu Status"));
  }

  async function fetchVehicleDetail(source) {
    const preferredType = normalizeLetterType(source.letterType) || "NTP";
    const types = Array.from(new Set([preferredType].concat(LETTER_TYPES)));
    const errors = [];
    let phoneOnlyDetail = null;
    for (let index = 0; index < types.length; index += 1) {
      try {
        const detail = await fetchVehicleDetailForLetter(source, types[index]);
        if (hasVehicleData(detail)) {
          detail.phone = detail.phone || (phoneOnlyDetail && phoneOnlyDetail.phone) || "";
          return detail;
        }
        if (!phoneOnlyDetail) phoneOnlyDetail = detail;
      } catch (error) {
        if (error.sessionExpired) throw error;
        errors.push(error && error.message ? error.message : "status tidak dapat dibaca");
      }
    }
    if (phoneOnlyDetail) return phoneOnlyDetail;
    throw new Error("Detail kendaraan " + source.plateNumber + " tidak tersedia pada Status NTP, NPP, maupun SPOS: " + errors.join(" | "));
  }

  function uniquePlateSources(rows) {
    const byPlate = new Map();
    rows.forEach(function (row) {
      const plateNumber = formatPlate(row.plate_number || row.plateNumber || "");
      const key = plateKey(row.plate_key || row.plateKey || plateNumber);
      const candidate = {
        plateKey: key,
        plateNumber: plateNumber,
        letterType: normalizeLetterType(row.letter_type || row.letterType || "") || "NTP"
      };
      const current = byPlate.get(key);
      if (key && (!current || letterRank(candidate.letterType) > letterRank(current.letterType))) byPlate.set(key, candidate);
    });
    return Array.from(byPlate.values());
  }

  function splitIntoChunks(items, size) {
    const chunks = [];
    for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
    return chunks;
  }

  function pause(milliseconds) {
    return new Promise(function (resolve) { window.setTimeout(resolve, milliseconds); });
  }

  function representativeSources(sources) {
    const selected = [];
    const seenLetters = new Set();
    sources.forEach(function (source) {
      if (selected.length >= PREFLIGHT_SAMPLE_LIMIT) return;
      const letterType = normalizeLetterType(source.letterType) || "NTP";
      if (!seenLetters.has(letterType)) {
        selected.push(source);
        seenLetters.add(letterType);
      }
    });
    sources.forEach(function (source) {
      if (selected.length >= PREFLIGHT_SAMPLE_LIMIT) return;
      if (!selected.some(function (item) { return item.plateKey === source.plateKey; })) selected.push(source);
    });
    return selected;
  }

  async function preflightDetails(sources) {
    const samples = representativeSources(sources);
    const outcomes = [];
    for (let index = 0; index < samples.length; index += 1) {
      const source = samples[index];
      notify("Menguji Status " + source.letterType + " untuk " + source.plateNumber + " (" + (index + 1) + "/" + samples.length + ")...");
      try {
        outcomes.push({ source: source, detail: await fetchVehicleDetail(source), error: "" });
      } catch (error) {
        if (error.sessionExpired) throw error;
        outcomes.push({ source: source, detail: null, error: error && error.message ? error.message : "respons tidak dapat dibaca" });
      }
    }
    const successful = outcomes.filter(function (outcome) { return outcome.detail; });
    if (!successful.length) {
      const example = outcomes[0];
      throw new Error("Uji baca SIAPP gagal pada " + samples.length + " nopol; belum ada penyimpanan. " + example.error + ". Periksa Response permintaan vstat/gethp untuk nopol yang tampil pada halaman Status SIAPP.");
    }
    return successful;
  }

  async function runAutomaticImport() {
    if (location.origin !== "https://siapp.dipendajatim.go.id") {
      throw new Error("Jalankan bookmark Tarik Detail Otomatis pada SIAPP yang sudah login.");
    }
    const scope = config.vehicleDetailScope === "production" ? "production" : "taxpayers";
    const table = scope === "production" ? "production_records" : "taxpayers";
    const scopeLabel = scope === "production" ? "Buku Produksi" : "kartu follow-up";
    notify("Membaca daftar nopol " + scopeLabel + "...");

    const sourceFields = scope === "taxpayers" ? "id,plate_key,plate_number,letter_type,phone" : "plate_key,plate_number,letter_type";
    const sourceRows = await listSupabaseRows(table, sourceFields);
    const taxpayerRows = scope === "taxpayers" ? sourceRows : await listSupabaseRows("taxpayers", "id,plate_key,phone");
    const taxpayersByPlate = new Map(taxpayerRows.map(function (item) {
      return [plateKey(item.plate_key), { id: item.id, phone: normalizePhone(item.phone) }];
    }).filter(function (item) { return item[0] && item[1].id; }));
    const detailRows = await listSupabaseRows("vehicle_details", "*");
    const existingDetailsByPlate = new Map(detailRows.map(function (item) {
      return [plateKey(item.plate_key), item];
    }).filter(function (item) { return item[0]; }));
    const existing = new Map(detailRows.map(function (item) {
      return [plateKey(item.plate_key), normalizeLetterType(item.source_letter_type) || "NTP"];
    }).filter(function (item) { return item[0]; }));
    const pending = uniquePlateSources(sourceRows).filter(function (source) {
      const existingType = existing.get(source.plateKey);
      const existingDetail = existingDetailsByPlate.get(source.plateKey);
      return !existingType || !hasVehicleData(existingDetail) || letterRank(source.letterType) > letterRank(existingType) || !normalizePhone(existingDetail && existingDetail.phone);
    });

    if (!pending.length) {
      notify("Semua detail " + scopeLabel + " sudah tersimpan. Tidak ada nopol baru untuk ditarik.", "rgb(18,134,101)");
      return;
    }

    const approved = window.confirm("Tarik detail kendaraan untuk " + pending.length + " nopol " + scopeLabel + "? Sistem akan menguji beberapa respons Status SIAPP terlebih dahulu. Proses dapat dilanjutkan dengan menjalankan bookmark lagi bila terhenti.");
    if (!approved) {
      notify("Penarikan detail dibatalkan.");
      return;
    }

    let savedCount = 0;
    let phoneFilledCount = 0;
    let skippedCount = 0;
    let failedCount = 0;
    const unreadableByLetter = { SPOS: 0, NPP: 0, NTP: 0 };
    const preflightOutcomes = await preflightDetails(pending);
    const preflightDetailsOnly = preflightOutcomes.map(function (outcome) {
      return mergeDetail(existingDetailsByPlate.get(plateKey(outcome.detail.plate_key)), outcome.detail);
    });
    try {
      await upsertDetails(preflightDetailsOnly);
      savedCount += preflightDetailsOnly.length;
      phoneFilledCount += await fillMissingTaxpayerPhones(preflightDetailsOnly, taxpayersByPlate);
      preflightDetailsOnly.forEach(function (detail) {
        existingDetailsByPlate.set(plateKey(detail.plate_key), detail);
      });
    } catch (error) {
      throw new Error("Detail berhasil dibaca dari SIAPP, tetapi gagal disimpan ke Supabase: " + (error && error.message ? error.message : "galat tidak diketahui") + ". Jalankan migrasi terbaru lalu periksa policy tabel vehicle_details.");
    }

    const preflightKeys = new Set(preflightOutcomes.map(function (outcome) { return outcome.source.plateKey; }));
    const remaining = pending.filter(function (source) { return !preflightKeys.has(source.plateKey); });
    const chunks = splitIntoChunks(remaining, BATCH_SIZE);
    for (let index = 0; index < chunks.length; index += 1) {
      const chunk = chunks[index];
      notify("Menarik detail " + Math.min(preflightOutcomes.length + (index * BATCH_SIZE) + chunk.length, pending.length) + "/" + pending.length + " nopol. Tersimpan " + savedCount + ".");
      const outcomes = await Promise.all(chunk.map(function (source) {
        return fetchVehicleDetail(source).then(function (detail) {
          return { detail: detail, source: source };
        }).catch(function (error) {
          if (error.sessionExpired) throw error;
          return { detail: null, source: source, error: error && error.message ? error.message : "respons tidak dapat dibaca" };
        });
      }));
      const details = outcomes.map(function (outcome) { return outcome.detail; }).filter(Boolean).map(function (detail) {
        return mergeDetail(existingDetailsByPlate.get(plateKey(detail.plate_key)), detail);
      });
      outcomes.filter(function (outcome) { return !outcome.detail; }).forEach(function (outcome) {
        const letterType = normalizeLetterType(outcome.source && outcome.source.letterType) || "NTP";
        unreadableByLetter[letterType] += 1;
      });
      try {
        await upsertDetails(details);
        savedCount += details.length;
        phoneFilledCount += await fillMissingTaxpayerPhones(details, taxpayersByPlate);
        skippedCount += chunk.length - details.length;
      } catch (error) {
        failedCount += details.length;
        throw new Error("Penarikan dihentikan: detail SIAPP terbaca, tetapi batch gagal disimpan ke Supabase: " + (error && error.message ? error.message : "galat tidak diketahui") + ". Jalankan migrasi terbaru lalu coba lagi.");
      }
      if (index < chunks.length - 1) await pause(BATCH_PAUSE_MS);
    }

    const unreadableText = Object.keys(unreadableByLetter).filter(function (letterType) {
      return unreadableByLetter[letterType] > 0;
    }).map(function (letterType) {
      return letterType + " " + unreadableByLetter[letterType];
    }).join(", ");
    const failedText = (skippedCount + failedCount) ? ", " + (skippedCount + failedCount) + " belum terbaca" + (unreadableText ? " (" + unreadableText + ")" : "") : "";
    const phoneText = phoneFilledCount ? ", " + phoneFilledCount + " nomor HP kartu terisi" : "";
    notify("Selesai. " + savedCount + " detail kendaraan tersimpan" + phoneText + failedText + ". Jalankan lagi untuk melanjutkan nopol yang belum tersimpan.", savedCount ? "rgb(18,134,101)" : "rgb(180,35,24)");
  }

  async function saveCurrentDetail() {
    const letterType = detectCurrentLetterType(document);
    const detail = collectDetail(document, "", letterType);
    detail.phone = getPhoneInputValue(document) || await fetchPhoneValue({ plateNumber: detail.plate_number, letterType: letterType });
    if (!isDetailUsable(detail)) {
      throw new Error("Data Status SIAPP belum terbaca. Masukkan nopol, tekan Enter, lalu tunggu detail kendaraan tampil.");
    }
    await upsertDetails([detail]);
    if (detail.phone) {
      const taxpayers = await listSupabaseRows("taxpayers", "id,plate_key,phone");
      const taxpayersByPlate = new Map(taxpayers.map(function (item) {
        return [plateKey(item.plate_key), { id: item.id, phone: normalizePhone(item.phone) }];
      }).filter(function (item) { return item[0] && item[1].id; }));
      await fillMissingTaxpayerPhones([detail], taxpayersByPlate);
    }
    return detail;
  }

  function getPhoneInputValue(root) {
    const input = Array.from(root.querySelectorAll("input")).find(function (item) {
      return /hp|phone|nomor.*hp/i.test([item.name, item.id, item.placeholder, item.getAttribute("aria-label")].join(" ")) && normalizePhone(item.value);
    });
    return input ? normalizePhone(input.value) : "";
  }

  function detectCurrentLetterType(root) {
    const headings = Array.from(root.querySelectorAll("h1, h2, h3, h4, h5, h6, legend, strong, b"));
    const heading = headings.find(function (element) {
      return /^STATUS\s+(SPOS|SPSO|NPP|NTP)$/i.test(readableText(element));
    });
    if (heading) return normalizeLetterType(readableText(heading));
    const dateCell = Array.from(root.querySelectorAll("table thead td, table thead th")).find(function (element) {
      return /^TGL\s+(SPOS|SPSO|NPP|NTP)$/i.test(readableText(element));
    });
    return dateCell ? normalizeLetterType(readableText(dateCell)) : "";
  }

  if (!supabaseUrl || !publishableKey) {
    notify("Konfigurasi Supabase belum tersedia.", "rgb(180,35,24)");
    return;
  }

  if (config.vehicleDetailMode === "batch") {
    runAutomaticImport().catch(function (error) {
      console.error(error);
      notify(error.message || "Penarikan detail otomatis gagal.", "rgb(180,35,24)");
    });
    return;
  }

  notify("Membaca detail Status SIAPP...");
  saveCurrentDetail().then(function (detail) {
    notify("Detail " + detail.plate_number + " tersimpan. Buka ulang detail kartu di aplikasi untuk melihatnya.", "rgb(18,134,101)");
  }).catch(function (error) {
    console.error(error);
    notify(error.message || "Detail Status SIAPP gagal disimpan.", "rgb(180,35,24)");
  });
})();
