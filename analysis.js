const ANALYSIS_CONFIG = window.APP_CONFIG || {};
const ANALYSIS_SUPABASE_URL = String(ANALYSIS_CONFIG.SUPABASE_URL || "").replace(/\/$/, "");
const ANALYSIS_SUPABASE_KEY = String(ANALYSIS_CONFIG.SUPABASE_PUBLISHABLE_KEY || "");
const LETTER_RANK = { SPOS: 1, NPP: 2, NTP: 3 };

const controls = {
  status: document.querySelector("#analysisStatus"),
  source: document.querySelector("#analysisSource"),
  recordedPeriodFilter: document.querySelector("#analysisRecordedPeriodFilter"),
  refreshButton: document.querySelector("#refreshAnalysisBtn"),
  recordedVehicleCount: document.querySelector("#recordedVehicleCount"),
  paidVehicleCount: document.querySelector("#paidVehicleCount"),
  unpaidVehicleCount: document.querySelector("#unpaidVehicleCount"),
  paidRate: document.querySelector("#paidRate"),
  peakPaymentDay: document.querySelector("#peakPaymentDay"),
  peakPaymentDetail: document.querySelector("#peakPaymentDetail"),
  dailyPaymentChart: document.querySelector("#dailyPaymentChart")
};

let productionRecords = [];
let dailyPaymentChart = null;

function setStatus(message, state = "neutral") {
  if (!controls.status) return;
  controls.status.textContent = message;
  controls.status.dataset.state = state;
}

function normalizeText(value) {
  return String(value || "")
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

function getPlateKey(record) {
  return normalizeText(record.plate_key || record.plate_number).replace(/\s/g, "");
}

function getIsoDate(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;

  const localMatch = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (localMatch) return `${localMatch[3]}-${localMatch[2]}-${localMatch[1]}`;

  return "";
}

function getDateValue(value) {
  const isoDate = getIsoDate(value);
  return isoDate ? new Date(`${isoDate}T00:00:00`).getTime() : 0;
}

function getRecordedPeriod(record) {
  const recordedDate = getIsoDate(record.recorded_date);
  return recordedDate ? recordedDate.slice(0, 7) : "";
}

function isExplicitlyPaid(record) {
  const source = String(record.source_text || "").toUpperCase();
  const hasUnpaidMarker = /\b(BELUM|TIDAK)\s+(?:TERDETEKSI\s+)?(?:LUNAS|BAYAR)\b/.test(source);
  const hasPaidMarker = /\b(LUNAS|SUDAH\s+BAYAR|TERBAYAR|PAID)\b/.test(source);

  if (hasUnpaidMarker) return false;
  if (hasPaidMarker) return true;
  return Boolean(record.is_paid);
}

function compareRecords(left, right) {
  const recordedDifference = getDateValue(right.recorded_date) - getDateValue(left.recorded_date);
  if (recordedDifference) return recordedDifference;

  const leftRank = LETTER_RANK[String(left.letter_type || "").toUpperCase()] || 0;
  const rightRank = LETTER_RANK[String(right.letter_type || "").toUpperCase()] || 0;
  if (leftRank !== rightRank) return rightRank - leftRank;

  const updatedDifference = getDateValue(right.updated_at) - getDateValue(left.updated_at);
  if (updatedDifference) return updatedDifference;

  return String(right.id || "").localeCompare(String(left.id || ""), "id", { numeric: true });
}

function createMonthlyVehicles(records, period) {
  const byPlate = new Map();

  records.forEach((record) => {
    if (getRecordedPeriod(record) !== period) return;
    const plateKey = getPlateKey(record);
    if (!plateKey) return;

    const existing = byPlate.get(plateKey);
    if (!existing || compareRecords(record, existing) < 0) byPlate.set(plateKey, record);
  });

  return [...byPlate.values()].map((record) => ({ record, isPaid: isExplicitlyPaid(record) }));
}

function formatNumber(value) {
  return new Intl.NumberFormat("id-ID").format(Number(value || 0));
}

function formatPeriod(period) {
  if (!/^\d{4}-\d{2}$/.test(String(period || ""))) return "Bulan belum tersedia";
  return new Intl.DateTimeFormat("id-ID", { month: "long", year: "numeric" })
    .format(new Date(`${period}-01T00:00:00`));
}

function formatDate(value) {
  const isoDate = getIsoDate(value);
  if (!isoDate) return "belum tersedia";
  return new Intl.DateTimeFormat("id-ID", { day: "2-digit", month: "long", year: "numeric" })
    .format(new Date(`${isoDate}T00:00:00`));
}

function setMetric(element, value) {
  if (element) element.textContent = value;
}

function populateRecordedPeriodFilter() {
  const currentValue = controls.recordedPeriodFilter.value;
  const periods = [...new Set(productionRecords.map(getRecordedPeriod).filter(Boolean))].sort().reverse();
  controls.recordedPeriodFilter.innerHTML = "";

  periods.forEach((period) => {
    const option = document.createElement("option");
    option.value = period;
    option.textContent = formatPeriod(period);
    controls.recordedPeriodFilter.appendChild(option);
  });

  controls.recordedPeriodFilter.value = periods.includes(currentValue) ? currentValue : (periods[0] || "");
}

function buildDailyPaymentPattern(vehicles, selectedPeriod) {
  const days = Array.from({ length: 31 }, (_, index) => ({ day: index + 1, count: 0 }));

  vehicles.filter((item) => item.isPaid).forEach((item) => {
    const paidDate = getIsoDate(item.record.paid_date);
    if (!paidDate || paidDate.slice(0, 7) !== selectedPeriod) return;
    const day = Number(paidDate.slice(8, 10));
    if (day >= 1 && day <= 31) days[day - 1].count += 1;
  });

  return days;
}

function renderMetrics(vehicles, dailyPayments) {
  const paidCount = vehicles.filter((item) => item.isPaid).length;
  const unpaidCount = vehicles.length - paidCount;
  const paidRate = vehicles.length ? (paidCount / vehicles.length) * 100 : 0;
  const peak = dailyPayments.reduce((currentPeak, day) => day.count > currentPeak.count ? day : currentPeak, { day: 0, count: 0 });

  setMetric(controls.recordedVehicleCount, formatNumber(vehicles.length));
  setMetric(controls.paidVehicleCount, formatNumber(paidCount));
  setMetric(controls.unpaidVehicleCount, formatNumber(unpaidCount));
  setMetric(controls.paidRate, `${paidRate.toLocaleString("id-ID", { maximumFractionDigits: 1 })}%`);

  setMetric(controls.peakPaymentDay, peak.count ? `Tanggal ${peak.day}` : "Belum ada pelunasan");
  setMetric(controls.peakPaymentDetail, peak.count ? `${formatNumber(peak.count)} kendaraan lunas pada tanggal ini.` : "Belum ada tanggal bayar pada bulan terpilih.");
}

function renderDailyPaymentChart(dailyPayments) {
  if (!controls.dailyPaymentChart || !window.Chart) return;
  if (dailyPaymentChart) dailyPaymentChart.destroy();

  dailyPaymentChart = new window.Chart(controls.dailyPaymentChart, {
    type: "bar",
    data: {
      labels: dailyPayments.map((item) => item.day),
      datasets: [{
        label: "Kendaraan lunas",
        data: dailyPayments.map((item) => item.count),
        backgroundColor: "#158f68",
        borderRadius: 5,
        maxBarThickness: 38
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label(context) { return `${formatNumber(context.raw)} kendaraan lunas`; } } }
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: { precision: 0 },
          title: { display: true, text: "Jumlah kendaraan" },
          grid: { color: "#e9eef5" }
        },
        x: {
          title: { display: true, text: "Tanggal pembayaran" },
          grid: { display: false }
        }
      }
    }
  });
}

