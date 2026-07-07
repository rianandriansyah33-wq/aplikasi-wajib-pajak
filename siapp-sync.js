(function () {
  const config = window.__WAJIB_PAJAK_SYNC_CONFIG || {};
  const googleScriptUrl = config.googleScriptUrl || "";
  const syncMode = config.syncMode === "full" ? "full" : config.syncMode === "watch" ? "watch" : "quick";
  const watchIntervalMs = Number(config.watchIntervalMs) || 60000;
  const jasaRaharjaRoda4 = 143000;
  const dendaRoda4Per3Bulan = 35000;
  const letterOrder = ["SPOS", "NPP", "NTP"];
  const monthMap = {
    JANUARI: 1,
    FEBRUARI: 2,
    MARET: 3,
    APRIL: 4,
    MEI: 5,
    JUNI: 6,
    JULI: 7,
    AGUSTUS: 8,
    SEPTEMBER: 9,
    OKTOBER: 10,
    NOVEMBER: 11,
    DESEMBER: 12
  };

  function delay(ms) {
    return new Promise(function (resolve) {
      window.setTimeout(resolve, ms);
    });
  }

  function normalizeText(value) {
    return String(value || "").toUpperCase().replace(/\s+/g, " ").trim();
  }

  function cleanOwnerName(value) {
    const rawText = String(value || "").replace(/<br\s*\/?>/gi, "\n");
    const firstLine = rawText.split(/\r?\n/)
      .map(function (line) {
        return normalizeText(line);
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

  function getCellText(cell) {
    const clone = cell.cloneNode(true);
    const ownerDocument = cell.ownerDocument || document;
    clone.querySelectorAll("br").forEach(function (breakElement) {
      breakElement.replaceWith(ownerDocument.createTextNode("\n"));
    });
    clone.querySelectorAll("div,p").forEach(function (blockElement) {
      blockElement.appendChild(ownerDocument.createTextNode("\n"));
    });
    return clone.textContent || cell.textContent || "";
  }

  function setStatus(message, color) {
    let element = document.getElementById("siapp-sync-status");
    if (!element) {
      element = document.createElement("div");
      element.id = "siapp-sync-status";
      element.style.cssText = "position:fixed;right:16px;top:16px;z-index:999999;padding:12px 14px;border-radius:8px;background:rgb(22,35,49);color:white;font:700 13px Arial,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.22);max-width:360px;line-height:1.4";
      document.body.appendChild(element);
    }
    element.textContent = message;
    element.style.background = color || "rgb(22,35,49)";
  }

  function formatPlate(value) {
    const compact = normalizeText(value).replace(/[^A-Z0-9]/g, "");
    const match = compact.match(/^([A-Z]{1,2})([0-9]{1,4})([A-Z]{1,3})$/);
    return match ? [match[1], match[2], match[3]].join(" ") : "";
  }

  function getPlateKey(value) {
    return formatPlate(value).replace(/\s/g, "") || String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  }

  function extractPlate(value) {
    const text = normalizeText(value).replace(/[^A-Z0-9\s]/g, " ");
    const matches = text.match(/\b[A-Z]{1,2}\s*\d{1,4}\s*[A-Z]{1,3}\b/g) || [];
    for (let index = 0; index < matches.length; index += 1) {
      const plate = formatPlate(matches[index]);
      if (plate) return plate;
    }
    return "";
  }

  function getRootText(root) {
    return normalizeText(root.body ? root.body.innerText : root.innerText || root.textContent || "");
  }

  function absoluteUrl(value, baseUrl) {
    return new URL(value || baseUrl, baseUrl || window.location.href).href;
  }

  function parseHtml(html, url) {
    const parser = new DOMParser();
    const parsedDocument = parser.parseFromString(html, "text/html");
    if (!parsedDocument.querySelector("table tr") && /<tr[\s>]/i.test(html)) {
      parsedDocument.body.innerHTML = "<table><tbody>" + html + "</tbody></table>";
    }
    parsedDocument.__siappUrl = url || window.location.href;
    return parsedDocument;
  }

  function normalizeLetter(value) {
    const text = normalizeText(value);
    if (text.includes("SPSO") || text.includes("SPOS")) return "SPOS";
    if (text.includes("NPP")) return "NPP";
    if (text.includes("NTP")) return "NTP";
    return "";
  }

  function getSelectedTexts(root) {
    return Array.from(root.querySelectorAll("select")).map(function (select) {
      const option = select.options[select.selectedIndex];
      return normalizeText(option ? option.textContent : select.value);
    });
  }

  function detectLetterType(root) {
    if (root && root.__siappLetterType) return root.__siappLetterType;
    const text = getRootText(root) + " " + getSelectedTexts(root).join(" ");
    return normalizeLetter(text) || "SPOS";
  }

  function getSelects(root) {
    return Array.from(root.querySelectorAll("select"));
  }

  function getOptionText(option) {
    return normalizeText(option ? option.textContent || option.label || option.value : "");
  }

  function findMonthSelect(root) {
    return getSelects(root).find(function (select) {
      return Array.from(select.options).filter(function (option) {
        return Boolean(monthMap[getOptionText(option)]);
      }).length >= 2;
    }) || null;
  }

  function findYearSelect(root) {
    return getSelects(root).find(function (select) {
      return Array.from(select.options).some(function (option) {
        return /\b20\d{2}\b/.test(getOptionText(option));
      });
    }) || null;
  }

  function findPerPageSelect(root, yearSelect) {
    return getSelects(root).find(function (select) {
      if (select === yearSelect) return false;
      const numbers = Array.from(select.options).map(function (option) {
        return Number(String(option.value || option.textContent || "").replace(/\D/g, ""));
      }).filter(Boolean);
      return numbers.length && Math.max.apply(null, numbers) >= 50 && Math.max.apply(null, numbers) <= 500;
    }) || null;
  }

  function getMonthOptions(select) {
    if (!select) return [{ value: String(new Date().getMonth() + 1), label: String(new Date().getMonth() + 1) }];
    return Array.from(select.options).map(function (option) {
      const label = getOptionText(option);
      return {
        value: option.value,
        label: label,
        month: monthMap[label]
      };
    }).filter(function (item) {
      return Boolean(item.month);
    });
  }

  function getYearOptions(select) {
    if (!select) return [{ value: String(new Date().getFullYear()), label: String(new Date().getFullYear()) }];
    return Array.from(select.options).map(function (option) {
      const label = getOptionText(option);
      const match = label.match(/\b20\d{2}\b/);
      return {
        value: option.value,
        label: match ? match[0] : "",
        year: match ? Number(match[0]) : 0
      };
    }).filter(function (item) {
      return Boolean(item.year);
    });
  }

  function getMaxPerPageValue(select) {
    if (!select) return "";
    const options = Array.from(select.options).map(function (option) {
      return {
        value: option.value,
        number: Number(String(option.value || option.textContent || "").replace(/\D/g, ""))
      };
    }).filter(function (item) {
      return Boolean(item.number);
    }).sort(function (first, second) {
      return second.number - first.number;
    });
    return options.length ? options[0].value : "";
  }

  function detectMonth(root) {
    if (root && root.__siappMonth) return root.__siappMonth;
    const selectedTexts = getSelectedTexts(root);
    for (let index = 0; index < selectedTexts.length; index += 1) {
      if (monthMap[selectedTexts[index]]) return monthMap[selectedTexts[index]];
    }
    const text = getRootText(root);
    const monthName = Object.keys(monthMap).find(function (name) {
      return text.includes(name);
    });
    return monthName ? monthMap[monthName] : new Date().getMonth() + 1;
  }

  function detectYear(root) {
    if (root && root.__siappYear) return root.__siappYear;
    const selectedTexts = getSelectedTexts(root).join(" ");
    const selectedMatch = selectedTexts.match(/\b20\d{2}\b/);
    if (selectedMatch) return Number(selectedMatch[0]);
    const pageMatch = getRootText(root).match(/\b20\d{2}\b/);
    return pageMatch ? Number(pageMatch[0]) : new Date().getFullYear();
  }

  function getPaidInfo(cells) {
    const rowText = normalizeText(cells.join(" "));
    const dateColumn = normalizeText(cells[5] || "");
    const statusColumn = normalizeText(cells[6] || "");
    const dateMatches = dateColumn.match(/\d{2}\/\d{2}\/\d{4}/g) || [];
    const hasPaidWord = /\b(LUNAS|SUDAH BAYAR|TERBAYAR|PAID)\b/.test(rowText + " " + statusColumn);
    const isPaid = hasPaidWord || dateMatches.length >= 3;

    return {
      isPaid: isPaid,
      status: isPaid ? "Lunas" : "Belum terdeteksi lunas",
      paidDate: isPaid && dateMatches.length ? dateMatches[dateMatches.length - 1] : ""
    };
  }

  function getNominalNumber(value) {
    return Number(String(value || "").replace(/\D/g, ""));
  }

  function toIsoDate(value) {
    const match = String(value || "").match(/(\d{2})\/(\d{2})\/(\d{4})/);
    if (!match) return "";
    return [match[3], match[2], match[1]].join("-");
  }

  function extractLastDate(value) {
    const matches = String(value || "").match(/\d{2}\/\d{2}\/\d{4}/g) || [];
    return matches.length ? matches[matches.length - 1] : "";
  }

  function extractTaxBaseAmount(cells) {
    const directValue = getNominalNumber(cells[4] || "");
    if (directValue) return directValue;

    for (let index = 0; index < cells.length; index += 1) {
      const cellText = String(cells[index] || "");
      if (/\d{1,2}\/\d{1,2}\/\d{4}/.test(cellText)) continue;
      if (!/\d+\.\d{3}/.test(cellText)) continue;
      const value = getNominalNumber(cellText);
      if (value >= 50000) return value;
    }

    return 0;
  }

  function extractTaxValidDate(cells) {
    const primaryDate = extractLastDate(cells[3] || "");
    if (primaryDate) return toIsoDate(primaryDate);

    for (let index = 0; index < cells.length; index += 1) {
      const value = extractLastDate(cells[index] || "");
      if (value) return toIsoDate(value);
    }

    return "";
  }

  function parseIsoDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return null;
    const parts = String(value).split("-").map(Number);
    const date = new Date(parts[0], parts[1] - 1, parts[2]);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function getLateMonthCount(taxValidDate) {
    const validDate = parseIsoDate(taxValidDate);
    if (!validDate) return 0;
    const currentDate = new Date();
    const currentStart = new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate());
    const validStart = new Date(validDate.getFullYear(), validDate.getMonth(), validDate.getDate());
    if (currentStart <= validStart) return 0;

    let months = (currentStart.getFullYear() - validStart.getFullYear()) * 12;
    months += currentStart.getMonth() - validStart.getMonth();
    if (currentStart.getDate() > validStart.getDate()) months += 1;
    return Math.max(1, months);
  }

  function calculateLatePenalty(taxValidDate) {
    const lateMonths = getLateMonthCount(taxValidDate);
    return lateMonths ? Math.ceil(lateMonths / 3) * dendaRoda4Per3Bulan : 0;
  }

  function calculateTaxPotential(baseAmount, taxValidDate) {
    const base = Number(baseAmount || 0);
    if (!base) return 0;
    return base + jasaRaharjaRoda4 + calculateLatePenalty(taxValidDate);
  }

  function parseRows(root) {
    const rows = Array.from(root.querySelectorAll("table tr"));
    const recordsByPlate = {};
    const letterType = detectLetterType(root);
    const month = detectMonth(root);
    const year = detectYear(root);

    rows.forEach(function (row) {
      const cells = Array.from(row.cells || []).map(getCellText);
      if (cells.length < 2) return;

      const plateNumber = extractPlate(cells[1]) || extractPlate(cells.join(" "));
      const plateKey = getPlateKey(plateNumber);
      if (!plateNumber || !plateKey) return;

      const payment = getPaidInfo(cells);
      const ownerName = cleanOwnerName(cells[2] || "");
      const entryMatch = String(cells[1] || "").match(/\d{6,}/);
      const taxBaseAmount = extractTaxBaseAmount(cells);
      const taxValidDate = extractTaxValidDate(cells);
      const latePenalty = calculateLatePenalty(taxValidDate);
      const calculatedTaxPotential = calculateTaxPotential(taxBaseAmount, taxValidDate);

      recordsByPlate[plateKey] = {
        id: [letterType, year, month, plateKey].join("-"),
        letterType: letterType,
        month: month,
        year: year,
        plateNumber: plateNumber,
        plateKey: plateKey,
        ownerName: ownerName,
        entryNumber: entryMatch ? entryMatch[0] : "",
        status: payment.status,
        isPaid: payment.isPaid,
        paidDate: payment.paidDate,
        taxValidDate: taxValidDate,
        taxBaseAmount: taxBaseAmount,
        jasaRaharja: taxBaseAmount ? jasaRaharjaRoda4 : 0,
        latePenalty: taxBaseAmount ? latePenalty : 0,
        calculatedTaxPotential: calculatedTaxPotential,
        sourceText: normalizeText(cells.join(" | ")).slice(0, 900),
        updatedAt: new Date().toISOString()
      };
    });

    return {
      scope: { letterType: letterType, month: month, year: year },
      records: Object.keys(recordsByPlate).map(function (plateKey) {
        return recordsByPlate[plateKey];
      })
    };
  }

  function mergeParsedPages(pages) {
    const recordsById = {};
    let scope = pages[0] ? pages[0].scope : { letterType: detectLetterType(document), month: detectMonth(document), year: detectYear(document) };

    pages.forEach(function (page) {
      scope = page.scope || scope;
      page.records.forEach(function (record) {
        recordsById[record.id] = record;
      });
    });

    return {
      scope: scope,
      records: Object.keys(recordsById).map(function (id) {
        return recordsById[id];
      })
    };
  }

  function isVisible(element) {
    if (!element.getBoundingClientRect) return true;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function getPaginationLinks(root, baseUrl) {
    const linksByUrl = {};
    Array.from(root.querySelectorAll("a[href]")).forEach(function (link) {
      const text = normalizeText(link.textContent);
      if (!/^\d+$/.test(text)) return;
      if (link.closest("table")) return;
      if (root === document && !isVisible(link)) return;

      const href = link.getAttribute("href") || "";
      if (!href || href === "#" || href.toLowerCase().startsWith("javascript:")) return;

      const url = absoluteUrl(href, baseUrl);
      if (new URL(url).origin !== window.location.origin) return;
      linksByUrl[url] = Number(text);
    });

    return Object.keys(linksByUrl).map(function (url) {
      return { url: url, page: linksByUrl[url] };
    }).sort(function (first, second) {
      return first.page - second.page;
    });
  }

  async function fetchDocument(url, options) {
    const response = await fetch(url, Object.assign({
      credentials: "include"
    }, options || {}));
    const html = await response.text();
    return parseHtml(html, response.url || url);
  }

  function withForcedScope(parsedDocument, target, filter) {
    parsedDocument.__siappLetterType = target.letterType;
    parsedDocument.__siappMonth = filter.month;
    parsedDocument.__siappYear = filter.year;
    return parsedDocument;
  }

  function getDirectEndpointFallback(letterType) {
    if (letterType === "NTP") return "/view/vBNTP.php";
    if (letterType === "NPP") return "/view/vBNPP.php";
    if (letterType === "SPOS") return "/view/vBSPSO.php";
    return "";
  }

  function findDirectEndpointUrl(root, letterType, baseUrl) {
    const expected = letterType === "SPOS" ? ["SPSO", "SPOS"] : [letterType];
    const html = root && root.documentElement ? root.documentElement.innerHTML : "";
    const matches = html.match(/["']([^"']*vB[^"']+?\.php)["']/gi) || [];
    const candidates = matches.map(function (match) {
      return match.replace(/^["']|["']$/g, "");
    }).filter(function (candidate) {
      const upper = candidate.toUpperCase();
      return expected.some(function (token) {
        return upper.includes(token);
      });
    });

    if (candidates.length) return absoluteUrl(candidates[0], baseUrl || window.location.href);

    const fallback = getDirectEndpointFallback(letterType);
    return fallback ? absoluteUrl(fallback, window.location.origin) : "";
  }

  function getEndpointMonthValue(filter) {
    const month = Number(filter.month || filter.monthValue || new Date().getMonth() + 1);
    return String(month).padStart(2, "0");
  }

  function buildEndpointPayload(filter) {
    const data = new URLSearchParams();
    data.set("bulan", getEndpointMonthValue(filter));
    data.set("tahun", String(filter.year || filter.yearLabel || new Date().getFullYear()));
    data.set("page", String(filter.perPageValue || 100));
    return data;
  }

  async function fetchDirectEndpointDocument(target, filter, sourceDocument) {
    const endpointUrl = findDirectEndpointUrl(sourceDocument, target.letterType, target.url);
    if (!endpointUrl) return null;

    const response = await fetch(endpointUrl, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest"
      },
      body: buildEndpointPayload(filter).toString()
    });

    if (!response.ok) return null;
    const html = await response.text();
    if (!html || !html.trim()) return null;
    return withForcedScope(parseHtml(html, response.url || endpointUrl), target, filter);
  }

  async function collectDirectEndpointRecords(target, filter, sourceDocument) {
    const firstDocument = await fetchDirectEndpointDocument(target, filter, sourceDocument);
    if (!firstDocument) return null;

    const pages = [parseRows(firstDocument)];
    const pageLinks = getPaginationLinks(firstDocument, firstDocument.__siappUrl || target.url);

    for (let pageIndex = 0; pageIndex < pageLinks.length; pageIndex += 1) {
      const pageLink = pageLinks[pageIndex];
      setStatus("Endpoint SIAPP - " + target.letterType + " " + filter.monthLabel + " " + filter.yearLabel + " halaman " + pageLink.page);
      const pageDocument = withForcedScope(await fetchDocument(pageLink.url), target, filter);
      pages.push(parseRows(pageDocument));
    }

    return mergeParsedPages(pages);
  }

  function getWorkerFrame() {
    let frame = document.getElementById("siapp-sync-worker-frame");
    if (!frame) {
      frame = document.createElement("iframe");
      frame.id = "siapp-sync-worker-frame";
      frame.style.cssText = "position:fixed;left:-10px;bottom:-10px;width:1px;height:1px;border:0;opacity:.01;pointer-events:none";
      document.body.appendChild(frame);
    }
    return frame;
  }

  function waitForFrameLoad(frame, timeoutMs) {
    return new Promise(function (resolve) {
      let done = false;
      const timer = window.setTimeout(function () {
        finish(false);
      }, timeoutMs || 10000);

      function finish(value) {
        if (done) return;
        done = true;
        window.clearTimeout(timer);
        frame.removeEventListener("load", onLoad);
        resolve(value);
      }

      function onLoad() {
        finish(true);
      }

      frame.addEventListener("load", onLoad);
    });
  }

  async function loadFrameDocument(frame, url) {
    const loaded = waitForFrameLoad(frame, 15000);
    frame.src = url;
    await loaded;
    await delay(250);
    if (!frame.contentDocument) throw new Error("Halaman SIAPP tidak bisa dibaca di iframe.");
    frame.contentDocument.__siappUrl = frame.contentWindow.location.href;
    return frame.contentDocument;
  }

  function setSelectValue(select, value) {
    if (!select || value == null || value === "") return;
    select.value = value;
    select.dispatchEvent(new Event("input", { bubbles: true }));
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }

  async function submitFrameFilter(frame, filter) {
    let frameDocument = frame.contentDocument;
    const controls = getControlSet(frameDocument);
    setSelectValue(controls.monthSelect, filter.monthValue);
    setSelectValue(controls.yearSelect, filter.yearValue);
    setSelectValue(controls.perPageSelect, filter.perPageValue || getMaxPerPageValue(controls.perPageSelect));

    const loaded = waitForFrameLoad(frame, 7000);
    if (controls.submitControl) {
      controls.submitControl.click();
    } else if (controls.form && typeof controls.form.requestSubmit === "function") {
      controls.form.requestSubmit();
    } else if (controls.form) {
      controls.form.submit();
    } else {
      throw new Error("Tombol Lihat tidak ditemukan.");
    }

    await Promise.race([loaded, delay(1800)]);
    await delay(450);
    frameDocument = frame.contentDocument;
    frameDocument.__siappUrl = frame.contentWindow.location.href;
    return frameDocument;
  }

  function getTargetFiltersFromDocument(targetDocument) {
    const controls = getControlSet(targetDocument);
    const monthOptions = getMonthOptions(controls.monthSelect);
    const yearOptions = getYearOptions(controls.yearSelect);
    const perPageValue = getMaxPerPageValue(controls.perPageSelect);
    const filters = [];

    monthOptions.forEach(function (monthOption) {
      yearOptions.forEach(function (yearOption) {
        filters.push({
          month: monthOption.month,
          monthValue: monthOption.value,
          monthLabel: monthOption.label,
          year: yearOption.year,
          yearValue: yearOption.value,
          yearLabel: yearOption.label,
          perPageValue: perPageValue
        });
      });
    });

    return filters;
  }

  function getCurrentFilterFromDocument(targetDocument) {
    const controls = getControlSet(targetDocument);
    const monthOption = controls.monthSelect ? controls.monthSelect.options[controls.monthSelect.selectedIndex] : null;
    const yearOption = controls.yearSelect ? controls.yearSelect.options[controls.yearSelect.selectedIndex] : null;
    const monthLabel = getOptionText(monthOption) || String(detectMonth(targetDocument));
    const yearLabel = getOptionText(yearOption) || String(detectYear(targetDocument));
    const yearMatch = yearLabel.match(/\b20\d{2}\b/);

    return [{
      month: monthMap[monthLabel] || detectMonth(targetDocument),
      monthValue: controls.monthSelect ? controls.monthSelect.value : "",
      monthLabel: monthLabel,
      year: yearMatch ? Number(yearMatch[0]) : detectYear(targetDocument),
      yearValue: controls.yearSelect ? controls.yearSelect.value : "",
      yearLabel: yearMatch ? yearMatch[0] : yearLabel,
      perPageValue: getMaxPerPageValue(controls.perPageSelect)
    }];
  }

  async function collectFramePaginationRecords(frame, baseParsed) {
    const frameDocument = frame.contentDocument;
    const pages = [baseParsed];
    const pageLinks = getPaginationLinks(frameDocument, frameDocument.__siappUrl || frame.contentWindow.location.href);

    for (let pageIndex = 0; pageIndex < pageLinks.length; pageIndex += 1) {
      const pageLink = pageLinks[pageIndex];
      if (pageLink.url === (frameDocument.__siappUrl || frame.contentWindow.location.href)) continue;
      const pageDocument = await loadFrameDocument(frame, pageLink.url);
      pages.push(parseRows(pageDocument));
    }

    return mergeParsedPages(pages);
  }

  function getControlSet(root) {
    const monthSelect = findMonthSelect(root);
    const yearSelect = findYearSelect(root);
    const perPageSelect = findPerPageSelect(root, yearSelect);
    const controls = [monthSelect, yearSelect, perPageSelect].filter(Boolean);
    const form = controls.map(function (control) {
      return control.closest("form");
    }).find(Boolean) || root.querySelector("form");

    return {
      form: form,
      monthSelect: monthSelect,
      yearSelect: yearSelect,
      perPageSelect: perPageSelect,
      submitControl: findSubmitControl(root, form)
    };
  }

  function findSubmitControl(root, form) {
    const scope = form || root;
    const controls = Array.from(scope.querySelectorAll("button, input[type='submit'], input[type='button'], input[type='image']"));
    return controls.find(function (control) {
      const text = normalizeText(control.textContent || control.value || control.getAttribute("title") || "");
      return text.includes("LIHAT") || text.includes("TAMPIL");
    }) || controls.find(function (control) {
      return String(control.type || "").toLowerCase() === "submit";
    }) || null;
  }

  function setDataValue(data, select, value) {
    if (!select || !value) return;
    if (select.name) data.set(select.name, value);
    else if (select.id) data.set(select.id, value);
  }

  function setSubmitValue(data, submitControl) {
    if (!submitControl || !submitControl.name) return;
    data.set(submitControl.name, submitControl.value || submitControl.textContent || "Lihat");
  }

  function makeRequest(actionUrl, method, data) {
    if (method === "POST") {
      return {
        url: actionUrl,
        options: {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"
          },
          body: data.toString()
        }
      };
    }

    const url = new URL(actionUrl);
    data.forEach(function (value, key) {
      url.searchParams.set(key, value);
    });

    return {
      url: url.href,
      options: { method: "GET" }
    };
  }

  function buildFilterRequests(root, baseUrl, filter) {
    const controls = getControlSet(root);
    const data = new URLSearchParams();
    let method = "GET";
    let actionUrl = baseUrl;

    if (controls.form) {
      method = String(controls.form.method || "GET").toUpperCase();
      actionUrl = absoluteUrl(controls.form.getAttribute("action") || baseUrl, baseUrl);
      Array.from(new FormData(controls.form)).forEach(function (entry) {
        data.set(entry[0], entry[1]);
      });
    }

    setDataValue(data, controls.monthSelect, filter.monthValue);
    setDataValue(data, controls.yearSelect, filter.yearValue);
    setDataValue(data, controls.perPageSelect, filter.perPageValue);
    setSubmitValue(data, controls.submitControl);

    const requests = [makeRequest(actionUrl, method, data)];
    const alternateMethod = method === "POST" ? "GET" : "POST";
    requests.push(makeRequest(actionUrl, alternateMethod, data));
    if (actionUrl !== baseUrl) {
      requests.push(makeRequest(baseUrl, method, data));
      requests.push(makeRequest(baseUrl, alternateMethod, data));
    }

    const seen = {};
    return requests.filter(function (request) {
      const key = request.options.method + "|" + request.url + "|" + (request.options.body || "");
      if (seen[key]) return false;
      seen[key] = true;
      return true;
    });
  }

  async function fetchFilteredDocument(target, filter) {
    const requests = buildFilterRequests(target.document, target.url, filter);
    let firstDocument = null;

    for (let index = 0; index < requests.length; index += 1) {
      const request = requests[index];
      const fetchedDocument = await fetchDocument(request.url, request.options);
      if (!firstDocument) firstDocument = fetchedDocument;
      if (parseRows(fetchedDocument).records.length) return fetchedDocument;
    }

    return firstDocument;
  }

  function discoverProductionTargets() {
    const targetsByLetter = {};
    Array.from(document.querySelectorAll("a[href]")).forEach(function (link) {
      const text = normalizeText(link.textContent);
      if (!text.includes("BUKU PRODUKSI")) return;
      const letterType = normalizeLetter(text);
      if (!letterType) return;
      targetsByLetter[letterType] = absoluteUrl(link.getAttribute("href"), window.location.href);
    });

    const currentLetter = detectLetterType(document);
    if (!targetsByLetter[currentLetter]) {
      targetsByLetter[currentLetter] = window.location.href;
    }

    return letterOrder.filter(function (letterType) {
      return Boolean(targetsByLetter[letterType]);
    }).map(function (letterType) {
      return {
        letterType: letterType,
        url: targetsByLetter[letterType]
      };
    });
  }

  async function prepareTargets() {
    const targets = discoverProductionTargets();
    const preparedTargets = [];

    for (let index = 0; index < targets.length; index += 1) {
      const target = targets[index];
      setStatus("Membuka menu " + target.letterType + "...");
      const targetDocument = target.url === window.location.href ? document : await fetchDocument(target.url);
      const controls = getControlSet(targetDocument);
      const monthOptions = getMonthOptions(controls.monthSelect);
      const yearOptions = getYearOptions(controls.yearSelect);
      const perPageValue = getMaxPerPageValue(controls.perPageSelect);
      const filters = [];

      monthOptions.forEach(function (monthOption) {
        yearOptions.forEach(function (yearOption) {
          filters.push({
            month: monthOption.month,
            monthValue: monthOption.value,
            monthLabel: monthOption.label,
            year: yearOption.year,
            yearValue: yearOption.value,
            yearLabel: yearOption.label,
            perPageValue: perPageValue
          });
        });
      });

      preparedTargets.push(Object.assign({}, target, {
        document: targetDocument,
        filters: filters
      }));
    }

    return preparedTargets;
  }

  async function sendRecords(scope, records) {
    if (!records.length) return;
    await fetch(googleScriptUrl, {
      method: "POST",
      mode: "no-cors",
      redirect: "follow",
      headers: {
        "Content-Type": "text/plain;charset=utf-8"
      },
      body: JSON.stringify({
        action: "upsertProduction",
        scope: scope,
        productionRecords: records
      })
    });
  }

  async function collectFilterRecords(target, filter, progressText) {
    setStatus(progressText + " - " + target.letterType + " " + filter.monthLabel + " " + filter.yearLabel);
    const filteredDocument = await fetchFilteredDocument(target, filter);
    const pages = [parseRows(filteredDocument)];
    const pageLinks = getPaginationLinks(filteredDocument, filteredDocument.__siappUrl || target.url);

    for (let pageIndex = 0; pageIndex < pageLinks.length; pageIndex += 1) {
      const pageLink = pageLinks[pageIndex];
      if (pageLink.url === (filteredDocument.__siappUrl || target.url)) continue;
      setStatus(progressText + " - " + target.letterType + " " + filter.monthLabel + " " + filter.yearLabel + " halaman " + pageLink.page);
      const pageDocument = await fetchDocument(pageLink.url);
      pages.push(parseRows(pageDocument));
    }

    return mergeParsedPages(pages);
  }

  async function run(options) {
    const settings = options || {};
    const isFullSync = syncMode === "full";
    const isWatchSync = syncMode === "watch";
    setStatus(isFullSync ? "Menyiapkan Sinkron SIAPP lengkap..." : isWatchSync ? "Memantau SIAPP..." : "Menyiapkan Sinkron SIAPP cepat...");

    if (!googleScriptUrl) {
      setStatus("URL Google Apps Script belum tersedia.", "rgb(180,35,24)");
      if (!settings.silent) alert("URL Google Apps Script belum tersedia.");
      return;
    }

    try {
      const targets = isFullSync ? discoverProductionTargets() : [{
        letterType: detectLetterType(document),
        url: window.location.href
      }];
      if (!targets.length) {
        setStatus("Menu Buku Produksi tidak ditemukan.", "rgb(180,35,24)");
        if (!settings.silent) alert("Menu Buku Produksi tidak ditemukan di halaman SIAPP.");
        return;
      }

      if (isFullSync) {
        const targetNames = targets.map(function (target) {
          return target.letterType;
        }).join(", ");

        const approved = confirm("Sinkron lengkap akan membaca menu " + targetNames + ", semua bulan, semua tahun, dan halaman yang tersedia. Proses bisa lama. Lanjutkan?");
        if (!approved) {
          setStatus("Sinkron SIAPP dibatalkan.", "rgb(107,114,128)");
          return;
        }
      }

      let frame = null;
      let filterNumber = 0;
      let totalFilters = 0;
      let totalRecords = 0;

      for (let targetIndex = 0; targetIndex < targets.length; targetIndex += 1) {
        const target = targets[targetIndex];
        setStatus("Membuka menu " + target.letterType + "...");
        const targetDocument = target.url === window.location.href ? document : await fetchDocument(target.url);
        const filters = isFullSync ? getTargetFiltersFromDocument(targetDocument) : getCurrentFilterFromDocument(document);
        let frameLoaded = false;
        totalFilters += filters.length;

        for (let filterIndex = 0; filterIndex < filters.length; filterIndex += 1) {
          filterNumber += 1;
          const filter = filters[filterIndex];
          const progressText = isFullSync ? "Sinkron lengkap " + filterNumber + "/" + (totalFilters || "?") : isWatchSync ? "Pantau otomatis" : "Sinkron cepat";
          setStatus(progressText + " - " + target.letterType + " " + filter.monthLabel + " " + filter.yearLabel);
          let parsed = await collectDirectEndpointRecords(target, filter, targetDocument);

          if (!parsed) {
            if (!frame) frame = getWorkerFrame();
            if (!frameLoaded) {
              await loadFrameDocument(frame, target.url);
              frameLoaded = true;
            }
            const filteredDocument = await submitFrameFilter(frame, filter);
            const parsedBase = parseRows(withForcedScope(filteredDocument, target, filter));
            parsed = await collectFramePaginationRecords(frame, parsedBase);
          }

          if (parsed.records.length) {
            await sendRecords(parsed.scope, parsed.records);
            totalRecords += parsed.records.length;
            await delay(180);
          }
        }
      }

      if (isWatchSync) {
        setStatus("Pantau aktif. Sinkron terakhir mengirim " + totalRecords + " data. Berikutnya otomatis tiap " + Math.round(watchIntervalMs / 60000) + " menit.", "rgb(22,101,52)");
      } else {
        setStatus("Sinkron selesai. " + totalRecords + " data SIAPP dikirim.", "rgb(22,101,52)");
        if (!settings.silent) alert("Sinkron SIAPP selesai. " + totalRecords + " data dikirim ke aplikasi.");
      }
    } catch (error) {
      console.error(error);
      setStatus("Sinkron SIAPP gagal: " + (error && error.message ? error.message : "periksa koneksi"), "rgb(180,35,24)");
      if (!settings.silent) alert("Sinkron SIAPP gagal. Coba ulangi, atau kirim screenshot pesan di kanan atas.");
    }
  }

  if (syncMode === "watch") {
    if (window.__WAJIB_PAJAK_SYNC_WATCH_TIMER) {
      window.clearInterval(window.__WAJIB_PAJAK_SYNC_WATCH_TIMER);
      window.__WAJIB_PAJAK_SYNC_WATCH_TIMER = null;
      setStatus("Pantau otomatis dihentikan.", "rgb(107,114,128)");
      return;
    }

    async function runWatchTick() {
      if (window.__WAJIB_PAJAK_SYNC_WATCH_RUNNING) return;
      window.__WAJIB_PAJAK_SYNC_WATCH_RUNNING = true;
      try {
        await run({ silent: true });
      } finally {
        window.__WAJIB_PAJAK_SYNC_WATCH_RUNNING = false;
      }
    }

    runWatchTick();
    window.__WAJIB_PAJAK_SYNC_WATCH_TIMER = window.setInterval(function () {
      runWatchTick();
    }, watchIntervalMs);
  } else {
    run();
  }
})();
