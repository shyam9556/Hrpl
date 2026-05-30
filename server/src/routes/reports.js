import { Router } from "express";

import db from "../config/database.js";
import { authenticate, authorize } from "../middleware/auth.js";

const router = Router();

// All reports are admin-only
router.use(authenticate);
router.use(authorize("admin"));

// ─── GET /api/reports/quotations ─────────────────────────
// Quotation report with filters: date range, status, dealer
router.get("/quotations", async (req, res, next) => {
  try {
    const { startDate, endDate, status, dealerId } = req.query;

    let whereClause = "";
    const params = [];

    // Validate date format to prevent SQL parse errors
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (startDate && !dateRegex.test(startDate)) {
      return res.status(400).json({ success: false, error: "Invalid startDate format. Use YYYY-MM-DD." });
    }
    if (endDate && !dateRegex.test(endDate)) {
      return res.status(400).json({ success: false, error: "Invalid endDate format. Use YYYY-MM-DD." });
    }

    if (startDate) {
      whereClause += " AND q.created_at >= ?";
      params.push(startDate);
    }
    if (endDate) {
      // MySQL: add 1 day to endDate to make it inclusive of the full end day
      whereClause += " AND q.created_at < DATE_ADD(?, INTERVAL 1 DAY)";
      params.push(endDate);
    }
    if (status) {
      whereClause += " AND q.status = ?";
      params.push(status);
    }
    if (dealerId) {
      const parsedDealerId = parseInt(dealerId, 10);
      if (isNaN(parsedDealerId)) {
        return res.status(400).json({ success: false, error: "Invalid dealer ID." });
      }
      whereClause += " AND q.dealer_id = ?";
      params.push(parsedDealerId);
    }

    const result = await db.query(
      `SELECT q.id, q.quotation_number, q.system_kw, q.panel_count,
              q.subtotal, q.gst_amount, q.total, q.subsidy_amount, q.effective_price,
              q.status, q.created_at,
              u.name as dealer_name,
              c.name as customer_name, c.phone as customer_phone, c.city as customer_city,
              p.brand as panel_brand, p.watt as panel_watt,
              i.brand as inverter_brand, i.kw as inverter_kw
       FROM quotations q
       JOIN users u ON u.id = q.dealer_id
       LEFT JOIN customers c ON c.id = q.customer_id
       JOIN panels p ON p.id = q.panel_id
       JOIN inverters i ON i.id = q.inverter_id
       WHERE 1=1 ${whereClause}
       ORDER BY q.created_at DESC
       LIMIT 5000`,
      params
    );

    // Summary stats
    const summary = {
      totalQuotations: result.rows.length,
      totalRevenue: result.rows.reduce((sum, r) => sum + parseFloat(r.total), 0),
      totalEffective: result.rows.reduce((sum, r) => sum + parseFloat(r.effective_price), 0),
      totalSubsidy: result.rows.reduce((sum, r) => sum + parseFloat(r.subsidy_amount), 0),
      totalGst: result.rows.reduce((sum, r) => sum + parseFloat(r.gst_amount), 0),
      avgSystemKw: result.rows.length > 0
        ? (result.rows.reduce((sum, r) => sum + parseFloat(r.system_kw), 0) / result.rows.length).toFixed(2)
        : 0,
    };

    res.json({
      success: true,
      summary,
      quotations: result.rows,
    });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/reports/dealers ────────────────────────────
// Dealer performance report
router.get("/dealers", async (req, res, next) => {
  try {
    const result = await db.query(
      `SELECT u.id, u.name, u.email, u.mobile, u.location, u.company_name, u.is_active,
              COUNT(q.id) as total_quotations,
              COUNT(CASE WHEN q.status = 'Approved' THEN 1 END) as approved_quotations,
              COUNT(CASE WHEN q.status = 'Pending' THEN 1 END) as pending_quotations,
              COALESCE(SUM(CASE WHEN q.status = 'Approved' THEN q.total END), 0) as total_revenue,
              COALESCE(SUM(CASE WHEN q.status = 'Approved' THEN q.system_kw END), 0) as total_kw_sold,
              COUNT(DISTINCT q.customer_id) as unique_customers
       FROM users u
       LEFT JOIN quotations q ON q.dealer_id = u.id
       WHERE u.role = 'dealer'
       GROUP BY u.id, u.name, u.email, u.mobile, u.location, u.company_name, u.is_active
       ORDER BY total_revenue DESC`
    );

    res.json({
      success: true,
      count: result.rows.length,
      dealers: result.rows,
    });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/reports/revenue ────────────────────────────
// Revenue report — monthly breakdown
router.get("/revenue", async (req, res, next) => {
  try {
    const { year } = req.query;
    const targetYear = year || new Date().getFullYear();

    // MySQL equivalent of PostgreSQL's TO_CHAR and EXTRACT
    const result = await db.query(
      `SELECT DATE_FORMAT(created_at, '%Y-%m') as month,
              DATE_FORMAT(created_at, '%b %Y') as month_label,
              COUNT(*) as quotation_count,
              COALESCE(SUM(total), 0) as gross_revenue,
              COALESCE(SUM(effective_price), 0) as net_revenue,
              COALESCE(SUM(gst_amount), 0) as total_gst,
              COALESCE(SUM(subsidy_amount), 0) as total_subsidy,
              COALESCE(SUM(system_kw), 0) as total_kw
       FROM quotations
       WHERE status = 'Approved'
         AND YEAR(created_at) = ?
       GROUP BY DATE_FORMAT(created_at, '%Y-%m'), DATE_FORMAT(created_at, '%b %Y')
       ORDER BY month`,
      [targetYear]
    );

    // Annual totals
    const annual = {
      year: parseInt(targetYear, 10),
      totalQuotations: result.rows.reduce((sum, r) => sum + parseInt(r.quotation_count, 10), 0),
      grossRevenue: result.rows.reduce((sum, r) => sum + parseFloat(r.gross_revenue), 0),
      netRevenue: result.rows.reduce((sum, r) => sum + parseFloat(r.net_revenue), 0),
      totalGst: result.rows.reduce((sum, r) => sum + parseFloat(r.total_gst), 0),
      totalKw: result.rows.reduce((sum, r) => sum + parseFloat(r.total_kw), 0),
    };

    res.json({
      success: true,
      annual,
      monthly: result.rows,
    });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/reports/customers ──────────────────────────
// Customer status summary report
router.get("/customers", async (req, res, next) => {
  try {
    // Status breakdown
    const statusResult = await db.query(
      `SELECT status, COUNT(*) as count
       FROM customers
       GROUP BY status
       ORDER BY count DESC`
    );

    // Top customers by quotation value
    const topCustomers = await db.query(
      `SELECT c.id, c.name, c.phone, c.city, c.status,
              COUNT(q.id) as quotation_count,
              COALESCE(SUM(q.total), 0) as total_value
       FROM customers c
       LEFT JOIN quotations q ON q.customer_id = c.id
       GROUP BY c.id, c.name, c.phone, c.city, c.status
       ORDER BY total_value DESC
       LIMIT 20`
    );

    res.json({
      success: true,
      statusBreakdown: statusResult.rows,
      topCustomers: topCustomers.rows,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
