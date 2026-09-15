const ANALYSIS_CONFIG = window.APP_CONFIG || {};
const ANALYSIS_SUPABASE_URL = String(ANALYSIS_CONFIG.SUPABASE_URL || "").replace(/\/$/, "");
const ANALYSIS_SUPABASE_KEY = String(ANALYSIS_CONFIG.SUPABASE_PUBLISHABLE_KEY || "");

const LETTER_RANK = { SPOS: 1, NPP: 2, NTP: 3 };
const DISTRICT_LABELS = {
  ASEMROWO: "Asemrowo",
  BENOWO: "Benowo",
  BUBUTAN: "Bubutan",
  BULAK: "Bulak",
  GAYUNGAN: "Gayungan",
  GENTENG: "Genteng",
  GUBENG: "Gubeng",
  "GUNUNG ANYAR": "Gunung Anyar",
  JAMBANGAN: "Jambangan",
  "KARANG PILANG": "Karang Pilang",
  KENJERAN: "Kenjeran",
  KREMBANGAN: "Krembangan",
  LAKARSANTRI: "Lakarsantri",
  MANGGALA: "Manggala",
  MULYOREJO: "Mulyorejo",
  "PABEAN CANTIAN": "Pabean Cantian",
  PAKAL: "Pakal",
  RUNGKUT: "Rungkut",
  SAMBIKEREP: "Sambikerep",
  SAWAHAN: "Sawahan",
  SEMAMPIR: "Semampir",
  SIMOKERTO: "Simokerto",
  SUKOLILO: "Sukolilo",
  SUKOMANUNGGAL: "Sukomanunggal",
  TAMBAKSARI: "Tambaksari",
  TANDES: "Tandes",
  TEGALSARI: "Tegalsari",
  WONOCOLO: "Wonocolo",
  WONOKROMO: "Wonokromo",
  WIYUNG: "Wiyung"
};
const DISTRICT_KEYS = Object.keys(DISTRICT_LABELS).sort((left, right) => right.length - left.length);

const controls = {
  status: document.querySelector("#analysisStatus"),
  source: document.querySelector("#analysisSource"),
  periodFilter: document.querySelector("#analysisPeriodFilter"),
  districtFilter: document.querySelector("#analysisDistrictFilter"),
  letterFilter: document.querySelector("#analysisLetterFilter"),
  paymentFilter: document.querySelector("#analysisPaymentFilter"),
  refreshButton: document.querySelector("#refreshAnalysisBtn"),
  selectedVehicleCount: document.querySelector("#selectedVehicleCount"),
  unpaidPotential: document.querySelector("#unpaidPotential"),
  paidVehicleCount: document.querySelector("#paidVehicleCount"),
  paidRate: document.querySelector("#paidRate"),
  peakPaymentDay: document.querySelector("#peakPaymentDay"),
  peakPaymentDayDetail: document.querySelector("#peakPaymentDayDetail"),
  priorityDistrict: document.querySelector("#priorityDistrict"),
  priorityDistrictDetail: document.querySelector("#priorityDistrictDetail"),
  overdueVehicleCount: document.querySelector("#overdueVehicleCount"),
  overduePotential: document.querySelector("#overduePotential"),
  monthlyPaymentChart: document.querySelector("#monthlyPaymentChart"),
  paymentDayChart: document.querySelector("#paymentDayChart"),
  paymentStatusChart: document.querySelector("#paymentStatusChart"),
  letterStageChart: document.querySelector("#letterStageChart"),
  arrearsAgeChart: document.querySelector("#arrearsAgeChart"),
  districtArrearsChart: document.querySelector("#districtArrearsChart"),
  areaListCount: document.querySelector("#areaListCount"),
  areaList: document.querySelector("#areaList")
};

let productionRecords = [];
let latestVehicles = [];
const charts = {};

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

