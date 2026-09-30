const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const source = fs.readFileSync(path.join(__dirname, "../siapp-vehicle-detail.js"), "utf8");
const instrumented = source.replace('  if (!supabaseUrl || !publishableKey) {', `
  window.detailTest = { endpointsFromScript, findStatusPageUrl, getStatusPageEndpoints,
    fetchVehicleDetail, parsePhoneResponse, detectCurrentLetterType };
  return;
  if (!supabaseUrl || !publishableKey) {`);
const origin = "https://siapp.dipendajatim.go.id";
const dbOrigin = "https://database.example.test";
const menu = '<a href="idxstaf.php?id=12">Status SPSO</a><a href="idxstaf.php?id=22">Status NPP</a><a href="idxstaf.php?id=32">Status NTP</a>';

// Table structure matches the Status NTP response supplied by the user.
function vehicleHtml(plate = "L 8083 UE", type = "NTP") {
  return `<table>
    <tr><td>Nopol</td><td>:</td><td>${plate}</td><td></td></tr>
    <tr><td>Nama</td><td>:</td><td colspan="2">CONTOH PEMILIK</td></tr>
    <tr><td>Alamat</td><td>:</td><td colspan="3">ALAMAT UJI</td></tr>
    <tr><td>Kecamatan/Desa</td><td>:</td><td>MULYOREJO/KEL DK.SUTOREJO</td></tr>
    <tr><td>Jenis</td><td>:</td><td>TRUCK TANGKI</td></tr>
    <tr><td>Merk/Type</td><td>:</td><td>MITSUBISHI/FE74HDV 4X2 MT</td></tr>
    <tr><td>Th Buat/Warna</td><td>:</td><td>2017 / KUNING</td></tr>
  </table><table><thead><tr><td>Kohir</td><td>Tgl Masa Laku</td><td>Tgl Masa STNK</td><td>Tgl ${type}</td><td>PKB</td><td>Opsen</td><td>JUMLAH</td></tr></thead>
  <tbody><tr><td>106563/2022</td><td>31/07/2026</td><td>31/07/2027</td><td>29/09/2026</td><td>3.782.500</td><td>2.496.500</td><td>6.279.000</td></tr></tbody></table>`;
}

const sourceRow = { id: "test-card", plate_key: "L8083UE", plate_number: "L 8083 UE", letter_type: "NTP", phone: "" };
let browser;
let passed = 0;

async function setup(overrides = {}, full = false) {
  const page = await browser.newPage();
  const calls = [];
  const fixtures = Object.assign({
    "/idxstaf.php": menu,
    "/idxstaf.php?id=32": menu + '<h4>Status NTP</h4><script>window.urls={detail:"view/vstatntp.php",phone:"contacts/gethpntp.php"};</script>',
    "/idxstaf.php?id=22": menu + '<h4>Status NPP</h4><script src="assets/status-npp.js"></script>',
    "/idxstaf.php?id=12": menu + '<h4>Status SPSO</h4><script>window.urls={detail:"view/vstatspos.php",phone:"contacts/gethpspos.php"};</script>',
    "/assets/status-npp.js": 'window.urls={detail:"view/vstatnpp.php",phone:"contacts/gethpnpp.php"};',
    "/view/vstatntp.php": vehicleHtml(),
    "/view/vstatnpp.php": "",
    "/view/vstatspos.php": "",
    "/contacts/gethpntp.php": '{"nohp":"081200000000"}',
    "/contacts/gethpnpp.php": "",
    "/contacts/gethpspos.php": "",
    "/rest/v1/vehicle_details:GET": [],
    "/rest/v1/taxpayers:GET": [sourceRow],
    "/rest/v1/vehicle_details:POST": { status: 204, body: "" },
    "/rest/v1/taxpayers:PATCH": { status: 204, body: "" }
  }, overrides);
  await page.route("**/*", async route => {
    const request = route.request();
    const url = new URL(request.url());
    calls.push({ url: request.url(), method: request.method(), body: request.postData() });
    const key = url.origin === dbOrigin ? url.pathname + ":" + request.method() : url.pathname + url.search;
    const fixture = fixtures[key];
    if (fixture === undefined || ![origin, dbOrigin].includes(url.origin)) {
      return route.fulfill({ status: 404, body: "Not found" });
    }
    const status = fixture && fixture.status || 200;
    const body = fixture && fixture.status ? fixture.body : typeof fixture === "string" ? fixture : JSON.stringify(fixture);
    await route.fulfill({ status, body, headers: {
      "Content-Type": url.origin === dbOrigin ? "application/json" : "text/html",
      "Access-Control-Allow-Origin": "*"
    } });
  });
  await page.goto(origin + "/idxstaf.php");
  await page.evaluate(db => {
    window.__WAJIB_PAJAK_VEHICLE_DETAIL_CONFIG = {
      supabaseUrl: db, supabasePublishableKey: "test-key", vehicleDetailMode: "batch"
    };
    window.confirm = () => true;
  }, dbOrigin);
  await page.addScriptTag({ content: full ? source : instrumented });
  return { page, calls };
}

