import mysql from "mysql2/promise";
import env from "./env.js";

/**
 * MySQL Connection Pool
 *
 * Uses a pool (not a single connection) so multiple requests can
 * query the database concurrently without blocking each other.
 *
 * mysql2/promise returns results as [rows, fields] arrays.
 * We wrap .query() so callers use result.rows (same API shape as before).
 */
const pool = mysql.createPool({
  host: env.db.host,
  port: env.db.port,
  database: env.db.name,
  user: env.db.user,
  password: env.db.password,
  waitForConnections: true,
  connectionLimit: 20,         // Maximum connections in pool
  queueLimit: 0,               // Unlimited queuing
  connectTimeout: 5000,        // Fail if can't connect in 5 seconds
  timezone: "+00:00",          // Store/retrieve in UTC (matches TIMESTAMPTZ behaviour)
  dateStrings: false,          // Return Date objects (not strings)
  decimalNumbers: false,       // Return DECIMAL as strings to avoid float precision loss
});

// Ensure every connection explicitly sets session time_zone to '+00:00' (UTC)
// so that database-native functions like NOW() and CURRENT_TIMESTAMP return UTC time,
// matching the pool timezone option (+00:00) and preventing offset/double-shifting bugs in the UI.
pool.on("connection", (connection) => {
  connection.query("SET time_zone = '+00:00';");
});


/**
 * Normalise mysql2 results to match the old pg API shape:
 *   result.rows        — array of row objects
 *   result.rowCount    — number of affected/returned rows
 *   result.insertId    — last inserted auto-increment id (INSERT only)
 */
function normalise(rows, meta) {
  // For SELECT: rows is an array of RowDataPacket objects
  // For INSERT/UPDATE/DELETE: rows is a ResultSetHeader, meta is undefined
  if (Array.isArray(rows)) {
    return { rows, rowCount: rows.length };
  }
  // DML statement — rows is actually ResultSetHeader
  return {
    rows: [],
    rowCount: rows.affectedRows,
    insertId: rows.insertId,
  };
}

const db = {
  /**
   * Query helper — runs a parameterized query and returns { rows, rowCount }.
   * Usage:
   *   const { rows } = await db.query("SELECT * FROM users WHERE id = ?", [userId]);
   *
   * Always use ? for parameters — NEVER concatenate values into SQL strings
   * (this prevents SQL injection attacks).
   */
  query: async (text, params) => {
    const [rows, meta] = await pool.query(text, params);
    return normalise(rows, meta);
  },

  /**
   * Execute helper — alias for query, mirrors mysql2 .execute() for prepared statements.
   */
  execute: async (text, params) => {
    const [rows, meta] = await pool.execute(text, params);
    return normalise(rows, meta);
  },

  /**
   * Get a single connection from the pool for transactions.
   * The returned connection has .query(), .execute(), .beginTransaction(),
   * .commit(), .rollback(), and .release() methods.
   *
   * Usage:
   *   const client = await db.getClient();
   *   try {
   *     await client.query("BEGIN");          // or client.beginTransaction()
   *     await client.query("INSERT INTO ...");
   *     await client.query("COMMIT");         // or client.commit()
   *   } catch (err) {
   *     await client.query("ROLLBACK");       // or client.rollback()
   *     throw err;
   *   } finally {
   *     client.release();
   *   }
   *
   * IMPORTANT: client.query() on a PoolConnection returns raw mysql2 results.
   * We wrap it below so it also returns { rows, rowCount } for consistency.
   */
  getClient: async () => {
    const conn = await pool.getConnection();

    // Wrap conn.query so route handlers get the same { rows, rowCount } shape
    const origQuery = conn.query.bind(conn);
    conn.query = async (text, params) => {
      const [rows, meta] = await origQuery(text, params);
      return normalise(rows, meta);
    };

    // Also expose beginTransaction / commit / rollback as query("BEGIN") aliases
    // for backward compat with existing route code that calls client.query("BEGIN")
    const origBegin = conn.beginTransaction.bind(conn);
    const origCommit = conn.commit.bind(conn);
    const origRollback = conn.rollback.bind(conn);

    // Override query to intercept BEGIN / COMMIT / ROLLBACK strings
    const wrappedQuery = conn.query;
    conn.query = async (text, params) => {
      const upper = typeof text === "string" ? text.trim().toUpperCase() : "";
      if (upper === "BEGIN")    { await origBegin();    return { rows: [], rowCount: 0 }; }
      if (upper === "COMMIT")   { await origCommit();   return { rows: [], rowCount: 0 }; }
      if (upper === "ROLLBACK") { await origRollback(); return { rows: [], rowCount: 0 }; }
      return wrappedQuery(text, params);
    };

    return conn;
  },

  /**
   * Test database connection — used at startup to verify DB is reachable.
   */
  testConnection: async () => {
    try {
      const [rows] = await pool.query("SELECT NOW() AS server_time");
      console.log(`✅ MySQL connected — Server time: ${rows[0].server_time}`);
      return true;
    } catch (err) {
      console.error(`❌ MySQL connection failed: ${err.message}`);
      return false;
    }
  },

  /**
   * Gracefully close all pool connections (for clean shutdown).
   */
  close: () => pool.end(),
};

export default db;
