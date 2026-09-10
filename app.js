const STORAGE_KEY = "wajibPajakFollowUpRecords";
const PRODUCTION_STORAGE_KEY = "wajibPajakProductionRecords";
const PRODUCTION_SYNC_META_KEY = "wajibPajakProductionLastSyncAt";
const PRODUCTION_SUMMARY_STORAGE_KEY = "wajibPajakProductionSummary";
const PENDING_UPSERT_STORAGE_KEY = "wajibPajakPendingRemoteUpserts";
const PENDING_DELETE_STORAGE_KEY = "wajibPajakPendingRemoteDeletes";
const REMOTE_REFRESH_INTERVAL_MS = 15000;
const REMOTE_PRODUCTION_REFRESH_INTERVAL_MS = 300000;
const REMOTE_WRITE_SETTLE_MS = 2000;
const REMOTE_EMPTY_AFTER_WRITE_GUARD_MS = 20000;
const REMOTE_RETRY_BASE_MS = 5000;
const REMOTE_RETRY_MAX_MS = 120000;
const PRODUCTION_SUMMARY_FALLBACK_REFRESH_MS = 300000;
const DATABASE_JSONP_MAX_URL_LENGTH = 14000;
const JASA_RAHARJA_RODA_4 = 143000;
const DENDA_RODA_4_PER_3_BULAN = 35000;
const LETTER_SEQUENCE = ["SPOS", "NPP", "NTP"];
const LETTER_OFFSETS = {
  SPOS: 15,
  NPP: 30,
  NTP: 60
};
const databaseConfig = getDatabaseConfig();

const form = document.querySelector("#taxpayerForm");
const tableBody = document.querySelector("#recordsTable");
const rowTemplate = document.querySelector("#rowTemplate");
const emptyState = document.querySelector("#emptyState");
const toast = document.querySelector("#toast");

const fields = {
  recordId: document.querySelector("#recordId"),
  letterType: document.querySelector("#letterType"),
  taxValidDate: document.querySelector("#taxValidDate"),
  plateNumber: document.querySelector("#plateNumber"),
  ownerName: document.querySelector("#ownerName"),
  taxPotential: document.querySelector("#taxPotential"),
  fieldVisitDate: document.querySelector("#fieldVisitDate"),
  fieldVisitNote: document.querySelector("#fieldVisitNote"),
  phone: document.querySelector("#phone"),
  status: document.querySelector("#status")
};

const controls = {
  topbar: document.querySelector(".topbar"),
  formTitle: document.querySelector("#formTitle"),
  toggleFormBtn: document.querySelector("#toggleFormBtn"),
  resetFormBtn: document.querySelector("#resetFormBtn"),
  searchInput: document.querySelector("#searchInput"),
  statusFilter: document.querySelector("#statusFilter"),
  dateFilter: document.querySelector("#dateFilter"),
  dlFilter: document.querySelector("#dlFilter"),
  clearAllBtn: document.querySelector("#clearAllBtn"),
  homeBtn: document.querySelector("#homeBtn"),
  exportJsonBtn: document.querySelector("#exportJsonBtn"),
  exportCsvBtn: document.querySelector("#exportCsvBtn"),
  importFile: document.querySelector("#importFile"),
  duplicateCheckResult: document.querySelector("#duplicateCheckResult"),
  productionCheckResult: document.querySelector("#productionCheckResult"),
  siappAutofillPanel: document.querySelector("#siappAutofillPanel"),
  autoLetterType: document.querySelector("#autoLetterType"),
  autoOwnerName: document.querySelector("#autoOwnerName"),
  autoTaxValidDate: document.querySelector("#autoTaxValidDate"),
  autoTaxPotential: document.querySelector("#autoTaxPotential"),
  syncStatus: document.querySelector("#syncStatus"),
  dashboardSection: document.querySelector("#dashboardSection"),
  dashboardSiappBtn: document.querySelector("#dashboardSiappBtn"),
  listPanel: document.querySelector(".list-panel"),
  toggleDashboardBtn: document.querySelector("#toggleDashboardBtn"),
  toggleListBtn: document.querySelector("#toggleListBtn"),
  mobileMenuBtn: document.querySelector("#mobileMenuBtn"),
  mobileMenuPanel: document.querySelector("#mobileMenuPanel"),
  mobileHomeBtn: document.querySelector("#mobileHomeBtn"),
  mobileDashboardBtn: document.querySelector("#mobileDashboardBtn"),
  mobileExportJsonBtn: document.querySelector("#mobileExportJsonBtn"),
  mobileExportCsvBtn: document.querySelector("#mobileExportCsvBtn"),
  mobileImportBtn: document.querySelector("#mobileImportBtn"),
  siappHelperLink: document.querySelector("#siappHelperLink"),
  mobileSiappHelperLink: document.querySelector("#mobileSiappHelperLink"),
  dashboardMonthFilter: document.querySelector("#dashboardMonthFilter"),
  detailOverlay: document.querySelector("#detailOverlay"),
  detailCloseBtn: document.querySelector("#detailCloseBtn"),
  detailTitle: document.querySelector("#detailTitle"),
  detailSubtitle: document.querySelector("#detailSubtitle"),
  detailContent: document.querySelector("#detailContent"),
  siappOverlay: document.querySelector("#siappOverlay"),
  siappCloseBtn: document.querySelector("#siappCloseBtn"),
  siappFrame: document.querySelector("#siappFrame")
};

const summary = {
  totalRecords: document.querySelector("#totalRecords"),
  unpaidRecords: document.querySelector("#unpaidRecords"),
  overdueRecords: document.querySelector("#overdueRecords"),
  todayFollowUps: document.querySelector("#todayFollowUps"),
  unpaidPotential: document.querySelector("#unpaidPotential"),
  dlMonthCount: document.querySelector("#dlMonthCount"),
  paidMonthAmount: document.querySelector("#paidMonthAmount"),
  dlConversionRate: document.querySelector("#dlConversionRate"),
  siappReferenceCount: document.querySelector("#siappReferenceCount"),
  siappLastSync: document.querySelector("#siappLastSync"),
  dashboardMonthLabel: document.querySelector("#dashboardMonthLabel"),
  dashboardInsights: document.querySelector("#dashboardInsights"),
  dlWeekCounts: [
    document.querySelector("#dlWeek1Count"),
    document.querySelector("#dlWeek2Count"),
    document.querySelector("#dlWeek3Count"),
    document.querySelector("#dlWeek4Count")
  ],
  dlWeekPaid: [
    document.querySelector("#dlWeek1Paid"),
    document.querySelector("#dlWeek2Paid"),
    document.querySelector("#dlWeek3Paid"),
    document.querySelector("#dlWeek4Paid")
  ]
};

let records = loadRecords().map(normalizeRecord);
let productionRecords = loadProductionRecords().map(normalizeProductionRecord);
let productionRecordsByPlate = createProductionIndex(productionRecords);
let productionLastSyncAt = loadProductionLastSyncAt();
let productionSummarySnapshot = loadProductionSummarySnapshot();
let pendingRemoteUpserts = loadPendingRemoteUpserts().map(normalizeRecord);
let pendingRemoteDeletes = loadPendingRemoteDeletes();
let isRemoteRefreshing = false;
let isProductionRefreshing = false;
let isProductionSummaryRefreshing = false;
let isPendingRemoteSyncing = false;
let remoteMutationCount = 0;
let remoteAutoRefreshStarted = false;
let lastRemoteWriteAt = 0;
let lastProductionRefreshAt = 0;
let lastProductionSummaryFallbackAt = 0;
let remoteRetryAttempt = 0;
let remoteRetryTimer = null;
let remoteFailureCount = 0;
let remoteConnectionState = "unknown";
let activeDetailRecordId = "";
let hasAttemptedLocalProductionMigration = false;
let hasAttemptedLocalTaxpayerMigration = false;

function getDatabaseConfig() {
  const config = window.APP_CONFIG || {};
  return {
    provider: String(config.DATABASE_PROVIDER || "google-script").trim().toLowerCase(),
    googleScriptUrl: String(config.GOOGLE_SCRIPT_URL || "").trim(),
    supabaseUrl: String(config.SUPABASE_URL || "").trim().replace(/\/$/, ""),
    supabasePublishableKey: String(config.SUPABASE_PUBLISHABLE_KEY || "").trim()
  };
}

function hasRemoteDatabase() {
  if (databaseConfig.provider === "supabase") {
    return Boolean(databaseConfig.supabaseUrl && databaseConfig.supabasePublishableKey);
  }
  return Boolean(databaseConfig.googleScriptUrl);
}

function isSupabaseDatabase() {
  return databaseConfig.provider === "supabase" && hasRemoteDatabase();
}

function updateSyncStatus(text, state) {
  if (!controls.syncStatus) return;
  const previousState = remoteConnectionState;
  const nextState = state === "is-online" ? "online" : state === "is-error" ? "offline" : "connecting";

  controls.syncStatus.textContent = "Database: " + text;
  controls.syncStatus.classList.remove("is-online", "is-error");
  if (state) controls.syncStatus.classList.add(state);

  if (nextState !== previousState) {
    if (nextState === "online") {
      showToast("Database online tersambung.", "connection-success");
    } else if (nextState === "offline" && previousState === "online") {
      showToast("Koneksi database terputus. Aplikasi mencoba ulang otomatis.", "connection-error");
    }
  }

  remoteConnectionState = nextState;
}

function markRemoteOnline(text) {
  remoteFailureCount = 0;
  updateSyncStatus(text || "Online auto-sync", "is-online");
}

function markRemoteFailure(text) {
  remoteFailureCount += 1;
  if (remoteFailureCount >= 2 || remoteConnectionState !== "online") {
    updateSyncStatus(text || "Gagal sinkron", "is-error");
    return;
  }
  updateSyncStatus("Menghubungkan ulang...", "");
}

function createId() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return window.crypto.randomUUID();
  }
  return "rec-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 9);
}

function loadRecords() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch {
    return [];
  }
}

function saveRecords() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
}

function loadProductionRecords() {
  try {
    return JSON.parse(localStorage.getItem(PRODUCTION_STORAGE_KEY)) || [];
  } catch {
    return [];
  }
}

function saveProductionRecords() {
  localStorage.setItem(PRODUCTION_STORAGE_KEY, JSON.stringify(productionRecords));
}

function loadProductionLastSyncAt() {
  return localStorage.getItem(PRODUCTION_SYNC_META_KEY) || "";
}

function saveProductionLastSyncAt(value) {
  productionLastSyncAt = value || "";
  if (productionLastSyncAt) localStorage.setItem(PRODUCTION_SYNC_META_KEY, productionLastSyncAt);
  else localStorage.removeItem(PRODUCTION_SYNC_META_KEY);
}

function normalizeProductionSummary(summary) {
  const source = summary || {};
  const count = Number(source.count || source.total || 0);
  const paidCount = Number(source.paidCount || source.lunas || 0);
  const unpaidCount = Number(source.unpaidCount || source.belumLunas || Math.max(0, count - paidCount));
  return {
    count: count,
    paidCount: paidCount,
    unpaidCount: unpaidCount,
    latestUpdate: String(source.latestUpdate || source.updatedAt || "")
  };
}

function loadProductionSummarySnapshot() {
  try {
    return normalizeProductionSummary(JSON.parse(localStorage.getItem(PRODUCTION_SUMMARY_STORAGE_KEY)) || {});
  } catch {
    return normalizeProductionSummary({});
  }
}

function saveProductionSummarySnapshot(summary) {
  productionSummarySnapshot = normalizeProductionSummary(summary);
  if (productionSummarySnapshot.count || productionSummarySnapshot.latestUpdate) {
    localStorage.setItem(PRODUCTION_SUMMARY_STORAGE_KEY, JSON.stringify(productionSummarySnapshot));
  } else {
    localStorage.removeItem(PRODUCTION_SUMMARY_STORAGE_KEY);
  }
}

function loadPendingRemoteUpserts() {
  try {
    return JSON.parse(localStorage.getItem(PENDING_UPSERT_STORAGE_KEY)) || [];
  } catch {
    return [];
  }
}

function savePendingRemoteUpserts() {
  localStorage.setItem(PENDING_UPSERT_STORAGE_KEY, JSON.stringify(pendingRemoteUpserts));
}

function loadPendingRemoteDeletes() {
  try {
    return (JSON.parse(localStorage.getItem(PENDING_DELETE_STORAGE_KEY)) || []).filter(Boolean);
  } catch {
    return [];
  }
}

function savePendingRemoteDeletes() {
  localStorage.setItem(PENDING_DELETE_STORAGE_KEY, JSON.stringify(pendingRemoteDeletes));
}

function createProductionIndex(items) {
  const index = {};
  (items || []).forEach(function (record) {
    const plateKey = record.plateKey || getPlateKey(record.plateNumber);
    if (!plateKey) return;
    if (!index[plateKey]) index[plateKey] = [];
    index[plateKey].push(record);
  });
  return index;
}

function getLatestProductionUpdateFromRecords(items) {
  return (items || [])
    .map(function (record) {
      return String(record.updatedAt || "");
    })
    .filter(Boolean)
    .sort()
    .pop() || "";
}

function createProductionSummaryFromRecords(items) {
  const sourceRecords = items || [];
  const paidCount = sourceRecords.filter(function (record) {
    return record.isPaid;
  }).length;
  return normalizeProductionSummary({
    count: sourceRecords.length,
    paidCount: paidCount,
    unpaidCount: sourceRecords.length - paidCount,
    latestUpdate: getLatestProductionUpdateFromRecords(sourceRecords)
  });
}

function setProductionRecords(items) {
  productionRecords = (items || []).map(normalizeProductionRecord);
  productionRecordsByPlate = createProductionIndex(productionRecords);
  saveProductionRecords();
  const summary = createProductionSummaryFromRecords(productionRecords);
  saveProductionSummarySnapshot(summary);
  saveProductionLastSyncAt(summary.latestUpdate || new Date().toISOString());
}

function getDatabaseRequestTimeout(action) {
  if (action === "listProduction") return 60000;
  if (action === "productionSummary") return 20000;
  if (action === "list") return 25000;
  return 30000;
}

function buildDatabaseJsonpUrl(action, payload, callbackName) {
  const params = new URLSearchParams({
    action: action,
    callback: callbackName || "__wajibPajakDbCallback"
  });

  if (payload) params.set("payload", JSON.stringify(payload));
  return databaseConfig.googleScriptUrl + "?" + params.toString();
}

function shouldUseJsonpForDatabase(action, payload) {
  if (action === "list" || action === "listProduction" || action === "productionSummary") return true;
  if (action !== "upsert" && action !== "deleteMany") return false;
  return buildDatabaseJsonpUrl(action, payload, "__wajibPajakDbCallbackCheck").length <= DATABASE_JSONP_MAX_URL_LENGTH;
}

