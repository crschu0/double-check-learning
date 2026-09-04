import { cert, getApps, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { Readable } from "node:stream";
import { pathToFileURL } from "node:url";
import { google } from "googleapis";

const DEFAULT_FOLDER_ID = "18_Eu6JDgzXCatO-4_GecSFWx-uRsHn9d";
const DEFAULT_PROJECT_ID = "incentive-program-6bf45";
const DEFAULT_REPORT_NAME = "Current Weekly Incentive Report";

function addDays(dateText, days) {
  const date = new Date(`${dateText}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function centralDateText(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function fridayFor(dateText) {
  const day = new Date(`${dateText}T12:00:00Z`).getUTCDay();
  const daysSinceFriday = (day + 2) % 7;
  return addDays(dateText, -daysSinceFriday);
}

function thursdayFor(dateText) {
  const day = new Date(`${dateText}T12:00:00Z`).getUTCDay();
  const daysSinceThursday = (day + 3) % 7;
  return addDays(dateText, -daysSinceThursday);
}

function displayDate(dateText) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(new Date(`${dateText}T12:00:00Z`));
}

function generatedTime(date = new Date()) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    weekday: "long",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short"
  }).format(date);
}

function numberValue(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function clip(value, width) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length <= width ? text : `${text.slice(0, Math.max(0, width - 3))}...`;
}

function column(value, width, align = "left") {
  const text = clip(value, width);
  return align === "right" ? text.padStart(width) : text.padEnd(width);
}

function buildReport(data, now = new Date(), weekStartOverride = null) {
  const today = centralDateText(now);
  const weekStart = weekStartOverride || data.settings?.currentWeekStart || fridayFor(today);
  const weekEnd = addDays(weekStart, 6);
  const houses = Array.isArray(data.houses) ? data.houses : [];
  const students = Array.isArray(data.students) ? data.students : [];
  const allPoints = Array.isArray(data.points) ? data.points : [];
  const points = allPoints.filter(point => point.date >= weekStart && point.date <= weekEnd);
  const limit = Math.max(1, numberValue(data.settings?.funFridayLimit) || 5);
  const totals = Object.fromEntries(houses.map(house => [house, 0]));
  for (const point of points) {
    totals[point.house] = (totals[point.house] || 0) + numberValue(point.value);
  }

  const studentRows = students.map(student => {
    const total = points
      .filter(point => point.studentId === student.id)
      .reduce((sum, point) => sum + numberValue(point.value), 0);
    return {
      id: student.id,
      name: student.name || "Unnamed student",
      house: student.house || "Unassigned",
      total,
      status: total === 0 ? "CLEAN" : total >= limit ? "AT/OVER LIMIT" : "HAS POINTS"
    };
  }).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));

  const lowest = houses.length
    ? Math.min(...houses.map(house => totals[house] || 0))
    : 0;
  const winner = houses.length
    ? houses.filter(house => (totals[house] || 0) === lowest).join(", ")
    : "No houses configured";
  const cleanCount = studentRows.filter(row => row.total === 0).length;
  const atLimitCount = studentRows.filter(row => row.total >= limit).length;

  const lines = [];
  const ranges = { title: null, headings: [], mono: [] };
  let index = 1;
  const append = (text, style = null) => {
    const startIndex = index;
    lines.push(text);
    index += text.length;
    const range = { startIndex, endIndex: index };
    if (style === "title") ranges.title = range;
    if (style === "heading") ranges.headings.push(range);
    if (style === "mono") ranges.mono.push(range);
  };

  append("WEEKLY INCENTIVE REPORT\n", "title");
  append(`Week: ${displayDate(weekStart)} - ${displayDate(weekEnd)}\n`);
  append(`Generated: ${generatedTime(now)}\n`);
  append(`Fun Friday limit: ${limit} points\n\n`);

  append("QUICK SUMMARY\n", "heading");
  append(`Winning house (fewest points): ${winner}\n`);
  append(`Students with a clean week: ${cleanCount} of ${students.length}\n`);
  append(`Students at or over the limit: ${atLimitCount}\n`);
  append(`Point entries recorded: ${points.length}\n\n`);

  append("HOUSE TOTALS\n", "heading");
  append(`${column("House", 24)}  ${column("Points", 8, "right")}\n`, "mono");
  append(`${"-".repeat(24)}  ${"-".repeat(8)}\n`, "mono");
  for (const house of [...houses].sort((a, b) => (totals[a] || 0) - (totals[b] || 0) || a.localeCompare(b))) {
    append(`${column(house, 24)}  ${column(totals[house] || 0, 8, "right")}\n`, "mono");
  }
  if (!houses.length) append("No houses are configured.\n", "mono");
  append("\n");

  append("STUDENT CHECK - HIGHEST POINTS FIRST\n", "heading");
  append(`${column("Student", 25)}  ${column("House", 16)}  ${column("Points", 6, "right")}  ${column("Status", 13)}\n`, "mono");
  append(`${"-".repeat(25)}  ${"-".repeat(16)}  ${"-".repeat(6)}  ${"-".repeat(13)}\n`, "mono");
  for (const row of studentRows) {
    append(`${column(row.name, 25)}  ${column(row.house, 16)}  ${column(row.total, 6, "right")}  ${column(row.status, 13)}\n`, "mono");
  }
  if (!studentRows.length) append("No students are configured.\n", "mono");
  append("\n");

  append("POINT DETAILS\n", "heading");
  append(`${column("Date", 10)}  ${column("Student", 23)}  ${column("House", 14)}  ${column("Pts", 4, "right")}  Reason\n`, "mono");
  append(`${"-".repeat(10)}  ${"-".repeat(23)}  ${"-".repeat(14)}  ${"-".repeat(4)}  ${"-".repeat(24)}\n`, "mono");
  const detailRows = [...points].sort((a, b) =>
    String(a.date).localeCompare(String(b.date)) ||
    String(a.studentName).localeCompare(String(b.studentName))
  );
  for (const point of detailRows) {
    append(`${column(point.date, 10)}  ${column(point.studentName, 23)}  ${column(point.house, 14)}  ${column(numberValue(point.value), 4, "right")}  ${clip(point.reason || "", 30)}\n`, "mono");
  }
  if (!detailRows.length) append("No point entries were recorded this week.\n", "mono");

  return {
    text: lines.join(""),
    ranges,
    summary: { weekStart, weekEnd, totals, winner, cleanCount, atLimitCount, pointCount: points.length }
  };
}

async function findReportFile(drive, folderId, reportName) {
  const safeName = reportName.replaceAll("'", "\\'");
  const response = await drive.files.list({
    q: `'${folderId}' in parents and name = '${safeName}' and trashed = false and mimeType = 'application/pdf'`,
    fields: "files(id,name,modifiedTime)",
    orderBy: "modifiedTime desc",
    pageSize: 10
  });
  const file = response.data.files?.[0];
  if (!file) throw new Error(`Could not find the PDF named "${reportName}" in the incentive Drive folder.`);
  return file;
}

function pdfText(value) {
  return String(value)
    .normalize("NFKD")
    .replace(/[^\x20-\x7E]/g, "?")
    .replaceAll("\\", "\\\\")
    .replaceAll("(", "\\(")
    .replaceAll(")", "\\)");
}

function pdfObject(number, body) {
  return `${number} 0 obj\n${body}\nendobj\n`;
}

function makePdf(report) {
  const headingNames = new Set(["QUICK SUMMARY", "HOUSE TOTALS", "STUDENT CHECK - HIGHEST POINTS FIRST", "POINT DETAILS"]);
  const tableStartNames = new Set(["House", "Student", "Date"]);
  const pages = [[]];
  let y = 738;
  let inTable = false;

  for (const rawLine of report.text.trimEnd().split("\n")) {
    const line = pdfText(rawLine);
    const isTitle = rawLine === "WEEKLY INCENTIVE REPORT";
    const isHeading = headingNames.has(rawLine);
    if (isHeading) inTable = false;
    if (tableStartNames.has(rawLine.trimStart().split(/\s{2,}/)[0])) inTable = true;
    const isTable = inTable && !isHeading;
    const size = isTitle ? 18 : isHeading ? 11.5 : isTable ? 7.4 : 9.5;
    const leading = isTitle ? 28 : isHeading ? 21 : isTable ? 11 : rawLine ? 14 : 8;
    if ((isHeading && y < 110) || y - leading < 50) {
      pages.push([]);
      y = 738;
    }
    pages.at(-1).push({ line, y, size, font: isTitle || isHeading ? "F2" : isTable ? "F3" : "F1", teal: isTitle || isHeading });
    y -= leading;
  }

  const pageCount = pages.length;
  const fontBase = 3 + pageCount * 2;
  const objects = [];
  const kids = [];
  objects[1] = pdfObject(1, "<< /Type /Catalog /Pages 2 0 R >>");

  pages.forEach((lines, pageIndex) => {
    const pageNumber = 3 + pageIndex * 2;
    const contentNumber = pageNumber + 1;
    kids.push(`${pageNumber} 0 R`);
    const commands = ["q"];
    for (const item of lines) {
      commands.push(`BT /${item.font} ${item.size} Tf ${item.teal ? "0.12 0.35 0.42" : "0.15 0.20 0.24"} rg 54 ${item.y} Td (${item.line}) Tj ET`);
      if (item.font === "F2" && item.size === 18) commands.push(`0.85 0.89 0.91 RG 54 ${item.y - 10} m 558 ${item.y - 10} l S`);
    }
    commands.push(`BT /F1 8 Tf 0.40 0.46 0.50 rg 54 26 Td (Room 113 - Page ${pageIndex + 1} of ${pageCount}) Tj ET`, "Q");
    const stream = `${commands.join("\n")}\n`;
    objects[pageNumber] = pdfObject(pageNumber, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontBase} 0 R /F2 ${fontBase + 1} 0 R /F3 ${fontBase + 2} 0 R >> >> /Contents ${contentNumber} 0 R >>`);
    objects[contentNumber] = pdfObject(contentNumber, `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`);
  });

  objects[2] = pdfObject(2, `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${pageCount} >>`);
  objects[fontBase] = pdfObject(fontBase, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  objects[fontBase + 1] = pdfObject(fontBase + 1, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>");
  objects[fontBase + 2] = pdfObject(fontBase + 2, "<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>");

  let pdf = "%PDF-1.4\n%Room113\n";
  const offsets = [0];
  for (let number = 1; number < objects.length; number += 1) {
    offsets[number] = Buffer.byteLength(pdf);
    pdf += objects[number];
  }
  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let number = 1; number < objects.length; number += 1) {
    pdf += `${String(offsets[number]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, "binary");
}

async function replacePdf(drive, fileId, report) {
  const pdf = makePdf(report);
  await drive.files.update({
    fileId,
    media: { mimeType: "application/pdf", body: Readable.from(pdf) },
    fields: "id,name,mimeType,modifiedTime,size"
  });
}

async function archiveAndReset(db, summary) {
  const ref = db.doc("trackerData/incentives");
  return db.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) throw new Error("trackerData/incentives does not exist.");
    const data = snapshot.data();
    const existingStart = data.settings?.currentWeekStart || summary.weekStart;
    const nextWeekStart = addDays(summary.weekStart, 7);
    if (existingStart > summary.weekStart) return "already-reset";

    const history = Array.isArray(data.history) ? data.history : [];
    const archive = {
      id: `auto-${summary.weekEnd}`,
      ended: summary.weekEnd,
      winner: summary.winner,
      cleanCount: summary.cleanCount,
      totals: summary.totals
    };
    transaction.update(ref, {
      history: [archive, ...history.filter(item => item.ended !== summary.weekEnd)],
      "settings.currentWeekStart": nextWeekStart,
      "settings.weekStartsOn": "Friday",
      updatedAt: FieldValue.serverTimestamp()
    });
    return "reset";
  });
}

async function main() {
  const rawCredential = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!rawCredential) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is required.");
  const credential = JSON.parse(rawCredential);
  const folderId = process.env.INCENTIVE_DRIVE_FOLDER_ID || DEFAULT_FOLDER_ID;
  const projectId = process.env.FIREBASE_PROJECT_ID || DEFAULT_PROJECT_ID;
  const reportName = process.env.INCENTIVE_REPORT_NAME || `${DEFAULT_REPORT_NAME}.pdf`;
  const autoReset = process.env.AUTO_RESET_WEEK === "true";

  const auth = new google.auth.GoogleAuth({
    credentials: credential,
    scopes: ["https://www.googleapis.com/auth/drive"]
  });
  const drive = google.drive({ version: "v3", auth });
  if (!getApps().length) initializeApp({ credential: cert(credential), projectId });
  const db = getFirestore();

  const incentivesRef = db.doc("trackerData/incentives");
  const snapshot = await incentivesRef.get();
  if (!snapshot.exists) throw new Error("trackerData/incentives does not exist.");

  const incentives = snapshot.data();
  const today = centralDateText();
  const completedWeekStart = addDays(thursdayFor(today), -6);
  if (autoReset && incentives.settings?.currentWeekStart > completedWeekStart) {
    console.log("The completed incentive week was already archived and reset; no report was overwritten.");
    return;
  }

  const report = buildReport(incentives, new Date(), autoReset ? completedWeekStart : null);
  const reportFile = await findReportFile(drive, folderId, reportName);
  await replacePdf(drive, reportFile.id, report);
  console.log(`Updated the private weekly incentive report for ${report.summary.weekStart} through ${report.summary.weekEnd}.`);

  if (autoReset) {
    const result = await archiveAndReset(db, report.summary);
    console.log(result === "reset"
      ? `Archived the week and advanced the tracker to ${addDays(report.summary.weekStart, 7)}.`
      : "The tracker was already advanced; no second reset was performed.");
  } else {
    console.log("Preview run only; the incentive week was not reset.");
  }
}

export { buildReport, fridayFor, makePdf };

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
