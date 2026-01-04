/**
 * db.js
 * SQLite database module using better-sqlite3.
 * 
 * Handles persistent storage for transcripts.
 * Database location: data/app.db
 * 
 * Exposed functions:
 * - insertTranscript(data) → returns inserted row id
 * - getHistory(limit) → returns array of transcripts (latest first)
 * - deleteTranscript(id) → deletes row and returns audio_path for cleanup
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Database path
const DB_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DB_DIR, 'app.db');

// Ensure data directory exists
if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
}

// Open database (creates if not exists)
const db = new Database(DB_PATH);

// Enable WAL mode for better performance
db.pragma('journal_mode = WAL');

// Create transcripts table if not exists
db.exec(`
    CREATE TABLE IF NOT EXISTS transcripts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT,
        audio_path TEXT,
        raw_text TEXT,
        final_text TEXT,
        duration_ms INTEGER,
        model TEXT,
        status TEXT
    );
`);

console.log('[db] Database initialized:', DB_PATH);

/**
 * Insert a new transcript record
 * @param {Object} data - Transcript data
 * @param {string} data.created_at - ISO timestamp
 * @param {string} data.audio_path - Path to WAV file
 * @param {string} data.raw_text - Exact Whisper output
 * @param {string} data.final_text - Same as raw_text (no processing)
 * @param {number} data.duration_ms - Recording duration in ms (optional)
 * @param {string} data.model - Model used (e.g., 'whisper.cpp base')
 * @param {string} data.status - 'ok' or 'error'
 * @returns {number} - Inserted row id
 */
function insertTranscript(data) {
    const stmt = db.prepare(`
        INSERT INTO transcripts (created_at, audio_path, raw_text, final_text, duration_ms, model, status)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
        data.created_at,
        data.audio_path,
        data.raw_text,
        data.final_text,
        data.duration_ms || null,
        data.model,
        data.status
    );

    console.log(`[db] Inserted transcript id=${result.lastInsertRowid}`);
    return result.lastInsertRowid;
}

/**
 * Get transcript history
 * @param {number} limit - Maximum number of records to return (default: 50)
 * @returns {Array} - Array of transcript objects (latest first)
 */
function getHistory(limit = 50) {
    const stmt = db.prepare(`
        SELECT id, created_at, final_text, audio_path
        FROM transcripts
        ORDER BY id DESC
        LIMIT ?
    `);

    const rows = stmt.all(limit);
    console.log(`[db] Retrieved ${rows.length} transcripts`);
    return rows;
}

/**
 * Get a single transcript by id
 * @param {number} id - Transcript id
 * @returns {Object|null} - Transcript object or null if not found
 */
function getTranscriptById(id) {
    const stmt = db.prepare(`
        SELECT id, created_at, audio_path, raw_text, final_text, duration_ms, model, status
        FROM transcripts
        WHERE id = ?
    `);

    const row = stmt.get(id);
    if (!row) {
        console.log(`[db] Transcript id=${id} not found`);
        return null;
    }

    console.log(`[db] Retrieved transcript id=${id}`);
    return row;
}

/**
 * Update only the final_text of a transcript (for rerun)
 * @param {number} id - Transcript id
 * @param {string} finalText - New formatted text
 * @returns {boolean} - true if updated, false if not found
 */
function updateFinalText(id, finalText) {
    const stmt = db.prepare(`
        UPDATE transcripts
        SET final_text = ?
        WHERE id = ?
    `);

    const result = stmt.run(finalText, id);

    if (result.changes === 0) {
        console.log(`[db] Transcript id=${id} not found for update`);
        return false;
    }

    console.log(`[db] Updated final_text for transcript id=${id}`);
    return true;
}

/**
 * Delete a transcript by id
 * @param {number} id - Transcript id to delete
 * @returns {string|null} - audio_path of deleted record (for file cleanup), or null if not found
 */
function deleteTranscript(id) {
    // First get the audio_path for cleanup
    const selectStmt = db.prepare('SELECT audio_path FROM transcripts WHERE id = ?');
    const row = selectStmt.get(id);

    if (!row) {
        console.log(`[db] Transcript id=${id} not found`);
        return null;
    }

    // Delete the record
    const deleteStmt = db.prepare('DELETE FROM transcripts WHERE id = ?');
    deleteStmt.run(id);

    console.log(`[db] Deleted transcript id=${id}`);
    return row.audio_path;
}

/**
 * Close database connection (call on app quit)
 */
function close() {
    db.close();
    console.log('[db] Database closed');
}

module.exports = {
    insertTranscript,
    getHistory,
    getTranscriptById,
    updateFinalText,
    deleteTranscript,
    close
};
