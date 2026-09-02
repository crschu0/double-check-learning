import { cert, getApps, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { google } from "googleapis";
import {
  buildRosterIndex,
  normalizeName,
  parseFreckleCsv,
  parseReportFilename,
  resolveRosterName,
  toFreckleRecord
} from "./freckle-parser.js";

const folderId = process.env.FRECKLE_DRIVE_FOLDER_ID || "18_Eu6JDgzXCatO-4_GecSFWx-uRsHn9d";
const projectId = process.env.FIREBASE_PROJECT_ID || "incentive-program-6bf45";
const rawCredential = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

if (!rawCredential) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is required.");
const credential = JSON.parse(rawCredential);

const auth = new google.auth.GoogleAuth({
  credentials: credential,
  scopes: ["https://www.googleapis.com/auth/drive.readonly"]
});
const drive = google.drive({ version: "v3", auth });

if (!getApps().length) initializeApp({ credential: cert(credential), projectId });
const db = getFirestore();

async function listCsvFiles() {
  const response = await drive.files.list({
    q: `'${folderId}' in parents and trashed = false and mimeType = 'text/csv'`,
    fields: "files(id,name,modifiedTime)",
    orderBy: "modifiedTime desc",
    pageSize: 100
  });
  return (response.data.files || []).filter(file => parseReportFilename(file.name));
}

function selectLatestReportSet(files) {
  const parsed = files.map(file => ({ ...file, report: parseReportFilename(file.name) }));
  if (!parsed.length) return [];
  const latestEnd = parsed
    .map(file => Date.parse(file.report.endDate))
    .filter(Number.isFinite)
    .sort((a, b) => b - a)[0];
  if (!latestEnd) return [];

  const byClass = new Map();
  for (const file of parsed.filter(item => Date.parse(item.report.endDate) === latestEnd)) {
    const key = file.report.className.toLowerCase();
    if (!byClass.has(key)) byClass.set(key, file);
  }
  return [...byClass.values()];
}

async function downloadText(fileId) {
  const response = await drive.files.get({ fileId, alt: "media" }, { responseType: "text" });
  return String(response.data);
}

function reportNameFallback(sourceName) {
  const cleaned = String(sourceName || "")
    .replace(/\s*\.\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned || /^not here$/i.test(cleaned)) return null;
  return cleaned;
}

async function main() {
  const files = selectLatestReportSet(await listCsvFiles());
  if (!files.length) throw new Error("No dated Freckle Activity CSV files were found.");

  const incentivesRef = db.doc("trackerData/incentives");
  const incentivesSnap = await incentivesRef.get();
  if (!incentivesSnap.exists) throw new Error("trackerData/incentives does not exist.");

  const students = incentivesSnap.data().students || [];
  const rosterIndex = buildRosterIndex(students);
  const importedAt = new Date().toISOString().slice(0, 10);
  const updates = {};
  const skipped = [];

  for (const file of files) {
    const rows = parseFreckleCsv(await downloadText(file.id));
    for (const row of rows) {
      const rosterName = resolveRosterName(row.sourceName, rosterIndex)
        || reportNameFallback(row.sourceName);
      if (!rosterName) {
        skipped.push(`${row.sourceName} (${file.report.className})`);
        continue;
      }
      updates[normalizeName(rosterName)] = toFreckleRecord(row, rosterName, file.report, importedAt);
    }
  }

  const progressRef = db.doc("privateProgress/progress");
  const progressSnap = await progressRef.get();
  const progress = progressSnap.exists ? progressSnap.data() : {};
  const mergedFreckle = { ...(progress.freckle || {}), ...updates };
  const serverTime = FieldValue.serverTimestamp();

  const dashboardRef = db.doc("publicDashboard/dashboard");
  const dashboardSnap = await dashboardRef.get();
  const dashboard = dashboardSnap.exists ? dashboardSnap.data() : {};

  const batch = db.batch();
  batch.set(progressRef, { ...progress, freckle: mergedFreckle, updatedAt: serverTime }, { merge: true });
  batch.set(db.doc("publicProgress/studentProgress"), {
    freckle: mergedFreckle,
    scratch: progress.scratch || {},
    updatedAt: serverTime
  }, { merge: true });
  batch.set(dashboardRef, {
    ...dashboard,
    progress: {
      ...(dashboard.progress || {}),
      freckle: mergedFreckle,
      scratch: progress.scratch || {}
    },
    updatedAt: serverTime
  }, { merge: true });
  await batch.commit();

  console.log(`Imported ${Object.keys(updates).length} students from ${files.length} Freckle CSV files.`);
  if (skipped.length) console.log(`Skipped unmatched rows: ${skipped.join(", ")}`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