function renderAnalysis() {
  const selectedPeriod = controls.recordedPeriodFilter.value;
  const vehicles = createMonthlyVehicles(productionRecords, selectedPeriod);
  const dailyPayments = buildDailyPaymentPattern(vehicles, selectedPeriod);
  renderMetrics(vehicles, dailyPayments);
  renderDailyPaymentChart(dailyPayments);
}

function setSource() {
  if (!controls.source) return;
  const latestRecorded = productionRecords.reduce((latest, record) => Math.max(latest, getDateValue(record.recorded_date)), 0);
  controls.source.textContent = `${formatNumber(productionRecords.length)} baris Buku Produksi. Bulan filter diambil dari Tgl Rekam${latestRecorded ? `, data rekam terakhir ${formatDate(new Date(latestRecorded).toISOString())}` : ""}.`;
}

async function requestSupabase(path, options = {}) {
  const response = await fetch(`${ANALYSIS_SUPABASE_URL}${path}`, {
    ...options,
    headers: {
      apikey: ANALYSIS_SUPABASE_KEY,
      Authorization: `Bearer ${ANALYSIS_SUPABASE_KEY}`,
      ...(options.headers || {})
    }
  });

  if (!response.ok) throw new Error(`Supabase merespons ${response.status}`);
  return response;
}

async function fetchProductionRecords() {
  const fields = [
    "id", "plate_key", "plate_number", "letter_type", "is_paid", "paid_date",
    "recorded_date", "source_text", "updated_at"
  ].join(",");
  const pageSize = 1000;
  const records = [];

  for (let offset = 0; ; offset += pageSize) {
    const response = await requestSupabase(`/rest/v1/production_records?select=${encodeURIComponent(fields)}&order=recorded_date.desc,updated_at.desc,id.desc`, {
      headers: { Range: `${offset}-${offset + pageSize - 1}` }
    });
    const page = await response.json();
    records.push(...page);
    if (page.length < pageSize) break;
  }

  return records;
}

async function loadAnalysis() {
  if (!ANALYSIS_SUPABASE_URL || !ANALYSIS_SUPABASE_KEY) {
    setStatus("DATABASE: KONFIGURASI BELUM LENGKAP", "error");
    if (controls.source) controls.source.textContent = "URL atau kunci Supabase belum tersedia pada config.js.";
    return;
  }

  setStatus("DATABASE: MEMUAT ANALISIS...", "loading");
  if (controls.refreshButton) controls.refreshButton.disabled = true;

  try {
    productionRecords = await fetchProductionRecords();
    populateRecordedPeriodFilter();
    setSource();
    renderAnalysis();
    setStatus("DATABASE: ANALISIS TERHUBUNG", "success");
  } catch (error) {
    console.error("Gagal memuat analisis bulanan.", error);
    setStatus("DATABASE: GAGAL MEMUAT", "error");
    if (controls.source) controls.source.textContent = "Data belum dapat dimuat. Periksa koneksi internet atau coba muat ulang.";
  } finally {
    if (controls.refreshButton) controls.refreshButton.disabled = false;
  }
}

controls.recordedPeriodFilter?.addEventListener("change", renderAnalysis);
controls.refreshButton?.addEventListener("click", loadAnalysis);
loadAnalysis();
