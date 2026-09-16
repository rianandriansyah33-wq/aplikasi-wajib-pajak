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
  dailyPaymentChart: document.querySelector("#dailyPaymentChart"),
  averagePaymentDuration: document.querySelector("#averagePaymentDuration"),
  paymentDurationDetail: document.querySelector("#paymentDurationDetail"),
  paymentDurationChart: document.querySelector("#paymentDurationChart"),
  payoutPeriodFilter: document.querySelector("#payoutPeriodFilter"),
  payoutPeriodTotals: document.querySelector("#payoutPeriodTotals"),
  payoutCalendar: document.querySelector("#payoutCalendar"),
  payoutDateLabel: document.querySelector("#payoutDateLabel"),
  payoutDateCount: document.querySelector("#payoutDateCount"),
  payoutDateTotal: document.querySelector("#payoutDateTotal"),
  payoutTableBody: document.querySelector("#payoutTableBody"),
  payoutEmpty: document.querySelector("#payoutEmpty"),
  payoutHistoryOverlay: document.querySelector("#payoutHistoryOverlay"),
  payoutHistoryCloseButton: document.querySelector("#payoutHistoryCloseBtn"),
  payoutHistoryTitle: document.querySelector("#payoutHistoryTitle"),
  payoutHistoryMeta: document.querySelector("#payoutHistoryMeta"),
  payoutHistoryPlate: document.querySelector("#payoutHistoryPlate"),
  payoutHistoryTaxPeriod: document.querySelector("#payoutHistoryTaxPeriod"),
  payoutHistoryCount: document.querySelector("#payoutHistoryCount"),
  payoutHistoryFlow: document.querySelector("#payoutHistoryFlow"),
  payoutHistoryTableBody: document.querySelector("#payoutHistoryTableBody")
};

let productionRecords = [];
let dailyPaymentChart = null;
let paymentDurationChart = null;
let selectedPayoutDate = "";
let selectedPayoutRecordId = "";
let payoutRecordsByDate = new Map();

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
  const plateValue = typeof record === "string"
    ? record
    : (record && (record.plate_key || record.plate_number));
  return normalizeText(plateValue).replace(/\s/g, "");
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

