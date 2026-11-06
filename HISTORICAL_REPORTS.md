# Historical incentive PDF recovery

The manual **Export archived historical incentive PDF (no reset)** workflow copies an original PDF revision from Drive to a separate dated school-owned PDF. It never accesses Firestore, resets a week, or replaces Current Weekly Incentive Report.pdf. The scheduled workflow is unchanged.

1. List revisions of Current Weekly Incentive Report.pdf and inspect the desired revision to confirm its week. Upload dates are normally the Friday after the reported week.
2. In the school freckle data folder, create a separate PDF with the exact name `Weekly Incentive Report YYYY-MM-DD to YYYY-MM-DD.pdf` using the Friday and following Thursday. A copy of a PDF can serve as the destination. Share that destination with the existing reporting service account as editor, using the same private access as the current report. Do not use a student-data backup file as the destination.
3. Run the manual historical workflow with the Friday, original revision ID, and separate destination file ID.
4. The script checks the folder, PDF type, exact dated name, and embedded week before writing. It then downloads the saved PDF and compares every byte. No PDF content is logged or uploaded to GitHub artifacts.

This recovers preserved original reports; it does not invent records for weeks without an original PDF. It deliberately fails closed for compressed PDFs or other formats whose week cannot be verified. Preserve important source revisions with Drive's Keep forever option, or save dated copies before Drive's version retention expires. A missing original requires a separate investigation of a complete historical data snapshot, including roster, settings, points, and absences.

Local safety tests: `node scripts/export-historical-incentive-report.test.js`.
Configure CURRENT_INCENTIVE_REPORT_FILE_ID and INCENTIVE_REPORT_FOLDER_ID as private repository secrets before running. No school identifiers or student report contents belong in this public repository.
