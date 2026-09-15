const AREA_CONFIG = window.APP_CONFIG || {};
const AREA_SUPABASE_URL = String(AREA_CONFIG.SUPABASE_URL || "").replace(/\/$/, "");
const AREA_SUPABASE_KEY = String(AREA_CONFIG.SUPABASE_PUBLISHABLE_KEY || "");
const AREA_LETTER_RANK = { SPOS: 1, NPP: 2, NTP: 3 };
const AREA_CENTERS = {
  ASEMROWO: { label: "Asemrowo", lat: -7.2407, lng: 112.6991 },
  BABATAN: { label: "Babatan", lat: -7.3164, lng: 112.7005 },
  BENOWO: { label: "Benowo", lat: -7.2351, lng: 112.6452 },
  BUBUTAN: { label: "Bubutan", lat: -7.2466, lng: 112.7328 },
  BULAK: { label: "Bulak", lat: -7.2265, lng: 112.7814 },
  DUKUHPAKIS: { label: "Dukuh Pakis", lat: -7.2926, lng: 112.6904 },
  GAYUNGAN: { label: "Gayungan", lat: -7.3312, lng: 112.7258 },
  GENTENG: { label: "Genteng", lat: -7.2614, lng: 112.7462 },
  GUBENG: { label: "Gubeng", lat: -7.2812, lng: 112.7553 },
  GUNUNGANYAR: { label: "Gunung Anyar", lat: -7.3353, lng: 112.7928 },
  JAMBANGAN: { label: "Jambangan", lat: -7.3314, lng: 112.7148 },
  KARANGPILANG: { label: "Karang Pilang", lat: -7.3392, lng: 112.6912 },
  KENJERAN: { label: "Kenjeran", lat: -7.2323, lng: 112.7707 },
  KREMBANGAN: { label: "Krembangan", lat: -7.2294, lng: 112.7199 },
  LAKARSANTRI: { label: "Lakarsantri", lat: -7.3106, lng: 112.6417 },
  MULYOREJO: { label: "Mulyorejo", lat: -7.2664, lng: 112.7848 },
  PABEANCANTIAN: { label: "Pabean Cantian", lat: -7.2191, lng: 112.7372 },
  PAKAL: { label: "Pakal", lat: -7.2321, lng: 112.6219 },
  RUNGKUT: { label: "Rungkut", lat: -7.3198, lng: 112.7798 },
  SAMBIKEREP: { label: "Sambikerep", lat: -7.2783, lng: 112.6441 },
  SAWAHAN: { label: "Sawahan", lat: -7.2833, lng: 112.7202 },
  SEMAMPIR: { label: "Semampir", lat: -7.2227, lng: 112.7533 },
  SIMOKERTO: { label: "Simokerto", lat: -7.2452, lng: 112.7541 },
  SUKOLILO: { label: "Sukolilo", lat: -7.2852, lng: 112.7984 },
  SUKOMANUNGGAL: { label: "Sukomanunggal", lat: -7.2687, lng: 112.6947 },
  TAMBAKSARI: { label: "Tambaksari", lat: -7.2508, lng: 112.7721 },
  TANDES: { label: "Tandes", lat: -7.2523, lng: 112.6827 },
  TEGALSARI: { label: "Tegalsari", lat: -7.2837, lng: 112.7381 },
  TENGGILISMEJOYO: { label: "Tenggilis Mejoyo", lat: -7.3204, lng: 112.7548 },
  WIYUNG: { label: "Wiyung", lat: -7.3104, lng: 112.6929 },
  WONOCOLO: { label: "Wonocolo", lat: -7.3181, lng: 112.7402 },
  WONOKROMO: { label: "Wonokromo", lat: -7.3008, lng: 112.7409 }
};
const AREA_CENTER_KEYS = Object.keys(AREA_CENTERS).sort(function (first, second) {
  return second.length - first.length;
});

const controls = {
  status: document.querySelector("#analysisStatus"),
  source: document.querySelector("#analysisSource"),
  periodFilter: document.querySelector("#analysisPeriodFilter"),
  letterFilter: document.querySelector("#analysisLetterFilter"),
  refreshButton: document.querySelector("#refreshAnalysisBtn"),
  vehicleCount: document.querySelector("#arrearsVehicleCount"),
  potential: document.querySelector("#arrearsPotential"),
  districtCount: document.querySelector("#mappedDistrictCount"),
  unmappedCount: document.querySelector("#unmappedAddressCount"),
  areaList: document.querySelector("#areaList"),
  areaListCount: document.querySelector("#areaListCount"),
  map: document.querySelector("#areaMap")
};

