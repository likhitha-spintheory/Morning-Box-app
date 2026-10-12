/* Cutoff and delivery dates are Dubai time whatever the device timezone is. */
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.TZ = 'America/Los_Angeles';
const { cutoffFor, isBeforeCutoff, firstOrderableDate, dubaiTodayIso, isoDate } = await import('../src/domain/standards.js');

test('cutoff is 9:00 PM Dubai the evening before', () => {
  assert.equal(cutoffFor('2026-10-15').toISOString(), '2026-10-14T17:00:00.000Z');
  assert.equal(isBeforeCutoff('2026-10-15', new Date('2026-10-14T16:59:00Z')), true);
  assert.equal(isBeforeCutoff('2026-10-15', new Date('2026-10-14T17:00:00Z')), false);
});

test('first orderable morning follows the Dubai clock', () => {
  /* 8:30 PM in Dubai (09:30 in Los Angeles): tomorrow is still open. */
  assert.equal(isoDate(firstOrderableDate(new Date('2026-10-14T16:30:00Z'))), '2026-10-15');
  /* 9:30 PM in Dubai: tomorrow has closed. */
  assert.equal(isoDate(firstOrderableDate(new Date('2026-10-14T17:30:00Z'))), '2026-10-16');
  /* 1:00 AM on the 15th in Dubai is still the 14th in Los Angeles. */
  assert.equal(dubaiTodayIso(new Date('2026-10-14T21:00:00Z')), '2026-10-15');
});
