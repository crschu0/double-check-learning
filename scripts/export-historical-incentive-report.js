import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { pathToFileURL } from 'node:url';

const SOURCE_ID = process.env.CURRENT_INCENTIVE_REPORT_FILE_ID;
const FOLDER_ID = process.env.INCENTIVE_REPORT_FOLDER_ID;

export function validateOptions({ revisionId, targetId, weekStart, sourceId = SOURCE_ID, folderId = FOLDER_ID }) {
  if (!sourceId || !folderId) throw new Error('Private source file and folder configuration is required.');
  if (!revisionId || !/^[\w-]+$/.test(revisionId)) throw new Error('An explicit archived revision ID is required.');
  if (!targetId || targetId === sourceId || !/^[\w-]+$/.test(targetId)) throw new Error('A separate historical destination PDF is required.');
  const date = new Date(`${weekStart}T12:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart || '') || !Number.isFinite(+date) || date.toISOString().slice(0, 10) !== weekStart || date.getUTCDay() !== 5) throw new Error('weekStart must be a valid Friday (YYYY-MM-DD).');
  date.setUTCDate(date.getUTCDate() + 6);
  return `Weekly Incentive Report ${weekStart} to ${date.toISOString().slice(0, 10)}.pdf`;
}

export async function exportHistorical(drive, options) {
  const name = validateOptions(options);
  const { revisionId, targetId, weekStart, sourceId = SOURCE_ID, folderId = FOLDER_ID } = options;
  const target = (await drive.files.get({ fileId: targetId, fields: 'id,name,mimeType,parents' })).data;
  // A precreated school-owned PDF avoids service-account storage quota failures.
  // Require the exact dated name and folder to protect unrelated files/backups.
  if (target.name !== name || target.mimeType !== 'application/pdf' || !target.parents?.includes(folderId)) throw new Error(`Destination must be an existing PDF named ${name} in the report folder.`);
  const response = await drive.revisions.get({ fileId: sourceId, revisionId, alt: 'media' }, { responseType: 'arraybuffer' });
  const bytes = Buffer.from(response.data);
  const end = name.slice(-14, -4);
  const display = value => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(`${value}T12:00:00Z`));
  // Current report PDFs contain uncompressed ASCII text. Fail closed for other formats.
  if (!bytes.subarray(0, 5).equals(Buffer.from('%PDF-')) || !bytes.includes(Buffer.from(`Week: ${display(weekStart)} - ${display(end)}`))) throw new Error('Archived PDF does not match the requested week; nothing was written.');
  await drive.files.update({ fileId: targetId, media: { mimeType: 'application/pdf', body: Readable.from(bytes) }, fields: 'id' });
  const saved = Buffer.from((await drive.files.get({ fileId: targetId, alt: 'media' }, { responseType: 'arraybuffer' })).data);
  if (!saved.equals(bytes)) throw new Error('Saved PDF verification failed.');
  return { fileId: targetId, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
}

async function main() {
  const { google } = await import('googleapis');
  const options = { revisionId: process.env.REPORT_REVISION_ID, targetId: process.env.HISTORICAL_REPORT_FILE_ID, weekStart: process.env.REPORT_WEEK_START };
  validateOptions(options);
  const auth = new google.auth.GoogleAuth({ credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON), scopes: ['https://www.googleapis.com/auth/drive'] });
  console.log(await exportHistorical(google.drive({ version: 'v3', auth }), options));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });
