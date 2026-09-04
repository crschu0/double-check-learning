import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { Readable } from "node:stream";
import { google } from "googleapis";

const TZ = "America/Chicago";
const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "incentive-program-6bf45";
const FOLDER_ID = process.env.INCENTIVE_DRIVE_FOLDER_ID || "18_Eu6JDgzXCatO-4_GecSFWx-uRsHn9d";
const REPORT_NAME = process.env.INCENTIVE_REPORT_NAME || "Current Weekly Incentive Report.pdf";

function partsInZone(date, timeZone = TZ) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
  }).formatToParts(date);
  return Object.fromEntries(parts.filter(p => p.type !== "literal").map(p => [p.type, p.value]));
}

function zonedLocalToUtc(year, month, day, hour, minute, timeZone = TZ) {
  const desired = Date.UTC(year, month - 1, day, hour, minute, 0);
  let guess = desired;
  for (let i = 0; i < 4; i += 1) {
    const p = partsInZone(new Date(guess), timeZone);
    const shown = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
    guess += desired - shown;
  }
  return new Date(guess);
}

function dateText(date) {
  const p = partsInZone(date);
  return `${p.year}-${p.month}-${p.day}`;
}

function addDays(text, days) {
  const d = new Date(`${text}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function weekday(text) {
  return new Date(`${text}T12:00:00Z`).getUTCDay();
}

function mostRecentThursdayCutoff(now = new Date()) {
  let d = dateText(now);
  const dow = weekday(d);
  const daysBack = (dow + 3) % 7; // Thu=4 -> 0, Fri=5 -> 1
  d = addDays(d, -daysBack);
  let cutoff = zonedLocalToUtc(+d.slice(0,4), +d.slice(5,7), +d.slice(8,10), 21, 15);
  if (cutoff > now) {
    d = addDays(d, -7);
    cutoff = zonedLocalToUtc(+d.slice(0,4), +d.slice(5,7), +d.slice(8,10), 21, 15);
  }
  return cutoff;
}

function fridayFor(text) {
  const dow = weekday(text);
  const daysSinceFriday = (dow + 2) % 7;
  return addDays(text, -daysSinceFriday);
}

function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }
function clean(v) { return String(v ?? "").replace(/\s+/g, " ").trim(); }
function clip(v, n) { const s = clean(v); return s.length <= n ? s : `${s.slice(0, n - 3)}...`; }
function col(v, n, right = false) { const s = clip(v, n); return right ? s.padStart(n) : s.padEnd(n); }

function pointTimestamp(point) {
  const candidates = [point.createdAt, point.timestamp, point.addedAt];
  for (const value of candidates) {
    if (!value) continue;
    if (typeof value === "string") {
      const ms = Date.parse(value); if (Number.isFinite(ms)) return ms;
    }
    if (typeof value?.toDate === "function") return value.toDate().getTime();
    if (typeof value?.seconds === "number") return value.seconds * 1000;
  }
  return NaN;
}

function buildReport(data, cutoff) {
  const cutoffDate = dateText(cutoff);
  const weekStart = fridayFor(cutoffDate);
  const weekEnd = addDays(weekStart, 6);
  const houses = Array.isArray(data.houses) ? data.houses : [];
  const students = Array.isArray(data.students) ? data.students : [];
  const allPoints = Array.isArray(data.points) ? data.points : [];
  const cutoffMs = cutoff.getTime();
  const points = allPoints.filter(p => {
    if (p.date < weekStart || p.date > weekEnd) return false;
    const ms = pointTimestamp(p);
    return Number.isFinite(ms) ? ms <= cutoffMs : p.date <= cutoffDate;
  });
  const totals = Object.fromEntries(houses.map(h => [h, 0]));
  for (const p of points) totals[p.house] = (totals[p.house] || 0) + num(p.value);
  const lowest = houses.length ? Math.min(...houses.map(h => totals[h] || 0)) : 0;
  const winner = houses.length ? houses.filter(h => (totals[h] || 0) === lowest).join(", ") : "No houses configured";
  const rows = students.map(s => ({
    name: s.name || "Unnamed student", house: s.house || "Unassigned",
    total: points.filter(p => p.studentId === s.id).reduce((a,p) => a + num(p.value), 0)
  })).sort((a,b) => b.total - a.total || a.name.localeCompare(b.name));
  const limit = Math.max(1, num(data.settings?.funFridayLimit) || 5);
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday:"long", month:"short", day:"numeric", year:"numeric", hour:"numeric", minute:"2-digit", timeZoneName:"short" });
  const lines = [];
  lines.push("WEEKLY INCENTIVE REPORT");
  lines.push(`Week: ${weekStart} - ${weekEnd}`);
  lines.push(`Snapshot as of: ${fmt.format(cutoff)}`);
  lines.push(`Fun Friday limit: ${limit} points`);
  lines.push("");
  lines.push("QUICK SUMMARY");
  lines.push(`Winning house (fewest points): ${winner}`);
  lines.push(`Point entries recorded: ${points.length}`);
  lines.push("");
  lines.push("HOUSE TOTALS");
  lines.push(`${col("House",24)}  ${col("Points",8,true)}`);
  lines.push(`${"-".repeat(24)}  ${"-".repeat(8)}`);
  for (const h of [...houses].sort((a,b)=>(totals[a]||0)-(totals[b]||0)||a.localeCompare(b))) lines.push(`${col(h,24)}  ${col(totals[h]||0,8,true)}`);
  lines.push("");
  lines.push("STUDENT CHECK - HIGHEST POINTS FIRST");
  lines.push(`${col("Student",25)}  ${col("House",16)}  ${col("Points",6,true)}  Status`);
  lines.push(`${"-".repeat(25)}  ${"-".repeat(16)}  ${"-".repeat(6)}  ${"-".repeat(13)}`);
  for (const r of rows) lines.push(`${col(r.name,25)}  ${col(r.house,16)}  ${col(r.total,6,true)}  ${r.total===0?"CLEAN":r.total>=limit?"AT/OVER LIMIT":"HAS POINTS"}`);
  lines.push("");
  lines.push("POINT DETAILS");
  lines.push(`${col("Date",10)}  ${col("Student",23)}  ${col("House",14)}  ${col("Pts",4,true)}  Reason`);
  lines.push(`${"-".repeat(10)}  ${"-".repeat(23)}  ${"-".repeat(14)}  ${"-".repeat(4)}  ${"-".repeat(24)}`);
  for (const p of [...points].sort((a,b)=>String(a.date).localeCompare(String(b.date))||String(a.studentName).localeCompare(String(b.studentName)))) {
    lines.push(`${col(p.date,10)}  ${col(p.studentName,23)}  ${col(p.house,14)}  ${col(num(p.value),4,true)}  ${clip(p.reason||"",30)}`);
  }
  return lines;
}

function esc(s) { return String(s).replaceAll("\\","\\\\").replaceAll("(","\\(").replaceAll(")","\\)").replace(/[^\x20-\x7E]/g,"?"); }
function makePdf(lines) {
  const pageLines = 58; const pages = [];
  for (let i=0;i<lines.length;i+=pageLines) pages.push(lines.slice(i,i+pageLines));
  const objs=[]; const kids=[]; const fontBase=3+pages.length*2;
  objs[1]=`1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`;
  pages.forEach((pg,i)=>{ const pn=3+i*2, cn=pn+1; kids.push(`${pn} 0 R`); let y=750; const cmd=[];
    for (const line of pg) { const title=line==="WEEKLY INCENTIVE REPORT"; const head=["QUICK SUMMARY","HOUSE TOTALS","STUDENT CHECK - HIGHEST POINTS FIRST","POINT DETAILS"].includes(line); const font=title||head?"F2":"F3"; const size=title?16:head?11:8; cmd.push(`BT /${font} ${size} Tf 54 ${y} Td (${esc(line)}) Tj ET`); y-=title?24:head?18:11; }
    cmd.push(`BT /F1 8 Tf 54 26 Td (Room 113 - Page ${i+1} of ${pages.length}) Tj ET`); const stream=cmd.join("\n")+"\n";
    objs[pn]=`${pn} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontBase} 0 R /F2 ${fontBase+1} 0 R /F3 ${fontBase+2} 0 R >> >> /Contents ${cn} 0 R >>\nendobj\n`;
    objs[cn]=`${cn} 0 obj\n<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream\nendobj\n`; });
  objs[2]=`2 0 obj\n<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${pages.length} >>\nendobj\n`;
  objs[fontBase]=`${fontBase} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n`;
  objs[fontBase+1]=`${fontBase+1} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj\n`;
  objs[fontBase+2]=`${fontBase+2} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>\nendobj\n`;
  let pdf="%PDF-1.4\n%Room113\n"; const offsets=[0];
  for(let i=1;i<objs.length;i++){offsets[i]=Buffer.byteLength(pdf);pdf+=objs[i];}
  const x=Buffer.byteLength(pdf); pdf+=`xref\n0 ${objs.length}\n0000000000 65535 f \n`; for(let i=1;i<objs.length;i++) pdf+=`${String(offsets[i]).padStart(10,"0")} 00000 n \n`; pdf+=`trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`; return Buffer.from(pdf,"binary");
}

async function main() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is required.");
  const credential = JSON.parse(raw);
  if (!getApps().length) initializeApp({ credential: cert(credential), projectId: PROJECT_ID });
  const db = getFirestore();
  const snap = await db.doc("trackerData/incentives").get();
  if (!snap.exists) throw new Error("trackerData/incentives does not exist.");
  const cutoff = process.env.REPORT_AS_OF ? new Date(process.env.REPORT_AS_OF) : mostRecentThursdayCutoff();
  if (!Number.isFinite(cutoff.getTime())) throw new Error("Invalid REPORT_AS_OF timestamp.");
  const lines = buildReport(snap.data(), cutoff);
  const auth = new google.auth.GoogleAuth({ credentials: credential, scopes:["https://www.googleapis.com/auth/drive"] });
  const drive = google.drive({ version:"v3", auth });
  const safe = REPORT_NAME.replaceAll("'","\\'");
  const list = await drive.files.list({ q:`'${FOLDER_ID}' in parents and name='${safe}' and trashed=false`, fields:"files(id,name)", pageSize:10 });
  const file = list.data.files?.[0]; if (!file) throw new Error(`Could not find ${REPORT_NAME}`);
  await drive.files.update({ fileId:file.id, media:{ mimeType:"application/pdf", body:Readable.from(makePdf(lines)) }, fields:"id,name,modifiedTime,size" });
  console.log(`Recovered weekly incentive report as of ${cutoff.toISOString()} with ${lines.length} report lines.`);
}

await main();
