import { createReadStream } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { google } from "googleapis";

const email = process.env.FRECKLE_EMAIL;
const password = process.env.FRECKLE_PASSWORD;
const rawCredential = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
const folderId = process.env.FRECKLE_DRIVE_FOLDER_ID || "18_Eu6JDgzXCatO-4_GecSFWx-uRsHn9d";
const wantedClasses = (process.env.FRECKLE_CLASSES || "5th,Phinnley")
  .split(",")
  .map(value => value.trim())
  .filter(Boolean);

if (!email || !password) throw new Error("FRECKLE_EMAIL and FRECKLE_PASSWORD are required.");
if (!rawCredential) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is required.");

const credential = JSON.parse(rawCredential);
const auth = new google.auth.GoogleAuth({
  credentials: credential,
  scopes: ["https://www.googleapis.com/auth/drive"]
});
const drive = google.drive({ version: "v3", auth });

function filenameMatchesClass(filename, className) {
  return String(filename || "").toLowerCase().endsWith(` ${className.toLowerCase()}.csv`);
}

function classFromFilename(filename) {
  const match = String(filename || "").match(/^Freckle Activity .+ \d{4} - .+ \d{4} (.+)\.csv$/i);
  return match ? match[1].trim() : "";
}

async function waitForExport(page) {
  const link = page.locator('a[download][href^="blob:"]');
  await link.waitFor({ state: "visible", timeout: 60000 });
  return link;
}

async function selectClass(page, className) {
  let link = await waitForExport(page);
  let filename = await link.getAttribute("download");
  if (filenameMatchesClass(filename, className)) return link;

  const selects = page.locator("select");
  for (let index = 0; index < await selects.count(); index += 1) {
    const select = selects.nth(index);
    const labels = await select.locator("option").allTextContents();
    if (labels.some(label => label.trim().toLowerCase() === className.toLowerCase())) {
      await select.selectOption({ label: labels.find(label => label.trim().toLowerCase() === className.toLowerCase()) });
      await page.waitForTimeout(1500);
      link = await waitForExport(page);
      filename = await link.getAttribute("download");
      if (filenameMatchesClass(filename, className)) return link;
    }
  }

  const currentClass = classFromFilename(filename);
  const triggerCandidates = [
    currentClass && page.getByRole("button", { name: new RegExp(`^${currentClass.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") }),
    page.locator('[aria-label*="class" i]').filter({ visible: true }),
    currentClass && page.getByText(currentClass, { exact: true }).filter({ visible: true })
  ].filter(Boolean);

  let opened = false;
  for (const candidate of triggerCandidates) {
    if (await candidate.count()) {
      await candidate.first().click();
      opened = true;
      break;
    }
  }
  if (opened) {
    const option = page.getByText(className, { exact: true }).filter({ visible: true });
    if (await option.count()) {
      await option.first().click();
      await page.waitForTimeout(1500);
      link = await waitForExport(page);
      filename = await link.getAttribute("download");
      if (filenameMatchesClass(filename, className)) return link;
    }
  }

  for (const route of ["/dashboard", "/rosters"]) {
    await page.goto(`https://classroom.freckle.com${route}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(1200);
    const classChoice = page.getByText(className, { exact: true }).filter({ visible: true });
    if (!await classChoice.count()) continue;
    await classChoice.first().click();
    await page.waitForTimeout(1000);
    await page.goto("https://classroom.freckle.com/activity-feed", { waitUntil: "domcontentloaded", timeout: 60000 });
    link = await waitForExport(page);
    filename = await link.getAttribute("download");
    if (filenameMatchesClass(filename, className)) return link;
  }

  throw new Error(`Could not switch the Freckle activity export to ${className}.`);
}

async function uploadCsv(filePath, filename) {
  const escaped = filename.replace(/'/g, "\\'");
  const existing = await drive.files.list({
    q: `'${folderId}' in parents and trashed = false and name = '${escaped}'`,
    fields: "files(id,name)",
    pageSize: 10
  });
  const media = { mimeType: "text/csv", body: createReadStream(filePath) };
  const match = (existing.data.files || [])[0];
  if (match) {
    await drive.files.update({ fileId: match.id, media, fields: "id,name" });
  } else {
    await drive.files.create({
      requestBody: { name: filename, parents: [folderId], mimeType: "text/csv" },
      media,
      fields: "id,name"
    });
  }
  console.log(`Uploaded ${filename} to the private Freckle Drive folder.`);
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ acceptDownloads: true });
  const downloadDir = await mkdtemp(path.join(tmpdir(), "freckle-"));

  try {
    await page.goto("https://classroom.freckle.com/login", { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.locator('input[name="email"]').fill(email);
    await page.locator('input[name="password"]').fill(password);
    await Promise.all([
      page.waitForURL(url => !url.pathname.endsWith("/login"), { timeout: 60000 }),
      page.getByRole("button", { name: "Log In", exact: true }).click()
    ]);

    await page.goto("https://classroom.freckle.com/activity-feed", { waitUntil: "domcontentloaded", timeout: 60000 });
    for (const className of wantedClasses) {
      const link = await selectClass(page, className);
      const filename = path.basename(await link.getAttribute("download"));
      const downloadPromise = page.waitForEvent("download", { timeout: 30000 });
      await link.click();
      const download = await downloadPromise;
      const filePath = path.join(downloadDir, filename);
      await download.saveAs(filePath);
      await uploadCsv(filePath, filename);
    }
  } finally {
    await browser.close();
  }
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
