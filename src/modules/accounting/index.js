// Muhasebe modülü: tanımlar + faturalar + hareketler/bordro + raporlar
const express = require('express');

const router = express.Router();
router.use(require('./setup').router);
router.use(require('./invoices').router);
router.use(require('./transactions').router);
router.use(require('./reports').router);

module.exports = { router };
