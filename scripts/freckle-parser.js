import { parse } from "csv-parse/sync";

export function normalizeName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[.]/g, "")
    .replace(/[^a-z0-9' -]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseReportFilename(filename) {
  const match = String(filename).match(
    /^Freckle Activity ([A-Z][a-z]{2} \d{1,2}, \d{4}) - ([A-Z][a-z]{2} \d{1,2}, \d{4}) (.+)\.csv$/i
  );
  if (!match) return null;
  return { startDate: match[1], endDate: match[2], className: match[3].trim() };
}

export function parseFreckleCsv(content) {
  const rows = parse(content, {
    columns: true,
    bom: true,
    skip_empty_lines: true,
    trim: true
  });

  const required = ["Name", "Accuracy", "Time Practiced", "Questions", "Last Practiced"];
  if (!rows.length || required.some(column => !(column in rows[0]))) {
    throw new Error(`Freckle CSV is missing one of: ${required.join(", ")}`);
  }

  return rows.map(row => ({
    sourceName: row.Name,
    accuracy: row.Accuracy === "-" ? "No data" : String(row.Accuracy),
    timePracticed: Number(row["Time Practiced"] || 0),
    questions: Number(row.Questions || 0),
    lastPracticed: row["Last Practiced"] || "-",
    hasData: row.Accuracy !== "-" || Number(row["Time Practiced"]) > 0 || Number(row.Questions) > 0
  }));
}

export function buildRosterIndex(students) {
  const exact = new Map();
  const first = new Map();

  for (const student of students || []) {
    const name = String(student.name || "").trim();
    const key = normalizeName(name);
    if (!key) continue;
    exact.set(key, name);
    const firstName = key.split(" ")[0];
    const matches = first.get(firstName) || [];
    matches.push(name);
    first.set(firstName, matches);
  }

  return { exact, first };
}

export function resolveRosterName(sourceName, index) {
  const key = normalizeName(sourceName);
  if (index.exact.has(key)) return index.exact.get(key);
  if (!key.includes(" ")) {
    const matches = index.first.get(key) || [];
    if (matches.length === 1) return matches[0];
  }
  return null;
}

export function toFreckleRecord(row, rosterName, report, importedAt) {
  const questions = row.questions;
  const numericAccuracy = Number(row.accuracy);
  const correct = Number.isFinite(numericAccuracy)
    ? Math.round((numericAccuracy / 100) * questions)
    : 0;

  return {
    name: rosterName,
    hasData: row.hasData,
    accuracy: row.accuracy,
    timePracticed: `${row.timePracticed} min`,
    questions: String(questions),
    correctQuestions: correct,
    correctTotal: row.hasData ? `${correct} / ${questions}` : "0 / 0",
    lastPracticed: row.lastPracticed,
    reportDates: `${report.startDate} - ${report.endDate}`,
    sourceClass: report.className,
    importedAt
  };
}