function normalizeAreaKey(value) {
  return normalizeText(value)
    .replace(/\bKEC(?:AMATAN)?\b/g, " ")
    .replace(/\bKEL(?:URAHAN)?\b/g, " ")
    .replace(/\s+/g, " ")
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

function getProductionDate(record) {
  return getDateValue(record.recorded_date) || getDateValue(record.updated_at);
}

function getPotential(record) {
  const calculated = Number(record.calculated_tax_potential || 0);
  const taxBase = Number(record.tax_base_amount || 0);
  return Number.isFinite(calculated) && calculated > 0 ? calculated : (Number.isFinite(taxBase) ? taxBase : 0);
}

function isExplicitlyPaid(record) {
  const source = String(record.source_text || "").toUpperCase();
  const hasUnpaidMarker = /\b(BELUM|TIDAK)\s+(?:TERDETEKSI\s+)?(?:LUNAS|BAYAR)\b/.test(source);
  const hasPaidMarker = /\b(LUNAS|SUDAH\s+BAYAR|TERBAYAR|PAID)\b/.test(source);

  if (hasUnpaidMarker) return false;
  if (hasPaidMarker) return true;
  return Boolean(record.is_paid);
}

function extractDistrictFromRecord(record) {
  const source = String(record.source_text || "").toUpperCase();
  const marker = source.match(/\bKEC(?:AMATAN)?\.?\s*/);
  if (!marker || typeof marker.index !== "number") return null;

  const remainder = source.slice(marker.index + marker[0].length);
  const rawDistrict = remainder
    .split(/\b(?:KEL(?:URAHAN)?|DESA|KOTA|KAB(?:UPATEN)?|RT|RW|JL|JLN|JALAN|GG|GANG|DK|DUSUN|NO|NOMOR|BLOK)\b|\||\d{2}\/\d{2}\/\d{4}/)[0]
    .replace(/[^A-Z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const normalized = normalizeAreaKey(rawDistrict);
  const key = DISTRICT_KEYS.find((knownKey) => normalized === knownKey || normalized.startsWith(`${knownKey} `));

  return key ? { key, label: DISTRICT_LABELS[key] } : null;
}

function compareProductionRecords(left, right) {
  const dateDifference = getProductionDate(right) - getProductionDate(left);
  if (dateDifference) return dateDifference;

  const leftRank = LETTER_RANK[String(left.letter_type || "").toUpperCase()] || 0;
  const rightRank = LETTER_RANK[String(right.letter_type || "").toUpperCase()] || 0;
  if (leftRank !== rightRank) return rightRank - leftRank;

  const updateDifference = getDateValue(right.updated_at) - getDateValue(left.updated_at);
  if (updateDifference) return updateDifference;

  return String(right.id || "").localeCompare(String(left.id || ""), "id", { numeric: true });
}

function createLatestVehicles(records) {
  const byPlate = new Map();

  records.forEach((record) => {
    const plateKey = getPlateKey(record);
    if (!plateKey) return;
    const existing = byPlate.get(plateKey);
    if (!existing || compareProductionRecords(record, existing) < 0) byPlate.set(plateKey, record);
  });

  return [...byPlate.values()].map((record) => ({
    record,
    district: extractDistrictFromRecord(record),
    isPaid: isExplicitlyPaid(record)
  }));
}

function formatNumber(value) {
  return new Intl.NumberFormat("id-ID").format(Number(value || 0));
}

function formatCurrency(value) {
  return `Rp ${Math.round(Number(value || 0)).toLocaleString("id-ID")},-`;
}

function formatCompactCurrency(value) {
  const amount = Number(value || 0);
  if (Math.abs(amount) >= 1000000000) return `Rp ${(amount / 1000000000).toLocaleString("id-ID", { maximumFractionDigits: 1 })} M`;
  if (Math.abs(amount) >= 1000000) return `Rp ${(amount / 1000000).toLocaleString("id-ID", { maximumFractionDigits: 1 })} jt`;
  return formatCurrency(amount);
}

function formatPeriod(value) {
  if (!/^\d{4}-\d{2}$/.test(String(value || ""))) return "Periode belum terbaca";
  return new Intl.DateTimeFormat("id-ID", { month: "long", year: "numeric" })
    .format(new Date(`${value}-01T00:00:00`));
}

function formatDateTime(value) {
  const isoDate = getIsoDate(value);
  if (!isoDate) return "belum tersedia";
  return new Intl.DateTimeFormat("id-ID", { day: "2-digit", month: "long", year: "numeric" })
    .format(new Date(`${isoDate}T00:00:00`));
}

function getRecordPeriod(record) {
  const month = Number(record.month || 0);
  const year = Number(record.year || 0);
  if (month >= 1 && month <= 12 && year >= 2000) return `${year}-${String(month).padStart(2, "0")}`;

  const sourceDate = getIsoDate(record.recorded_date || record.updated_at);
  return sourceDate ? sourceDate.slice(0, 7) : "";
}

function getFilteredVehicles() {
  const selectedPeriod = controls.periodFilter.value;
  const selectedDistrict = controls.districtFilter.value;
  const selectedLetter = controls.letterFilter.value;
  const selectedPayment = controls.paymentFilter.value;

  return latestVehicles.filter((item) => {
    if (selectedPeriod !== "all" && getRecordPeriod(item.record) !== selectedPeriod) return false;
    if (selectedDistrict !== "all" && item.district?.key !== selectedDistrict) return false;
    if (selectedLetter !== "all" && String(item.record.letter_type || "").toUpperCase() !== selectedLetter) return false;
    if (selectedPayment === "paid" && !item.isPaid) return false;
    if (selectedPayment === "unpaid" && item.isPaid) return false;
    return true;
  });
}

function aggregateDistricts(vehicles) {
  const grouped = new Map();

  vehicles.forEach((item) => {
    if (!item.district) return;
    const current = grouped.get(item.district.key) || {
      key: item.district.key,
      label: item.district.label,
      count: 0,
      paidCount: 0,
      unpaidCount: 0,
      unpaidPotential: 0
    };

    current.count += 1;
    if (item.isPaid) current.paidCount += 1;
    else {
      current.unpaidCount += 1;
      current.unpaidPotential += getPotential(item.record);
    }
    grouped.set(current.key, current);
  });

  return [...grouped.values()].sort((left, right) => right.unpaidPotential - left.unpaidPotential || right.unpaidCount - left.unpaidCount);
}

function buildPaymentTrend(vehicles) {
  const trend = new Map();
  vehicles.filter((item) => item.isPaid).forEach((item) => {
    const paidDate = getIsoDate(item.record.paid_date);
    if (!paidDate) return;
    const period = paidDate.slice(0, 7);
    const current = trend.get(period) || { period, count: 0, amount: 0 };
    current.count += 1;
    current.amount += getPotential(item.record);
    trend.set(period, current);
  });
  return [...trend.values()].sort((left, right) => left.period.localeCompare(right.period));
}

function buildPaymentDays(vehicles) {
  const days = Array.from({ length: 31 }, (_, index) => ({ day: index + 1, count: 0 }));
  vehicles.filter((item) => item.isPaid).forEach((item) => {
    const paidDate = getIsoDate(item.record.paid_date);
    if (!paidDate) return;
    const day = Number(paidDate.slice(8, 10));
    if (day >= 1 && day <= 31) days[day - 1].count += 1;
  });
  return days;
}

function buildLetterStages(vehicles) {
  const stages = ["SPOS", "NPP", "NTP"].map((letter) => ({ letter, count: 0, potential: 0 }));
  const byLetter = new Map(stages.map((stage) => [stage.letter, stage]));

  vehicles.filter((item) => !item.isPaid).forEach((item) => {
    const letter = String(item.record.letter_type || "").toUpperCase();
    const stage = byLetter.get(letter);
    if (!stage) return;
    stage.count += 1;
    stage.potential += getPotential(item.record);
  });
  return stages;
}

function buildAgeing(vehicles) {
  const groups = [
    { label: "0-30 hari", count: 0, potential: 0 },
    { label: "31-90 hari", count: 0, potential: 0 },
    { label: "91-180 hari", count: 0, potential: 0 },
    { label: ">180 hari", count: 0, potential: 0 },
    { label: "Masa pajak belum terbaca", count: 0, potential: 0 }
  ];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  vehicles.filter((item) => !item.isPaid).forEach((item) => {
    const taxDate = getIsoDate(item.record.tax_valid_date);
    const amount = getPotential(item.record);
    if (!taxDate) {
      groups[4].count += 1;
      groups[4].potential += amount;
      return;
    }

    const dayDifference = Math.max(0, Math.floor((today.getTime() - new Date(`${taxDate}T00:00:00`).getTime()) / 86400000));
    const target = dayDifference <= 30 ? groups[0] : dayDifference <= 90 ? groups[1] : dayDifference <= 180 ? groups[2] : groups[3];
    target.count += 1;
    target.potential += amount;
  });
  return groups;
}

function setMetric(element, value) {
  if (element) element.textContent = value;
}

function setSource() {
  if (!controls.source) return;
  const latestUpdate = productionRecords.reduce((latest, record) => Math.max(latest, getDateValue(record.updated_at)), 0);
  const dateText = latestUpdate ? formatDateTime(new Date(latestUpdate).toISOString()) : "belum tersedia";
  controls.source.textContent = `${formatNumber(productionRecords.length)} baris Buku Produksi, ${formatNumber(latestVehicles.length)} nopol unik. Data diperbarui ${dateText}.`;
}

function updateMetricCards(vehicles, districts, ageing) {
  const paidVehicles = vehicles.filter((item) => item.isPaid);
  const unpaidVehicles = vehicles.filter((item) => !item.isPaid);
  const unpaidPotential = unpaidVehicles.reduce((total, item) => total + getPotential(item.record), 0);
  const paidRate = vehicles.length ? (paidVehicles.length / vehicles.length) * 100 : 0;
  const peakDay = buildPaymentDays(vehicles).reduce((best, item) => item.count > best.count ? item : best, { day: 0, count: 0 });
  const topDistrict = districts[0];
  const overdue = ageing[3];

  setMetric(controls.selectedVehicleCount, formatNumber(vehicles.length));
  setMetric(controls.unpaidPotential, formatCurrency(unpaidPotential));
  setMetric(controls.paidVehicleCount, formatNumber(paidVehicles.length));
  setMetric(controls.paidRate, `${paidRate.toLocaleString("id-ID", { maximumFractionDigits: 1 })}%`);

  setMetric(controls.peakPaymentDay, peakDay.count ? `Tanggal ${peakDay.day}` : "Belum ada data");
  setMetric(controls.peakPaymentDayDetail, peakDay.count ? `${formatNumber(peakDay.count)} nopol tercatat lunas pada tanggal ini.` : "Belum ada pembayaran pada filter ini.");
  setMetric(controls.priorityDistrict, topDistrict ? topDistrict.label : "Alamat belum terbaca");
  setMetric(controls.priorityDistrictDetail, topDistrict ? `${formatCurrency(topDistrict.unpaidPotential)} dari ${formatNumber(topDistrict.unpaidCount)} nopol belum lunas.` : "Tidak ada kecamatan dengan tunggakan pada filter ini.");
  setMetric(controls.overdueVehicleCount, `${formatNumber(overdue.count)} nopol`);
  setMetric(controls.overduePotential, overdue.count ? `${formatCurrency(overdue.potential)} nominal tertunda.` : "Tidak ada tunggakan lebih dari 180 hari.");
}

function destroyChart(id) {
  if (charts[id]) {
    charts[id].destroy();
    delete charts[id];
  }
}

function createChart(id, config) {
  destroyChart(id);
  const canvas = controls[id];
  if (!canvas || !window.Chart) return;
  charts[id] = new window.Chart(canvas, config);
}

function axisCurrency(value) {
  return formatCompactCurrency(value);
}

function createCharts(vehicles, districts, ageing) {
  const paymentTrend = buildPaymentTrend(vehicles);
  const paymentDays = buildPaymentDays(vehicles);
  const letterStages = buildLetterStages(vehicles);
  const paidCount = vehicles.filter((item) => item.isPaid).length;
  const unpaidCount = vehicles.length - paidCount;

  createChart("monthlyPaymentChart", {
    type: "bar",
    data: {
      labels: paymentTrend.length ? paymentTrend.map((item) => formatPeriod(item.period)) : ["Belum ada pembayaran"],
      datasets: [
        {
          type: "bar",
          label: "Jumlah nopol lunas",
          data: paymentTrend.length ? paymentTrend.map((item) => item.count) : [0],
          backgroundColor: "#158f68",
          borderRadius: 5,
          yAxisID: "count"
        },
        {
          type: "line",
          label: "Nominal pelunasan",
          data: paymentTrend.length ? paymentTrend.map((item) => item.amount) : [0],
          borderColor: "#1967d2",
          backgroundColor: "#1967d2",
          borderWidth: 2,
          pointRadius: 3,
          pointHoverRadius: 5,
          tension: 0.3,
          yAxisID: "money"
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { position: "bottom", labels: { boxWidth: 10, usePointStyle: true } },
        tooltip: { callbacks: { label(context) { return context.dataset.yAxisID === "money" ? `${context.dataset.label}: ${formatCurrency(context.raw)}` : `${context.dataset.label}: ${formatNumber(context.raw)} nopol`; } } }
      },
      scales: {
        count: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: "#e9eef5" } },
        money: { position: "right", beginAtZero: true, ticks: { callback: axisCurrency }, grid: { drawOnChartArea: false } },
        x: { grid: { display: false } }
      }
    }
  });

  createChart("paymentDayChart", {
    type: "bar",
    data: {
      labels: paymentDays.map((item) => item.day),
      datasets: [{ label: "Nopol lunas", data: paymentDays.map((item) => item.count), backgroundColor: "#0b8078", borderRadius: 4 }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label(context) { return `${formatNumber(context.raw)} nopol lunas`; } } } },
      scales: { y: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: "#e9eef5" } }, x: { title: { display: true, text: "Tanggal pembayaran" }, grid: { display: false } } }
    }
  });

  createChart("paymentStatusChart", {
    type: "doughnut",
    data: {
      labels: ["Sudah lunas", "Belum lunas"],
      datasets: [{ data: [paidCount, unpaidCount], backgroundColor: ["#158f68", "#c7423c"], borderColor: "#ffffff", borderWidth: 3, hoverOffset: 5 }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "64%",
      plugins: { legend: { position: "bottom", labels: { boxWidth: 10, usePointStyle: true } }, tooltip: { callbacks: { label(context) { return `${context.label}: ${formatNumber(context.raw)} nopol`; } } } }
    }
  });

  createChart("letterStageChart", {
    type: "bar",
    data: {
      labels: letterStages.map((stage) => stage.letter),
      datasets: [{ label: "Nominal belum lunas", data: letterStages.map((stage) => stage.potential), backgroundColor: ["#d19219", "#c8513a", "#8b4cbd"], borderRadius: 5 }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label(context) { const stage = letterStages[context.dataIndex]; return [`Nominal: ${formatCurrency(context.raw)}`, `Nopol: ${formatNumber(stage.count)}`]; } } } },
      scales: { y: { beginAtZero: true, ticks: { callback: axisCurrency }, grid: { color: "#e9eef5" } }, x: { grid: { display: false } } }
    }
  });

  createChart("arrearsAgeChart", {
    type: "bar",
    data: {
      labels: ageing.map((group) => group.label),
      datasets: [{ label: "Nopol belum lunas", data: ageing.map((group) => group.count), backgroundColor: ["#dfb34b", "#dd8f35", "#d95e3e", "#b83336", "#7b8799"], borderRadius: 5 }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label(context) { const group = ageing[context.dataIndex]; return [`Nopol: ${formatNumber(group.count)}`, `Nominal: ${formatCurrency(group.potential)}`]; } } } },
      scales: { y: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: "#e9eef5" } }, x: { grid: { display: false } } }
    }
  });

  const visibleDistricts = districts.filter((district) => district.unpaidPotential > 0).slice(0, 12).reverse();
  createChart("districtArrearsChart", {
    type: "bar",
    data: {
      labels: visibleDistricts.length ? visibleDistricts.map((district) => district.label) : ["Belum ada tunggakan"],
      datasets: [{ label: "Nominal belum lunas", data: visibleDistricts.length ? visibleDistricts.map((district) => district.unpaidPotential) : [0], backgroundColor: "#c7423c", borderRadius: 5 }]
    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      onClick(event, elements) {
        if (!elements.length || !visibleDistricts.length) return;
        controls.districtFilter.value = visibleDistricts[elements[0].index].key;
        renderAnalysis();
      },
      plugins: { legend: { display: false }, tooltip: { callbacks: { label(context) { const district = visibleDistricts[context.dataIndex]; return [`Nominal: ${formatCurrency(context.raw)}`, `Belum lunas: ${formatNumber(district.unpaidCount)} nopol`]; } } } },
      scales: { x: { beginAtZero: true, ticks: { callback: axisCurrency }, grid: { color: "#e9eef5" } }, y: { grid: { display: false } } }
    }
  });
}

