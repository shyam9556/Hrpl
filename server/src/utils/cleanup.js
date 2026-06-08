import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import db from "../config/database.js";
import env from "../config/env.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function cleanupOrphanedDocuments() {
  try {
    // UPLOADS_DIR is relative to the server root (which is two levels up from src/utils)
    const UPLOADS_DIR = path.normalize(
      path.isAbsolute(env.upload.dir)
        ? env.upload.dir
        : path.resolve(__dirname, "../..", env.upload.dir)
    );

    // 1. Find and delete documents whose parent entities (quotation/dealer_registration/customer) do not exist
    const missingParentResult = await db.query(`
      SELECT d.id, d.file_path, d.original_name, d.entity_type, d.entity_id 
      FROM documents d 
      LEFT JOIN quotations q ON d.entity_type = 'quotation' AND d.entity_id = q.id 
      LEFT JOIN dealer_registrations r ON d.entity_type = 'dealer_registration' AND d.entity_id = r.id 
      LEFT JOIN customers c ON d.entity_type = 'customer' AND d.entity_id = c.id 
      WHERE (d.entity_type = 'quotation' AND q.id IS NULL)
         OR (d.entity_type = 'dealer_registration' AND r.id IS NULL)
         OR (d.entity_type = 'customer' AND c.id IS NULL)
    `);

    const toDeleteDbIds = new Set();

    // Delete files on disk for missing parents
    for (const doc of missingParentResult.rows) {
      const fullPath = path.normalize(path.join(UPLOADS_DIR, doc.file_path));
      if (fs.existsSync(fullPath)) {
        try {
          fs.unlinkSync(fullPath);
          console.log(`[CLEANUP] Deleted physical file for orphaned document ID ${doc.id} (Parent entity ${doc.entity_type} #${doc.entity_id} missing): ${doc.file_path}`);
        } catch (unlinkErr) {
          console.error(`[CLEANUP] Failed to delete physical file ${fullPath}:`, unlinkErr.message);
        }
      }
      toDeleteDbIds.add(doc.id);
    }

    // 2. Scan remaining documents to check if their physical files are missing on disk
    const allDocsResult = await db.query("SELECT id, file_path FROM documents");
    for (const doc of allDocsResult.rows) {
      if (toDeleteDbIds.has(doc.id)) continue;
      const fullPath = path.normalize(path.join(UPLOADS_DIR, doc.file_path));
      if (!fs.existsSync(fullPath)) {
        toDeleteDbIds.add(doc.id);
        console.log(`[CLEANUP] Found database record for ID ${doc.id} with missing physical file on disk: ${doc.file_path}`);
      }
    }

    // 3. Delete all accumulated orphaned records from database
    if (toDeleteDbIds.size > 0) {
      const toDeleteArray = Array.from(toDeleteDbIds);
      const placeholders = toDeleteArray.map(() => "?").join(", ");
      await db.query(`DELETE FROM documents WHERE id IN (${placeholders})`, toDeleteArray);
      console.log(`[CLEANUP] Deleted ${toDeleteDbIds.size} orphaned document records from database.`);

      // Reset geotag flags for quotations that have no geotags left in the database
      const qUpdate = await db.query(`
        UPDATE quotations q 
        SET geotag_uploaded = 0, 
            geotag_submitted = 0, 
            geotag_needs_review = 0 
        WHERE NOT EXISTS (
          SELECT 1 FROM documents d 
          WHERE d.entity_type = 'quotation' 
            AND d.entity_id = q.id 
            AND d.doc_type IN ('geotag_1', 'geotag_2', 'geotag_3')
        )
      `);
      console.log(`[CLEANUP] Reset geotag flags for ${qUpdate.rowCount || qUpdate.affectedRows || 0} quotations.`);
    } else {
      console.log("[CLEANUP] No orphaned documents found.");
    }
  } catch (err) {
    console.error("[CLEANUP] Error during orphaned documents cleanup:", err.message);
  }
}
