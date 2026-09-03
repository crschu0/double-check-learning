import { cert, getApps, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
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
const saveWeeklySnapshot = process.env.SAVE_WEEKLY_SNAPSHOT === "true";
const historyStartDate = process.env.FRECKLE_HISTORY_START || "2026-08-01";
const localDownloadDir = process.env.FRECKLE_DOWNLOAD_DIR
  ? path.resolve(process.env.FRECKLE_DOWNLOAD_DIR)
  : null;

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

async function listLocalCsvFiles() {
  if (!localDownloadDir) return [];
  let names;
  try {
    names = await readdir(localDownloadDir);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  return names
    .filter(name => parseReportFilename(name))
    .map(name => ({ name, localPath: path.join(localDownloadDir, name) }));
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

async function downloadText(file) {
  if (file.localPath) return readFile(file.localPath, "utf8");
  const fileId = file.id;
  const response = await drive.files.get({ fileId, alt: "media" }, { responseType: "text" });
  return String(response.data);
}

async function latestRichDataFile() {
  const response = await drive.files.list({
    q: `'${folderId}' in parents and trashed = false and name contains 'Freckle Rich Data'`,
    fields: "files(id,name,modifiedTime)",
    orderBy: "modifiedTime desc",
    pageSize: 10
  });
  return (response.data.files || []).find(file => /\.json$/i.test(file.name)) || null;
}

function reportNameFallback(sourceName) {
  const cleaned = String(sourceName || "")
    .replace(/\s*\.\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned || /^not here$/i.test(cleaned)) return null;
  return cleaned;
}

function reportWeekId(files, fallback) {
  const endDate = files[0] && files[0].report && files[0].report.endDate;
  const parsed = endDate ? new Date(endDate) : new Date(fallback);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString().slice(0, 10);
}

async function main() {
  const files = selectLatestReportSet([
    ...await listLocalCsvFiles(),
    ...await listCsvFiles()
  ]);
  if (!files.length) throw new Error("No dated Freckle Activity CSV files were found.");

  const incentivesRef = db.doc("trackerData/incentives");
  const incentivesSnap = await incentivesRef.get();
  if (!incentivesSnap.exists) throw new Error("trackerData/incentives does not exist.");

  const students = incentivesSnap.data().students || [];
  const rosterIndex = buildRosterIndex(students);
  const importedAt = new Date().toISOString().slice(0, 10);
  const updates = {};
  const activeStudentKeys = new Set();
  const skipped = [];

  for (const file of files) {
    const rows = parseFreckleCsv(await downloadText(file));
    for (const row of rows) {
      const rosterName = resolveRosterName(row.sourceName, rosterIndex)
        || reportNameFallback(row.sourceName);
      if (!rosterName) {
        skipped.push(`${row.sourceName} (${file.report.className})`);
        continue;
      }
      const key = normalizeName(rosterName);
      activeStudentKeys.add(key);
      updates[key] = toFreckleRecord(row, rosterName, file.report, importedAt);
    }
  }

  const progressRef = db.doc("privateProgress/progress");
  const progressSnap = await progressRef.get();
  const progress = progressSnap.exists ? progressSnap.data() : {};

  const richFile = await latestRichDataFile();
  const richData = richFile ? JSON.parse(await downloadText(richFile)) : {};
  const richByStudent = {};

  for (const item of richData.growth || []) {
    const rosterName = resolveRosterName(item.name, rosterIndex) || reportNameFallback(item.name);
    if (!rosterName) continue;
    const key = normalizeName(rosterName);
    if (!activeStudentKeys.has(key)) continue;
    richByStudent[key] ||= { name: rosterName, growth: [], sessions: [] };
    richByStudent[key].growth.push({
      domain: item.domain,
      starting: item.starting,
      current: item.current,
      progress: Number(item.progress || 0)
    });
  }

  for (const item of richData.sessions || []) {
    const rosterName = resolveRosterName(item.name, rosterIndex) || reportNameFallback(item.name);
    if (!rosterName) continue;
    const key = normalizeName(rosterName);
    if (!activeStudentKeys.has(key)) continue;
    richByStudent[key] ||= { name: rosterName, growth: [], sessions: [] };
    richByStudent[key].sessions.push({
      completedAt: item.completedAt,
      type: item.type,
      contentLevel: item.contentLevel,
      timePracticed: item.timePracticed,
      questions: Number(item.questions || 0),
      accuracy: Number(item.accuracy || 0)
    });
  }

  for (const [key, rich] of Object.entries(richByStudent)) {
    updates[key] = {
      ...((progress.freckle || {})[key] || {}),
      ...(updates[key] || {}),
      ...rich
    };
  }

  const freckleInsights = {
    generatedAt: richData.generatedAt || importedAt,
    source: richData.source || "Freckle weekly reports",
    standards: (richData.standards || []).map(item => ({
      className: item.className,
      domain: item.domain,
      code: item.code,
      name: item.name,
      questions: Number(item.questions || 0),
      below50: Number(item.below50 || 0),
      from50to79: Number(item.from50to79 || 0),
      above79: Number(item.above79 || 0)
    }))
  };

  const serverTime = FieldValue.serverTimestamp();
  const weekId = reportWeekId(files, importedAt);
  const weeklySnapshots = await db.collection("privateProgressWeekly").get();
  const oldWeeklySnapshots = weeklySnapshots.docs.filter(snapshot =>
    /^\d{4}-\d{2}-\d{2}$/.test(snapshot.id) && snapshot.id < historyStartDate
  );
  const batch = db.batch();
  batch.update(progressRef, {
    freckle: updates,
    freckleInsights,
    updatedAt: serverTime
  });
  if (saveWeeklySnapshot) {
    batch.set(db.doc(`privateProgressWeekly/${weekId}`), {
      weekId,
      reportDates: files[0].report ? `${files[0].report.startDate} - ${files[0].report.endDate}` : weekId,
      importedAt,
      freckle: updates,
      freckleInsights,
      updatedAt: serverTime
    }, { merge: true });
  }
  for (const snapshot of oldWeeklySnapshots) batch.delete(snapshot.ref);
  await batch.commit();

  const snapshotMessage = saveWeeklySnapshot ? `; saved weekly snapshot ${weekId}` : "; refreshed current dashboard data";
  console.log(`Imported ${Object.keys(updates).length} students from ${files.length} Freckle CSV files${richFile ? " plus private rich report data" : ""}${snapshotMessage}.`);
  if (oldWeeklySnapshots.length) {
    console.log(`Removed ${oldWeeklySnapshots.length} weekly snapshots dated before ${historyStartDate}.`);
  }
  if (skipped.length) console.log(`Skipped unmatched rows: ${skipped.join(", ")}`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