function renderAreaList(districts) {
  if (!controls.areaList || !controls.areaListCount) return;
  const visibleDistricts = districts.filter((district) => district.unpaidPotential > 0);
  controls.areaListCount.textContent = `${formatNumber(visibleDistricts.length)} area`;

  if (!visibleDistricts.length) {
    controls.areaList.innerHTML = '<p class="area-list-empty">Tidak ada tunggakan pada filter ini.</p>';
    return;
  }

  controls.areaList.innerHTML = visibleDistricts.slice(0, 8).map((district) => `
    <button class="area-row" type="button" data-district="${district.key}">
      <span class="area-row-main">
        <strong>${district.label}</strong>
        <small>${formatNumber(district.unpaidCount)} belum lunas dari ${formatNumber(district.count)} nopol</small>
      </span>
      <span class="area-row-value">${formatCurrency(district.unpaidPotential)}</span>
    </button>
  `).join("");

  controls.areaList.querySelectorAll("[data-district]").forEach((button) => {
    button.addEventListener("click", () => {
      controls.districtFilter.value = button.dataset.district;
      renderAnalysis();
    });
  });
}

function renderAnalysis() {
  const vehicles = getFilteredVehicles();
  const districts = aggregateDistricts(vehicles);
  const ageing = buildAgeing(vehicles);
  updateMetricCards(vehicles, districts, ageing);
  createCharts(vehicles, districts, ageing);
  renderAreaList(districts);
}

