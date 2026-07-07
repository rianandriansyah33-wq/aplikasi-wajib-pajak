var SHEET_NAME = "DATA_WAJIB_PAJAK";
var PRODUCTION_SHEET_NAME = "BUKU_PRODUKSI";
var LETTER_SEQUENCE = ["SPOS", "NPP", "NTP"];
var PRODUCTION_MATCH_WINDOW_DAYS = 7;
var JASA_RAHARJA_RODA_4 = 143000;
var DENDA_RODA_4_PER_3_BULAN = 35000;

var HEADERS = [
  "id",
  "letterType",
  "taxValidDate",
  "stnkValidDate",
  "plateNumber",
  "ownerName",
  "taxPotential",
  "phone",
  "status",
  "updatedAt"
];

var PRODUCTION_HEADERS = [
  "id",
  "letterType",
  "month",
  "year",
  "plateNumber",
  "plateKey",
  "ownerName",
  "entryNumber",
  "status",
  "isPaid",
  "paidDate",
  "sourceText",
  "updatedAt",
  "taxValidDate",
  "taxBaseAmount",
  "jasaRaharja",
  "latePenalty",
  "calculatedTaxPotential",
  "recordedDate"
];

function doGet(e) {
  return handleRequest_(e);
}

function doPost(e) {
  return handleRequest_(e);
}

function handleRequest_(e) {
  try {
    var payload = parsePayload_(e);
    var action = payload.action || "list";
    var result;

    if (action === "list") {
      result = { ok: true, records: listRecords_() };
      return output_(result, e);
    }

    if (action === "listProduction") {
      result = { ok: true, productionRecords: listProductionRecords_() };
      return output_(result, e);
    }

    if (action === "upsert") {
      var saved = upsertRecords_(payload.records || []);
      result = { ok: true, records: saved };
      return output_(result, e);
    }

    if (action === "replaceProduction") {
      var savedProduction = replaceProductionRecords_(payload.scope || {}, payload.productionRecords || []);
      result = { ok: true, productionRecords: savedProduction };
      return output_(result, e);
    }

    if (action === "upsertProduction") {
      var upsertedProduction = upsertProductionRecords_(payload.scope || {}, payload.productionRecords || []);
      result = { ok: true, productionRecords: upsertedProduction };
      return output_(result, e);
    }

    if (action === "deleteMany") {
      deleteRecords_(payload.ids || []);
      result = { ok: true };
      return output_(result, e);
    }

    return output_({ ok: false, error: "Aksi tidak dikenal: " + action }, e);
  } catch (error) {
    return output_({ ok: false, error: String(error && error.message ? error.message : error) }, e);
  }
}

function parsePayload_(e) {
  if (e && e.postData && e.postData.contents) {
    return JSON.parse(e.postData.contents);
  }
  if (e && e.parameter && e.parameter.payload) {
    var payload = JSON.parse(e.parameter.payload);
    payload.action = e.parameter.action || payload.action;
    return payload;
  }
  if (e && e.parameter) return e.parameter;
  return {};
}

function getSheetByName_(sheetName, headers) {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) sheet = spreadsheet.insertSheet(sheetName);

  var headerRange = sheet.getRange(1, 1, 1, headers.length);
  var existingHeaders = headerRange.getValues()[0];
  var needsHeader = false;

  for (var index = 0; index < headers.length; index += 1) {
    if (existingHeaders[index] !== headers[index]) needsHeader = true;
  }

  if (needsHeader) headerRange.setValues([headers]);
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, sheet.getMaxRows(), headers.length).setNumberFormat("@");
  return sheet;
}

function getSheet_() {
  return getSheetByName_(SHEET_NAME, HEADERS);
}

function getProductionSheet_() {
  return getSheetByName_(PRODUCTION_SHEET_NAME, PRODUCTION_HEADERS);
}

function listRecords_() {
  var sheet = getSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  var values = sheet.getRange(2, 1, lastRow - 1, HEADERS.length).getValues();
  var records = [];

  values.forEach(function (row) {
    var record = rowToRecord_(row);
    if (record.id) records.push(record);
  });

  records.sort(function (a, b) {
    return String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""));
  });

  return records;
}

