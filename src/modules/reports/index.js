// Muhasebe raporu ve müşteri efor raporu uç noktaları
const express = require('express');
const { asyncHandler } = require('../../lib/http');
const { auth, requirePerm } = require('../../lib/auth');
const { getSettings } = require('../settings');
const { buildReport } = require('./service');
const { writeReportXlsx } = require('./excel');
const { buildEffortReport, writeEffortXlsx } = require('./effort');

const router = express.Router();

router.get('/api/report', auth, requirePerm('reports.view'), (req, res) => res.json(buildReport(req)));

router.get('/api/report.xlsx', auth, requirePerm('reports.view'), asyncHandler((req, res) => writeReportXlsx(buildReport(req), res)));

router.get('/api/effort-report', auth, requirePerm('effort_report.view'), (req, res) => res.json(buildEffortReport(req)));

router.get('/api/effort-report.xlsx', auth, requirePerm('effort_report.view'),
  asyncHandler((req, res) => writeEffortXlsx(buildEffortReport(req), getSettings().company_name, res)));

module.exports = { router };
