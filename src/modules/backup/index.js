// Yedeklerin listelenmesi ve anlık yedeğin indirilmesi (yalnızca yönetici)
const express = require('express');
const fs = require('fs');
const config = require('../../config');
const { db } = require('../../db');
const { auth, requirePerm } = require('../../lib/auth');
const { listBackups, tempSnapshot } = require('../../lib/backup');
const audit = require('../../lib/audit');

const router = express.Router();

router.get('/api/admin/backups', auth, requirePerm('settings.edit'), (req, res) => {
  res.json({ keep: config.backupKeep, backups: listBackups(config.backupDir) });
});

router.get('/api/admin/backup.db', auth, requirePerm('settings.edit'), (req, res, next) => {
  const file = tempSnapshot(db);
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  audit.record(req, 'backup_download', 'database');
  res.download(file, `swise-one-yedek-${stamp}.db`, (err) => {
    fs.rm(file, { force: true }, () => {});
    if (err && !res.headersSent) next(err);
  });
});

module.exports = { router };