function listProductionRecords_() {
  var sheet = getProductionSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  var values = sheet.getRange(2, 1, lastRow - 1, PRODUCTION_HEADERS.length).getValues();
  var records = [];

  values.forEach(function (row) {
    var record = rowToProductionRecord_(row);
    if (record.id && record.plateKey) records.push(record);
  });

  records.sort(function (a, b) {
    return String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""));
  });

  return records;
}

function upsertRecords_(records) {
  var normalizedRecords = [];
  records.forEach(function (record) {
    var normalizedRecord = normalizeRecord_(record);
    if (normalizedRecord.id) normalizedRecords.push(normalizedRecord);
  });
  if (!normalizedRecords.length) return [];

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    var sheet = getSheet_();
    var rowById = getRowById_(sheet);

    normalizedRecords.forEach(function (record) {
      var rowValues = recordToRow_(record);
      var rowNumber = rowById[record.id];
      if (rowNumber) {
        sheet.getRange(rowNumber, 1, 1, HEADERS.length).setValues([rowValues]);
      } else {
        sheet.appendRow(rowValues);
      }
    });
  } finally {
    lock.releaseLock();
  }

  return normalizedRecords;
}

function replaceProductionRecords_(scope, records) {
  var normalizedScope = normalizeProductionScope_(scope);
  var normalizedRecords = [];

  records.forEach(function (record) {
    var normalizedRecord = normalizeProductionRecord_(record, normalizedScope);
    if (normalizedRecord.id && normalizedRecord.plateKey) normalizedRecords.push(normalizedRecord);
  });

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    var sheet = getProductionSheet_();
    var lastRow = sheet.getLastRow();

    if (lastRow >= 2) {
      var values = sheet.getRange(2, 1, lastRow - 1, PRODUCTION_HEADERS.length).getValues();
      for (var index = values.length - 1; index >= 0; index -= 1) {
        var existing = rowToProductionRecord_(values[index]);
        if (isSameProductionScope_(existing, normalizedScope)) sheet.deleteRow(index + 2);
      }
    }

    if (normalizedRecords.length) {
      var rows = normalizedRecords.map(productionRecordToRow_);
      sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, PRODUCTION_HEADERS.length).setValues(rows);
    }

    upgradeTaxpayerLettersFromProduction_(normalizedRecords);
  } finally {
    lock.releaseLock();
  }

  return normalizedRecords;
}

function upsertProductionRecords_(scope, records) {
  var normalizedScope = normalizeProductionScope_(scope);
  var normalizedRecords = [];

  records.forEach(function (record) {
    var normalizedRecord = normalizeProductionRecord_(record, normalizedScope);
    if (normalizedRecord.id && normalizedRecord.plateKey) normalizedRecords.push(normalizedRecord);
  });
  if (!normalizedRecords.length) return [];

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    var sheet = getProductionSheet_();
    var rowById = getRowById_(sheet);

    normalizedRecords.forEach(function (record) {
      var rowValues = productionRecordToRow_(record);
      var rowNumber = rowById[record.id];
      if (rowNumber) {
        sheet.getRange(rowNumber, 1, 1, PRODUCTION_HEADERS.length).setValues([rowValues]);
      } else {
        sheet.appendRow(rowValues);
      }
    });

    upgradeTaxpayerLettersFromProduction_(normalizedRecords);
  } finally {
    lock.releaseLock();
  }

  return normalizedRecords;
}

