import { Router } from "express";

import db from "../config/database.js";
import { authenticate, authorize } from "../middleware/auth.js";

const router = Router();

router.use(authenticate);

// ─── GET /api/dashboard ──────────────────────────────────
// Dashboard summary cards — admin sees all, dealer sees own
router.get("/", async (req, res, next) => {
  try {
    const isAdmin = req.user.role === "admin";
    const dealerFilter = isAdmin ? "" : "AND q.dealer_id = ?";
    const dealerParam = isAdmin ? [] : [req.user.id];

    // Run all queries in parallel for speed
    const [
      totalQuotations,
      pendingQuotations,
      approvedQuotations,
      totalRevenue,
      totalCustomers,
      totalDealers,
      pendingRegistrations,
      recentQuotations,
    ] = await Promise.all([
      // 1. Total quotations
      db.query(
        `SELECT COUNT(*) as count FROM quotations q WHERE 1=1 ${dealerFilter}`,
        dealerParam
      ),
      // 2. Pending quotations
      db.query(
        `SELECT COUNT(*) as count FROM quotations q WHERE status = 'Pending' ${dealerFilter}`,
        dealerParam
      ),
      // 3. Approved quotations
      db.query(
        `SELECT COUNT(*) as count FROM quotations q WHERE status = 'Approved' ${dealerFilter}`,
        dealerParam
      ),
      // 4. Total revenue (sum of approved quotations)
      db.query(
        `SELECT COALESCE(SUM(total), 0) as total_revenue,
                COALESCE(SUM(effective_price), 0) as effective_revenue
         FROM quotations q WHERE status = 'Approved' ${dealerFilter}`,
        dealerParam
      ),
      // 5. Total customers
      isAdmin
        ? db.query("SELECT COUNT(*) as count FROM customers")
        : db.query("SELECT COUNT(*) as count FROM customers WHERE created_by = ?", [req.user.id]),
      // 6. Total dealers (admin only)
      isAdmin
        ? db.query("SELECT COUNT(*) as count FROM users WHERE role = 'dealer'")
        : Promise.resolve({ rows: [{ count: 0 }] }),
      // 7. Pending registrations (admin only)
      isAdmin
        ? db.query("SELECT COUNT(*) as count FROM dealer_registrations WHERE status = 'Pending'")
        : Promise.resolve({ rows: [{ count: 0 }] }),
      // 8. Recent 5 quotations
      db.query(
        `SELECT q.id, q.quotation_number, q.system_kw, q.total, q.effective_price,
                q.status, q.created_at, c.name as customer_name,
                u.name as dealer_name
         FROM quotations q
         LEFT JOIN customers c ON c.id = q.customer_id
         JOIN users u ON u.id = q.dealer_id
         WHERE 1=1 ${dealerFilter}
         ORDER BY q.created_at DESC LIMIT 5`,
        dealerParam
      ),
    ]);

    res.json({
      success: true,
      dashboard: {
        stats: {
          totalQuotations: parseInt(totalQuotations.rows[0].count, 10),
          pendingQuotations: parseInt(pendingQuotations.rows[0].count, 10),
          approvedQuotations: parseInt(approvedQuotations.rows[0].count, 10),
          totalRevenue: parseFloat(totalRevenue.rows[0].total_revenue),
          effectiveRevenue: parseFloat(totalRevenue.rows[0].effective_revenue),
          totalCustomers: parseInt(totalCustomers.rows[0].count, 10),
          totalDealers: parseInt(totalDealers.rows[0].count, 10),
          pendingRegistrations: parseInt(pendingRegistrations.rows[0].count, 10),
        },
        recentQuotations: recentQuotations.rows,
        // monthlyStats reserved for future chart feature
      },
    });
  } catch (err) {
    next(err);
  }
});

export default router;
