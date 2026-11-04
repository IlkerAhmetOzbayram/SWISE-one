// Muhasebe raporu ve müşteri efor raporu uç noktaları
const express = require('express');
const { asyncHandler } = require('../../lib/http');
const { auth, admin } = require('../../lib/auth');
const { getSettings } = require('../settings');
const { buildReport } = require('./service');
const { writeReportXlsx } = require('./excel');
const { buildEffortReport, writeEffortXlsx } = require('./effort');

const router = express.Router();

router.get('/api/report', auth, admin, (req, res) => res.json(buildReport(req)));

router.get('/api/report.xlsx', auth, admin, asyncHandler((req, res) => writeReportXlsx(buildReport(req), res)));

router.get('/api/effort-report', auth, admin, (req, res) => res.json(buildEffortReport(req)));

router.get('/api/effort-report.xlsx', auth, admin,
  asyncHandler((req, res) => writeEffortXlsx(buildEffortReport(req), getSettings().company_name, res)));

module.exports = { router };