function getPaidPeriod(record) {
  const paidDate = getIsoDate(record.paid_date);
  return paidDate ? paidDate.slice(0, 7) : "";
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

function formatCurrency(value) {
  return `Rp ${new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 }).format(Number(value || 0))},-`;
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

function populatePayoutPeriodFilter(records) {
  if (!controls.payoutPeriodFilter) return;
  const currentValue = controls.payoutPeriodFilter.value;
  const periods = [...new Set((records || [])
    .filter(isExplicitlyPaid)
    .map(getPaidPeriod)
    .filter(Boolean))].sort().reverse();
  controls.payoutPeriodFilter.innerHTML = "";

  periods.forEach((period) => {
    const option = document.createElement("option");
    option.value = period;
    option.textContent = formatPeriod(period);
    controls.payoutPeriodFilter.appendChild(option);
  });

  controls.payoutPeriodFilter.value = periods.includes(currentValue) ? currentValue : (periods[0] || "");
}

function buildDailyPaymentPattern(records, selectedPeriod) {
  const days = Array.from({ length: 31 }, (_, index) => ({ day: index + 1, count: 0 }));

  records.filter(isExplicitlyPaid).forEach((record) => {
    const paidDate = getIsoDate(record.paid_date);
    if (!paidDate || paidDate.slice(0, 7) !== selectedPeriod) return;
    const day = Number(paidDate.slice(8, 10));
    if (day >= 1 && day <= 31) days[day - 1].count += 1;
  });

  return days;
}

function buildPaymentDurations(records) {
  const buckets = [
    { label: "0-7 hari", count: 0, min: 0, max: 7 },
    { label: "8-14 hari", count: 0, min: 8, max: 14 },
    { label: "15-30 hari", count: 0, min: 15, max: 30 },
    { label: "31-60 hari", count: 0, min: 31, max: 60 },
    { label: "61-90 hari", count: 0, min: 61, max: 90 },
    { label: ">90 hari", count: 0, min: 91, max: Infinity }
  ];
  const durations = [];
  records.forEach((record) => {
    const recordedDate = getIsoDate(record.recorded_date);
    const paidDate = getIsoDate(record.paid_date);
    if (!recordedDate || !paidDate || !isExplicitlyPaid(record) || paidDate < recordedDate) return;

    const duration = Math.floor((new Date(`${paidDate}T00:00:00`).getTime() - new Date(`${recordedDate}T00:00:00`).getTime()) / 86400000);
    durations.push(duration);
    const bucket = buckets.find((itemBucket) => duration >= itemBucket.min && duration <= itemBucket.max);
    if (bucket) bucket.count += 1;
  });

  return { buckets, durations };
}

function getPayoutNominal(record) {
  const calculated = Number(record.calculated_tax_potential || 0);
  if (calculated > 0) return calculated;
  return Number(record.tax_base_amount || 0) + Number(record.jasa_raharja || 0) + Number(record.late_penalty || 0);
}

function getLocationDetails(record) {
  const sourceParts = String(record.source_text || "").split("|").map((part) => part.trim());
  let locationSource = sourceParts[2] || "";
  const ownerName = String(record.owner_name || "").trim();
  if (ownerName && locationSource.toUpperCase().startsWith(ownerName.toUpperCase())) {
    locationSource = locationSource.slice(ownerName.length).trim();
  }

  const kecamatanMatch = locationSource.match(/\bKEC(?:AMATAN)?\.?\s+(.+?)(?=\s+\bKEL(?:URAHAN)?\.?\s+|$)/i);
  const kelurahanMatch = locationSource.match(/\bKEL(?:URAHAN)?\.?\s+(.+?)(?=\s+\bKEC(?:AMATAN)?\.?\s+|$)/i);
  const address = locationSource
    .replace(/\bKEC(?:AMATAN)?\.?\s+.*$/i, "")
    .replace(/\bKEL(?:URAHAN)?\.?\s+.*$/i, "")
    .replace(/\s+/g, " ")
    .trim();

  return {
    address: address || "-",
    kelurahan: kelurahanMatch ? kelurahanMatch[1].replace(/\s+/g, " ").trim() : "-",
    kecamatan: kecamatanMatch ? kecamatanMatch[1].replace(/\s+/g, " ").trim() : "-"
  };
}

function buildPayoutRecordsByDate(records, period) {
  const uniquePayouts = new Map();

  records.forEach((record) => {
    if (!isExplicitlyPaid(record) || getPaidPeriod(record) !== period) return;
    const paidDate = getIsoDate(record.paid_date);
    const plateKey = getPlateKey(record);
    if (!paidDate || !plateKey) return;

    const key = `${plateKey}|${paidDate}`;
    const existing = uniquePayouts.get(key);
    if (!existing || getPayoutNominal(record) > getPayoutNominal(existing)) uniquePayouts.set(key, record);
  });

  const byDate = new Map();
  uniquePayouts.forEach((record) => {
    const paidDate = getIsoDate(record.paid_date);
    const payout = {
      record,
      nominal: getPayoutNominal(record),
      location: getLocationDetails(record)
    };
    const entries = byDate.get(paidDate) || [];
    entries.push(payout);
    byDate.set(paidDate, entries);
  });

  byDate.forEach((entries) => {
    entries.sort((left, right) => right.nominal - left.nominal || String(left.record.owner_name || "").localeCompare(String(right.record.owner_name || ""), "id"));
  });
  return byDate;
}

function createCalendarDayLabel(dateValue, entries) {
  const count = entries.length;
  const total = entries.reduce((sum, entry) => sum + entry.nominal, 0);
  return `${formatDate(dateValue)}: ${formatNumber(count)} pencairan, total ${formatCurrency(total)}.`;
}

function buildPayoutPeriodSummary(period, byDate) {
  if (!/^\d{4}-\d{2}$/.test(String(period || ""))) return { totalCount: 0, totalNominal: 0, weeks: [] };
  const [year, month] = period.split("-").map(Number);
  const daysInMonth = new Date(year, month, 0).getDate();
  const firstWeekday = (new Date(year, month - 1, 1).getDay() + 6) % 7;
  const weekCount = Math.ceil((firstWeekday + daysInMonth) / 7);
  let totalCount = 0;
  let totalNominal = 0;

  const weeks = Array.from({ length: weekCount }, (_, index) => {
    const startDay = Math.max(1, index * 7 - firstWeekday + 1);
    const endDay = Math.min(daysInMonth, (index + 1) * 7 - firstWeekday);
    const entries = [];

    for (let day = startDay; day <= endDay; day += 1) {
      const dateValue = `${period}-${String(day).padStart(2, "0")}`;
      entries.push(...(byDate.get(dateValue) || []));
    }

    const nominal = entries.reduce((sum, entry) => sum + entry.nominal, 0);
    totalCount += entries.length;
    totalNominal += nominal;
    return { startDay, endDay, count: entries.length, nominal };
  });

  return { totalCount, totalNominal, weeks };
}

function renderPayoutPeriodTotals(period, byDate) {
  if (!controls.payoutPeriodTotals) return;
  controls.payoutPeriodTotals.replaceChildren();
  const summary = buildPayoutPeriodSummary(period, byDate);
  const createTotal = (title, detail, nominal, className = "") => {
    const item = document.createElement("article");
    item.className = `payout-period-total ${className}`.trim();
    const titleElement = document.createElement("span");
    titleElement.textContent = title;
    const detailElement = document.createElement("small");
    detailElement.textContent = detail;
    const nominalElement = document.createElement("strong");
    nominalElement.textContent = formatCurrency(nominal);
    item.append(titleElement, detailElement, nominalElement);
    return item;
  };

  controls.payoutPeriodTotals.appendChild(createTotal(
    `Total ${formatPeriod(period)}`,
    `${formatNumber(summary.totalCount)} pencairan`,
    summary.totalNominal,
    "payout-period-total-month"
  ));

  summary.weeks.forEach((week, index) => {
    const range = week.startDay === week.endDay
      ? `${week.startDay} ${formatPeriod(period).split(" ")[0]}`
      : `${week.startDay}-${week.endDay} ${formatPeriod(period).split(" ")[0]}`;
    controls.payoutPeriodTotals.appendChild(createTotal(
      `Minggu ${index + 1}`,
      `${range} | ${formatNumber(week.count)} pencairan`,
      week.nominal
    ));
  });
}

function getProductionStatusDate(record) {
  const parts = String(record.source_text || "").split("|").map((part) => part.trim());
  const statusDateSegment = parts.length >= 2 ? parts[parts.length - 2] : "";
  const dates = statusDateSegment.match(/\d{2}\/\d{2}\/\d{4}/g) || [];
  return dates.length >= 2 ? getIsoDate(dates[1]) : "";
}

function getProductionTaxPeriod(record) {
  const storedDate = getIsoDate(record.tax_valid_date);
  if (storedDate) return storedDate;

  const parts = String(record.source_text || "").split("|").map((part) => part.trim());
  const taxPeriodDates = (parts[3] || "").match(/\d{2}\/\d{2}\/\d{4}/g) || [];
  return taxPeriodDates.length ? getIsoDate(taxPeriodDates[taxPeriodDates.length - 1]) : "";
}

function getPaymentHistoryForPlate(plateKey) {
  const stages = new Map();

  productionRecords
    .filter((record) => getPlateKey(record) === plateKey)
    .forEach((record) => {
      const stageKey = `${String(record.letter_type || "-").toUpperCase()}|${getIsoDate(record.recorded_date)}`;
      const existing = stages.get(stageKey);
      if (!existing) {
        stages.set(stageKey, record);
        return;
      }

      const currentIsPaid = isExplicitlyPaid(record);
      const existingIsPaid = isExplicitlyPaid(existing);
      if (currentIsPaid !== existingIsPaid) {
        if (currentIsPaid) stages.set(stageKey, record);
        return;
      }

      if (getDateValue(record.updated_at) >= getDateValue(existing.updated_at)) {
        stages.set(stageKey, record);
      }
    });

  return [...stages.values()]
    .sort((left, right) => {
      const recordedDifference = getDateValue(left.recorded_date) - getDateValue(right.recorded_date);
      if (recordedDifference) return recordedDifference;

      const leftRank = LETTER_RANK[String(left.letter_type || "").toUpperCase()] || 0;
      const rightRank = LETTER_RANK[String(right.letter_type || "").toUpperCase()] || 0;
      if (leftRank !== rightRank) return leftRank - rightRank;

      return String(left.id || "").localeCompare(String(right.id || ""), "id", { numeric: true });
    });
}

function getDaysBetween(startDate, endDate) {
  const start = getDateValue(startDate);
  const end = getDateValue(endDate);
  if (!start || !end || end < start) return null;
  return Math.floor((end - start) / 86400000);
}

function getHistoryDurationLabel(history, index) {
  const record = history[index];
  const nextRecord = history[index + 1];

  if (nextRecord) {
    const days = getDaysBetween(record.recorded_date, nextRecord.recorded_date);
    const nextLetter = String(nextRecord.letter_type || "Surat berikutnya").toUpperCase();
    return days === null ? `Menuju ${nextLetter}` : `Ke ${nextLetter}: ${days} hari`;
  }

  if (isExplicitlyPaid(record)) {
    const days = getDaysBetween(record.recorded_date, record.paid_date);
    return days === null ? "Sudah lunas" : `Rekam ke lunas: ${days} hari`;
  }

  return "Menunggu tahap atau pelunasan berikutnya";
}

function clearPayoutHistory() {
  if (controls.payoutHistoryOverlay) controls.payoutHistoryOverlay.hidden = true;
  document.body.classList.remove("payout-history-open");
  if (controls.payoutHistoryTableBody) controls.payoutHistoryTableBody.replaceChildren();
}

function closePayoutHistory() {
  if (!selectedPayoutRecordId) return;
  selectedPayoutRecordId = "";
  clearPayoutHistory();
  renderPayoutDetail();
}

function renderPayoutHistory() {
  if (!controls.payoutHistoryOverlay || !controls.payoutHistoryTableBody) return;
  const selectedRecord = productionRecords.find((record) => String(record.id || "") === selectedPayoutRecordId);
  if (!selectedRecord) {
    clearPayoutHistory();
    return;
  }

  const plateKey = getPlateKey(selectedRecord);
  const history = getPaymentHistoryForPlate(plateKey);
  if (!history.length) {
    clearPayoutHistory();
    return;
  }

  const taxPeriodRecord = history.find((record) => getProductionTaxPeriod(record)) || selectedRecord;
  controls.payoutHistoryOverlay.hidden = false;
  document.body.classList.add("payout-history-open");
  setMetric(controls.payoutHistoryTitle, `Riwayat Surat ${selectedRecord.plate_number || plateKey}`);
  setMetric(controls.payoutHistoryMeta, `${formatNumber(history.length)} surat tercatat`);
  setMetric(controls.payoutHistoryPlate, selectedRecord.plate_number || plateKey);
  setMetric(controls.payoutHistoryTaxPeriod, formatDate(getProductionTaxPeriod(taxPeriodRecord)));
  setMetric(controls.payoutHistoryCount, `${formatNumber(history.length)} surat`);
  setMetric(
    controls.payoutHistoryFlow,
    `Urutan surat: ${history.map((record) => String(record.letter_type || "-").toUpperCase()).join(" → ")}`
  );
  controls.payoutHistoryTableBody.replaceChildren();

  history.forEach((record, index) => {
    const paid = isExplicitlyPaid(record);
    const row = document.createElement("tr");
    const values = [
      index + 1,
      String(record.letter_type || "-").toUpperCase(),
      formatDate(getProductionTaxPeriod(record)),
      formatDate(record.recorded_date),
      formatDate(getProductionStatusDate(record)),
      paid ? "Lunas" : "Belum lunas",
      paid ? formatDate(record.paid_date) : "-",
      getHistoryDurationLabel(history, index)
    ];

    values.forEach((value, valueIndex) => {
      const cell = document.createElement("td");
      cell.textContent = value;
      if (valueIndex === 1) cell.className = "history-letter";
      if (valueIndex === 3) cell.className = paid ? "history-paid" : "history-unpaid";
      row.appendChild(cell);
    });
    controls.payoutHistoryTableBody.appendChild(row);
  });
}

function renderPayoutDetail() {
  if (!controls.payoutTableBody) return;
  const entries = payoutRecordsByDate.get(selectedPayoutDate) || [];
  controls.payoutTableBody.replaceChildren();
  if (controls.payoutEmpty) controls.payoutEmpty.hidden = entries.length > 0;

  if (!entries.length) {
    selectedPayoutRecordId = "";
    clearPayoutHistory();
    setMetric(controls.payoutDateLabel, "Pilih tanggal pencairan");
    setMetric(controls.payoutDateCount, "-");
    setMetric(controls.payoutDateTotal, "Belum ada data untuk ditampilkan");
    return;
  }

  if (!entries.some((entry) => String(entry.record.id || "") === selectedPayoutRecordId)) {
    selectedPayoutRecordId = "";
  }

  const total = entries.reduce((sum, entry) => sum + entry.nominal, 0);
  setMetric(controls.payoutDateLabel, `Pencairan ${formatDate(selectedPayoutDate)}`);
  setMetric(controls.payoutDateCount, `${formatNumber(entries.length)} pencairan`);
  setMetric(controls.payoutDateTotal, `Total ${formatCurrency(total)}`);

  entries.forEach((entry, index) => {
    const row = document.createElement("tr");
    const recordId = String(entry.record.id || "");
    row.classList.toggle("is-history-selected", recordId === selectedPayoutRecordId);
    row.tabIndex = 0;
    row.setAttribute("role", "button");
    row.setAttribute("aria-label", `Riwayat surat ${entry.record.plate_number || "kendaraan"}`);
    const values = [
      index + 1,
      entry.record.owner_name || "-",
      entry.location.address,
      entry.location.kelurahan,
      entry.location.kecamatan,
      entry.record.plate_number || "-",
      formatCurrency(entry.nominal),
      formatDate(entry.record.paid_date)
    ];
    values.forEach((value, valueIndex) => {
      const cell = document.createElement("td");
      cell.textContent = value;
      if (valueIndex === 5) cell.className = "payout-plate";
      if (valueIndex === 6) cell.className = "payout-nominal";
      row.appendChild(cell);
    });
    const selectHistory = () => {
      selectedPayoutRecordId = recordId;
      renderPayoutDetail();
    };
    row.addEventListener("click", selectHistory);
    row.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      selectHistory();
    });
    controls.payoutTableBody.appendChild(row);
  });

  renderPayoutHistory();
}