async function test(name, fn) {
  await fn();
  passed += 1;
  process.stdout.write("PASS " + name + "\n");
}

async function getDetail(page) {
  return page.evaluate(() => window.detailTest.fetchVehicleDetail({ plateNumber: "L 8083 UE", letterType: "NTP" }));
}

(async () => {
  browser = await chromium.launch({ channel: "chrome", headless: true });
  await test("preserves relative folders, case and base URL; ignores off-origin URLs", async () => {
    const { page } = await setup();
    const found = await page.evaluate(() => window.detailTest.endpointsFromScript(`
      url: "view/vstatntp.php"; url: './contacts/gethpntp.php'; url: '../view/vstatNTP.php';
      url: 'https://other.example/gethpntp.php';`, "NTP", location.origin + "/folder/page.php"));
    assert.deepEqual(found.detail, [origin + "/folder/view/vstatntp.php", origin + "/view/vstatNTP.php"]);
    assert.deepEqual(found.phone, [origin + "/folder/contacts/gethpntp.php"]);
    await page.close();
  });
  await test("discovers status links and endpoints in external scripts", async () => {
    const { page, calls } = await setup();
    const found = await page.evaluate(async () => {
      const url = window.detailTest.findStatusPageUrl("NPP");
      const endpoints = await window.detailTest.getStatusPageEndpoints("NPP");
      await window.detailTest.getStatusPageEndpoints("NPP");
      return { url, endpoints };
    });
    assert.equal(found.url, origin + "/idxstaf.php?id=22");
    assert.deepEqual(found.endpoints.phone, [origin + "/contacts/gethpnpp.php"]);
    assert.equal(calls.filter(c => c.url.endsWith("id=22")).length, 1);
    assert.ok(calls.every(c => !c.url.includes("idkstat")));
    await page.close();
  });
  await test("reads the supplied NTP table structure and HP without calling ceknorek", async () => {
    const { page, calls } = await setup();
    const detail = await getDetail(page);
    assert.equal(detail.plate_key, "L8083UE");
    assert.equal(detail.phone, "+6281200000000");
    assert.equal(detail.vehicle_type, "TRUCK TANGKI");
    assert.equal(detail.source_letter_type, "NTP");
    assert.equal(detail.total_amount, 6279000);
    assert.equal(detail.tax_valid_date, "2026-07-31");
    assert.equal(detail.letter_date, "2026-09-29");
    assert.ok(calls.every(c => !c.url.includes("ceknorek")));
    assert.ok(calls.filter(c => c.method === "POST").every(c => c.body === "nopol=L8083UE"));
    await page.close();
  });
  await test("phone-only NTP does not prevent reading full NPP detail", async () => {
    const { page } = await setup({ "/view/vstatntp.php": "", "/view/vstatnpp.php": vehicleHtml("L 8083 UE", "NPP") });
    const detail = await getDetail(page);
    assert.equal(detail.source_letter_type, "NPP");
    assert.equal(detail.vehicle_type, "TRUCK TANGKI");
    assert.equal(detail.phone, "+6281200000000");
    await page.close();
  });
  await test("wrong vehicle response is never attached to the requested plate", async () => {
    const { page } = await setup({ "/view/vstatntp.php": vehicleHtml("L 9999 ZZ"), "/contacts/gethpntp.php": "" });
    await assert.rejects(getDetail(page), /tidak memuat detail nopol yang diminta/);
    await page.close();
  });
  await test("missing HP endpoint does not block valid vehicle data", async () => {
    const { page } = await setup({ "/contacts/gethpntp.php": { status: 404, body: "Not found" } });
    const detail = await getDetail(page);
    assert.equal(detail.total_amount, 6279000);
    assert.equal(detail.phone, "");
    await page.close();
  });
  await test("login response stops the lookup immediately", async () => {
    const { page, calls } = await setup({ "/idxstaf.php?id=32": '<form><input type="password"></form>' });
    await assert.rejects(getDetail(page), /Sesi SIAPP berakhir/);
    assert.ok(calls.every(c => c.method !== "POST"));
    await page.close();
  });
  await test("phone parsing accepts HP fields and rejects numbers in unrelated HTML", async () => {
    const { page } = await setup();
    const phones = await page.evaluate(() => [
      '{"nohp":"081200000000"}', '"6281200000000"', '+62 812 0000 0000',
      '<input id="no_hp" value="081200000000">',
      '<html>Hubungi admin 081200000000</html>', '{"nik":"6281200000000"}'
    ].map(window.detailTest.parsePhoneResponse));
    assert.deepEqual(phones, ["+6281200000000", "+6281200000000", "+6281200000000", "+6281200000000", "", ""]);
    await page.close();
  });
  await test("manual source status uses the page heading rather than the sidebar", async () => {
    const { page } = await setup();
    const letter = await page.evaluate(html => window.detailTest.detectCurrentLetterType(new DOMParser().parseFromString(html, "text/html")), menu + '<h4>Status NTP</h4>');
    assert.equal(letter, "NTP");
    await page.close();
  });
  await test("full batch reads, saves and fills only the blank card phone", async () => {
    const { page, calls } = await setup({}, true);
    await page.waitForFunction(() => document.querySelector("#siapp-vehicle-detail-status")?.textContent.startsWith("Selesai."));
    const writes = calls.filter(c => c.url.startsWith(dbOrigin) && c.method !== "GET");
    const insert = writes.find(c => c.method === "POST");
    assert.equal(JSON.parse(insert.body)[0].phone, "+6281200000000");
    assert.deepEqual(JSON.parse(writes.find(c => c.method === "PATCH").body), { phone: "+6281200000000" });
    await page.close();
  });
  await test("existing card phone is preserved", async () => {
    const { page, calls } = await setup({ "/rest/v1/taxpayers:GET": [{ ...sourceRow, phone: "+6281300000000" }] }, true);
    await page.waitForFunction(() => document.querySelector("#siapp-vehicle-detail-status")?.textContent.startsWith("Selesai."));
    assert.ok(calls.every(c => c.method !== "PATCH"));
    await page.close();
  });
  await test("empty responses fail preflight without writing to Supabase", async () => {
    const { page, calls } = await setup({ "/view/vstatntp.php": "", "/contacts/gethpntp.php": "" }, true);
    await page.waitForFunction(() => document.querySelector("#siapp-vehicle-detail-status")?.textContent.startsWith("Uji baca SIAPP gagal"));
    assert.ok(calls.filter(c => c.url.startsWith(dbOrigin)).every(c => c.method === "GET"));
    await page.close();
  });
  process.stdout.write(`${passed} tests passed. All requests used local fixtures.\n`);
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  if (browser) await browser.close();
});
