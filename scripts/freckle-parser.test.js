import test from "node:test";
import assert from "node:assert/strict";
import {
  buildRosterIndex,
  parseFreckleCsv,
  parseReportFilename,
  resolveRosterName,
  toFreckleRecord
} from "./freckle-parser.js";

test("parses the Freckle filename", () => {
  assert.deepEqual(
    parseReportFilename("Freckle Activity Aug 31, 2026 - Sep 2, 2026 5th 26-27.csv"),
    { startDate: "Aug 31, 2026", endDate: "Sep 2, 2026", className: "5th 26-27" }
  );
});

test("parses activity rows and no-data rows", () => {
  const rows = parseFreckleCsv(
    "Name,Accuracy,Time Practiced,Questions,Last Practiced\nAlex .,78,7,9,Math Adaptive Practice\nBlake .,-,0,0,-"
  );
  assert.equal(rows[0].accuracy, "78");
  assert.equal(rows[0].hasData, true);
  assert.equal(rows[1].accuracy, "No data");
  assert.equal(rows[1].hasData, false);
});

test("matches exact full names and unique first names only", () => {
  const index = buildRosterIndex([
    { name: "Alex Example" },
    { name: "Jordan Alpha" },
    { name: "Jordan Beta" },
    { name: "Taylor Sample" }
  ]);
  assert.equal(resolveRosterName("Taylor Sample", index), "Taylor Sample");
  assert.equal(resolveRosterName("Alex .", index), "Alex Example");
  assert.equal(resolveRosterName("Jordan .", index), null);
});

test("builds a dashboard-compatible activity record", () => {
  const [row] = parseFreckleCsv(
    "Name,Accuracy,Time Practiced,Questions,Last Practiced\nTaylor Sample,78,13,99,Math Adaptive Practice"
  );
  const record = toFreckleRecord(
    row,
    "Taylor Sample",
    { startDate: "Aug 31, 2026", endDate: "Sep 2, 2026", className: "5th 26-27" },
    "2026-09-02"
  );
  assert.equal(record.correctTotal, "77 / 99");
  assert.equal(record.reportDates, "Aug 31, 2026 - Sep 2, 2026");
});
