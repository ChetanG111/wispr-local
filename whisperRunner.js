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

// Paths relative to project root
const WHISPER_CLI = path.join(__dirname, 'whisper', 'bin', 'whisper-cli.exe');
const WHISPER_MODEL = path.join(__dirname, 'whisper', 'models', 'ggml-base.en.bin');

/**
 * Transcribe a WAV file using Whisper
 * @param {string} wavPath - Absolute path to the WAV file
 * @returns {Promise<string>} - Transcribed text (plain text, no timestamps)
 */
function transcribe(wavPath) {
    return new Promise((resolve, reject) => {
        console.log(`[whisperRunner] Transcribing: ${wavPath}`);
        console.log(`[whisperRunner] Using model: ${WHISPER_MODEL}`);
        console.log(`[whisperRunner] Using CLI: ${WHISPER_CLI}`);

        // Spawn whisper-cli.exe with required arguments
        // -m: model path
        // -f: input file path
        // -nt: no timestamps
        // -np: no progress output
        const args = [
            '-m', WHISPER_MODEL,
            '-f', wavPath,
            '-nt',
            '-np'
        ];

        const whisperProcess = spawn(WHISPER_CLI, args, {
            cwd: path.dirname(WHISPER_CLI),
            windowsHide: true
        });

        let stdout = '';
        let stderr = '';

        whisperProcess.stdout.on('data', (data) => {
            stdout += data.toString();
        });

        whisperProcess.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        whisperProcess.on('error', (err) => {
            console.error(`[whisperRunner] Failed to spawn whisper-cli: ${err.message}`);
            reject(new Error(`Failed to spawn whisper-cli: ${err.message}`));
        });

        whisperProcess.on('close', (code) => {
            if (code !== 0) {
                console.error(`[whisperRunner] whisper-cli exited with code ${code}`);
                console.error(`[whisperRunner] stderr: ${stderr}`);
                reject(new Error(`whisper-cli exited with code ${code}: ${stderr}`));
                return;
            }

            // Clean up the output - trim whitespace
            const transcription = stdout.trim();
            console.log(`[whisperRunner] Transcription complete: "${transcription.substring(0, 100)}${transcription.length > 100 ? '...' : ''}"`);
            resolve(transcription);
        });
    });
}

module.exports = {
    transcribe
};
