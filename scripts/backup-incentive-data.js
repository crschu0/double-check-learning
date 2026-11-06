import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp, GeoPoint, DocumentReference } from "firebase-admin/firestore";
import { google } from "googleapis";
import { Readable } from "node:stream";
import { createHash } from "node:crypto";

const projectId = process.env.FIREBASE_PROJECT_ID || "incentive-program-6bf45";
const parentFolder = process.env.INCENTIVE_DRIVE_FOLDER_ID;
// School-owned private backup slots: updates use the owner's Drive quota.
const backupSlots = [
  "1iG0HgQHvZ0tMFsSPJOInfyHtorpksEoG",
  "1afsxJIBiazSz4-_S7P6m1dAKjg-o70Sc",
  "1NIwXcPy0UETq3iWlzjfxshJRr2UBx9z8",
  "1o1nqN16she5nc1Hu2U6vzlBZcaucW-qi",
  "1RGqRoL-DicW-AZwfP8rQWkTMeZeMZxvF",
  "1ApqtLOmhkbewEMCOGRf11AVUoBSAn-Lf",
  "18RHLReLXeu_6EvzNI3zEIvksZYTh_3sk",
  "1y6GrkbvREQZFkXvb22nsaWCSqK3fjPek"
];
const credentialsText = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
if (!credentialsText || !parentFolder) throw new Error("Firebase service account and private Drive folder are required.");

const credentials = JSON.parse(credentialsText);
if (!getApps().length) initializeApp({ credential: cert(credentials), projectId });
const db = getFirestore();
const drive = google.drive({
  version: "v3",
  auth: new google.auth.GoogleAuth({ credentials, scopes: ["https://www.googleapis.com/auth/drive"] })
});

// Preserve Firestore types rather than relying on JSON.stringify's lossy implicit conversions.
function encode(value) {
  if (value instanceof Timestamp) return { __firestoreType: "timestamp", seconds: value.seconds, nanoseconds: value.nanoseconds };
  if (value instanceof GeoPoint) return { __firestoreType: "geopoint", latitude: value.latitude, longitude: value.longitude };
  if (value instanceof DocumentReference) return { __firestoreType: "reference", path: value.path };
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return { __firestoreType: "bytes", base64: Buffer.from(value).toString("base64") };
  if (value instanceof Date) return { __firestoreType: "date", iso: value.toISOString() };
  if (Array.isArray(value)) return value.map(encode);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encode(item)]));
  }
  return value;
}

async function collect(collection, output) {
  const references = await collection.listDocuments();
  for (const reference of references) {
    const snapshot = await reference.get();
    if (snapshot.exists) output.push({ path: reference.path, data: encode(snapshot.data()) });
    const children = await reference.listCollections();
    for (const child of children) await collect(child, output);
  }
}

async function main() {
  const docs = [];
  for (const collection of await db.listCollections()) await collect(collection, docs);
  docs.sort((a, b) => a.path.localeCompare(b.path));

  const paths = new Set(docs.map(item => item.path));
  if (!paths.has("trackerData/incentives") || !paths.has("privateProgress/progress")) {
    throw new Error("Backup refused: required incentive or private student progress records are missing.");
  }

  const now = new Date();
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit"
  }).format(now);
  const stamp = now.toISOString().replaceAll(":", "-").replaceAll(".", "-");
  const payload = Buffer.from(JSON.stringify({
    format: "room113-firestore-backup-v1",
    projectId,
    capturedAt: now.toISOString(),
    documentCount: docs.length,
    documents: docs
  }, null, 2) + "\n", "utf8");
  const sha256 = createHash("sha256").update(payload).digest("hex");
  const weekNumber = Math.floor(now.getTime() / (7 * 24 * 60 * 60 * 1000));
  const slot = ((weekNumber % backupSlots.length) + backupSlots.length) % backupSlots.length;
  const backupFileId = backupSlots[slot];
  const filename = `Room113-Student-Data-${date}-${stamp}.json`;

  // Update an existing school-owned file; service accounts cannot create files
  // in regular My Drive folders. Rotate weekly to retain seven prior backups.
  const uploaded = await drive.files.update({
    fileId: backupFileId,
    media: { mimeType: "application/json", body: Readable.from([payload]) },
    fields: "id,name,size,md5Checksum,parents",
    supportsAllDrives: true
  });
  if (uploaded.data.id !== backupFileId) throw new Error("Backup update returned the wrong file ID.");
  if (!uploaded.data.parents?.includes(parentFolder)) {
    throw new Error("Backup file is not in the expected private folder.");
  }

  // Read it back; don't allow the incentive week to reset if the stored copy differs.
  const response = await drive.files.get({ fileId: uploaded.data.id, alt: "media", supportsAllDrives: true }, { responseType: "arraybuffer" });
  const downloaded = Buffer.from(response.data);
  const remoteHash = createHash("sha256").update(downloaded).digest("hex");
  if (remoteHash !== sha256) throw new Error("Backup failed verification: Drive copy differs from source.");
  const parsed = JSON.parse(downloaded.toString("utf8"));
  if (parsed.documentCount !== docs.length) throw new Error("Backup failed verification: document count differs.");

  console.log(`Verified private Drive backup ${filename}, slot ${slot + 1} (${backupFileId}): ${docs.length} Firestore documents, ${payload.length} bytes, SHA-256 ${sha256}.`);
}

main().catch(error => {
  console.error("Student backup failed; do not reset the week:", error.message);
  process.exitCode = 1;
});