function updateSelectOptions(select, entries, getValue, getLabel) {
  const currentValue = select.value;
  const firstOption = select.options[0]?.outerHTML || "";
  select.innerHTML = firstOption;
  entries.forEach((entry) => {
    const option = document.createElement("option");
    option.value = getValue(entry);
    option.textContent = getLabel(entry);
    select.appendChild(option);
  });
  select.value = [...select.options].some((option) => option.value === currentValue) ? currentValue : "all";
}

function populateFilters() {
  const periods = [...new Set(latestVehicles.map((item) => getRecordPeriod(item.record)).filter(Boolean))].sort().reverse();
  const districts = [...new Set(latestVehicles.map((item) => item.district).filter(Boolean).map((district) => district.key))]
    .sort((left, right) => DISTRICT_LABELS[left].localeCompare(DISTRICT_LABELS[right], "id"));

  updateSelectOptions(controls.periodFilter, periods, (period) => period, (period) => formatPeriod(period));
  updateSelectOptions(controls.districtFilter, districts, (district) => district, (district) => DISTRICT_LABELS[district]);
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
    "id", "plate_key", "plate_number", "letter_type", "month", "year", "owner_name",
    "status", "is_paid", "paid_date", "recorded_date", "tax_valid_date", "tax_base_amount",
    "calculated_tax_potential", "source_text", "updated_at"
  ].join(",");
  const pageSize = 1000;
  const records = [];

  for (let offset = 0; ; offset += pageSize) {
    const response = await requestSupabase(`/rest/v1/production_records?select=${encodeURIComponent(fields)}&order=updated_at.desc&id.desc`, {
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
    latestVehicles = createLatestVehicles(productionRecords);
    populateFilters();
    setSource();
    renderAnalysis();
    setStatus("DATABASE: ANALISIS TERHUBUNG", "success");
  } catch (error) {
    console.error("Gagal memuat analisis tunggakan.", error);
    setStatus("DATABASE: GAGAL MEMUAT", "error");
    if (controls.source) controls.source.textContent = "Data belum dapat dimuat. Periksa koneksi internet atau coba muat ulang.";
  } finally {
    if (controls.refreshButton) controls.refreshButton.disabled = false;
  }
}

function bindEvents() {
  [controls.periodFilter, controls.districtFilter, controls.letterFilter, controls.paymentFilter].forEach((select) => {
    select?.addEventListener("change", renderAnalysis);
  });
  controls.refreshButton?.addEventListener("click", loadAnalysis);
}

bindEvents();
loadAnalysis();
