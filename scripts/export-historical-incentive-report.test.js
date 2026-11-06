import test from 'node:test';
import assert from 'node:assert/strict';
import { exportHistorical, validateOptions } from './export-historical-incentive-report.js';

const options = { revisionId: 'archived-revision', targetId: 'separate-pdf', weekStart: '2026-10-23', sourceId: 'source-pdf', folderId: 'private-folder' };
test('rejects the current report and invalid weeks', () => {
  for (const change of [{ targetId: 'source-pdf' }, { weekStart: '2026-10-24' }, { weekStart: '2026-02-30' }, { revisionId: '' }]) assert.throws(() => validateOptions({ ...options, ...change }));
});

function fixture({ wrongWeek = false, wrongTarget = false, corrupt = false } = {}) {
  let writes = 0;
  const bytes = Buffer.from(`%PDF-1.4\nWeek: Oct ${wrongWeek ? '16' : '23'}, 2026 - Oct ${wrongWeek ? '22' : '29'}, 2026\n`);
  const drive = {
    revisions: { get: async () => ({ data: bytes }) },
    files: {
      get: async args => ({ data: args.alt ? (corrupt ? Buffer.from('corrupt') : bytes) : { name: wrongTarget ? 'unrelated.pdf' : validateOptions(options), mimeType: 'application/pdf', parents: ['private-folder'] } }),
      update: async args => { assert.equal(args.fileId, options.targetId); writes++; }
    }
  };
  return { drive, writes: () => writes };
}
test('copies original bytes to the separate target and verifies readback', async () => {
  const f = fixture();
  const result = await exportHistorical(f.drive, options);
  assert.equal(result.fileId, options.targetId);
  assert.equal(f.writes(), 1);
});
test('wrong week or unrelated destination causes zero writes', async () => {
  for (const settings of [{ wrongWeek: true }, { wrongTarget: true }]) {
    const f = fixture(settings);
    await assert.rejects(exportHistorical(f.drive, options));
    assert.equal(f.writes(), 0);
  }
});
test('detects a corrupt saved copy', async () => {
  await assert.rejects(exportHistorical(fixture({ corrupt: true }).drive, options), /verification failed/);
});