function upgradeTaxpayerLettersFromProduction_(productionRecords) {
  var targetByPlate = {};

  productionRecords.forEach(function (productionRecord) {
    if (!productionRecord) return;
    var plateKey = getPlateKey_(productionRecord.plateKey || productionRecord.plateNumber);
    if (!plateKey) return;

    var existing = targetByPlate[plateKey] || {};
    targetByPlate[plateKey] = {
      letterType: getHigherLetterType_(existing.letterType, productionRecord.letterType),
      taxValidDate: productionRecord.taxValidDate || existing.taxValidDate || "",
      ownerName: productionRecord.ownerName || existing.ownerName || "",
      recordedDate: productionRecord.recordedDate || existing.recordedDate || "",
      paymentStatus: productionRecord.isPaid ? "Sudah bayar" : "Belum bayar",
      calculatedTaxPotential: Number(productionRecord.calculatedTaxPotential || existing.calculatedTaxPotential || 0)
    };
  });

  var targetPlateKeys = Object.keys(targetByPlate);
  if (!targetPlateKeys.length) return [];

  var sheet = getSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  var values = sheet.getRange(2, 1, lastRow - 1, HEADERS.length).getValues();
  var changedRecords = [];

  values.forEach(function (row, index) {
    var record = rowToRecord_(row);
    if (!record.id) return;

    var plateKey = getPlateKey_(record.plateNumber);
    var target = targetByPlate[plateKey];
    if (!target) return;
    if (!isProductionRecordNearTaxpayer_(target, record)) return;

    var nextLetter = getHigherLetterType_(record.letterType, target.letterType);
    var isChanged = false;

    if (record.status !== "Sudah bayar" && nextLetter && nextLetter !== record.letterType) {
      record.letterType = nextLetter;
      isChanged = true;
    }

    if (target.ownerName && record.ownerName !== target.ownerName) {
      record.ownerName = target.ownerName;
      isChanged = true;
    }

    if (target.taxValidDate && record.taxValidDate !== target.taxValidDate) {
      record.taxValidDate = target.taxValidDate;
      isChanged = true;
    }

    if (target.calculatedTaxPotential && Number(record.taxPotential || 0) !== target.calculatedTaxPotential) {
      record.taxPotential = target.calculatedTaxPotential;
      isChanged = true;
    }

    if (target.paymentStatus && record.status !== target.paymentStatus) {
      record.status = target.paymentStatus;
      isChanged = true;
    }

    if (!isChanged) return;
    record.updatedAt = new Date().toISOString();
    sheet.getRange(index + 2, 1, 1, HEADERS.length).setValues([recordToRow_(record)]);
    changedRecords.push(record);
  });

  return changedRecords;
}

function getPlateKey_(value) {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function getLetterRank_(letterType) {
  return LETTER_SEQUENCE.indexOf(String(letterType || "").toUpperCase());
}

function getHigherLetterType_(firstLetter, secondLetter) {
  var firstRank = getLetterRank_(firstLetter);
  var secondRank = getLetterRank_(secondLetter);
  if (firstRank < 0) return secondRank < 0 ? "" : String(secondLetter || "").toUpperCase();
  if (secondRank < 0) return String(firstLetter || "").toUpperCase();
  return secondRank > firstRank ? String(secondLetter || "").toUpperCase() : String(firstLetter || "").toUpperCase();
}

function deleteRecords_(ids) {
  var idSet = {};
  ids.forEach(function (id) {
    if (id) idSet[String(id)] = true;
  });

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    var sheet = getSheet_();
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return;

    var values = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (var index = values.length - 1; index >= 0; index -= 1) {
      var id = String(values[index][0] || "");
      if (idSet[id]) sheet.deleteRow(index + 2);
    }
  } finally {
    lock.releaseLock();
  }
}

function getRowById_(sheet) {
  var rowById = {};
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return rowById;

  var ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  ids.forEach(function (row, index) {
    var id = String(row[0] || "");
    if (id) rowById[id] = index + 2;
  });
  return rowById;
}

function rowToRecord_(row) {
  var record = {};
  HEADERS.forEach(function (header, index) {
    record[header] = row[index] == null ? "" : row[index];
  });
  record.taxPotential = Number(String(record.taxPotential || "0").replace(/\D/g, ""));
  return normalizeRecord_(record);
}

function rowToProductionRecord_(row) {
  var record = {};
  PRODUCTION_HEADERS.forEach(function (header, index) {
    record[header] = row[index] == null ? "" : row[index];
  });
  return normalizeProductionRecord_(record, {});
}

function recordToRow_(record) {
  return HEADERS.map(function (header) {
    return record[header] == null ? "" : String(record[header]);
  });
}