async function requestDatabase(action, payload) {
  if (!hasRemoteDatabase()) return null;
  if (isSupabaseDatabase()) return requestSupabaseDatabase(action, payload || {});

  if (shouldUseJsonpForDatabase(action, payload)) {
    return requestDatabaseJsonp(action, payload);
  }

  const controller = new AbortController();
  const timeout = window.setTimeout(function () {
    controller.abort();
  }, getDatabaseRequestTimeout(action));

  try {
    await fetch(databaseConfig.googleScriptUrl, {
      method: "POST",
      mode: "no-cors",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "Content-Type": "text/plain;charset=utf-8"
      },
      body: JSON.stringify(Object.assign({ action: action }, payload || {}))
    });
  } finally {
    window.clearTimeout(timeout);
  }

  return Object.assign({ ok: true }, payload || {});
}

function toSupabaseTaxpayerRow(record) {
  const item = normalizeRecord(record);
  return {
    id: item.id,
    plate_key: getPlateKey(item.plateNumber),
    letter_type: item.letterType,
    tax_valid_date: item.taxValidDate || null,
    plate_number: item.plateNumber,
    owner_name: item.ownerName,
    tax_potential: Number(item.taxPotential || 0),
    phone: item.phone,
    status: item.status,
    field_visit_date: item.fieldVisitDate || null,
    field_visit_note: item.fieldVisitNote,
    updated_at: item.updatedAt
  };
}

function fromSupabaseTaxpayerRow(row) {
  return normalizeRecord({
    id: row.id,
    letterType: row.letter_type,
    taxValidDate: row.tax_valid_date,
    plateNumber: row.plate_number,
    ownerName: row.owner_name,
    taxPotential: row.tax_potential,
    phone: row.phone,
    status: row.status,
    fieldVisitDate: row.field_visit_date,
    fieldVisitNote: row.field_visit_note,
    updatedAt: row.updated_at
  });
}

function toSupabaseProductionRow(record) {
  const item = normalizeProductionRecord(record);
  return {
    id: item.id,
    letter_type: item.letterType,
    month: item.month,
    year: item.year,
    plate_number: item.plateNumber,
    plate_key: item.plateKey,
    owner_name: item.ownerName,
    entry_number: item.entryNumber,
    status: item.status,
    is_paid: item.isPaid,
    paid_date: item.paidDate || null,
    recorded_date: item.recordedDate || null,
    tax_valid_date: item.taxValidDate || null,
    tax_base_amount: Number(item.taxBaseAmount || 0),
    jasa_raharja: Number(item.jasaRaharja || 0),
    late_penalty: Number(item.latePenalty || 0),
    calculated_tax_potential: Number(item.calculatedTaxPotential || 0),
    source_text: item.sourceText,
    updated_at: item.updatedAt
  };
}

function fromSupabaseProductionRow(row) {
  return normalizeProductionRecord({
    id: row.id,
    letterType: row.letter_type,
    month: row.month,
    year: row.year,
    plateNumber: row.plate_number,
    plateKey: row.plate_key,
    ownerName: row.owner_name,
    entryNumber: row.entry_number,
    status: row.status,
    isPaid: row.is_paid,
    paidDate: row.paid_date,
    recordedDate: row.recorded_date,
    taxValidDate: row.tax_valid_date,
    taxBaseAmount: row.tax_base_amount,
    jasaRaharja: row.jasa_raharja,
    latePenalty: row.late_penalty,
    calculatedTaxPotential: row.calculated_tax_potential,
    sourceText: row.source_text,
    updatedAt: row.updated_at
  });
}

async function requestSupabaseRest(path, options) {
  const requestOptions = options || {};
  const response = await fetch(databaseConfig.supabaseUrl + "/rest/v1/" + path, Object.assign({}, requestOptions, {
    headers: Object.assign({
      apikey: databaseConfig.supabasePublishableKey,
      Authorization: "Bearer " + databaseConfig.supabasePublishableKey
    }, requestOptions.headers || {})
  }));
  if (!response.ok) throw new Error("Supabase: " + response.status);
  if (response.status === 204) return [];
  const text = await response.text();
  return text ? JSON.parse(text) : [];
}

async function listSupabaseRows(table, mapper) {
  const allRows = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const rows = await requestSupabaseRest(table + "?select=*&order=updated_at.desc", {
      headers: { Range: from + "-" + (from + pageSize - 1) }
    });
    allRows.push.apply(allRows, rows);
    if (rows.length < pageSize) break;
  }
  return allRows.map(mapper);
}

async function requestSupabaseDatabase(action, payload) {
  if (action === "list") {
    return { ok: true, records: await listSupabaseRows("taxpayers", fromSupabaseTaxpayerRow) };
  }
  if (action === "listProduction") {
    return { ok: true, productionRecords: await listSupabaseRows("production_records", fromSupabaseProductionRow) };
  }
  if (action === "productionSummary") {
    const rows = await requestSupabaseRest("production_summary?select=*");
    const source = rows[0] || {};
    return {
      ok: true,
      productionSummary: {
        count: Number(source.count || 0),
        paidCount: Number(source.paid_count || 0),
        unpaidCount: Number(source.unpaid_count || 0),
        latestUpdate: source.latest_update || ""
      }
    };
  }
  if (action === "upsert") {
    const rows = (payload.records || []).map(toSupabaseTaxpayerRow);
    if (!rows.length) return { ok: true, records: [] };
    const saved = await requestSupabaseRest("taxpayers?on_conflict=id", {
      method: "POST",
      headers: { "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify(rows)
    });
    return { ok: true, records: saved.map(fromSupabaseTaxpayerRow) };
  }
  if (action === "upsertProduction") {
    const rows = (payload.productionRecords || []).map(toSupabaseProductionRow);
    if (!rows.length) return { ok: true, productionRecords: [] };
    const saved = await requestSupabaseRest("production_records?on_conflict=id", {
      method: "POST",
      headers: { "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify(rows)
    });
    return { ok: true, productionRecords: saved.map(fromSupabaseProductionRow) };
  }
  if (action === "deleteMany") {
    const ids = (payload.ids || []).filter(Boolean);
    if (!ids.length) return { ok: true };
    const query = "taxpayers?id=in.(" + ids.map(encodeURIComponent).join(",") + ")";
    await requestSupabaseRest(query, { method: "DELETE", headers: { Prefer: "return=minimal" } });
    return { ok: true };
  }
  throw new Error("Aksi Supabase tidak dikenal.");
}

function requestDatabaseJsonp(action, payload) {
  return new Promise(function (resolve, reject) {
    const callbackName = "__wajibPajakDbCallback" + Date.now() + Math.random().toString(36).slice(2);
    const script = document.createElement("script");

    const timeout = window.setTimeout(function () {
      cleanup();
      reject(new Error("Database tidak merespons."));
    }, getDatabaseRequestTimeout(action));

    function cleanup() {
      window.clearTimeout(timeout);
      delete window[callbackName];
      script.remove();
    }

    window[callbackName] = function (result) {
      cleanup();
      if (!result || !result.ok) {
        reject(new Error(result && result.error ? result.error : "Database request gagal"));
        return;
      }
      resolve(result);
    };

    script.onerror = function () {
      cleanup();
      reject(new Error("Database tidak dapat diakses."));
    };

    script.src = buildDatabaseJsonpUrl(action, payload, callbackName);
    document.head.append(script);
  });
}

async function fetchRemoteRecords() {
  const result = await requestDatabase("list");
  return Array.isArray(result.records) ? result.records.map(normalizeRecord) : [];
}

async function saveRemoteRecords(items) {
  if (!hasRemoteDatabase() || !items.length) return [];
  beginRemoteMutation();
  try {
    const result = await requestDatabase("upsert", {
      records: items
    });
    return Array.isArray(result.records) ? result.records.map(normalizeRecord) : [];
  } finally {
    finishRemoteMutation();
  }
}

async function deleteRemoteRecords(ids) {
  if (!hasRemoteDatabase() || !ids.length) return;
  beginRemoteMutation();
  try {
    await requestDatabase("deleteMany", {
      ids: ids
    });
  } finally {
    finishRemoteMutation();
  }
}

async function fetchRemoteProductionRecords() {
  const result = await requestDatabase("listProduction");
  return Array.isArray(result.productionRecords) ? result.productionRecords.map(normalizeProductionRecord) : [];
}

async function fetchRemoteProductionSummary() {
  const result = await requestDatabase("productionSummary");
  return normalizeProductionSummary(result.productionSummary || result.summary || result);
}

async function migrateLocalProductionRecordsToRemote() {
  if (!isSupabaseDatabase() || hasAttemptedLocalProductionMigration || !productionRecords.length) return;
  const remoteProduction = await fetchRemoteProductionRecords();
  const remoteById = new Map(remoteProduction.map(function (record) {
    return [record.id, record];
  }));
  const itemsToMigrate = productionRecords.filter(function (record) {
    const remoteRecord = remoteById.get(record.id);
    return !remoteRecord || String(record.updatedAt || "") > String(remoteRecord.updatedAt || "");
  });
  hasAttemptedLocalProductionMigration = true;
  if (!itemsToMigrate.length) return;

  const batches = chunkItems(itemsToMigrate, 100);
  for (let index = 0; index < batches.length; index += 1) {
    await requestDatabase("upsertProduction", { productionRecords: batches[index] });
  }
  showToast(itemsToMigrate.length + " data Buku Produksi dipindahkan ke Supabase.", "connection-success");
}

async function migrateLocalTaxpayersToSupabase(localRecords, remoteRecords) {
  if (!isSupabaseDatabase() || hasAttemptedLocalTaxpayerMigration || !localRecords.length) return false;
  const remoteById = new Map(remoteRecords.map(function (record) {
    return [record.id, record];
  }));
  const itemsToMigrate = localRecords.filter(function (record) {
    const normalizedRecord = normalizeRecord(record);
    const remoteRecord = remoteById.get(normalizedRecord.id);
    return !remoteRecord || String(normalizedRecord.updatedAt || "") > String(remoteRecord.updatedAt || "");
  });
  hasAttemptedLocalTaxpayerMigration = true;
  if (!itemsToMigrate.length) return false;

  const batches = chunkItems(itemsToMigrate, 100);
  for (let index = 0; index < batches.length; index += 1) {
    await requestDatabase("upsert", { records: batches[index] });
  }
  showToast(itemsToMigrate.length + " data wajib pajak dipindahkan ke Supabase.", "connection-success");
  return true;
}

async function replaceRemoteProductionRecords(scope, items) {
  if (!hasRemoteDatabase()) return [];
  beginRemoteMutation();
  try {
    const result = await requestDatabase("replaceProduction", {
      scope: scope,
      productionRecords: items
    });
    return Array.isArray(result.productionRecords) ? result.productionRecords.map(normalizeProductionRecord) : items;
  } finally {
    finishRemoteMutation();
  }
}

function mergeSavedRecords(savedRecords) {
  savedRecords.forEach(function (savedRecord) {
    const index = records.findIndex(function (item) {
      return item.id === savedRecord.id;
    });
    if (index >= 0) records[index] = savedRecord;
    else records.push(savedRecord);
  });
}

function beginRemoteMutation() {
  remoteMutationCount += 1;
  lastRemoteWriteAt = Date.now();
}

function finishRemoteMutation() {
  window.setTimeout(function () {
    remoteMutationCount = Math.max(0, remoteMutationCount - 1);
    refreshRemoteRecords({ silent: true });
  }, REMOTE_WRITE_SETTLE_MS);
}

function isRemoteMutating() {
  return remoteMutationCount > 0;
}

function clearFormSyncPending() {
  if (form) delete form.dataset.pendingRecordId;
}

function hasPendingRemoteWork() {
  return pendingRemoteUpserts.length > 0 || pendingRemoteDeletes.length > 0;
}

function chunkItems(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function queueRemoteUpsert(record) {
  const normalizedRecord = normalizeRecord(record);
  pendingRemoteDeletes = pendingRemoteDeletes.filter(function (id) {
    return id !== normalizedRecord.id;
  });
  pendingRemoteUpserts = pendingRemoteUpserts.filter(function (item) {
    return item.id !== normalizedRecord.id;
  });
  pendingRemoteUpserts.push(normalizedRecord);
  savePendingRemoteUpserts();
  savePendingRemoteDeletes();
}

function queueRemoteDelete(id) {
  if (!id) return;
  pendingRemoteUpserts = pendingRemoteUpserts.filter(function (item) {
    return item.id !== id;
  });
  if (!pendingRemoteDeletes.includes(id)) pendingRemoteDeletes.push(id);
  savePendingRemoteUpserts();
  savePendingRemoteDeletes();
}

function mergeRemoteRecordsWithPending(remoteRecords) {
  const deletedIds = new Set(pendingRemoteDeletes);
  const recordsById = {};

  remoteRecords.forEach(function (record) {
    const normalizedRecord = normalizeRecord(record);
    if (!deletedIds.has(normalizedRecord.id)) recordsById[normalizedRecord.id] = normalizedRecord;
  });

  pendingRemoteUpserts.forEach(function (record) {
    const normalizedRecord = normalizeRecord(record);
    recordsById[normalizedRecord.id] = normalizedRecord;
  });

  return Object.keys(recordsById).map(function (id) {
    return recordsById[id];
  });
}

function scheduleRemoteRetry(delayOverride) {
  if (!hasRemoteDatabase() || remoteRetryTimer) return;
  const delay = typeof delayOverride === "number"
    ? delayOverride
    : Math.min(REMOTE_RETRY_MAX_MS, REMOTE_RETRY_BASE_MS * Math.pow(2, remoteRetryAttempt));

  remoteRetryTimer = window.setTimeout(function () {
    remoteRetryTimer = null;
    if (hasPendingRemoteWork()) {
      syncPendingRemoteMutations();
    } else {
      refreshRemoteRecords({ silent: true });
    }
  }, delay);
}

async function syncPendingRemoteMutations() {
  if (!hasRemoteDatabase() || !hasPendingRemoteWork() || isPendingRemoteSyncing || isRemoteMutating()) return;

  const deleteIds = pendingRemoteDeletes.slice();
  const upsertRecords = pendingRemoteUpserts.slice();
  const sentUpsertIds = new Set(upsertRecords.map(function (record) {
    return record.id;
  }));

  isPendingRemoteSyncing = true;
  try {
    if (deleteIds.length) {
      const deleteChunks = chunkItems(deleteIds, 25);
      for (let index = 0; index < deleteChunks.length; index += 1) {
        await deleteRemoteRecords(deleteChunks[index]);
      }
      const deletedIdSet = new Set(deleteIds);
      pendingRemoteDeletes = pendingRemoteDeletes.filter(function (id) {
        return !deletedIdSet.has(id);
      });
      savePendingRemoteDeletes();
    }

    if (upsertRecords.length) {
      let savedRecords = [];
      const upsertChunks = chunkItems(upsertRecords, 10);
      for (let index = 0; index < upsertChunks.length; index += 1) {
        savedRecords = savedRecords.concat(await saveRemoteRecords(upsertChunks[index]));
      }
      const upsertIdSet = new Set(upsertRecords.map(function (record) {
        return record.id;
      }));
      pendingRemoteUpserts = pendingRemoteUpserts.filter(function (record) {
        return !upsertIdSet.has(record.id);
      });
      savePendingRemoteUpserts();
      mergeSavedRecords(savedRecords.length ? savedRecords : upsertRecords);
      saveRecords();
    }

    remoteRetryAttempt = 0;
    markRemoteOnline("Online auto-sync");
    render();

    if (form && form.dataset.pendingRecordId && sentUpsertIds.has(form.dataset.pendingRecordId)) {
      resetForm();
      showToast("Data berhasil tersimpan di database. Form siap input berikutnya.", "connection-success");
    }
  } catch (error) {
    console.error(error);
    remoteRetryAttempt += 1;
    markRemoteFailure("Gagal sinkron");
    showToast("Database belum tersambung. Aplikasi mencoba ulang otomatis.", "connection-error");
    scheduleRemoteRetry();
  } finally {
    isPendingRemoteSyncing = false;
  }
}

function getRecordsSignature(items) {
  return JSON.stringify(
    items
      .map(function (record) {
        return normalizeRecord(record);
      })
      .sort(function (a, b) {
        return a.id.localeCompare(b.id);
      })
      .map(function (record) {
        return {
          id: record.id,
          letterType: record.letterType,
          taxValidDate: record.taxValidDate,
          plateNumber: record.plateNumber,
          ownerName: record.ownerName,
          taxPotential: record.taxPotential,
          phone: record.phone,
          status: record.status,
          updatedAt: record.updatedAt
        };
      })
  );
}

function areRecordCollectionsEqual(first, second) {
  return getRecordsSignature(first) === getRecordsSignature(second);
}

function shouldKeepLocalRecordsDuringRecentWrite(remoteRecords) {
  return (
    !remoteRecords.length &&
    records.length > 0 &&
    Date.now() - lastRemoteWriteAt < REMOTE_EMPTY_AFTER_WRITE_GUARD_MS
  );
}

function isProductionSummaryNewer(summary) {
  if (!summary || !summary.latestUpdate) return false;
  const currentRecordLatest = getLatestProductionUpdateFromRecords(productionRecords);
  return !currentRecordLatest || String(summary.latestUpdate) > String(currentRecordLatest);
}

async function refreshRemoteRecords(options) {
  const settings = options || {};
  if (!hasRemoteDatabase() || isRemoteRefreshing || isRemoteMutating()) return;

  isRemoteRefreshing = true;
  try {
    const localRecordsBeforeRemoteLoad = records.slice();
    let remoteRecords = await fetchRemoteRecords();
    if (await migrateLocalTaxpayersToSupabase(localRecordsBeforeRemoteLoad, remoteRecords)) {
      remoteRecords = await fetchRemoteRecords();
    }
    await refreshRemoteProductionSummary({ silent: true });
    if (shouldKeepLocalRecordsDuringRecentWrite(remoteRecords)) {
      markRemoteOnline("Online auto-sync");
      return;
    }
    const mergedRecords = mergeRemoteRecordsWithPending(remoteRecords);
    if (!areRecordCollectionsEqual(records, mergedRecords)) {
      records = mergedRecords;
      saveRecords();
      render();
      if (!settings.silent) showToast("Data terbaru dimuat dari database.");
    }
    markRemoteOnline("Online auto-sync");
    syncPendingRemoteMutations();
  } catch (error) {
    console.error(error);
    markRemoteFailure("Gagal sinkron");
    if (!settings.silent) showToast("Auto-sync gagal mengambil database.");
    scheduleRemoteRetry();
  } finally {
    isRemoteRefreshing = false;
  }
}

async function refreshRemoteProductionSummary(options) {
  const settings = options || {};
  if (!hasRemoteDatabase() || isProductionSummaryRefreshing) return;

  isProductionSummaryRefreshing = true;
  try {
    const remoteSummary = await fetchRemoteProductionSummary();
    const shouldRefreshFullData =
      settings.force ||
      !productionRecords.length ||
      isProductionSummaryNewer(remoteSummary) ||
      Number(remoteSummary.count || 0) !== productionRecords.length;

    saveProductionSummarySnapshot(remoteSummary);
    if (remoteSummary.latestUpdate) saveProductionLastSyncAt(remoteSummary.latestUpdate);
    updateProductionSummary();

    if (shouldRefreshFullData) {
      await refreshRemoteProductionRecords({ force: true, silent: true });
    }
  } catch (error) {
    console.warn(error);
    const shouldFallbackFullRefresh =
      settings.force ||
      !productionRecords.length ||
      Date.now() - lastProductionSummaryFallbackAt > PRODUCTION_SUMMARY_FALLBACK_REFRESH_MS;
    if (shouldFallbackFullRefresh) {
      lastProductionSummaryFallbackAt = Date.now();
      await refreshRemoteProductionRecords({ force: true, silent: true });
    }
    if (!settings.silent) showToast("Ringkasan SIAPP belum bisa diperbarui.");
  } finally {
    isProductionSummaryRefreshing = false;
  }
}

async function refreshRemoteProductionRecords(options) {
  const settings = options || {};
  if (!hasRemoteDatabase() || isProductionRefreshing) return;
  if (!settings.force && productionRecords.length && Date.now() - lastProductionRefreshAt < REMOTE_PRODUCTION_REFRESH_INTERVAL_MS) return;

  isProductionRefreshing = true;
  try {
    const remoteProductionRecords = await fetchRemoteProductionRecords();
    lastProductionRefreshAt = Date.now();
    if (remoteProductionRecords.length || !productionRecords.length) {
      setProductionRecords(remoteProductionRecords);
      const changedRecords = applyProductionLetterUpdates(remoteProductionRecords);
      changedRecords.forEach(queueRemoteUpsert);
      updateProductionSummary();
      updateProductionCheckPreview();
      applyProductionDefaultsToForm();
      render();
      if (changedRecords.length) syncPendingRemoteMutations();
    }
  } catch (error) {
    console.warn(error);
    if (!settings.silent) showToast("Data SIAPP belum bisa diperbarui. Aplikasi akan mencoba lagi.");
  } finally {
    isProductionRefreshing = false;
  }
}

function startRemoteAutoRefresh() {
  if (!hasRemoteDatabase() || remoteAutoRefreshStarted) return;
  remoteAutoRefreshStarted = true;

  window.setInterval(function () {
    if (!document.hidden) refreshRemoteRecords({ silent: true });
  }, REMOTE_REFRESH_INTERVAL_MS);

  window.addEventListener("focus", function () {
    refreshRemoteRecords({ silent: true });
  });

  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) refreshRemoteRecords({ silent: true });
  });
}

