(function () {
  "use strict";

  const config = window.__WAJIB_PAJAK_VEHICLE_DETAIL_CONFIG || {};
  const supabaseUrl = String(config.supabaseUrl || "").replace(/\/$/, "");
  const publishableKey = String(config.supabasePublishableKey || "");
  const LETTER_RANK = { SPOS: 1, NPP: 2, NTP: 3 };
  const DETAIL_ENDPOINTS = {
    SPOS: ["/view/vstatspos.php", "/view/vstatspso.php"],
    NPP: ["/view/vstatnpp.php"],
    NTP: ["/view/vstatntp.php"]
  };
  const PHONE_ENDPOINTS = {
    SPOS: ["/view/gethpspos.php", "/view/gethpspso.php"],
    NPP: ["/view/gethpnpp.php"],
    NTP: ["/view/gethpntp.php"]
  };
  const STATUS_PAGE_PATHS = {
    SPOS: "/idkstat.php?id=24",
    NPP: "/idkstat.php?id=28",
    NTP: "/idkstat.php?id=32"
  };
  const PLATE_CHECK_ENDPOINTS = ["/view/ceknorek.php", "/ceknorek.php"];
  const LETTER_TYPES = ["NTP", "NPP", "SPOS"];
  const BATCH_SIZE = 3;
  const BATCH_PAUSE_MS = 300;
  const PREFLIGHT_SAMPLE_LIMIT = 6;
  const statusPageEndpointCache = {
    detail: new Map(),
    phone: new Map()
  };

  function notify(message, color) {
    let element = document.getElementById("siapp-vehicle-detail-status");
    if (!element) {
      element = document.createElement("div");
      element.id = "siapp-vehicle-detail-status";
      element.style.cssText = "position:fixed;right:16px;top:16px;z-index:999999;padding:12px 14px;border-radius:8px;background:rgb(22,35,49);color:white;font:700 13px Arial,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.22);max-width:360px";
      document.body.appendChild(element);
    }
    element.textContent = message;
    if (color) element.style.background = color;
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

  function normalizeEndpointCandidate(value) {
    const candidate = String(value || "").trim();
    if (!candidate) return "";
    if (/^https?:\/\//i.test(candidate)) return candidate;
    if (candidate.startsWith("/")) return candidate;
    return "/view/" + candidate.replace(/^\.\//, "");
  }

  function endpointsFromHtml(html, letterType, pattern) {
    const expected = normalizeLetterType(letterType);
    return (String(html || "").match(pattern) || []).map(normalizeEndpointCandidate).filter(function (endpoint) {
      const type = normalizeLetterType(endpoint);
      return type === expected;
    });
  }

  function discoverDetailEndpoints(letterType) {
    const documentHtml = document.documentElement ? document.documentElement.innerHTML : "";
    return endpointsFromHtml(documentHtml, letterType, /(?:https?:\/\/[^\"'\s]+)?(?:\/view)?\/vstat[a-z0-9_]*\.php/gi);
  }

  function discoverPhoneEndpoints(letterType) {
    const documentHtml = document.documentElement ? document.documentElement.innerHTML : "";
    return endpointsFromHtml(documentHtml, letterType, /(?:https?:\/\/[^\"'\s]+)?(?:\/view)?\/gethp[a-z0-9_]*\.php/gi);
  }

  async function discoverStatusPageEndpoints(letterType, kind) {
    const normalizedType = normalizeLetterType(letterType) || "NTP";
    const cache = statusPageEndpointCache[kind];
    if (cache.has(normalizedType)) return cache.get(normalizedType);

    const path = STATUS_PAGE_PATHS[normalizedType];
    if (!path) return [];
    try {
      const response = await fetch(path, { credentials: "include" });
      const html = await response.text();
      if (!response.ok || !html) throw new Error("halaman status tidak tersedia");
      const pattern = kind === "detail"
        ? /(?:https?:\/\/[^\"'\s]+)?(?:\/view)?\/vstat[a-z0-9_]*\.php/gi
        : /(?:https?:\/\/[^\"'\s]+)?(?:\/view)?\/gethp[a-z0-9_]*\.php/gi;
      const endpoints = endpointsFromHtml(html, normalizedType, pattern);
      cache.set(normalizedType, endpoints);
      return endpoints;
    } catch (error) {
      cache.set(normalizedType, []);
      return [];
    }
  }

  async function getDetailEndpoints(letterType) {
    const normalizedType = normalizeLetterType(letterType) || "NTP";
    const statusEndpoints = await discoverStatusPageEndpoints(normalizedType, "detail");
    return Array.from(new Set(statusEndpoints.concat(discoverDetailEndpoints(normalizedType), DETAIL_ENDPOINTS[normalizedType] || [])));
  }

  async function getPhoneEndpoints(letterType) {
    const normalizedType = normalizeLetterType(letterType) || "NTP";
    const statusEndpoints = await discoverStatusPageEndpoints(normalizedType, "phone");
    return Array.from(new Set(statusEndpoints.concat(discoverPhoneEndpoints(normalizedType), PHONE_ENDPOINTS[normalizedType] || [])));
  }

  async function fetchSiappText(endpoint, plateNumber) {
    const response = await fetch(endpoint, {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest"
      },
      body: "nopol=" + encodeURIComponent(plateKey(plateNumber))
    });
    const text = await response.text();
    if (!response.ok) throw new Error("SIAPP " + response.status + " di " + endpoint);
    if (!text || !text.trim()) throw new Error("SIAPP mengembalikan respons kosong di " + endpoint);
    return text;
  }

  function phoneFromObject(value) {
    if (!value || typeof value !== "object") return "";
    const directKey = Object.keys(value).find(function (key) { return /^(hp|phone|no_hp|nomor_hp)$/i.test(key); });
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
      const fromJson = phoneFromObject(JSON.parse(raw));
      if (fromJson) return fromJson;
    } catch (error) {
      // SIAPP may return a plain value or a short HTML fragment instead of JSON.
    }
    const parsed = new DOMParser().parseFromString(raw, "text/html");
    const input = Array.from(parsed.querySelectorAll("input")).find(function (item) {
      return /hp|phone|nomor.*hp/i.test([item.name, item.id, item.placeholder].join(" ")) && normalizePhone(item.value);
    });
    if (input) return normalizePhone(input.value);
    const match = raw.match(/(?:\+?62|0)8\d{7,13}/);
    return normalizePhone(match ? match[0] : raw);
  }

  async function fetchPhoneValue(source, letterType) {
    const endpoints = await getPhoneEndpoints(letterType || source.letterType);
    for (let index = 0; index < endpoints.length; index += 1) {
      try {
        const responseText = await fetchSiappText(endpoints[index], source.plateNumber);
        const phone = parsePhoneResponse(responseText);
        if (phone) return phone;
      } catch (error) {
        // The next known phone endpoint is attempted for the same SIAPP status.
      }
    }
    return "";
  }

  async function checkPlateBeforeDetail(plateNumber) {
    const errors = [];
    for (let index = 0; index < PLATE_CHECK_ENDPOINTS.length; index += 1) {
      try {
        // Status SIAPP normally performs this request immediately after a
        // nopol is submitted, before requesting its phone and detail fields.
        await fetchSiappText(PLATE_CHECK_ENDPOINTS[index], plateNumber);
        return;
      } catch (error) {
        errors.push(error && error.message ? error.message : "cek nopol gagal");
      }
    }
    throw new Error("Nopol " + plateNumber + " tidak dapat diverifikasi oleh SIAPP: " + errors.join(" | "));
  }

  async function fetchVehicleDetailForLetter(source, letterType) {
    const endpoints = await getDetailEndpoints(letterType);
    const phone = await fetchPhoneValue(source, letterType);
    let phoneOnlyDetail = null;
    const errors = [];
    for (let index = 0; index < endpoints.length; index += 1) {
      try {
        const html = await fetchSiappText(endpoints[index], source.plateNumber);
        const parsed = new DOMParser().parseFromString(html, "text/html");
        const detail = collectDetail(parsed, source.plateNumber, letterType);
        detail.phone = phone;
        if (hasVehicleData(detail)) return detail;
        if (isDetailUsable(detail)) phoneOnlyDetail = detail;
        errors.push("respons " + endpoints[index] + " tidak berisi detail kendaraan");
      } catch (error) {
        errors.push(error && error.message ? error.message : "respons tidak dapat dibaca");
      }
    }
    if (phoneOnlyDetail) return phoneOnlyDetail;
    throw new Error("Status " + (letterType || "SIAPP") + " untuk " + source.plateNumber + " tidak tersedia" + (errors.length ? ": " + errors.join(" | ") : ""));
  }

  async function fetchVehicleDetail(source) {
    const preferredType = normalizeLetterType(source.letterType) || "NTP";
    const types = Array.from(new Set([preferredType].concat(LETTER_TYPES)));
    const errors = [];
    await checkPlateBeforeDetail(source.plateNumber);
    for (let index = 0; index < types.length; index += 1) {
      try {
        return await fetchVehicleDetailForLetter(source, types[index]);
      } catch (error) {
        errors.push(error && error.message ? error.message : "status tidak dapat dibaca");
      }
    }
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
        outcomes.push({ source: source, detail: null, error: error && error.message ? error.message : "respons tidak dapat dibaca" });
      }
    }
    const successful = outcomes.filter(function (outcome) { return outcome.detail; });
    if (!successful.length) {
      const examples = outcomes.slice(0, 3).map(function (outcome) {
        return outcome.source.letterType + " " + outcome.source.plateNumber + ": " + outcome.error;
      }).join(". ");
      throw new Error("Uji baca SIAPP gagal, sehingga penarikan ribuan nopol dihentikan. " + examples + ". Buka Status SPOS/NPP/NTP pada SIAPP, pastikan masih login, lalu jalankan ulang bookmark terbaru.");
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
      return !existingType || letterRank(source.letterType) > letterRank(existingType) || !normalizePhone(existingDetail && existingDetail.phone);
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
    const text = normalize(root && root.body ? root.body.textContent : root && root.textContent);
    return normalizeLetterType(text) || "NTP";
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