let productionRecords = [];
let leafletMap = null;
let leafletLayer = null;
let areaMarkers = new Map();

function getPlateKey(value) {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function normalizeAreaKey(value) {
  return String(value || "").toUpperCase().replace(/[^A-Z]/g, "");
}

function getIsoDate(value) {
  const text = String(value || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

function getProductionDate(record) {
  const recordedDate = getIsoDate(record.recorded_date);
  if (recordedDate) return recordedDate;
  const year = Number(record.year || 0);
  const month = Number(record.month || 0);
  return year && month ? String(year) + "-" + String(month).padStart(2, "0") + "-01" : "";
}

function formatPeriod(value) {
  const date = new Date(value + "T00:00:00");
  if (Number.isNaN(date.getTime())) return "Periode tidak diketahui";
  const label = date.toLocaleDateString("id-ID", { month: "long", year: "numeric" });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function formatCurrency(value) {
  return "Rp " + Math.round(Number(value || 0)).toLocaleString("id-ID") + ",-";
}

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function setStatus(message, type) {
  if (!controls.status) return;
  controls.status.textContent = message;
  controls.status.classList.toggle("is-online", type === "online");
  controls.status.classList.toggle("is-failed", type === "error");
}

async function requestSupabase(path, options) {
  const settings = options || {};
  const response = await fetch(AREA_SUPABASE_URL + "/rest/v1/" + path, Object.assign({}, settings, {
    headers: Object.assign({
      apikey: AREA_SUPABASE_KEY,
      Authorization: "Bearer " + AREA_SUPABASE_KEY
    }, settings.headers || {})
  }));

  if (!response.ok) throw new Error("Supabase " + response.status);
  return response.json();
}

async function fetchProductionRecords() {
  const fields = [
    "id", "plate_key", "plate_number", "letter_type", "month", "year", "owner_name",
    "status", "is_paid", "paid_date", "recorded_date", "tax_base_amount",
    "calculated_tax_potential", "source_text", "updated_at"
  ].join(",");
  const records = [];
  const pageSize = 1000;

  for (let from = 0; ; from += pageSize) {
    const rows = await requestSupabase("production_records?select=" + encodeURIComponent(fields) + "&order=id.asc", {
      headers: { Range: from + "-" + (from + pageSize - 1) }
    });
    records.push.apply(records, rows);
    setStatus("Memuat Buku Produksi " + records.length + " data...", "loading");
    if (rows.length < pageSize) return records;
  }
}

function isExplicitlyPaid(record) {
  const text = String(record.source_text || "").toUpperCase();
  if (!text) return false;
  const hasUnpaidMarker = /\b(BELUM|TIDAK)\s+(?:TERDETEKSI\s+)?(?:LUNAS|BAYAR)\b/.test(text);
  const hasPaidMarker = /\b(LUNAS|SUDAH\s+BAYAR|TERBAYAR|PAID)\b/.test(text);
  return !hasUnpaidMarker && hasPaidMarker;
}

function compareProductionRecords(first, second) {
  const firstDate = getProductionDate(first);
  const secondDate = getProductionDate(second);
  if (firstDate !== secondDate) {
    if (!firstDate) return 1;
    if (!secondDate) return -1;
    return secondDate.localeCompare(firstDate);
  }

  const rankDifference = (AREA_LETTER_RANK[second.letter_type] || 0) - (AREA_LETTER_RANK[first.letter_type] || 0);
  if (rankDifference) return rankDifference;
  return String(second.updated_at || "").localeCompare(String(first.updated_at || ""));
}

function getAddressText(record) {
  return String(record && record.source_text || "").toUpperCase().replace(/\s+/g, " ").trim();
}

function extractAreaFromRecord(record) {
  const text = getAddressText(record);
  if (!text) return null;
  const districtMarker = text.match(/\bKEC(?:AMATAN)?\.?\s*/);
  if (!districtMarker || districtMarker.index == null) return null;

  const remainder = text.slice(districtMarker.index + districtMarker[0].length);
  const rawDistrict = remainder
    .split(/\b(?:KEL(?:URAHAN)?|DESA|KOTA|KAB(?:UPATEN)?|RT|RW|JL|JLN|JALAN|GG|GANG|DK|DUSUN|NO|NOMOR|BLOK)\b|\||\d{2}\/\d{2}\/\d{4}/)[0]
    .replace(/[^A-Z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const normalizedDistrict = normalizeAreaKey(rawDistrict);
  const districtKey = AREA_CENTER_KEYS.find(function (knownKey) {
    return normalizedDistrict === knownKey || normalizedDistrict.startsWith(knownKey);
  });
  if (!districtKey) return null;

  const villageMarker = text.match(/\bKEL(?:URAHAN)?\.?\s*/);
  const rawVillage = villageMarker && villageMarker.index != null
    ? text.slice(villageMarker.index + villageMarker[0].length)
      .split(/\b(?:KEC(?:AMATAN)?|DESA|KOTA|KAB(?:UPATEN)?|RT|RW|JL|JLN|JALAN|GG|GANG|DK|DUSUN|NO|NOMOR|BLOK)\b|\||\d{2}\/\d{2}\/\d{4}/)[0]
      .replace(/[^A-Z\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
    : "";

  const center = AREA_CENTERS[districtKey];
  return {
    key: districtKey,
    label: center.label,
    village: rawVillage,
    center: center
  };
}

function getBestArea(records) {
  return records.slice().sort(compareProductionRecords).map(extractAreaFromRecord).find(Boolean) || null;
}

function createLatestVehicles(records) {
  const recordsByPlate = new Map();
  records.forEach(function (record) {
    const plateKey = String(record.plate_key || getPlateKey(record.plate_number));
    if (!plateKey) return;
    const items = recordsByPlate.get(plateKey) || [];
    items.push(record);
    recordsByPlate.set(plateKey, items);
  });

  return Array.from(recordsByPlate.values()).map(function (items) {
    const sorted = items.slice().sort(compareProductionRecords);
    return { record: sorted[0], area: getBestArea(sorted) };
  });
}

function getPotential(record) {
  const calculated = Number(record.calculated_tax_potential || 0);
  return calculated || Number(record.tax_base_amount || 0);
}

function getFilteredVehicles() {
  const period = controls.periodFilter.value;
  const letterType = controls.letterFilter.value;

  return createLatestVehicles(productionRecords).filter(function (item) {
    const record = item.record;
    if (isExplicitlyPaid(record)) return false;
    if (period !== "all" && getProductionDate(record).slice(0, 7) !== period) return false;
    if (letterType !== "all" && record.letter_type !== letterType) return false;
    return true;
  });
}

function aggregateAreas(vehicles) {
  const areas = new Map();
  vehicles.forEach(function (item) {
    const area = item.area;
    const key = area ? area.key : "UNMAPPED";
    const current = areas.get(key) || {
      key: key,
      label: area ? area.label : "Alamat belum terbaca",
      center: area ? area.center : null,
      count: 0,
      potential: 0,
      villages: new Set()
    };
    current.count += 1;
    current.potential += getPotential(item.record);
    if (area && area.village) current.villages.add(area.village);
    areas.set(key, current);
  });

  return Array.from(areas.values()).sort(function (first, second) {
    return second.potential - first.potential || second.count - first.count || first.label.localeCompare(second.label);
  });
}

function populatePeriodFilter() {
  const selectedValue = controls.periodFilter.value || "all";
  const periods = Array.from(new Set(productionRecords.map(function (record) {
    return getProductionDate(record).slice(0, 7);
  }).filter(Boolean))).sort().reverse();

  controls.periodFilter.replaceChildren();
  const allOption = document.createElement("option");
  allOption.value = "all";
  allOption.textContent = "Semua periode";
  controls.periodFilter.append(allOption);
  periods.forEach(function (period) {
    const option = document.createElement("option");
    option.value = period;
    option.textContent = formatPeriod(period + "-01");
    controls.periodFilter.append(option);
  });
  controls.periodFilter.value = periods.includes(selectedValue) ? selectedValue : "all";
}

function initializeMap() {
  if (leafletMap || !controls.map || !window.L) return Boolean(leafletMap);
  leafletMap = window.L.map(controls.map, { zoomControl: true, scrollWheelZoom: false }).setView([-7.275, 112.745], 12);
  window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 18,
    attribution: "&copy; OpenStreetMap contributors"
  }).addTo(leafletMap);
  leafletLayer = window.L.layerGroup().addTo(leafletMap);
  return true;
}

function renderMap(areas) {
  if (!initializeMap()) {
    controls.map.textContent = "Peta tidak dapat dimuat pada perangkat ini.";
    return;
  }

  leafletLayer.clearLayers();
  areaMarkers = new Map();
  const locatedAreas = areas.filter(function (area) { return Boolean(area.center); });
  const maxCount = Math.max.apply(null, locatedAreas.map(function (area) { return area.count; }).concat([1]));
  const bounds = [];

  locatedAreas.forEach(function (area) {
    const radius = Math.round(7 + (Math.sqrt(area.count / maxCount) * 18));
    const marker = window.L.circleMarker([area.center.lat, area.center.lng], {
      radius: radius,
      color: "#a8322c",
      weight: 2,
      fillColor: "#c2413a",
      fillOpacity: .68
    }).addTo(leafletLayer);
    const villageCount = area.villages.size ? area.villages.size + " kelurahan terbaca" : "Kelurahan belum terbaca";
    marker.bindTooltip("<strong>" + escapeHtml(area.label) + "</strong>" + area.count + " nopol | " + formatCurrency(area.potential) + "<br>" + villageCount);
    areaMarkers.set(area.key, marker);
    bounds.push([area.center.lat, area.center.lng]);
  });

  if (bounds.length) leafletMap.fitBounds(bounds, { padding: [28, 28], maxZoom: 13 });
  else leafletMap.setView([-7.275, 112.745], 12);
}

function focusArea(area) {
  if (!area.center || !leafletMap) return;
  leafletMap.setView([area.center.lat, area.center.lng], 14, { animate: true });
  const marker = areaMarkers.get(area.key);
  if (marker) marker.openTooltip();
}

function renderAreaList(areas) {
  controls.areaList.replaceChildren();
  controls.areaListCount.textContent = areas.length + " area";
  if (!areas.length) {
    const empty = document.createElement("p");
    empty.className = "area-empty";
    empty.textContent = "Tidak ada tunggakan pada filter ini.";
    controls.areaList.append(empty);
    return;
  }

  areas.forEach(function (area) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "area-row" + (area.center ? "" : " is-unmapped");
    row.innerHTML = "<span class=\"area-row-head\"><strong>" + escapeHtml(area.label) + "</strong><span class=\"area-row-count\">" + area.count + " nopol</span></span>" +
      "<span class=\"area-row-meta\"><span>" + (area.villages.size ? area.villages.size + " kelurahan" : "Alamat belum lengkap") + "</span><strong>" + formatCurrency(area.potential) + "</strong></span>";
    row.disabled = !area.center;
    if (area.center) row.addEventListener("click", function () { focusArea(area); });
    controls.areaList.append(row);
  });
}

function renderAnalysis() {
  const vehicles = getFilteredVehicles();
  const areas = aggregateAreas(vehicles);
  const mapped = areas.filter(function (area) { return Boolean(area.center); });
  const unmapped = areas.find(function (area) { return area.key === "UNMAPPED"; });
  const totalPotential = vehicles.reduce(function (total, item) {
    return total + getPotential(item.record);
  }, 0);

  controls.vehicleCount.textContent = vehicles.length;
  controls.potential.textContent = formatCurrency(totalPotential);
  controls.districtCount.textContent = mapped.length;
  controls.unmappedCount.textContent = unmapped ? unmapped.count : 0;
  renderMap(areas);
  renderAreaList(areas);
}

async function loadAnalysis() {
  if (!AREA_SUPABASE_URL || !AREA_SUPABASE_KEY) {
    setStatus("Konfigurasi Supabase belum tersedia.", "error");
    return;
  }

  if (controls.refreshButton) controls.refreshButton.disabled = true;
  try {
    setStatus("Memuat data Buku Produksi...", "loading");
    productionRecords = await fetchProductionRecords();
    populatePeriodFilter();
    renderAnalysis();
    setStatus("Database online tersambung.", "online");
    if (controls.source) controls.source.textContent = productionRecords.length + " data Buku Produksi";
  } catch (error) {
    console.error(error);
    setStatus("Gagal memuat data Buku Produksi.", "error");
    if (controls.source) controls.source.textContent = "Data belum tersedia";
  } finally {
    if (controls.refreshButton) controls.refreshButton.disabled = false;
  }
}

controls.periodFilter.addEventListener("change", renderAnalysis);
controls.letterFilter.addEventListener("change", renderAnalysis);
controls.refreshButton.addEventListener("click", loadAnalysis);
window.addEventListener("resize", function () {
  if (leafletMap) leafletMap.invalidateSize();
});

loadAnalysis();