function renderPayoutCalendar() {
  if (!controls.payoutCalendar || !controls.payoutPeriodFilter) return;
  const period = controls.payoutPeriodFilter.value;
  payoutRecordsByDate = buildPayoutRecordsByDate(productionRecords, period);
  renderPayoutPeriodTotals(period, payoutRecordsByDate);
  const dates = [...payoutRecordsByDate.keys()].sort();
  if (!dates.includes(selectedPayoutDate)) selectedPayoutDate = dates[dates.length - 1] || "";
  controls.payoutCalendar.replaceChildren();

  const weekdays = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"];
  weekdays.forEach((weekday) => {
    const label = document.createElement("span");
    label.className = "payout-calendar-weekday";
    label.textContent = weekday;
    controls.payoutCalendar.appendChild(label);
  });

  if (period) {
    const [year, month] = period.split("-").map(Number);
    const daysInMonth = new Date(year, month, 0).getDate();
    const firstWeekday = (new Date(year, month - 1, 1).getDay() + 6) % 7;

    for (let index = 0; index < firstWeekday; index += 1) {
      const blank = document.createElement("span");
      blank.className = "payout-calendar-day is-empty";
      blank.setAttribute("aria-hidden", "true");
      controls.payoutCalendar.appendChild(blank);
    }

    for (let day = 1; day <= daysInMonth; day += 1) {
      const dateValue = `${period}-${String(day).padStart(2, "0")}`;
      const entries = payoutRecordsByDate.get(dateValue) || [];
      const dayElement = document.createElement(entries.length ? "button" : "span");
      dayElement.className = "payout-calendar-day";
      const dayNumber = document.createElement("strong");
      dayNumber.textContent = day;
      dayElement.appendChild(dayNumber);

      if (entries.length) {
        dayElement.type = "button";
        dayElement.classList.add("has-payout");
        dayElement.classList.toggle("is-selected", dateValue === selectedPayoutDate);
        dayElement.setAttribute("aria-pressed", String(dateValue === selectedPayoutDate));
        dayElement.setAttribute("aria-label", createCalendarDayLabel(dateValue, entries));

        const count = document.createElement("span");
        count.textContent = `${formatNumber(entries.length)} cair`;
        const total = document.createElement("small");
        total.textContent = formatCurrency(entries.reduce((sum, entry) => sum + entry.nominal, 0));
        dayElement.append(count, total);
        dayElement.addEventListener("click", () => {
          selectedPayoutDate = dateValue;
          renderPayoutCalendar();
        });
      } else {
        dayElement.setAttribute("aria-label", `${formatDate(dateValue)}: tidak ada pencairan.`);
      }
      controls.payoutCalendar.appendChild(dayElement);
    }
  }

  renderPayoutDetail();
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

  setMetric(controls.peakPaymentDay, peak.count ? `Tanggal ${peak.day}` : "Belum ada pencairan");
  setMetric(controls.peakPaymentDetail, peak.count ? `${formatNumber(peak.count)} pelunasan pada tanggal ini.` : "Belum ada tanggal bayar pada bulan terpilih.");
}

