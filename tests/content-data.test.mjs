import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blankAsset, publishedInWeek, monday, addDays } from '../app/content/types.ts';

test('cross-posting counts as one published asset and excludes scheduled uploads', () => {
  const asset = blankAsset('enzo');
  for (const p of asset.publications) { p.status = 'PUBLISHED'; p.date = '2026-09-14'; }
  assert.equal([asset].filter(a => publishedInWeek(a, '2026-09-14')).length, 1);
  for (const p of asset.publications) p.status = 'SCHEDULED';
  assert.equal(publishedInWeek(asset, '2026-09-14'), false);
});
test('week boundaries cross months correctly', () => {
  assert.equal(monday('2026-10-01'), '2026-09-28');
  assert.equal(addDays('2026-09-28', 7), '2026-10-05');
  const a = blankAsset('hustliq'); a.publications[0].status = 'PUBLISHED'; a.publications[0].date = '2026-10-05';
  assert.equal(publishedInWeek(a, '2026-09-28'), false);
});
test('new records never invent outcomes or share mutable platform metrics', () => {
  const a = blankAsset('enzo'); const b = blankAsset('hustliq');
  a.publications[0].metrics.views = 0;
  assert.equal(a.publications[1].metrics.views, null);
  assert.equal(b.publications[0].metrics.views, null);
  assert.equal(a.status, 'IDEA'); assert.equal(a.scheduledDate, null);
});
