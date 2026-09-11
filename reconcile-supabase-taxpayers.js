/*
 * One-off maintenance utility for repairing taxpayer rows from the SIAPP
 * production records already stored in Supabase.
 *
 * Usage:
 *   node reconcile-supabase-taxpayers.js          # preview only
 *   node reconcile-supabase-taxpayers.js --apply  # write corrections
 */

const fs = require("fs");

const config = fs.readFileSync("config.js", "utf8");
const getConfigValue = function (name) {
  const line = config.split("\n").find(function (value) {
    return value.includes(name);
  });
  return line ? line.split('"')[1] : "";
};

const supabaseUrl = getConfigValue("SUPABASE_URL");
const supabaseKey = getConfigValue("SUPABASE_PUBLISHABLE_KEY");
const shouldApply = process.argv.includes("--apply");

if (!supabaseUrl || !supabaseKey) throw new Error("Konfigurasi Supabase tidak ditemukan.");

const letterRank = { SPOS: 1, NPP: 2, NTP: 3 };

function isExplicitlyPaid(record) {
  const sourceText = String(record.source_text || "").toUpperCase();
  if (!sourceText) return false;
  const hasUnpaidMarker = /\b(BELUM|TIDAK)\s+(?:TERDETEKSI\s+)?(?:LUNAS|BAYAR)\b/.test(sourceText);
  const hasPaidMarker = /\b(LUNAS|SUDAH\s+BAYAR|TERBAYAR|PAID)\b/.test(sourceText);
  return !hasUnpaidMarker && hasPaidMarker;
}

function dateDistance(first, second) {
  const firstDate = new Date(first + "T00:00:00");
  const secondDate = new Date(second + "T00:00:00");
  if (Number.isNaN(firstDate.getTime()) || Number.isNaN(secondDate.getTime())) return Number.POSITIVE_INFINITY;
  return Math.abs(firstDate.getTime() - secondDate.getTime());
}

function selectProductionRecord(taxpayer, candidates) {
  const referenceDate = taxpayer.field_visit_date || String(taxpayer.updated_at || "").slice(0, 10);
  return candidates.slice().sort(function (first, second) {
    const distanceDifference = dateDistance(first.recorded_date, referenceDate) - dateDistance(second.recorded_date, referenceDate);
    if (distanceDifference) return distanceDifference;
    const letterDifference = (letterRank[second.letter_type] || 0) - (letterRank[first.letter_type] || 0);
    if (letterDifference) return letterDifference;
    return String(second.updated_at || "").localeCompare(String(first.updated_at || ""));
  })[0] || null;
}

async function request(path, options) {
  const settings = options || {};
  const response = await fetch(supabaseUrl + "/rest/v1/" + path, Object.assign({}, settings, {
    headers: Object.assign({
      apikey: supabaseKey,
      Authorization: "Bearer " + supabaseKey
    }, settings.headers || {})
  }));
  if (!response.ok) throw new Error("Supabase " + response.status + ": " + (await response.text()));
  if (response.status === 204) return [];
  const text = await response.text();
  return text ? JSON.parse(text) : [];
}

async function listRows(table, columns) {
  const rows = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const page = await request(table + "?select=" + columns + "&order=updated_at.desc", {
      headers: { Range: from + "-" + (from + pageSize - 1) }
    });
    rows.push.apply(rows, page);
    if (page.length < pageSize) return rows;
  }
}

function makeReplacement(taxpayer, productionRecord) {
  const paid = productionRecord ? isExplicitlyPaid(productionRecord) : false;
  return {
    id: taxpayer.id,
    plate_key: taxpayer.plate_key,
    letter_type: productionRecord ? productionRecord.letter_type : taxpayer.letter_type,
    tax_valid_date: productionRecord && productionRecord.tax_valid_date ? productionRecord.tax_valid_date : taxpayer.tax_valid_date,
    plate_number: taxpayer.plate_number,
    owner_name: productionRecord && productionRecord.owner_name ? productionRecord.owner_name : taxpayer.owner_name,
    tax_potential: productionRecord && Number(productionRecord.calculated_tax_potential || 0) ? Number(productionRecord.calculated_tax_potential) : Number(taxpayer.tax_potential || 0),
    phone: taxpayer.phone,
    status: paid ? "Sudah bayar" : "Belum bayar",
    field_visit_date: taxpayer.field_visit_date,
    field_visit_note: taxpayer.field_visit_note,
    updated_at: new Date().toISOString()
  };
}

function isDifferent(taxpayer, replacement) {
  return ["letter_type", "tax_valid_date", "owner_name", "tax_potential", "status"].some(function (field) {
    return String(taxpayer[field] == null ? "" : taxpayer[field]) !== String(replacement[field] == null ? "" : replacement[field]);
  });
}

async function main() {
  const taxpayers = await listRows("taxpayers", "id,plate_key,letter_type,tax_valid_date,plate_number,owner_name,tax_potential,phone,status,field_visit_date,field_visit_note,updated_at");
  const production = await listRows("production_records", "plate_key,letter_type,owner_name,status,is_paid,paid_date,recorded_date,tax_valid_date,calculated_tax_potential,source_text,updated_at");
  const productionByPlate = new Map();

  production.forEach(function (record) {
    const key = String(record.plate_key || "");
    if (!key) return;
    const entries = productionByPlate.get(key) || [];
    entries.push(record);
    productionByPlate.set(key, entries);
  });

  const changes = taxpayers.map(function (taxpayer) {
    const selected = selectProductionRecord(taxpayer, productionByPlate.get(taxpayer.plate_key) || []);
    return { taxpayer: taxpayer, selected: selected, replacement: makeReplacement(taxpayer, selected) };
  }).filter(function (item) {
    return isDifferent(item.taxpayer, item.replacement);
  });

  console.log("Taxpayers: " + taxpayers.length);
  console.log("Production records: " + production.length);
  console.log("Corrections: " + changes.length);
  changes.slice(0, 20).forEach(function (item) {
    console.log(item.taxpayer.plate_number + ": " + item.taxpayer.letter_type + " -> " + item.replacement.letter_type + ", " + item.taxpayer.status + " -> " + item.replacement.status);
  });

  if (!shouldApply || !changes.length) return;

  const rows = changes.map(function (item) { return item.replacement; });
  for (let start = 0; start < rows.length; start += 100) {
    await request("taxpayers?on_conflict=id", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal"
      },
      body: JSON.stringify(rows.slice(start, start + 100))
    });
  }
  console.log("Supabase updated successfully.");
}

main().catch(function (error) {
  console.error(error.message);
  process.exitCode = 1;
});
