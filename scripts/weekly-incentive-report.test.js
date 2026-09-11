import test from "node:test";
import assert from "node:assert/strict";

import { buildReport } from "./weekly-incentive-report.js";

test("an absence disqualifies a zero-point student from clean week", () => {
  const report = buildReport({
    houses: ["Ravenclaw"],
    students: [
      { id: "student-1", name: "Absent Student", house: "Ravenclaw" },
      { id: "student-2", name: "Clean Student", house: "Ravenclaw" }
    ],
    points: [],
    absences: [
      { id: "absence-1", studentId: "student-1", date: "2026-09-08" }
    ],
    settings: { currentWeekStart: "2026-09-04", funFridayLimit: 5 }
  }, new Date("2026-09-10T18:00:00Z"));

  assert.equal(report.summary.cleanCount, 1);
  assert.equal(report.summary.absenceCount, 1);
  assert.match(report.text, /Absent Student[\s\S]*NO CLEAN: ABSENCE/);
  assert.match(report.text, /Students ineligible for clean week due to absence: 1/);
});
