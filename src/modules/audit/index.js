// İşlem kaydının listelenmesi (yalnızca yönetici)
const express = require('express');
const { all } = require('../../db');
const { date } = require('../../lib/validate');
const { auth, admin } = require('../../lib/auth');

const router = express.Router();

router.get('/api/audit', auth, admin, (req, res) => {
  const q = req.query;
  const where = [];
  const params = [];
  if (q.from) { where.push('l.at >= ?'); params.push(date(q.from, 'Başlangıç')); }
  if (q.to) { where.push('l.at < date(?, \'+1 day\')'); params.push(date(q.to, 'Bitiş')); }
  if (q.user_id) { where.push('l.user_id = ?'); params.push(Number(q.user_id)); }
  if (q.entity) { where.push('l.entity = ?'); params.push(String(q.entity)); }
  if (q.before_id) { where.push('l.id < ?'); params.push(Number(q.before_id)); }
  const limit = Math.min(Number(q.limit) || 100, 500);
  const rows = all(`SELECT l.*, u.full_name user_name FROM audit_log l LEFT JOIN users u ON u.id = l.user_id
                    ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY l.id DESC LIMIT ?`, ...params, limit);
  res.json(rows.map((r) => ({ ...r, details: JSON.parse(r.details) })));
});

module.exports = { router };