function renderDailyPaymentChart(dailyPayments) {
  if (!controls.dailyPaymentChart || !window.Chart) return;
  if (dailyPaymentChart) dailyPaymentChart.destroy();

  dailyPaymentChart = new window.Chart(controls.dailyPaymentChart, {
    type: "bar",
    data: {
      labels: dailyPayments.map((item) => item.day),
      datasets: [{
        label: "Pelunasan",
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
        tooltip: { callbacks: { label(context) { return `${formatNumber(context.raw)} pelunasan`; } } }
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

function renderPaymentDuration(durationData) {
  const { buckets, durations } = durationData;
  const sortedDurations = [...durations].sort((left, right) => left - right);
  const average = sortedDurations.length ? sortedDurations.reduce((total, value) => total + value, 0) / sortedDurations.length : 0;
  const middle = Math.floor(sortedDurations.length / 2);
  const median = sortedDurations.length % 2 ? sortedDurations[middle] : (sortedDurations[middle - 1] + sortedDurations[middle]) / 2;
  const withinThirtyDays = sortedDurations.filter((value) => value <= 30).length;
  const withinThirtyRate = sortedDurations.length ? (withinThirtyDays / sortedDurations.length) * 100 : 0;

  if (sortedDurations.length) {
    setMetric(controls.averagePaymentDuration, `${average.toLocaleString("id-ID", { maximumFractionDigits: 1 })} hari rata-rata`);
    setMetric(controls.paymentDurationDetail, `${formatNumber(sortedDurations.length)} nopol berpasangan. Median ${median.toLocaleString("id-ID", { maximumFractionDigits: 1 })} hari. ${withinThirtyRate.toLocaleString("id-ID", { maximumFractionDigits: 1 })}% lunas dalam 30 hari.`);
  } else {
    setMetric(controls.averagePaymentDuration, "Belum ada data");
    setMetric(controls.paymentDurationDetail, "Belum ada nopol dengan Tgl Rekam dan Tgl Bayar yang lengkap.");
  }

  if (!controls.paymentDurationChart || !window.Chart) return;
  if (paymentDurationChart) paymentDurationChart.destroy();

  paymentDurationChart = new window.Chart(controls.paymentDurationChart, {
    type: "bar",
    data: {
      labels: buckets.map((bucket) => bucket.label),
      datasets: [{
        label: "Pelunasan",
        data: buckets.map((bucket) => bucket.count),
        backgroundColor: ["#158f68", "#0b8078", "#d19219", "#dd8f35", "#c8513a", "#b83336"],
        borderRadius: 5,
        maxBarThickness: 68
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label(context) { return `${formatNumber(context.raw)} pelunasan`; } } }
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: { precision: 0 },
          title: { display: true, text: "Jumlah kendaraan" },
          grid: { color: "#e9eef5" }
        },
        x: {
          title: { display: true, text: "Lama proses pembayaran" },
          grid: { display: false }
        }
      }
    }
  });
}

function renderAnalysis() {
  const selectedPeriod = controls.recordedPeriodFilter.value;
  const vehicles = createMonthlyVehicles(productionRecords, selectedPeriod);
  const dailyPayments = buildDailyPaymentPattern(productionRecords, selectedPeriod);
  const paymentDurations = buildPaymentDurations(productionRecords);
  renderMetrics(vehicles, dailyPayments);
  renderDailyPaymentChart(dailyPayments);
  renderPaymentDuration(paymentDurations);
  renderPayoutCalendar();
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
    "id", "plate_key", "plate_number", "letter_type", "owner_name", "is_paid", "paid_date",
    "recorded_date", "tax_valid_date", "tax_base_amount", "jasa_raharja", "late_penalty", "calculated_tax_potential", "source_text", "updated_at"
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
    populatePayoutPeriodFilter(productionRecords);
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
controls.payoutPeriodFilter?.addEventListener("change", () => {
  selectedPayoutDate = "";
  selectedPayoutRecordId = "";
  clearPayoutHistory();
  renderPayoutCalendar();
});
controls.refreshButton?.addEventListener("click", loadAnalysis);
controls.payoutHistoryCloseButton?.addEventListener("click", closePayoutHistory);
controls.payoutHistoryOverlay?.addEventListener("click", (event) => {
  if (event.target === controls.payoutHistoryOverlay) closePayoutHistory();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !controls.payoutHistoryOverlay?.hidden) closePayoutHistory();
});
loadAnalysis();