async function initializeRemoteDatabase() {
  if (!hasRemoteDatabase()) {
    updateSyncStatus("Lokal", "");
    render();
    return;
  }

  updateSyncStatus("Menghubungkan...", "");
  startRemoteAutoRefresh();
  try {
    const remoteRecords = await fetchRemoteRecords();
    const mergedRecords = mergeRemoteRecordsWithPending(remoteRecords);
    if (remoteRecords.length) {
      records = mergedRecords;
      saveRecords();
      render();
      markRemoteOnline("Online auto-sync");
      syncPendingRemoteMutations();
      await migrateLocalProductionRecordsToRemote();
      await refreshRemoteProductionRecords({ force: true, silent: true });
      refreshRemoteProductionSummary({ force: true, silent: true });
      return;
    }

    if (records.length && !hasPendingRemoteWork()) {
      records.forEach(queueRemoteUpsert);
      showToast("Data lokal akan dikirim ke database online.");
    } else if (hasPendingRemoteWork()) {
      records = mergedRecords;
      saveRecords();
    }

    render();
    markRemoteOnline("Online auto-sync");
    syncPendingRemoteMutations();
    await migrateLocalProductionRecordsToRemote();
    await refreshRemoteProductionRecords({ force: true, silent: true });
    refreshRemoteProductionSummary({ force: true, silent: true });
  } catch (error) {
    console.error(error);
    render();
    markRemoteFailure("Gagal sinkron");
    showToast("Database online gagal tersambung, memakai data lokal.");
    scheduleRemoteRetry();
  }
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function parseLocalDate(value) {
  if (!value) return null;
  if (String(value).includes("/")) {
    const parts = String(value).split("/").map(Number);
    return new Date(parts[2], parts[1] - 1, parts[0]);
  }
  const parts = String(value).split("-").map(Number);
  return new Date(parts[0], parts[1] - 1, parts[2]);
}

function daysBetween(startIso, endIso) {
  const start = parseLocalDate(startIso);
  const end = parseLocalDate(endIso);
  if (!start || !end) return null;
  const millis = end.setHours(0, 0, 0, 0) - start.setHours(0, 0, 0, 0);
  return Math.round(millis / 86400000);
}

function formatDate(value) {
  if (!value) return "-";
  const date = parseLocalDate(value);
  if (!date || Number.isNaN(date.getTime())) return "-";
  return [
    String(date.getDate()).padStart(2, "0"),
    String(date.getMonth() + 1).padStart(2, "0"),
    date.getFullYear()
  ].join("/");
}

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (!date || Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function dateToIso(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
}

function getMonthKey(value) {
  const isoDate = toIsoDate(value);
  return isoDate ? isoDate.slice(0, 7) : "";
}

function getMonthLabel(monthKey) {
  const date = parseLocalDate(monthKey + "-01");
  if (!date || Number.isNaN(date.getTime())) return "Bulan berjalan";
  const label = date.toLocaleDateString("id-ID", { month: "long", year: "numeric" });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function updateDashboardMonthFilter() {
  if (!controls.dashboardMonthFilter) return;
  const currentMonth = todayIso().slice(0, 7);
  const selectedMonth = controls.dashboardMonthFilter.value || currentMonth;
  const monthValues = new Set([currentMonth]);

  records.forEach(function (record) {
    const monthKey = getMonthKey(record.fieldVisitDate);
    if (monthKey) monthValues.add(monthKey);
  });

  const values = Array.from(monthValues).sort().reverse();
  controls.dashboardMonthFilter.replaceChildren();
  values.forEach(function (monthKey) {
    const option = document.createElement("option");
    option.value = monthKey;
    option.textContent = getMonthLabel(monthKey);
    controls.dashboardMonthFilter.append(option);
  });

  controls.dashboardMonthFilter.value = values.includes(selectedMonth) ? selectedMonth : currentMonth;
}

function getMonthContext(dateValue) {
  const selectedMonth = controls.dashboardMonthFilter ? controls.dashboardMonthFilter.value : "";
  const sourceDate = dateValue || (selectedMonth ? selectedMonth + "-01" : todayIso());
  const date = parseLocalDate(sourceDate);
  const safeDate = date && !Number.isNaN(date.getTime()) ? date : new Date();
  const year = safeDate.getFullYear();
  const monthIndex = safeDate.getMonth();
  const month = monthIndex + 1;
  const label = safeDate.toLocaleDateString("id-ID", { month: "long", year: "numeric" });
  return {
    year: year,
    month: month,
    monthIndex: monthIndex,
    label: label.charAt(0).toUpperCase() + label.slice(1),
    startIso: dateToIso(new Date(year, monthIndex, 1)),
    endIso: dateToIso(new Date(year, monthIndex + 1, 0))
  };
}

function isDateInMonth(dateValue, context) {
  const date = parseLocalDate(dateValue);
  if (!date || Number.isNaN(date.getTime())) return false;
  return date.getFullYear() === context.year && date.getMonth() === context.monthIndex;
}

function getMonthWeekNumber(dateValue) {
  const date = parseLocalDate(dateValue);
  if (!date || Number.isNaN(date.getTime())) return 0;
  const day = date.getDate();
  if (day <= 7) return 1;
  if (day <= 14) return 2;
  if (day <= 21) return 3;
  return 4;
}

function addDaysIso(value, days) {
  const date = parseLocalDate(value);
  if (!date || Number.isNaN(date.getTime())) return "";
  date.setDate(date.getDate() + days);
  return dateToIso(date);
}

function getLetterRank(letterType) {
  return LETTER_SEQUENCE.indexOf(letterType);
}

function getHigherLetterType(firstLetter, secondLetter) {
  const firstRank = getLetterRank(firstLetter);
  const secondRank = getLetterRank(secondLetter);
  if (firstRank < 0) return secondRank < 0 ? "" : secondLetter;
  if (secondRank < 0) return firstLetter;
  return secondRank > firstRank ? secondLetter : firstLetter;
}

function getLetterFollowUpPlan(record) {
  if (!record.taxValidDate) return [];

  const currentRank = getLetterRank(record.letterType);
  return LETTER_SEQUENCE
    .filter(function (letterType) {
      return getLetterRank(letterType) > currentRank;
    })
    .map(function (letterType) {
      return {
        letterType: letterType,
        offset: LETTER_OFFSETS[letterType],
        date: addDaysIso(record.taxValidDate, LETTER_OFFSETS[letterType])
      };
    })
    .filter(function (item) {
    return item.date;
  });
}

function getFollowUpEmptyText(record) {
  if (!record.taxValidDate) return "Masa pajak belum diisi";
  if (record.letterType === "NTP") return "Tidak ada surat lanjutan";
  return "Jenis surat belum dipilih";
}

function formatDateForInput(value) {
  return value ? formatDate(value) : "";
}

function formatFastDateInput(value) {
  const digits = String(value || "").replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return digits.slice(0, 2) + "/" + digits.slice(2);
  return digits.slice(0, 2) + "/" + digits.slice(2, 4) + "/" + digits.slice(4, 8);
}

function isCompleteDisplayDate(value) {
  return /^\d{2}\/\d{2}\/\d{4}$/.test(String(value || "").trim());
}

function normalizeDateInput(input) {
  input.value = formatFastDateInput(input.value);
  input.dataset.previousDigits = input.value.replace(/\D/g, "");
  return !input.dataset.previousDigits || (input.dataset.previousDigits.length === 8 && isCompleteDisplayDate(input.value));
}

function formatPartialDateDigits(digits, isDelete) {
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return digits.slice(0, 2) + "/" + digits.slice(2);
  return digits.slice(0, 2) + "/" + digits.slice(2, 4) + "/" + digits.slice(4, 8);
}

function toIsoDate(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  const formatted = formatFastDateInput(raw);
  const match = formatted.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return "";

  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return "";

  return [
    year,
    String(month).padStart(2, "0"),
    String(day).padStart(2, "0")
  ].join("-");
}

function getNominalNumber(value) {
  return Number(String(value || "").replace(/\D/g, ""));
}

function formatCurrency(value) {
  return "Rp " + new Intl.NumberFormat("id-ID", {
    maximumFractionDigits: 0
  }).format(Number(value || 0)) + ",-";
}

function extractLastDate(value) {
  const matches = String(value || "").match(/\d{2}\/\d{2}\/\d{4}/g) || [];
  return matches.length ? matches[matches.length - 1] : "";
}

function extractFirstDateFromText(value) {
  const matches = String(value || "").match(/\d{2}\/\d{2}\/\d{4}/g) || [];
  return matches.length ? matches[0] : "";
}

function extractSiappTaxBaseFromSourceText(value) {
  const parts = String(value || "").split("|").map(function (part) {
    return part.trim();
  });
  const directValue = getNominalNumber(parts[4] || "");
  if (directValue) return directValue;

  for (let index = 0; index < parts.length; index += 1) {
    if (/\d{1,2}\/\d{1,2}\/\d{4}/.test(parts[index])) continue;
    if (!/\d+\.\d{3}/.test(parts[index])) continue;
    const valueNumber = getNominalNumber(parts[index]);
    if (valueNumber >= 50000) return valueNumber;
  }

  return 0;
}

function extractSiappTaxValidDateFromSourceText(value) {
  const parts = String(value || "").split("|").map(function (part) {
    return part.trim();
  });
  return toIsoDate(extractLastDate(parts[3] || "") || extractLastDate(value));
}

function extractSiappRecordedDateFromSourceText(value) {
  const parts = String(value || "").split("|").map(function (part) {
    return part.trim();
  });
  return toIsoDate(extractFirstDateFromText(parts[5] || "") || extractFirstDateFromText(value));
}

function parseIsoDate(value) {
  const iso = toIsoDate(value);
  if (!iso) return null;
  const parts = iso.split("-").map(Number);
  const date = new Date(parts[0], parts[1] - 1, parts[2]);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getLateMonthCount(taxValidDate, today) {
  const validDate = parseIsoDate(taxValidDate);
  if (!validDate) return 0;
  const currentDate = today || new Date();
  const currentStart = new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate());
  const validStart = new Date(validDate.getFullYear(), validDate.getMonth(), validDate.getDate());
  if (currentStart <= validStart) return 0;

  let months = (currentStart.getFullYear() - validStart.getFullYear()) * 12;
  months += currentStart.getMonth() - validStart.getMonth();
  if (currentStart.getDate() > validStart.getDate()) months += 1;
  return Math.max(1, months);
}

function calculateLatePenalty(taxValidDate, today) {
  const lateMonths = getLateMonthCount(taxValidDate, today);
  if (!lateMonths) return 0;
  return Math.ceil(lateMonths / 3) * DENDA_RODA_4_PER_3_BULAN;
}

function calculateTaxPotentialFromSiapp(baseAmount, taxValidDate, today) {
  const base = Number(baseAmount || 0);
  if (!base) return 0;
  return base + JASA_RAHARJA_RODA_4 + calculateLatePenalty(taxValidDate, today);
}

function getProductionTaxBreakdown(record) {
  const baseAmount = getNominalNumber(record && (record.taxBaseAmount || record.siappBaseAmount || record.baseAmount || 0));
  const taxValidDate = toIsoDate(record && (record.taxValidDate || ""));
  const latePenalty = calculateLatePenalty(taxValidDate);
  const calculatedTaxPotential = Number(record && record.calculatedTaxPotential) || calculateTaxPotentialFromSiapp(baseAmount, taxValidDate);

  return {
    baseAmount: baseAmount,
    taxValidDate: taxValidDate,
    jasaRaharja: baseAmount ? JASA_RAHARJA_RODA_4 : 0,
    latePenalty: baseAmount ? latePenalty : 0,
    calculatedTaxPotential: calculatedTaxPotential
  };
}

function formatPlate(value) {
  const compact = String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const match = compact.match(/^([A-Z]{1,2})([0-9]{1,4})([A-Z]{0,3})$/);
  if (!match) return compact;
  return [match[1], match[2], match[3]].filter(Boolean).join(" ");
}

function formatUpperText(value) {
  return String(value || "").toUpperCase();
}

function normalizeUpperText(value) {
  return formatUpperText(value).trim();
}

function cleanOwnerName(value) {
  const rawText = String(value || "").replace(/<br\s*\/?>/gi, "\n");
  const firstLine = rawText.split(/\r?\n/)
    .map(function (line) {
      return normalizeUpperText(line).replace(/\s+/g, " ").trim();
    })
    .find(Boolean) || "";

  let ownerName = firstLine
    .replace(/\s*\|.*$/, "")
    .replace(/\b(KEC|KEL|DESA|DUSUN|JL|JLN|JALAN|RT|RW|GG|GANG|NO|NOMOR|BLOK|KAV|PERUM|DK|DS)\b.*$/, "")
    .trim();
  if (/\d/.test(ownerName)) {
    ownerName = ownerName.replace(/\b(MULYOREJO|MULYOSARI|MANYAR|SUTOREJO|KALIJUDAN|KALISARI|KENJERAN|KERTAJAYA|DHARMAHUSADA|BABATAN|TEMPUREJO|WISMA|PONDOK|KARANG|DUKUH|RUNGKUT|SUKOLILO|KEPUTIH|KLAMPIS|MENUR|MOJO|AIRLANGGA|SURABAYA|GRESIK|SIDOARJO|CHANDRALAGUNA|PURI|ASRI|TAMAN|GRAHA|GRIYA|CITRA|PERMATA|VILLA|KOMP|KOMPLEK|PERUMAHAN)\b.*$/, "").trim();
  }
  return ownerName
    .replace(/\b[A-Z]{1,2}\s*\d{1,4}\s*[A-Z]{1,3}\b.*$/, "")
    .trim();
}

function formatUpperTextField(event) {
  const input = event.target;
  const start = input.selectionStart;
  const end = input.selectionEnd;
  input.value = formatUpperText(input.value);
  if (typeof input.setSelectionRange === "function" && start !== null && end !== null) {
    input.setSelectionRange(start, end);
  }
}

function formatWhatsappLocal(value) {
  let digits = String(value || "").replace(/\D/g, "");
  if (digits.startsWith("62")) digits = digits.slice(2);
  if (digits.startsWith("0")) digits = digits.slice(1);
  return digits;
}

function normalizeWhatsapp(value) {
  const local = formatWhatsappLocal(value);
  return local ? "+62" + local : "";
}

function getJakartaGreeting() {
  const hour = new Date(Date.now() + 7 * 60 * 60 * 1000).getUTCHours();
  if (hour >= 4 && hour < 11) return "Selamat Pagi";
  if (hour >= 11 && hour < 15) return "Selamat Siang";
  if (hour >= 15 && hour < 18) return "Selamat Sore";
  return "Selamat Malam";
}

function getWhatsappMessage(record) {
  const name = record.ownerName ? "Bapak/Ibu " + record.ownerName : "Bapak/Ibu";
  const plate = record.plateNumber ? " dengan nomor polisi " + record.plateNumber : "";
  return getJakartaGreeting() + ", apa benar ini dengan " + name + "? kami dari SAMSAT Manyar mau mengingatkan terkait pembayaran pajak tahunan kendaraannya" + plate + ".";
}

function getWhatsappUrl(record) {
  const digits = String(record.phone || "").replace(/\D/g, "");
  if (!digits) return "";
  return "https://wa.me/" + digits + "?text=" + encodeURIComponent(getWhatsappMessage(record));
}

function getPlateKey(value) {
  return formatPlate(value).replace(/\s/g, "");
}

function extractPlateCandidates(value) {
  const text = normalizeUpperText(value).replace(/[^A-Z0-9\s]/g, " ");
  return Array.from(new Set((text.match(/\b[A-Z]{1,2}\s*\d{1,4}\s*[A-Z]{1,3}\b/g) || [])
    .map(formatPlate)
    .filter(function (plate) {
      return /^[A-Z]{1,2}\s\d{1,4}\s[A-Z]{1,3}$/.test(plate);
    })));
}

function extractFirstDate(value) {
  const match = String(value || "").match(/\d{2}\/\d{2}\/\d{4}/);
  return match ? match[0] : "";
}

function detectProductionPayment(rawText) {
  const text = normalizeUpperText(rawText);
  const dates = text.match(/\d{2}\/\d{2}\/\d{4}/g) || [];
  const hasUnpaidMarker = /\b(BELUM|TIDAK)\s+(?:TERDETEKSI\s+)?(?:LUNAS|BAYAR)\b/.test(text);
  const hasPaidWord = /\b(LUNAS|SUDAH\s+BAYAR|TERBAYAR|PAID)\b/.test(text);
  // Do not infer payment from the number of dates in a SIAPP row.
  const isPaid = !hasUnpaidMarker && hasPaidWord;
  return {
    isPaid: isPaid,
    status: isPaid ? "Lunas" : "Belum terdeteksi lunas",
    paidDate: isPaid && dates.length ? dates[dates.length - 1] : ""
  };
}

function isProductionRecordPaid(record) {
  if (!record) return false;
  const sourceText = String(record.sourceText || "").trim();
  if (sourceText) return detectProductionPayment(sourceText).isPaid;

  const fallbackPayment = detectProductionPayment([record.status, record.paidDate].join(" "));
  if (!fallbackPayment.isPaid && /\b(BELUM|TIDAK)\s+(?:TERDETEKSI\s+)?(?:LUNAS|BAYAR)\b/.test(normalizeUpperText([record.status, record.paidDate].join(" ")))) {
    return false;
  }
  const paidFlag = String(record.isPaid == null ? "" : record.isPaid).trim().toLowerCase();
  if (record.isPaid === true || ["true", "1", "ya"].includes(paidFlag)) return true;
  return fallbackPayment.isPaid;
}

function getProductionOwnerFromContext(context, plateNumber) {
  const compactText = normalizeUpperText(context).replace(/\s+/g, " ");
  const platePattern = getPlateKey(plateNumber).replace(/([A-Z])(?=\d)/, "$1\\s*").replace(/(\d)(?=[A-Z])/, "$1\\s*");
  const afterPlate = compactText.split(new RegExp(platePattern))[1] || "";
  const sameLineOwner = afterPlate
    .replace(/\b(KEC|KEL|DESA|JL|JLN|RT|RW)\b.*$/, "")
    .replace(/\d{2}\/\d{2}\/\d{4}.*$/, "")
    .trim();
  if (sameLineOwner && /^[A-Z][A-Z\s.'-]{2,}$/.test(sameLineOwner)) return sameLineOwner;
  return "";
}

function normalizeProductionRecord(record) {
  const plateNumber = formatPlate(record.plateNumber || record.nopol || "");
  const plateKey = getPlateKey(plateNumber);
  const month = Number(record.month || new Date().getMonth() + 1);
  const year = Number(record.year || new Date().getFullYear());
  const letterType = coerceLetterType(record) || "SPOS";
  const taxBaseAmount = getNominalNumber(record.taxBaseAmount || record.siappBaseAmount || record.baseAmount || 0) || extractSiappTaxBaseFromSourceText(record.sourceText || "");
  const taxValidDate = toIsoDate(record.taxValidDate || "") || extractSiappTaxValidDateFromSourceText(record.sourceText || "");
  const recordedDate = toIsoDate(record.recordedDate || "") || extractSiappRecordedDateFromSourceText(record.sourceText || "");
  const payment = detectProductionPayment([record.status, record.sourceText, record.paidDate].join(" "));
  const isPaid = isProductionRecordPaid(record);
  const latePenalty = taxBaseAmount ? calculateLatePenalty(taxValidDate) : 0;
  const calculatedTaxPotential = getNominalNumber(record.calculatedTaxPotential || record.taxPotential || 0) || calculateTaxPotentialFromSiapp(taxBaseAmount, taxValidDate);
  return {
    id: String(record.id || [letterType, year, month, plateKey].join("-")),
    letterType: letterType,
    month: month,
    year: year,
    plateNumber: plateNumber,
    plateKey: plateKey,
    ownerName: cleanOwnerName(record.ownerName || ""),
    entryNumber: String(record.entryNumber || ""),
    status: isPaid ? "Lunas" : "Belum terdeteksi lunas",
    isPaid: isPaid,
    paidDate: isPaid ? String(record.paidDate || payment.paidDate || "") : "",
    recordedDate: recordedDate,
    taxValidDate: taxValidDate,
    taxBaseAmount: taxBaseAmount,
    jasaRaharja: taxBaseAmount ? JASA_RAHARJA_RODA_4 : 0,
    latePenalty: latePenalty,
    calculatedTaxPotential: calculatedTaxPotential,
    sourceText: String(record.sourceText || ""),
    updatedAt: String(record.updatedAt || new Date().toISOString())
  };
}

function parseProductionPaste(text, scope) {
  const lines = String(text || "").split(/\r?\n/)
    .map(function (line) {
      return normalizeUpperText(line).replace(/\t/g, " ").replace(/\s+/g, " ").trim();
    })
    .filter(Boolean);
  const parsedByKey = {};
  const plateHits = [];

  lines.forEach(function (line, index) {
    extractPlateCandidates(line).forEach(function (plateNumber) {
      plateHits.push({ plateNumber: plateNumber, index: index });
    });
  });

  plateHits.forEach(function (hit, hitIndex) {
    const nextHit = plateHits[hitIndex + 1];
    const startIndex = Math.max(0, hit.index - 2);
    const endIndex = nextHit ? Math.max(hit.index + 1, nextHit.index) : Math.min(lines.length, hit.index + 12);
    const contextLines = lines.slice(startIndex, endIndex);
    const context = contextLines.join(" ");
    extractPlateCandidates(lines[hit.index]).forEach(function (plateNumber) {
      const payment = detectProductionPayment(context);
      const plateKey = getPlateKey(plateNumber);
      const ownerLine = getProductionOwnerFromContext(context, plateNumber) || contextLines.find(function (candidate) {
        return /^[A-Z][A-Z\s.'-]{2,}$/.test(candidate) && !/^(KEC|JL|JLN|DESA|KEL|RT|RW|NO|NAMA|NOKOHIR|PKB|TGL|STATUS)\b/.test(candidate);
      }) || "";
      const entryLine = contextLines.find(function (candidate) {
        return /^\d{6,}/.test(candidate);
      }) || "";

      parsedByKey[plateKey] = normalizeProductionRecord({
        letterType: scope.letterType,
        month: scope.month,
        year: scope.year,
        plateNumber: plateNumber,
        ownerName: ownerLine,
        entryNumber: entryLine.replace(/\D/g, ""),
        status: payment.status,
        isPaid: payment.isPaid,
        paidDate: payment.paidDate || extractFirstDate(context),
        sourceText: context,
        updatedAt: new Date().toISOString()
      });
    });
  });

  return Object.keys(parsedByKey).map(function (key) {
    return parsedByKey[key];
  });
}

function getProductionReferenceDate(value) {
  if (value && typeof value === "object" && value.updatedAt) {
    const datePart = String(value.updatedAt).slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return datePart;
  }
  return todayIso();
}

function getProductionRecordedDate(record) {
  return toIsoDate(record && record.recordedDate) || extractSiappRecordedDateFromSourceText(record && record.sourceText);
}

function hasProductionPlate(value) {
  const plateKey = getPlateKey(value);
  if (!plateKey) return false;
  return Boolean(productionRecordsByPlate[plateKey] && productionRecordsByPlate[plateKey].length);
}

function getRecordedDateDistance(record, referenceDate) {
  const recordedDate = getProductionRecordedDate(record);
  if (!recordedDate) return Infinity;
  const distance = daysBetween(referenceDate, recordedDate);
  return distance === null ? Infinity : Math.abs(distance);
}

function sortProductionCandidates(first, second, referenceDate) {
  const firstDistance = getRecordedDateDistance(first, referenceDate);
  const secondDistance = getRecordedDateDistance(second, referenceDate);
  if (firstDistance !== secondDistance) return firstDistance - secondDistance;
  const firstRank = getLetterRank(first.letterType);
  const secondRank = getLetterRank(second.letterType);
  if (firstRank !== secondRank) return secondRank - firstRank;
  return String(second.updatedAt || "").localeCompare(String(first.updatedAt || ""));
}

function getProductionMatch(value) {
  const plateKey = typeof value === "string" ? getPlateKey(value) : getPlateKey(value && value.plateNumber);
  if (!plateKey) return null;
  const referenceDate = getProductionReferenceDate(value);
  const candidates = (productionRecordsByPlate[plateKey] || []).slice();

  const closeMatches = candidates
    .filter(function (record) {
      return getProductionRecordedDate(record);
    })
    .sort(function (first, second) {
      return sortProductionCandidates(first, second, referenceDate);
    });

  if (closeMatches.length) return closeMatches[0];

  return candidates.sort(function (a, b) {
    return String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""));
  })[0] || null;
}

function isRecordPaid(record) {
  const match = getProductionMatch(record);
  if (match) return Boolean(match.isPaid);
  if (productionRecords.length) return false;
  return record.status === "Sudah bayar";
}

function describeProductionMatch(recordOrPlate) {
  const match = getProductionMatch(recordOrPlate);
  if (!match) return "Belum lunas SIAPP";
  if (match.isPaid) return "Lunas SIAPP" + (match.paidDate ? " - " + match.paidDate : "");
  return "Belum lunas SIAPP";
}

function getSiappPaymentFilterState(record) {
  const match = getProductionMatch(record);
  // Payment is only marked paid when SIAPP explicitly provides a paid record.
  // Every other taxpayer remains in the unpaid follow-up queue.
  if (!match) return "siappUnpaid";
  return match.isPaid ? "siappPaid" : "siappUnpaid";
}

function getAutoPaymentStatus(recordOrPlate, fallbackStatus) {
  const match = getProductionMatch(recordOrPlate);
  if (match) return match.isPaid ? "Sudah bayar" : "Belum bayar";
  return fallbackStatus || (recordOrPlate && recordOrPlate.status) || "Belum bayar";
}

function getProductionPeriodLabel(record) {
  const monthNames = ["", "Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
  return (monthNames[Number(record.month)] || "Bulan") + " " + (record.year || "");
}

function getLatestProductionUpdate() {
  return [productionLastSyncAt, productionSummarySnapshot.latestUpdate, getLatestProductionUpdateFromRecords(productionRecords)]
    .filter(Boolean)
    .sort()
    .pop() || "";
}

function updateProductionSummary() {
  const localSummary = createProductionSummaryFromRecords(productionRecords);
  const remoteSummary = normalizeProductionSummary(productionSummarySnapshot);
  const useRemoteSummary = remoteSummary.count >= localSummary.count || String(remoteSummary.latestUpdate || "") >= String(localSummary.latestUpdate || "");
  const activeSummary = useRemoteSummary ? remoteSummary : localSummary;
  const paidCount = activeSummary.paidCount;
  const unpaidCount = activeSummary.unpaidCount;
  const latestUpdate = getLatestProductionUpdate();
  const totalCount = activeSummary.count || productionRecords.length;
  const summaryText = totalCount
    ? totalCount + " nopol referensi tersimpan. " + paidCount + " lunas, " + unpaidCount + " belum lunas."
    : "Belum ada data referensi.";

  if (controls.productionSummary) controls.productionSummary.textContent = summaryText;
  if (summary.siappReferenceCount) {
    summary.siappReferenceCount.textContent = totalCount
      ? totalCount + " data SIAPP"
      : "0 data SIAPP";
  }
  if (summary.siappLastSync) {
    summary.siappLastSync.textContent = latestUpdate
      ? "Terakhir masuk: " + formatDateTime(latestUpdate) + " WIB. " + paidCount + " lunas, " + unpaidCount + " belum lunas."
      : "Belum ada data SIAPP tersimpan";
  }
}

function updateProductionCheckPreview() {
  if (!controls.productionCheckResult) return;
  const plateNumber = fields.plateNumber.value;
  controls.productionCheckResult.className = "production-check";

  if (!plateNumber) {
    controls.productionCheckResult.textContent = "";
    return;
  }

  if (!productionRecords.length) {
    controls.productionCheckResult.textContent = "";
    return;
  }

  const match = getProductionMatch(plateNumber);
  if (!match) {
    controls.productionCheckResult.textContent = "Nopol belum tersinkron SIAPP";
    controls.productionCheckResult.classList.add("is-neutral");
    return;
  }

  if (match.isPaid) {
    controls.productionCheckResult.textContent = "Lunas di SIAPP" + (match.paidDate ? " " + match.paidDate : "");
    controls.productionCheckResult.classList.add("is-paid");
    return;
  }

  controls.productionCheckResult.textContent = "";
}

function updateSiappAutofillPanel() {
  const match = getProductionMatch(fields.plateNumber.value);
  const breakdown = match ? getProductionTaxBreakdown(match) : null;
  if (controls.autoLetterType) controls.autoLetterType.textContent = match && match.letterType ? match.letterType : "-";
  if (controls.autoOwnerName) controls.autoOwnerName.textContent = match && match.ownerName ? match.ownerName : "-";
  if (controls.autoTaxValidDate) controls.autoTaxValidDate.textContent = match && match.taxValidDate ? formatDate(match.taxValidDate) : "-";
  if (controls.autoTaxPotential) controls.autoTaxPotential.textContent = breakdown && breakdown.calculatedTaxPotential ? formatCurrency(breakdown.calculatedTaxPotential) : "-";
}

function applyProductionDefaultsToForm() {
  const match = getProductionMatch(fields.plateNumber.value);
  if (!match) {
    if (fields.letterType) fields.letterType.value = "";
    if (fields.ownerName) fields.ownerName.value = "";
    if (fields.taxValidDate) fields.taxValidDate.value = "";
    if (fields.taxPotential) {
      fields.taxPotential.value = "";
      fields.taxPotential.dataset.previousDigits = "";
      fields.taxPotential.dataset.siappPlateKey = "";
    }
    updateSiappAutofillPanel();
    return;
  }

  const breakdown = getProductionTaxBreakdown(match);
  if (fields.letterType) fields.letterType.value = match.letterType || "";
  if (fields.ownerName) fields.ownerName.value = match.ownerName || "";
  if (fields.taxValidDate && match.taxValidDate) {
    fields.taxValidDate.value = match.taxValidDate;
  }

  updateSiappAutofillPanel();
  if (!breakdown.calculatedTaxPotential || !fields.taxPotential) return;
  const plateKey = getPlateKey(fields.plateNumber.value);
  const alreadyAutoFilled = fields.taxPotential.dataset.siappPlateKey === plateKey;
  if (fields.taxPotential.value && !alreadyAutoFilled) return;

  fields.taxPotential.value = String(breakdown.calculatedTaxPotential);
  fields.taxPotential.dataset.previousDigits = String(breakdown.calculatedTaxPotential);
  fields.taxPotential.dataset.siappPlateKey = plateKey;
  updateSiappAutofillPanel();
}

function findExistingRecordByPlate(plateNumber, excludedId) {
  const plateKey = getPlateKey(plateNumber);
  if (!plateKey) return null;
  return records.find(function (record) {
    return record.id !== excludedId && getPlateKey(record.plateNumber) === plateKey;
  }) || null;
}

function mergeDuplicateRecord(existingRecord, incomingRecord) {
  const mergedLetterType = getHigherLetterType(existingRecord.letterType, incomingRecord.letterType);
  return normalizeRecord({
    id: existingRecord.id,
    letterType: mergedLetterType || incomingRecord.letterType || existingRecord.letterType,
    taxValidDate: incomingRecord.taxValidDate || existingRecord.taxValidDate,
    plateNumber: incomingRecord.plateNumber || existingRecord.plateNumber,
    ownerName: incomingRecord.ownerName || existingRecord.ownerName,
    taxPotential: incomingRecord.taxPotential || existingRecord.taxPotential,
    phone: incomingRecord.phone || existingRecord.phone,
    status: getAutoPaymentStatus(incomingRecord.plateNumber || existingRecord.plateNumber, incomingRecord.status || existingRecord.status),
    fieldVisitDate: incomingRecord.fieldVisitDate || existingRecord.fieldVisitDate,
    fieldVisitNote: incomingRecord.fieldVisitNote || existingRecord.fieldVisitNote,
    updatedAt: new Date().toISOString()
  });
}

function applyProductionLetterUpdates(sourceRecords) {
  const changedRecords = [];
  const processedPlateKeys = {};

  sourceRecords.forEach(function (productionRecord) {
    if (!productionRecord) return;
    const existingRecord = findExistingRecordByPlate(productionRecord.plateNumber, "");
    if (!existingRecord) return;

    const plateKey = getPlateKey(existingRecord.plateNumber);
    if (!plateKey || processedPlateKeys[plateKey]) return;
    processedPlateKeys[plateKey] = true;

    const selectedProductionRecord = getProductionMatch(existingRecord);
    if (!selectedProductionRecord) return;

    const nextLetterType = selectedProductionRecord.letterType;
    const breakdown = getProductionTaxBreakdown(selectedProductionRecord);
    let isChanged = false;

    if (nextLetterType && nextLetterType !== existingRecord.letterType) {
      existingRecord.letterType = nextLetterType;
      isChanged = true;
    }

    if (selectedProductionRecord.ownerName && existingRecord.ownerName !== selectedProductionRecord.ownerName) {
      existingRecord.ownerName = selectedProductionRecord.ownerName;
      isChanged = true;
    }

    if (selectedProductionRecord.taxValidDate && existingRecord.taxValidDate !== selectedProductionRecord.taxValidDate) {
      existingRecord.taxValidDate = selectedProductionRecord.taxValidDate;
      isChanged = true;
    }

    if (breakdown.calculatedTaxPotential && Number(existingRecord.taxPotential || 0) !== breakdown.calculatedTaxPotential) {
      existingRecord.taxPotential = breakdown.calculatedTaxPotential;
      isChanged = true;
    }

    const nextPaymentStatus = selectedProductionRecord.isPaid ? "Sudah bayar" : "Belum bayar";
    if (existingRecord.status !== nextPaymentStatus) {
      existingRecord.status = nextPaymentStatus;
      isChanged = true;
    }

    if (!isChanged) return;
    existingRecord.updatedAt = new Date().toISOString();
    changedRecords.push(normalizeRecord(existingRecord));
  });

  // Keep every saved taxpayer in one of two payment states. A missing source
  // record is not evidence of payment, so it remains "Belum bayar" until a
  // future SIAPP sync explicitly records it as paid.
  records.forEach(function (existingRecord) {
    const plateKey = getPlateKey(existingRecord.plateNumber);
    if (!plateKey || processedPlateKeys[plateKey]) return;
    if (existingRecord.status === "Belum bayar") return;
    existingRecord.status = "Belum bayar";
    existingRecord.updatedAt = new Date().toISOString();
    changedRecords.push(normalizeRecord(existingRecord));
  });

  if (changedRecords.length) saveRecords();
  return changedRecords;
}

function updateDuplicateCheckPreview() {
  if (!controls.duplicateCheckResult) return;
  const existingRecord = findExistingRecordByPlate(fields.plateNumber.value, fields.recordId.value);
  controls.duplicateCheckResult.className = "duplicate-check";

  if (!existingRecord) {
    controls.duplicateCheckResult.textContent = "";
    return;
  }

  const nextLetter = getHigherLetterType(existingRecord.letterType, fields.letterType.value);
  controls.duplicateCheckResult.textContent = nextLetter && nextLetter !== existingRecord.letterType
    ? "Nopol sudah ada, akan update " + existingRecord.letterType + " ke " + nextLetter
    : "Nopol sudah ada, data akan diupdate";
  controls.duplicateCheckResult.classList.add("is-duplicate");
}

function coerceLetterType(record) {
  const value = normalizeUpperText(record.letterType || record.vehicleType || "");
  return ["SPOS", "NPP", "NTP"].includes(value) ? value : "";
}

function normalizeRecord(record) {
  return {
    id: record.id || createId(),
    letterType: coerceLetterType(record),
    taxValidDate: toIsoDate(record.taxValidDate || record.dueDate || ""),
    plateNumber: formatPlate(record.plateNumber || ""),
    ownerName: cleanOwnerName(record.ownerName),
    taxPotential: getNominalNumber(record.taxPotential || record.nominal || 0),
    phone: normalizeWhatsapp(record.phone),
    status: record.status || "Belum bayar",
    fieldVisitDate: toIsoDate(record.fieldVisitDate || record.dlDate || record.dinasLuarDate || ""),
    fieldVisitNote: normalizeUpperText(record.fieldVisitNote || record.dlNote || record.dinasLuarNote || record.keterangan || record.note || ""),
    updatedAt: record.updatedAt || new Date().toISOString()
  };
}

function readForm() {
  return normalizeRecord({
    id: fields.recordId.value || createId(),
    letterType: fields.letterType ? fields.letterType.value : "",
    taxValidDate: fields.taxValidDate ? toIsoDate(fields.taxValidDate.value) : "",
    plateNumber: fields.plateNumber.value,
    ownerName: fields.ownerName ? fields.ownerName.value : "",
    taxPotential: fields.taxPotential ? getNominalNumber(fields.taxPotential.value) : 0,
    phone: fields.phone.value,
    status: getAutoPaymentStatus(fields.plateNumber.value, fields.status.value || "Belum bayar"),
    fieldVisitDate: fields.fieldVisitDate ? toIsoDate(fields.fieldVisitDate.value) : "",
    fieldVisitNote: fields.fieldVisitNote ? fields.fieldVisitNote.value : "",
    updatedAt: new Date().toISOString()
  });
}

function fillForm(record) {
  openInputForm();
  fields.recordId.value = record.id;
  if (fields.letterType) fields.letterType.value = record.letterType;
  if (fields.taxValidDate) fields.taxValidDate.value = record.taxValidDate || "";
  fields.plateNumber.value = record.plateNumber;
  if (fields.ownerName) fields.ownerName.value = record.ownerName;
  if (fields.taxPotential) {
    fields.taxPotential.value = String(record.taxPotential || 0);
    fields.taxPotential.dataset.previousDigits = String(getNominalNumber(fields.taxPotential.value) || "");
    fields.taxPotential.dataset.siappPlateKey = "";
  }
  fields.phone.value = formatWhatsappLocal(record.phone);
  fields.status.value = record.status;
  if (fields.fieldVisitDate) {
    fields.fieldVisitDate.value = formatDateForInput(record.fieldVisitDate);
    fields.fieldVisitDate.dataset.previousDigits = fields.fieldVisitDate.value.replace(/\D/g, "");
  }
  if (fields.fieldVisitNote) fields.fieldVisitNote.value = record.fieldVisitNote || "";
  controls.formTitle.textContent = "Edit Wajib Pajak";
  updateDuplicateCheckPreview();
  updateProductionCheckPreview();
  updateSiappAutofillPanel();
  fields.plateNumber.focus();
}

function resetForm() {
  form.reset();
  clearFormSyncPending();
  fields.recordId.value = "";
  fields.status.value = "Belum bayar";
  if (fields.letterType) fields.letterType.value = "";
  if (fields.taxValidDate) fields.taxValidDate.value = "";
  if (fields.ownerName) fields.ownerName.value = "";
  if (fields.taxPotential) {
    fields.taxPotential.value = "";
    fields.taxPotential.dataset.previousDigits = "";
    fields.taxPotential.dataset.siappPlateKey = "";
  }
  if (fields.fieldVisitDate) {
    fields.fieldVisitDate.value = "";
    fields.fieldVisitDate.dataset.previousDigits = "";
  }
  if (fields.fieldVisitNote) fields.fieldVisitNote.value = "";
  controls.formTitle.textContent = "Tambah Wajib Pajak";
  updateDuplicateCheckPreview();
  updateProductionCheckPreview();
  updateSiappAutofillPanel();
}

function getFilteredRecords() {
  const query = controls.searchInput.value.trim().toLowerCase();
  const status = controls.statusFilter.value;
  const followUpCategory = controls.dateFilter.value;
  const dlFilter = controls.dlFilter ? controls.dlFilter.value : "all";

  return records
    .filter(function (record) {
      const haystack = [record.ownerName, record.plateNumber, record.letterType, record.phone, record.fieldVisitNote].join(" ").toLowerCase();

      if (query && !haystack.includes(query)) return false;
      if (status !== "all" && getSiappPaymentFilterState(record) !== status) return false;
      if (!matchesFollowUpCategory(record, followUpCategory)) return false;
      if (!matchesDlFilter(record, dlFilter)) return false;
      return true;
    })
    .sort(sortByDate);
}

function matchesDlFilter(record, filterValue) {
  if (!filterValue || filterValue === "all") return true;
  if (filterValue === "noDl") return !record.fieldVisitDate;

  // The list filter must always mean the actual current month, independent
  // from the month selected for reviewing dashboard history.
  const monthContext = getMonthContext(todayIso());
  const isThisMonth = isDateInMonth(record.fieldVisitDate, monthContext);
  if (!isThisMonth) return false;

  if (filterValue === "dlThisMonth") return true;
  if (filterValue === "dlPaidThisMonth") return isRecordPaid(record);
  if (filterValue === "dlUnpaidThisMonth") return !isRecordPaid(record);

  const week = getMonthWeekNumber(record.fieldVisitDate);
  return filterValue === "dlWeek" + week;
}

function matchesFollowUpCategory(record, category) {
  if (category === "all") return true;
  const priorityClass = getCardPriorityInfo(record).className;

  if (category === "needsAction") {
    return priorityClass === "priority-critical" || priorityClass === "priority-urgent";
  }
  if (category === "critical") return priorityClass === "priority-critical";
  if (category === "urgent") return priorityClass === "priority-urgent";
  if (category === "soon") return priorityClass === "priority-soon";
  if (category === "waiting") return priorityClass === "priority-muted";
  if (category === "paid") return priorityClass === "priority-paid";
  return true;
}

function sortByDate(a, b) {
  const aPriority = getRecordPriorityScore(a);
  const bPriority = getRecordPriorityScore(b);
  if (aPriority !== bPriority) return aPriority - bPriority;
  const aDate = getPrimaryFollowUp(a)?.date || a.taxValidDate || "9999-12-31";
  const bDate = getPrimaryFollowUp(b)?.date || b.taxValidDate || "9999-12-31";
  return aDate.localeCompare(bDate) || a.ownerName.localeCompare(b.ownerName);
}

function isTaxOverdue(record, today) {
  return !isRecordPaid(record) && record.taxValidDate && daysBetween(today, record.taxValidDate) < 0;
}

function isDateWithin(dateValue, today, limit, includePaid) {
  if (!dateValue) return false;
  const days = daysBetween(today, dateValue);
  return days !== null && days >= 0 && days <= limit;
}

function updateSummary() {
  updateDashboardMonthFilter();
  const today = todayIso();
  const monthContext = getMonthContext();
  const monthDlRecords = records.filter(function (record) {
    return isDateInMonth(record.fieldVisitDate, monthContext);
  });
  const unpaid = monthDlRecords.filter(function (record) {
    return !isRecordPaid(record);
  });
  const monthPaidDlRecords = monthDlRecords.filter(function (record) {
    return isRecordPaid(record);
  });
  const paidMonthAmount = monthPaidDlRecords.reduce(function (total, record) {
    return total + Number(record.taxPotential || 0);
  }, 0);
  const weeklyStats = [1, 2, 3, 4].map(function (week) {
    const weekRecords = monthDlRecords.filter(function (record) {
      return getMonthWeekNumber(record.fieldVisitDate) === week;
    });
    const paidRecords = weekRecords.filter(function (record) {
      return isRecordPaid(record);
    });
    return {
      count: weekRecords.length,
      paidCount: paidRecords.length,
      amount: paidRecords.reduce(function (total, record) {
        return total + Number(record.taxPotential || 0);
      }, 0)
    };
  });

  summary.totalRecords.textContent = monthDlRecords.length;
  summary.unpaidRecords.textContent = unpaid.length;
  summary.overdueRecords.textContent = monthDlRecords.filter(function (record) {
    return isTaxOverdue(record, today);
  }).length;
  summary.todayFollowUps.textContent = monthDlRecords.filter(function (record) {
    const nextFollowUp = getPrimaryFollowUp(record);
    return !isRecordPaid(record) && nextFollowUp && isDateWithin(nextFollowUp.date, today, 30, false);
  }).length;
  summary.unpaidPotential.textContent = formatCurrency(unpaid.reduce(function (total, record) {
    return total + Number(record.taxPotential || 0);
  }, 0));

  if (summary.dlMonthCount) summary.dlMonthCount.textContent = monthDlRecords.length;
  if (summary.paidMonthAmount) summary.paidMonthAmount.textContent = formatCurrency(paidMonthAmount);
  if (summary.dlConversionRate) {
    const rate = monthDlRecords.length ? Math.round((monthPaidDlRecords.length / monthDlRecords.length) * 100) : 0;
    summary.dlConversionRate.textContent = rate + "%";
  }
  if (summary.dashboardMonthLabel) summary.dashboardMonthLabel.textContent = monthContext.label;
  weeklyStats.forEach(function (stat, index) {
    if (summary.dlWeekCounts[index]) summary.dlWeekCounts[index].textContent = stat.count + " DL";
    if (summary.dlWeekPaid[index]) summary.dlWeekPaid[index].textContent = formatCurrency(stat.amount) + " cair";
  });
  renderDashboardInsights(monthDlRecords, monthPaidDlRecords, weeklyStats, monthContext, paidMonthAmount);
}

function renderDashboardInsights(monthDlRecords, monthPaidDlRecords, weeklyStats, monthContext, paidMonthAmount) {
  if (!summary.dashboardInsights) return;
  summary.dashboardInsights.replaceChildren();

  const insights = [];
  const unpaidDlCount = monthDlRecords.length - monthPaidDlRecords.length;
  const bestWeekIndex = weeklyStats.reduce(function (bestIndex, stat, index) {
    return stat.amount > weeklyStats[bestIndex].amount ? index : bestIndex;
  }, 0);
  const bestWeek = weeklyStats[bestWeekIndex];

  if (!monthDlRecords.length) {
    insights.push("Belum ada data dinas luar pada " + monthContext.label + ".");
  } else {
    insights.push(monthDlRecords.length + " WP sudah DL pada " + monthContext.label + ", " + monthPaidDlRecords.length + " sudah cair.");
    if (paidMonthAmount) insights.push("Nominal cair bulan ini " + formatCurrency(paidMonthAmount) + ".");
    if (bestWeek && bestWeek.amount) {
      insights.push("Minggu ke-" + (bestWeekIndex + 1) + " paling produktif dengan " + formatCurrency(bestWeek.amount) + " cair.");
    }
    if (unpaidDlCount) {
      insights.push(unpaidDlCount + " WP hasil DL bulan ini masih perlu dipantau karena belum cair di SIAPP.");
    } else {
      insights.push("Semua data DL bulan ini sudah terdeteksi lunas.");
    }
  }

  const urgentCount = monthDlRecords.filter(function (record) {
    return !isRecordPaid(record) && matchesFollowUpCategory(record, "needsAction");
  }).length;
  if (urgentCount) insights.push(urgentCount + " WP masih masuk kategori follow-up segera.");

  insights.slice(0, 5).forEach(function (text) {
    const item = document.createElement("li");
    item.textContent = text;
    summary.dashboardInsights.append(item);
  });
}

function describeDate(dateValue, paidLabel, isPaidSensitive) {
  const today = todayIso();
  const days = dateValue ? daysBetween(today, dateValue) : null;
  if (isPaidSensitive && paidLabel) return { text: paidLabel, className: "" };
  if (days === null) return { text: "Tanggal belum diisi", className: "" };
  if (days < 0) return { text: Math.abs(days) + " hari lewat", className: "due-late" };
  if (days <= 30) return { text: days + " hari lagi", className: "due-soon" };
  return { text: days + " hari lagi", className: "" };
}

function describeFollowUpWarning(dateValue) {
  const days = daysBetween(todayIso(), dateValue);
  if (days === null) return { text: "CEK TANGGAL", className: "followup-warning-check" };
  if (days < 0) return { text: "LEWAT " + Math.abs(days) + " HARI", className: "followup-warning-late" };
  if (days === 0) return { text: "MUNCUL HARI INI", className: "followup-warning-now" };
  if (days <= 7) return { text: "SEGERA " + days + " HARI", className: "followup-warning-urgent" };
  if (days <= 30) return { text: "AKAN MUNCUL " + days + " HARI", className: "followup-warning-soon" };
  return { text: "TERJADWAL " + days + " HARI", className: "followup-warning-scheduled" };
}

function getPrimaryFollowUp(record) {
  const plan = getLetterFollowUpPlan(record);
  return plan.slice().sort(function (first, second) {
    return first.date.localeCompare(second.date);
  })[0] || null;
}

function getRecordPriorityScore(record) {
  if (isRecordPaid(record)) return 1000000;

  const today = todayIso();
  const nextFollowUp = getPrimaryFollowUp(record);
  if (nextFollowUp) {
    const days = daysBetween(today, nextFollowUp.date);
    if (days !== null) return days;
  }

  if (isTaxOverdue(record, today)) {
    const taxDays = daysBetween(today, record.taxValidDate);
    return taxDays === null ? -500 : taxDays;
  }

  const taxDays = daysBetween(today, record.taxValidDate);
  return taxDays === null ? 999999 : taxDays + 200;
}

function getCardPriorityInfo(record) {
  if (isRecordPaid(record)) {
    return { text: "Lunas", className: "priority-paid" };
  }

  const nextFollowUp = getPrimaryFollowUp(record);
  if (nextFollowUp) {
    const days = daysBetween(todayIso(), nextFollowUp.date);
    if (days === null) return { text: "Cek tanggal", className: "priority-muted" };
    if (days < 0) return { text: "Lewat", className: "priority-critical" };
    if (days === 0) return { text: "Hari ini", className: "priority-critical" };
    if (days <= 7) return { text: "Segera", className: "priority-urgent" };
    if (days <= 30) return { text: "Dekat", className: "priority-soon" };
    return { text: "Terjadwal", className: "priority-muted" };
  }

  if (isTaxOverdue(record, todayIso())) {
    return { text: "Pajak lewat", className: "priority-critical" };
  }

  return { text: "Menunggu", className: "priority-muted" };
}

function getNextFollowUpSummary(record) {
  if (isRecordPaid(record)) {
    return {
      letter: "Lunas",
      date: "Sudah bayar",
      warningText: "SUDAH BAYAR",
      warningClass: "followup-warning-paid"
    };
  }

  const nextFollowUp = getPrimaryFollowUp(record);
  if (!nextFollowUp) {
    return {
      letter: record.letterType === "NTP" ? "Selesai" : "-",
      date: getFollowUpEmptyText(record),
      warningText: "BELUM ADA SURAT",
      warningClass: "followup-warning-check"
    };
  }

  const warning = describeFollowUpWarning(nextFollowUp.date);
  return {
    letter: nextFollowUp.letterType,
    date: formatDate(nextFollowUp.date),
    warningText: warning.text,
    warningClass: warning.className
  };
}

function renderFollowUpPlan(container, record) {
  const plan = getLetterFollowUpPlan(record);
  container.replaceChildren();

  if (!plan.length) {
    const empty = document.createElement("span");
    empty.className = "row-sub followup-empty";
    empty.textContent = getFollowUpEmptyText(record);
    container.append(empty);
    return;
  }

  plan.forEach(function (item) {
    const warning = describeFollowUpWarning(item.date);
    const line = document.createElement("div");
    line.className = "followup-item " + warning.className;

    const main = document.createElement("div");
    main.className = "followup-main";

    const badge = document.createElement("span");
    badge.className = "badge followup-badge";
    badge.textContent = item.letterType;

    const dateText = document.createElement("span");
    dateText.className = "followup-date";
    dateText.textContent = formatDate(item.date);

    const offsetText = document.createElement("span");
    offsetText.className = "followup-offset";
    offsetText.textContent = "H+" + item.offset;

    const warningText = document.createElement("span");
    warningText.className = "followup-warning-text";
    warningText.textContent = warning.text;

    main.append(badge, dateText, offsetText);
    line.append(main, warningText);
    container.append(line);
  });
}

function createDetailItem(label, content) {
  const item = document.createElement("div");
  item.className = "detail-item";

  const labelElement = document.createElement("span");
  labelElement.textContent = label;
  item.append(labelElement);

  if (content instanceof Node) {
    item.append(content);
    return item;
  }

  const valueElement = document.createElement("strong");
  valueElement.textContent = content || "-";
  item.append(valueElement);
  return item;
}

function getSiappStatusInfo(record) {
  const match = getProductionMatch(record);
  if (!match) {
    return {
      label: "Belum lunas",
      detail: "Belum ada pelunasan SIAPP",
      className: "is-unpaid"
    };
  }

  if (match.isPaid) {
    return {
      label: "Sudah lunas",
      detail: match.paidDate ? "Tgl bayar " + match.paidDate : "Tersinkron SIAPP",
      className: "is-paid"
    };
  }

  return {
    label: "Belum lunas",
    detail: "Tersinkron SIAPP",
    className: "is-unpaid"
  };
}

function createSiappStatusDisplay(record) {
  const info = getSiappStatusInfo(record);
  const wrapper = document.createElement("span");
  wrapper.className = "siapp-status-chip " + info.className;

  const label = document.createElement("strong");
  label.textContent = info.label;
  const detail = document.createElement("small");
  detail.textContent = info.detail;

  wrapper.append(label, detail);
  return wrapper;
}

function renderRecordDetail(record) {
  if (!controls.detailContent) return;

  const paid = isRecordPaid(record);
  const priority = getCardPriorityInfo(record);
  const nextFollowUp = getNextFollowUpSummary(record);
  const taxInfo = describeDate(record.taxValidDate, paid ? "Lunas" : "", true);

  controls.detailTitle.textContent = record.ownerName || "Nama belum diisi";
  controls.detailSubtitle.textContent = [record.plateNumber || "No polisi belum diisi", record.phone || "No Whatsapp belum diisi"].join(" | ");
  controls.detailContent.replaceChildren();

  const summaryBlock = document.createElement("div");
  summaryBlock.className = "detail-summary " + priority.className;

  const letterBlock = document.createElement("div");
  letterBlock.className = "detail-summary-item";
  letterBlock.innerHTML = "<span>Surat segera</span>";
  const nextLetter = document.createElement("strong");
  nextLetter.textContent = nextFollowUp.letter;
  const nextDate = document.createElement("small");
  nextDate.textContent = nextFollowUp.date;
  letterBlock.append(nextLetter, nextDate);

  const moneyBlock = document.createElement("div");
  moneyBlock.className = "detail-summary-item";
  moneyBlock.innerHTML = "<span>Nominal</span>";
  const moneyText = document.createElement("strong");
  moneyText.textContent = formatCurrency(record.taxPotential);
  const priorityText = document.createElement("small");
  priorityText.textContent = priority.text;
  moneyBlock.append(moneyText, priorityText);
  summaryBlock.append(letterBlock, moneyBlock);

  const detailGrid = document.createElement("div");
  detailGrid.className = "detail-grid";
  detailGrid.append(
    createDetailItem("Jenis Surat", record.letterType || "Belum dipilih"),
    createDetailItem("No Polisi", record.plateNumber || "Belum diisi"),
    createDetailItem("Nama Wajib Pajak", record.ownerName || "Belum diisi"),
    createDetailItem("No Whatsapp", record.phone || "Belum diisi"),
    createDetailItem("Tgl Dinas Luar", record.fieldVisitDate ? formatDate(record.fieldVisitDate) : "Belum diisi"),
    createDetailItem("Keterangan DL", record.fieldVisitNote || "Belum diisi"),
    createDetailItem("Masa Pajak", formatDate(record.taxValidDate) + " - " + taxInfo.text),
    createDetailItem("Status Bayar SIAPP", createSiappStatusDisplay(record))
  );

  const followUpSection = document.createElement("div");
  followUpSection.className = "detail-section";
  const followUpTitle = document.createElement("h3");
  followUpTitle.textContent = "Surat Lanjutan";
  const followUpPlan = document.createElement("div");
  followUpPlan.className = "followup-plan";
  renderFollowUpPlan(followUpPlan, record);
  followUpSection.append(followUpTitle, followUpPlan);

  const actions = document.createElement("div");
  actions.className = "detail-actions";

  const whatsappUrl = getWhatsappUrl(record);
  const whatsappButton = document.createElement("a");
  whatsappButton.className = "primary-button detail-whatsapp";
  whatsappButton.textContent = "WhatsApp";
  whatsappButton.target = "_blank";
  whatsappButton.rel = "noopener";
  if (whatsappUrl) {
    whatsappButton.href = whatsappUrl;
  } else {
    whatsappButton.classList.add("is-disabled");
    whatsappButton.setAttribute("aria-disabled", "true");
  }

  const editButton = document.createElement("button");
  editButton.className = "secondary-button";
  editButton.type = "button";
  editButton.textContent = "Edit";
  editButton.addEventListener("click", function () {
    fillForm(record);
    closeRecordDetail();
  });

  const deleteButton = document.createElement("button");
  deleteButton.className = "danger-button";
  deleteButton.type = "button";
  deleteButton.textContent = "Hapus";
  deleteButton.addEventListener("click", function () {
    closeRecordDetail();
    deleteRecord(record.id);
  });

  actions.append(whatsappButton, editButton, deleteButton);
  controls.detailContent.append(summaryBlock, detailGrid, followUpSection, actions);
}

function openRecordDetail(id) {
  const record = records.find(function (item) {
    return item.id === id;
  });
  if (!record || !controls.detailOverlay) return;

  activeDetailRecordId = id;
  renderRecordDetail(record);
  controls.detailOverlay.hidden = false;
  const detailPanel = controls.detailOverlay.querySelector(".detail-panel");
  if (detailPanel) detailPanel.scrollTop = 0;
  document.body.classList.add("modal-open");
  controls.detailCloseBtn.focus();
}

function closeRecordDetail() {
  if (!controls.detailOverlay) return;
  activeDetailRecordId = "";
  controls.detailOverlay.hidden = true;
  document.body.classList.remove("modal-open");
}

async function checkRecordAgainstSiapp(recordId) {
  let record = records.find(function (item) {
    return item.id === recordId;
  });
  if (!record) return;

  if (hasRemoteDatabase()) {
    await refreshRemoteProductionRecords({ force: true, silent: true });
    record = records.find(function (item) {
      return item.id === recordId;
    }) || record;
  }

  const match = getProductionMatch(record);
  if (!match) {
    showToast("Nopol belum ada di data SIAPP. Jalankan Sinkron SIAPP dulu.");
    return;
  }

  if (!match.isPaid) {
    showToast("SIAPP: " + (record.plateNumber || "nopol ini") + " belum terdeteksi lunas.");
    return;
  }

  if (record.status === "Sudah bayar") {
    showToast("SIAPP: " + (record.plateNumber || "nopol ini") + " sudah lunas" + (match.paidDate ? " per " + match.paidDate : "") + ".");
    return;
  }

  record.status = "Sudah bayar";
  record.updatedAt = new Date().toISOString();
  saveRecords();
  render();

  if (hasRemoteDatabase()) {
    queueRemoteUpsert(record);
    syncPendingRemoteMutations();
    scheduleRemoteRetry(3000);
    showToast("SIAPP: lunas, status dikirim ke database.");
    return;
  }

  showToast("SIAPP: lunas, status diperbarui.");
}

function render() {
  updateSummary();
  updateProductionSummary();
  tableBody.replaceChildren();
  const filtered = getFilteredRecords();
  emptyState.style.display = filtered.length ? "none" : "block";

  filtered.forEach(function (record) {
    const card = rowTemplate.content.firstElementChild.cloneNode(true);
    const priority = getCardPriorityInfo(record);
    const nextFollowUp = getNextFollowUpSummary(record);

    card.classList.add(priority.className);
    card.setAttribute("aria-label", "Buka detail " + (record.ownerName || record.plateNumber || "wajib pajak"));
    card.querySelector(".letter-badge").textContent = record.letterType || "Tanpa surat";
    card.querySelector(".card-priority-text").textContent = priority.text;
    card.querySelector(".card-money").textContent = formatCurrency(record.taxPotential);
    card.querySelector(".card-next-letter").textContent = nextFollowUp.letter;
    card.querySelector(".card-next-date").textContent = nextFollowUp.date;
    card.querySelector(".card-warning").textContent = nextFollowUp.warningText;
    card.querySelector(".card-warning").classList.add(nextFollowUp.warningClass);
    card.querySelector(".plate-text").textContent = record.plateNumber || "No polisi belum diisi";
    card.querySelector(".owner-name").textContent = record.ownerName || "Nama belum diisi";
    const dlInfo = card.querySelector(".card-dl-info");
    if (dlInfo) {
      dlInfo.textContent = record.fieldVisitDate
        ? "DL " + formatDate(record.fieldVisitDate) + (record.fieldVisitNote ? " - " + record.fieldVisitNote : "")
        : "Belum DL";
      dlInfo.classList.toggle("is-empty", !record.fieldVisitDate);
    }
    const productionElement = card.querySelector(".card-production");
    const productionMatch = getProductionMatch(record);

    if (productionElement) {
      productionElement.hidden = true;
      productionElement.textContent = "";
      productionElement.classList.remove("is-paid", "is-unpaid");
    }

    const siappButton = card.querySelector(".siapp-check-btn");
    if (siappButton) {
      const siappLabel = siappButton.querySelector(".siapp-check-label");
      if (productionMatch && productionMatch.isPaid) {
        siappButton.classList.add("is-paid");
        if (siappLabel) siappLabel.textContent = "Lunas SIAPP";
      } else if (productionMatch) {
        siappButton.classList.add("is-unpaid");
        if (siappLabel) siappLabel.textContent = "Belum lunas";
      } else {
        siappButton.classList.add("is-unpaid");
        if (siappLabel) siappLabel.textContent = "Belum lunas";
      }
      siappButton.disabled = true;
      siappButton.setAttribute("aria-label", "Status pembayaran otomatis dari data SIAPP tersinkron");
    }

    card.addEventListener("click", function () {
      openRecordDetail(record.id);
    });
    card.addEventListener("keydown", function (event) {
      if (event.target.closest("button, a, input, select, textarea")) return;
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      openRecordDetail(record.id);
    });
    tableBody.append(card);
  });

  if (activeDetailRecordId && controls.detailOverlay && !controls.detailOverlay.hidden) {
    const activeRecord = records.find(function (record) {
      return record.id === activeDetailRecordId;
    });
    if (activeRecord) renderRecordDetail(activeRecord);
    else closeRecordDetail();
  }
}

function statusClass(status) {
  return {
    "Belum bayar": "status-unpaid",
    "Sudah bayar": "status-paid"
  }[status] || "status-check";
}

function showToast(message, tone) {
  if (!toast) return;
  toast.textContent = message;
  toast.classList.remove("connection-success", "connection-error");
  if (tone) toast.classList.add(tone);
  toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(function () {
    toast.classList.remove("show");
    toast.classList.remove("connection-success", "connection-error");
  }, 2400);
}

async function upsertRecord(record) {
  const originalId = record.id;
  const duplicateRecord = findExistingRecordByPlate(record.plateNumber, record.id);
  let duplicateMessage = "";
  let idsToDeleteAfterMerge = [];

  if (duplicateRecord) {
    const previousLetter = duplicateRecord.letterType;
    record = mergeDuplicateRecord(duplicateRecord, record);
    const shouldRemoveOriginal = originalId && originalId !== record.id && records.some(function (item) {
      return item.id === originalId;
    });
    if (shouldRemoveOriginal) {
      records = records.filter(function (item) {
        return item.id !== originalId;
      });
      idsToDeleteAfterMerge = [originalId];
    }
    duplicateMessage = previousLetter && record.letterType && previousLetter !== record.letterType
      ? "Nopol sudah ada, surat diupdate dari " + previousLetter + " ke " + record.letterType
      : "Nopol sudah ada, data lama diupdate";
  }

  const index = records.findIndex(function (item) {
    return item.id === record.id;
  });
  const isUpdate = index >= 0;
  if (index >= 0) {
    records[index] = record;
  } else {
    records.push(record);
  }
  saveRecords();
  render();

  if (hasRemoteDatabase()) {
    fields.recordId.value = record.id;
    form.dataset.pendingRecordId = record.id;
    idsToDeleteAfterMerge.forEach(queueRemoteDelete);
    queueRemoteUpsert(record);
    syncPendingRemoteMutations();
    scheduleRemoteRetry(3000);
    showToast(duplicateMessage || (isUpdate ? "Data diperbarui. Sedang sinkron ke database." : "Data ditambahkan. Sedang sinkron ke database."));
    return;
  }

  resetForm();
  showToast(duplicateMessage || (isUpdate ? "Data wajib pajak diperbarui." : "Data wajib pajak ditambahkan."));
}

async function updateStatus(id, status) {
  const record = records.find(function (item) {
    return item.id === id;
  });
  if (!record) return;
  record.status = status;
  record.updatedAt = new Date().toISOString();
  saveRecords();
  render();

  if (hasRemoteDatabase()) {
    queueRemoteUpsert(record);
    syncPendingRemoteMutations();
    scheduleRemoteRetry(3000);
    showToast("Status diperbarui. Sedang sinkron ke database.");
    return;
  }

  showToast("Status diperbarui.");
}

async function deleteRecord(id) {
  const record = records.find(function (item) {
    return item.id === id;
  });
  if (!record) return;
  const approved = confirm("Hapus data " + record.ownerName + " - " + record.plateNumber + "?");
  if (!approved) return;
  records = records.filter(function (item) {
    return item.id !== id;
  });
  saveRecords();
  render();

  if (hasRemoteDatabase()) {
    queueRemoteDelete(id);
    syncPendingRemoteMutations();
    scheduleRemoteRetry(3000);
    showToast("Data dihapus dari tampilan. Sedang hapus di database.");
    return;
  }

  showToast("Data dihapus.");
}

function downloadFile(filename, type, content) {
  const blob = new Blob([content], { type: type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function toCsv(recordsToExport) {
  const headers = [
    "Jenis Surat",
    "Tgl Masa Laku Pajak",
    "No Polisi",
    "Nama Wajib Pajak",
    "Nominal",
    "No Whatsapp",
    "Tgl Dinas Luar",
    "Keterangan DL",
    "SPOS H+15",
    "NPP H+30",
    "NTP H+60",
    "Status"
  ];
  const rows = recordsToExport.map(function (record) {
    const plan = getLetterFollowUpPlan(record);
    const sposPlan = plan.find(function (item) {
      return item.letterType === "SPOS";
    });
    const nppPlan = plan.find(function (item) {
      return item.letterType === "NPP";
    });
    const ntpPlan = plan.find(function (item) {
      return item.letterType === "NTP";
    });

    return [
      record.letterType,
      formatDate(record.taxValidDate),
      record.plateNumber,
      record.ownerName,
      record.taxPotential,
      record.phone,
      formatDate(record.fieldVisitDate),
      record.fieldVisitNote,
      sposPlan ? formatDate(sposPlan.date) : "",
      nppPlan ? formatDate(nppPlan.date) : "",
      ntpPlan ? formatDate(ntpPlan.date) : "",
      record.status
    ];
  });
  return [headers].concat(rows)
    .map(function (row) {
      return row.map(function (cell) {
        return '"' + String(cell == null ? "" : cell).replaceAll('"', '""') + '"';
      }).join(",");
    })
    .join("\n");
}

function exportJsonData() {
  const backup = {
    format: "wajib-pajak-full-backup",
    version: 2,
    exportedAt: new Date().toISOString(),
    taxpayers: records,
    productionRecords: productionRecords
  };
  downloadFile("backup-wajib-pajak-lengkap-" + todayIso() + ".json", "application/json", JSON.stringify(backup, null, 2));
}

function exportCsvData() {
  downloadFile("data-wajib-pajak-" + todayIso() + ".csv", "text/csv;charset=utf-8", toCsv(getFilteredRecords()));
}

function parseCsvRows(value) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  const source = String(value || "").replace(/^\uFEFF/, "");

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === '"') {
      if (quoted && source[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && source[index + 1] === "\n") index += 1;
      row.push(cell);
      if (row.some(function (item) { return String(item).trim(); })) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }

  row.push(cell);
  if (row.some(function (item) { return String(item).trim(); })) rows.push(row);
  if (rows.length < 2) return [];

  const headers = rows.shift().map(function (header) {
    return String(header || "").replace(/^\uFEFF/, "").trim();
  });
  return rows.map(function (cells) {
    return headers.reduce(function (item, header, index) {
      item[header] = String(cells[index] == null ? "" : cells[index]).trim();
      return item;
    }, {});
  }).filter(function (item) {
    return Object.values(item).some(Boolean);
  });
}

function mergeImportedItems(existingItems, incomingItems, normalizer) {
  const merged = new Map();
  (existingItems || []).forEach(function (item) {
    const normalized = normalizer(item);
    if (normalized.id) merged.set(normalized.id, normalized);
  });
  (incomingItems || []).forEach(function (item) {
    const normalized = normalizer(item);
    if (!normalized.id) return;
    const existing = merged.get(normalized.id);
    if (!existing || String(normalized.updatedAt || "") >= String(existing.updatedAt || "")) {
      merged.set(normalized.id, normalized);
    }
  });
  return Array.from(merged.values());
}

async function readImportedData(file) {
  const source = await file.text();
  if (/\.csv$/i.test(file.name) || /^\s*(?:\uFEFF)?(?:id|letterType|plateNumber),/i.test(source)) {
    const csvRows = parseCsvRows(source);
    if (!csvRows.length) throw new Error("CSV kosong atau tidak sesuai format.");
    const isProduction = Object.prototype.hasOwnProperty.call(csvRows[0], "letterType") &&
      Object.prototype.hasOwnProperty.call(csvRows[0], "month") &&
      Object.prototype.hasOwnProperty.call(csvRows[0], "sourceText");
    return isProduction
      ? { taxpayers: [], productionRecords: csvRows, sourceLabel: "Buku Produksi" }
      : { taxpayers: csvRows, productionRecords: [], sourceLabel: "Data Wajib Pajak" };
  }

  const imported = JSON.parse(source);
  const taxpayers = Array.isArray(imported) ? imported : imported && imported.taxpayers;
  const productionRecords = Array.isArray(imported && imported.productionRecords) ? imported.productionRecords : [];
  if (!Array.isArray(taxpayers)) throw new Error("Format JSON tidak valid.");
  return { taxpayers: taxpayers, productionRecords: productionRecords, sourceLabel: "Cadangan JSON" };
}

function toggleMobileMenu() {
  if (!controls.mobileMenuPanel || !controls.mobileMenuBtn) return;
  const willOpen = controls.mobileMenuPanel.hidden;
  controls.mobileMenuPanel.hidden = !willOpen;
  controls.mobileMenuBtn.setAttribute("aria-expanded", String(willOpen));
}

function closeMobileMenu() {
  if (!controls.mobileMenuPanel || !controls.mobileMenuBtn) return;
  controls.mobileMenuPanel.hidden = true;
  controls.mobileMenuBtn.setAttribute("aria-expanded", "false");
}

function toggleMobileDashboard() {
  if (!controls.dashboardSection) return;
  const isOpen = controls.dashboardSection.classList.toggle("is-open");
  if (controls.mobileDashboardBtn) {
    controls.mobileDashboardBtn.setAttribute("aria-expanded", String(isOpen));
  }
  closeMobileMenu();
  if (isOpen) {
    setSectionCollapsed(controls.dashboardSection, controls.toggleDashboardBtn, false, "Buka dashboard", "Lipat dashboard");
    controls.dashboardSection.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function openSiappModal() {
  if (!controls.siappOverlay) return;
  if (controls.siappFrame) {
    const helperSrc = "siapp-helper.html?v=20260708-2140";
    if (!controls.siappFrame.src || !controls.siappFrame.src.includes(helperSrc)) {
      controls.siappFrame.src = helperSrc;
    }
  }
  controls.siappOverlay.hidden = false;
  document.body.classList.add("modal-open");
  closeMobileMenu();
}

function closeSiappModal() {
  if (!controls.siappOverlay) return;
  controls.siappOverlay.hidden = true;
  document.body.classList.remove("modal-open");
}

function startMobileHeaderAutoHide() {
  if (!controls.topbar) return;

  let lastScrollY = window.scrollY;
  let ticking = false;

  function setHeaderHidden(shouldHide) {
    controls.topbar.classList.toggle("is-scroll-hidden", shouldHide);
  }

  function updateHeader() {
    ticking = false;
    if (document.body.classList.contains("modal-open")) {
      setHeaderHidden(false);
      lastScrollY = window.scrollY;
      return;
    }

    const currentY = Math.max(0, window.scrollY);
    const delta = currentY - lastScrollY;
    const menuOpen = controls.mobileMenuPanel && !controls.mobileMenuPanel.hidden;

    if (menuOpen || currentY < 60 || delta < -6) {
      setHeaderHidden(false);
    } else if (delta > 8 && currentY > 90) {
      closeMobileMenu();
      setHeaderHidden(true);
    }

    lastScrollY = currentY;
  }

  window.addEventListener("scroll", function () {
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame(updateHeader);
  }, { passive: true });

  window.addEventListener("resize", updateHeader);
}

function goHome() {
  closeMobileMenu();
  closeSiappModal();
  closeRecordDetail();
  if (controls.topbar) controls.topbar.classList.remove("is-scroll-hidden");
  if (controls.dashboardSection) controls.dashboardSection.classList.remove("is-open");
  setSectionCollapsed(controls.dashboardSection, controls.toggleDashboardBtn, false, "Buka dashboard", "Lipat dashboard");
  setSectionCollapsed(controls.listPanel, controls.toggleListBtn, false, "Buka daftar follow-up", "Lipat daftar follow-up");
  if (controls.mobileDashboardBtn) controls.mobileDashboardBtn.setAttribute("aria-expanded", "false");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function setInputFormCollapsed(isCollapsed) {
  form.classList.toggle("is-collapsed", isCollapsed);
  if (!controls.toggleFormBtn) return;
  controls.toggleFormBtn.setAttribute("aria-expanded", String(!isCollapsed));
  controls.toggleFormBtn.title = isCollapsed ? "Buka form input" : "Lipat form input";
  controls.toggleFormBtn.setAttribute("aria-label", isCollapsed ? "Buka form input" : "Lipat form input");
}

function toggleInputForm() {
  setInputFormCollapsed(!form.classList.contains("is-collapsed"));
}

function openInputForm() {
  setInputFormCollapsed(false);
}

function setSectionCollapsed(section, button, isCollapsed, openLabel, closeLabel) {
  if (!section || !button) return;
  section.classList.toggle("is-collapsed", isCollapsed);
  button.setAttribute("aria-expanded", String(!isCollapsed));
  button.title = isCollapsed ? openLabel : closeLabel;
  button.setAttribute("aria-label", isCollapsed ? openLabel : closeLabel);
}

function toggleDashboardSection() {
  if (!controls.dashboardSection) return;
  setSectionCollapsed(
    controls.dashboardSection,
    controls.toggleDashboardBtn,
    !controls.dashboardSection.classList.contains("is-collapsed"),
    "Buka dashboard",
    "Lipat dashboard"
  );
}

function toggleListSection() {
  if (!controls.listPanel) return;
  setSectionCollapsed(
    controls.listPanel,
    controls.toggleListBtn,
    !controls.listPanel.classList.contains("is-collapsed"),
    "Buka daftar follow-up",
    "Lipat daftar follow-up"
  );
}

function formatNominalInput() {
  const value = getNominalNumber(fields.taxPotential.value);
  fields.taxPotential.dataset.previousDigits = value ? String(value) : "";
  fields.taxPotential.value = value ? formatCurrency(value) : "";
}

function formatDateField(event) {
  const input = event.target;
  const isDelete = event.inputType && event.inputType.startsWith("delete");
  const previousDigits = input.dataset.previousDigits || "";
  let digits = String(input.value || "").replace(/\D/g, "").slice(0, 8);

  if (isDelete && digits === previousDigits && digits.length) {
    digits = digits.slice(0, -1);
  }

  input.dataset.previousDigits = digits;
  input.value = formatPartialDateDigits(digits, isDelete);
}

function formatNominalField(event) {
  const input = event.target;
  const isDelete = event.inputType && event.inputType.startsWith("delete");
  const previousDigits = input.dataset.previousDigits || "";
  let digits = String(input.value || "").replace(/\D/g, "");

  if (isDelete && digits === previousDigits && digits.length) {
    digits = digits.slice(0, -1);
  }

  input.dataset.previousDigits = digits;
  input.value = digits ? formatCurrency(Number(digits)) : "";
}

form.addEventListener("submit", function (event) {
  event.preventDefault();
  applyProductionDefaultsToForm();
  const record = readForm();
  upsertRecord(record);
});

if (controls.toggleFormBtn) {
  controls.toggleFormBtn.addEventListener("click", toggleInputForm);
}

if (controls.toggleDashboardBtn) {
  controls.toggleDashboardBtn.addEventListener("click", toggleDashboardSection);
}

if (controls.toggleListBtn) {
  controls.toggleListBtn.addEventListener("click", toggleListSection);
}

if (controls.resetFormBtn) {
  controls.resetFormBtn.addEventListener("click", resetForm);
}

fields.plateNumber.addEventListener("input", function () {
  clearFormSyncPending();
  fields.plateNumber.value = formatPlate(fields.plateNumber.value);
  updateDuplicateCheckPreview();
  updateProductionCheckPreview();
  applyProductionDefaultsToForm();
});

if (fields.letterType) fields.letterType.addEventListener("change", updateDuplicateCheckPreview);
if (fields.ownerName) {
  fields.ownerName.addEventListener("input", function (event) {
    clearFormSyncPending();
    formatUpperTextField(event);
  });
}
if (fields.fieldVisitNote) {
  fields.fieldVisitNote.addEventListener("input", function (event) {
    clearFormSyncPending();
    formatUpperTextField(event);
  });
}
controls.searchInput.addEventListener("input", formatUpperTextField);

fields.phone.addEventListener("input", function () {
  clearFormSyncPending();
  fields.phone.value = formatWhatsappLocal(fields.phone.value);
});

if (fields.taxValidDate) {
  fields.taxValidDate.addEventListener("input", function (event) {
    clearFormSyncPending();
    formatDateField(event);
  });
  fields.taxValidDate.addEventListener("blur", formatDateField);
}

if (fields.fieldVisitDate) {
  fields.fieldVisitDate.addEventListener("input", function (event) {
    clearFormSyncPending();
    formatDateField(event);
  });
  fields.fieldVisitDate.addEventListener("blur", formatDateField);
}

if (fields.taxPotential) {
  fields.taxPotential.addEventListener("input", function (event) {
    clearFormSyncPending();
    fields.taxPotential.dataset.siappPlateKey = "";
    formatNominalField(event);
  });
  fields.taxPotential.addEventListener("blur", formatNominalInput);
}

[controls.searchInput, controls.statusFilter, controls.dateFilter, controls.dlFilter, controls.dashboardMonthFilter].forEach(function (control) {
  if (!control) return;
  control.addEventListener("input", render);
});

if (controls.mobileMenuBtn) {
  controls.mobileMenuBtn.addEventListener("click", function (event) {
    event.stopPropagation();
    toggleMobileMenu();
  });
}

if (controls.mobileMenuPanel) {
  controls.mobileMenuPanel.addEventListener("click", function (event) {
    event.stopPropagation();
  });
}

if (controls.mobileDashboardBtn) {
  controls.mobileDashboardBtn.addEventListener("click", toggleMobileDashboard);
}

if (controls.homeBtn) {
  controls.homeBtn.addEventListener("click", goHome);
}

if (controls.mobileHomeBtn) {
  controls.mobileHomeBtn.addEventListener("click", goHome);
}

if (controls.siappHelperLink) {
  controls.siappHelperLink.addEventListener("click", openSiappModal);
}

if (controls.dashboardSiappBtn) {
  controls.dashboardSiappBtn.addEventListener("click", openSiappModal);
}

if (controls.mobileSiappHelperLink) {
  controls.mobileSiappHelperLink.addEventListener("click", openSiappModal);
}

if (controls.mobileExportJsonBtn) {
  controls.mobileExportJsonBtn.addEventListener("click", function () {
    closeMobileMenu();
    exportJsonData();
  });
}

if (controls.mobileExportCsvBtn) {
  controls.mobileExportCsvBtn.addEventListener("click", function () {
    closeMobileMenu();
    exportCsvData();
  });
}

if (controls.mobileImportBtn) {
  controls.mobileImportBtn.addEventListener("click", function () {
    closeMobileMenu();
    controls.importFile.click();
  });
}

controls.detailCloseBtn.addEventListener("click", closeRecordDetail);
controls.detailOverlay.addEventListener("click", function (event) {
  if (event.target === controls.detailOverlay) closeRecordDetail();
});

if (controls.siappCloseBtn) {
  controls.siappCloseBtn.addEventListener("click", closeSiappModal);
}

if (controls.siappOverlay) {
  controls.siappOverlay.addEventListener("click", function (event) {
    if (event.target === controls.siappOverlay) closeSiappModal();
  });
}

document.addEventListener("keydown", function (event) {
  if (event.key === "Escape") closeMobileMenu();
  if (event.key === "Escape" && controls.siappOverlay && !controls.siappOverlay.hidden) {
    closeSiappModal();
  }
  if (event.key === "Escape" && controls.detailOverlay && !controls.detailOverlay.hidden) {
    closeRecordDetail();
  }
});

document.addEventListener("click", closeMobileMenu);

controls.clearAllBtn.addEventListener("click", async function () {
  if (!records.length) return;
  const approved = confirm("Hapus semua data wajib pajak di browser ini?");
  if (!approved) return;
  const previousIds = records.map(function (record) {
    return record.id;
  });
  records = [];
  saveRecords();
  resetForm();
  render();

  if (hasRemoteDatabase()) {
    previousIds.forEach(queueRemoteDelete);
    syncPendingRemoteMutations();
    scheduleRemoteRetry(3000);
    showToast("Semua data dihapus dari tampilan. Sedang hapus di database.");
    return;
  }

  showToast("Semua data dihapus.");
});

controls.exportJsonBtn.addEventListener("click", exportJsonData);

controls.exportCsvBtn.addEventListener("click", exportCsvData);

controls.importFile.addEventListener("change", async function (event) {
  const file = event.target.files[0];
  if (!file) return;
  try {
    const imported = await readImportedData(file);
    const importedTaxpayers = imported.taxpayers;
    const importedProduction = imported.productionRecords;
    const previousRecords = records.slice();
    const previousProductionRecords = productionRecords.slice();
    records = mergeImportedItems(records, importedTaxpayers, normalizeRecord);
    if (importedProduction.length) {
      setProductionRecords(mergeImportedItems(productionRecords, importedProduction, normalizeProductionRecord));
    }
    saveRecords();
    resetForm();
    render();

    if (hasRemoteDatabase()) {
      try {
        const savedRecords = importedTaxpayers.length ? await saveRemoteRecords(importedTaxpayers) : [];
        if (importedProduction.length) {
          const productionBatches = chunkItems(importedProduction, 100);
          for (let index = 0; index < productionBatches.length; index += 1) {
            showToast("Memindahkan Buku Produksi " + Math.min((index + 1) * 100, importedProduction.length) + "/" + importedProduction.length + " data...");
            await requestDatabase("upsertProduction", { productionRecords: productionBatches[index] });
          }
        }
        if (savedRecords.length) {
          records = savedRecords;
          saveRecords();
          render();
        }
        markRemoteOnline("Online tersambung");
        showToast(imported.sourceLabel + " berhasil diimport dan tersinkron.");
        return;
      } catch (error) {
        console.error(error);
        records = previousRecords;
        setProductionRecords(previousProductionRecords);
        saveRecords();
        render();
        markRemoteFailure("Gagal sinkron");
        showToast("Import ke database online gagal.");
        return;
      }
    }

    showToast(imported.sourceLabel + " berhasil diimport.");
  } catch {
    showToast("File JSON atau CSV tidak dapat dibaca.");
  } finally {
    controls.importFile.value = "";
  }
});

formatNominalInput();
updateProductionSummary();
updateProductionCheckPreview();
updateSiappAutofillPanel();
startMobileHeaderAutoHide();
initializeRemoteDatabase();