function productionRecordToRow_(record) {
  return PRODUCTION_HEADERS.map(function (header) {
    return record[header] == null ? "" : String(record[header]);
  });
}

function normalizeRecord_(record) {
  return {
    id: String(record.id || ""),
    letterType: String(record.letterType || ""),
    taxValidDate: String(record.taxValidDate || ""),
    stnkValidDate: String(record.stnkValidDate || ""),
    plateNumber: String(record.plateNumber || ""),
    ownerName: cleanOwnerName_(record.ownerName),
    taxPotential: Number(record.taxPotential || 0),
    phone: String(record.phone || ""),
    status: String(record.status || "Belum bayar"),
    updatedAt: String(record.updatedAt || new Date().toISOString())
  };
}

function cleanOwnerName_(value) {
  var rawText = String(value || "").replace(/<br\s*\/?>/gi, "\n");
  var lines = rawText.split(/\r?\n/);
  var firstLine = "";

  for (var index = 0; index < lines.length; index += 1) {
    var candidate = String(lines[index] || "").toUpperCase().replace(/\s+/g, " ").trim();
    if (candidate) {
      firstLine = candidate;
      break;
    }
  }

  var ownerName = firstLine
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

function normalizeProductionScope_(scope) {
  return {
    letterType: String(scope.letterType || "SPOS").toUpperCase(),
    month: Number(scope.month || new Date().getMonth() + 1),
    year: Number(scope.year || new Date().getFullYear())
  };
}

function extractLastDate_(value) {
  var matches = String(value || "").match(/\d{2}\/\d{2}\/\d{4}/g) || [];
  return matches.length ? matches[matches.length - 1] : "";
}

function extractFirstDate_(value) {
  var matches = String(value || "").match(/\d{2}\/\d{2}\/\d{4}/g) || [];
  return matches.length ? matches[0] : "";
}

function dateTextToIso_(value) {
  var match = String(value || "").match(/(\d{2})\/(\d{2})\/(\d{4})/);
  return match ? [match[3], match[2], match[1]].join("-") : "";
}

function extractSiappTaxBaseFromSourceText_(value) {
  var parts = String(value || "").split("|").map(function (part) {
    return String(part || "").trim();
  });
  var directValue = Number(String(parts[4] || "0").replace(/\D/g, ""));
  if (directValue) return directValue;

  for (var index = 0; index < parts.length; index += 1) {
    if (/\d{1,2}\/\d{1,2}\/\d{4}/.test(parts[index])) continue;
    if (!/\d+\.\d{3}/.test(parts[index])) continue;
    var valueNumber = Number(String(parts[index] || "0").replace(/\D/g, ""));
    if (valueNumber >= 50000) return valueNumber;
  }

  return 0;
}

function extractSiappTaxValidDateFromSourceText_(value) {
  var parts = String(value || "").split("|").map(function (part) {
    return String(part || "").trim();
  });
  return dateTextToIso_(extractLastDate_(parts[3] || "") || extractLastDate_(value));
}

function extractSiappRecordedDateFromSourceText_(value) {
  var parts = String(value || "").split("|").map(function (part) {
    return String(part || "").trim();
  });
  return dateTextToIso_(extractFirstDate_(parts[5] || "") || extractFirstDate_(value));
}

function parseIsoDate_(value) {
  var match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function getIsoDatePart_(value) {
  var match = String(value || "").match(/^(\d{4}-\d{2}-\d{2})/);
  if (match) return match[1];
  var now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0")
  ].join("-");
}

function getDateDistance_(firstIso, secondIso) {
  var firstDate = parseIsoDate_(firstIso);
  var secondDate = parseIsoDate_(secondIso);
  if (!firstDate || !secondDate) return 999999;
  return Math.abs(Math.round((secondDate.getTime() - firstDate.getTime()) / 86400000));
}

function isProductionRecordNearTaxpayer_(productionRecord, taxpayerRecord) {
  var recordedDate = String(productionRecord.recordedDate || "") || extractSiappRecordedDateFromSourceText_(productionRecord.sourceText || "");
  if (!recordedDate) return false;
  var referenceDate = getIsoDatePart_(taxpayerRecord.updatedAt);
  return getDateDistance_(referenceDate, recordedDate) <= PRODUCTION_MATCH_WINDOW_DAYS;
}

function getLateMonthCount_(taxValidDate) {
  var validDate = parseIsoDate_(taxValidDate);
  if (!validDate) return 0;

  var now = new Date();
  var currentDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  var validStart = new Date(validDate.getFullYear(), validDate.getMonth(), validDate.getDate());
  if (currentDate <= validStart) return 0;

  var months = (currentDate.getFullYear() - validStart.getFullYear()) * 12;
  months += currentDate.getMonth() - validStart.getMonth();
  if (currentDate.getDate() > validStart.getDate()) months += 1;
  return Math.max(1, months);
}

function calculateLatePenalty_(taxValidDate) {
  var lateMonths = getLateMonthCount_(taxValidDate);
  return lateMonths ? Math.ceil(lateMonths / 3) * DENDA_RODA_4_PER_3_BULAN : 0;
}

function normalizeProductionRecord_(record, scope) {
  var normalizedScope = normalizeProductionScope_(scope || {});
  var letterType = String(record.letterType || normalizedScope.letterType || "SPOS").toUpperCase();
  var month = Number(record.month || normalizedScope.month);
  var year = Number(record.year || normalizedScope.year);
  var plateNumber = String(record.plateNumber || "").toUpperCase().trim();
  var plateKey = String(record.plateKey || plateNumber).toUpperCase().replace(/[^A-Z0-9]/g, "");
  var isPaid = parseBoolean_(record.isPaid) || String(record.status || "").toUpperCase() === "LUNAS";
  var taxBaseAmount = Number(String(record.taxBaseAmount || "0").replace(/\D/g, "")) || extractSiappTaxBaseFromSourceText_(record.sourceText || "");
  var taxValidDate = String(record.taxValidDate || "") || extractSiappTaxValidDateFromSourceText_(record.sourceText || "");
  var recordedDate = String(record.recordedDate || "") || extractSiappRecordedDateFromSourceText_(record.sourceText || "");
  var latePenalty = Number(String(record.latePenalty || "0").replace(/\D/g, "")) || (taxBaseAmount ? calculateLatePenalty_(taxValidDate) : 0);
  var jasaRaharja = Number(String(record.jasaRaharja || "0").replace(/\D/g, "")) || (taxBaseAmount ? JASA_RAHARJA_RODA_4 : 0);
  var calculatedTaxPotential = Number(String(record.calculatedTaxPotential || "0").replace(/\D/g, "")) || (taxBaseAmount ? taxBaseAmount + jasaRaharja + latePenalty : 0);

  return {
    id: String(record.id || [letterType, year, month, plateKey].join("-")),
    letterType: letterType,
    month: month,
    year: year,
    plateNumber: plateNumber,
    plateKey: plateKey,
    ownerName: cleanOwnerName_(record.ownerName),
    entryNumber: String(record.entryNumber || ""),
    status: String(record.status || (isPaid ? "Lunas" : "Belum terdeteksi lunas")),
    isPaid: isPaid,
    paidDate: String(record.paidDate || ""),
    sourceText: String(record.sourceText || ""),
    updatedAt: String(record.updatedAt || new Date().toISOString()),
    taxValidDate: taxValidDate,
    taxBaseAmount: taxBaseAmount,
    jasaRaharja: jasaRaharja,
    latePenalty: latePenalty,
    calculatedTaxPotential: calculatedTaxPotential,
    recordedDate: recordedDate
  };
}

function parseBoolean_(value) {
  var text = String(value || "").toLowerCase();
  return value === true || text === "true" || text === "1" || text === "ya";
}

function isSameProductionScope_(record, scope) {
  return record.letterType === scope.letterType && Number(record.month) === Number(scope.month) && Number(record.year) === Number(scope.year);
}

function json_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function output_(payload, e) {
  var callback = e && e.parameter ? e.parameter.callback : "";
  if (callback) {
    return ContentService
      .createTextOutput(callback + "(" + JSON.stringify(payload) + ");")
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return json_(payload);
}
