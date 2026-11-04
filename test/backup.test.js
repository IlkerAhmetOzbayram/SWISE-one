const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { migrate } = require('../src/db/migrate');
const { dailyBackup, listBackups } = require('../src/lib/backup');

function setup() {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  db.prepare("INSERT INTO clients (name) VALUES ('Yedeklenen Müşteri')").run();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swise-yedek-test-'));
  return { db, dir };
}

test('günlük yedek alınır ve aynı gün tekrar alınmaz', (t) => {
  const { db, dir } = setup();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const day = new Date(2026, 10, 4);

  const first = dailyBackup(db, dir, 14, day);
  assert.equal(first.created, true);
  assert.equal(path.basename(first.file), 'swise-2026-11-04.db');
  assert.equal(dailyBackup(db, dir, 14, day).created, false);

  const copy = new DatabaseSync(first.file, { readOnly: true });
  assert.equal(copy.prepare('SELECT name FROM clients').get().name, 'Yedeklenen Müşteri');
  copy.close();
});

test('yalnızca son N günün yedeği saklanır', (t) => {
  const { db, dir } = setup();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const d of [1, 2, 3, 4]) dailyBackup(db, dir, 2, new Date(2026, 10, d));
  assert.deepEqual(listBackups(dir).map((b) => b.name), ['swise-2026-11-04.db', 'swise-2026-11-03.db']);
});
