import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import db from "../config/database.js";
import env from "../config/env.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function cleanupOrphanedDocuments() {
  try {
    const result = await db.query("SELECT id, entity_type, entity_id, doc_type, file_path, original_name FROM documents");
    
    // UPLOADS_DIR is relative to the server root (which is two levels up from src/utils)
    const UPLOADS_DIR = path.normalize(
      path.isAbsolute(env.upload.dir)
        ? env.upload.dir
        : path.resolve(__dirname, "../..", env.upload.dir)
    );

    const toDelete = [];
    for (const doc of result.rows) {
      const fullPath = path.normalize(path.join(UPLOADS_DIR, doc.file_path));
      if (!fs.existsSync(fullPath)) {
        toDelete.push(doc.id);
        console.log(`[CLEANUP] Found orphaned database record for ID ${doc.id} (Missing file: ${doc.file_path})`);
      }
    }

    if (toDelete.length > 0) {
      const placeholders = toDelete.map(() => "?").join(", ");
      await db.query(`DELETE FROM documents WHERE id IN (${placeholders})`, toDelete);
      console.log(`[CLEANUP] Deleted ${toDelete.length} orphaned document records from database.`);

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
    }
  } catch (err) {
    console.error("[CLEANUP] Error during orphaned documents cleanup:", err.message);
  }
}
