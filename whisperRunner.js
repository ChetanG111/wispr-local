/**
 * whisperRunner.js
 * Main process module for Whisper transcription.
 * 
 * Spawns whisper-cli.exe to transcribe WAV files.
 * Returns plain text only (no timestamps).
 * 
 * Exposed functions:
 * - transcribe(wavPath) → Promise<string>
 */

const { spawn } = require('child_process');
const path = require('path');
const logger = require('./logger');

// Paths state
let whisperCliPath = null;
let whisperModelPath = null;
let currentProcess = null;

function init(cliPath, modelPath) {
    whisperCliPath = cliPath;
    whisperModelPath = modelPath;
}

/**
 * Transcribe a WAV file using Whisper
 * @param {string} wavPath - Absolute path to the WAV file
 * @returns {Promise<string>} - Transcribed text (plain text, no timestamps)
 */
function transcribe(wavPath) {
    return new Promise((resolve, reject) => {
        if (!whisperCliPath || !whisperModelPath) {
            reject(new Error('Whisper runner not initialized with paths'));
            return;
        }

        logger.log(`[whisperRunner] Transcribing: ${wavPath}`);
        logger.log(`[whisperRunner] Using model: ${whisperModelPath}`);
        logger.log(`[whisperRunner] Using CLI: ${whisperCliPath}`);

        // Spawn whisper-cli.exe with required arguments
        // -m: model path
        // -f: input file path
        // -nt: no timestamps
        // -np: no progress output
        const args = [
            '-m', whisperModelPath,
            '-f', wavPath,
            '-nt',
            '-np'
        ];

        const whisperProcess = spawn(whisperCliPath, args, {
            cwd: path.dirname(whisperCliPath),
            windowsHide: true
        });

        currentProcess = whisperProcess;

        let stdout = '';
        let stderr = '';

        whisperProcess.stdout.on('data', (data) => {
            stdout += data.toString();
        });

        whisperProcess.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        whisperProcess.on('error', (err) => {
            currentProcess = null;
            logger.error(`[whisperRunner] Failed to spawn whisper-cli: ${err.message}`);
            reject(new Error(`Failed to spawn whisper-cli: ${err.message}`));
        });

        whisperProcess.on('close', (code) => {
            currentProcess = null;
            if (code !== 0) {
                logger.error(`[whisperRunner] whisper-cli exited with code ${code}`);
                logger.error(`[whisperRunner] stderr: ${stderr}`);
                reject(new Error(`whisper-cli exited with code ${code}: ${stderr}`));
                return;
            }

            // Clean up the output - trim whitespace
            const transcription = stdout.trim();
            logger.log(`[whisperRunner] Transcription complete: "${transcription.substring(0, 100)}${transcription.length > 100 ? '...' : ''}"`);
            resolve(transcription);
        });
    });
}

/**
 * Cancel the current transcription process if running
 */
function cancel() {
    if (currentProcess) {
        logger.log('[whisperRunner] Killing active Whisper process');
        currentProcess.kill();
        currentProcess = null;
    }
}

module.exports = {
    transcribe,
    init,
    cancel
};
