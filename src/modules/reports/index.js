// Muhasebe raporu uç noktaları
const express = require('express');
const { asyncHandler } = require('../../lib/http');
const { auth, admin } = require('../../lib/auth');
const { buildReport } = require('./service');
const { writeReportXlsx } = require('./excel');

const router = express.Router();

router.get('/api/report', auth, admin, (req, res) => res.json(buildReport(req)));

router.get('/api/report.xlsx', auth, admin, asyncHandler((req, res) => writeReportXlsx(buildReport(req), res)));

module.exports = { router };
