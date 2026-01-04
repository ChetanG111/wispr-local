/**
 * audioRecorder.js
 * Main process module for raw audio recording.
 * 
 * Responsibilities:
 * - Request microphone access
 * - Record raw audio using node-record-lpcm16
 * - Save audio to disk as WAV (16-bit PCM, mono, 16kHz)
 * 
 * Exposed functions:
 * - startRecording()
 * - stopRecording() → returns { filePath }
 */

const record = require('node-record-lpcm16');
const fs = require('fs');
const path = require('path');
const logger = require('./logger');

// Recording state
let recording = null;
let fileStream = null;
let currentFilePath = null;

// Audio format constants (optimized for speech)
const SAMPLE_RATE = 16000;  // 16 kHz - optimal for speech recognition
const CHANNELS = 1;         // Mono
const BIT_DEPTH = 16;       // 16-bit PCM

// Output directory state
let recordingsBaseDir = null;

function init(baseDir) {
    recordingsBaseDir = baseDir;
}

function getSoxPath() {
    // Check if we are in a packaged environment
    // We expect SoX to be in resources/sox/sox.exe
    if (process.resourcesPath) {
        const bundledPath = path.join(process.resourcesPath, 'sox', 'sox.exe');
        if (fs.existsSync(bundledPath)) {
            logger.log(`[audioRecorder] Using bundled SoX: ${bundledPath}`);
            return bundledPath;
        }
    }
    
    // Fallback to system path or known location
    const systemPath = 'C:\\Program Files (x86)\\sox-14-4-2\\sox.exe';
    if (fs.existsSync(systemPath)) {
        logger.log(`[audioRecorder] Using system SoX: ${systemPath}`);
        return systemPath;
    }

    // Last resort: assume it's in PATH
    logger.log('[audioRecorder] Using SoX from PATH');
    return 'sox';
}

/**
 * Get the recordings directory path, creating it if necessary
 */
function getRecordingsDir() {
    if (!recordingsBaseDir) {
        throw new Error('Audio recorder not initialized with base directory');
    }
    const recordingsDir = path.join(recordingsBaseDir, 'audio', 'recordings');

    // Ensure directory exists
    if (!fs.existsSync(recordingsDir)) {
        fs.mkdirSync(recordingsDir, { recursive: true });
    }

    return recordingsDir;
}

/**
 * Generate a unique filename based on current timestamp
 * Format: YYYY-MM-DD_HH-MM-SS.wav
 */
function generateFilename() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');

    return `${year}-${month}-${day}_${hours}-${minutes}-${seconds}.wav`;
}

/**
 * Write WAV header to file stream
 * WAV format: 16-bit PCM, mono, 16kHz
 */
function writeWavHeader(stream, dataLength) {
    const buffer = Buffer.alloc(44);

    // RIFF chunk descriptor
    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(36 + dataLength, 4);  // File size - 8
    buffer.write('WAVE', 8);

    // fmt sub-chunk
    buffer.write('fmt ', 12);
    buffer.writeUInt32LE(16, 16);              // Subchunk1Size (16 for PCM)
    buffer.writeUInt16LE(1, 20);               // AudioFormat (1 = PCM)
    buffer.writeUInt16LE(CHANNELS, 22);        // NumChannels
    buffer.writeUInt32LE(SAMPLE_RATE, 24);     // SampleRate
    buffer.writeUInt32LE(SAMPLE_RATE * CHANNELS * (BIT_DEPTH / 8), 28);  // ByteRate
    buffer.writeUInt16LE(CHANNELS * (BIT_DEPTH / 8), 32);  // BlockAlign
    buffer.writeUInt16LE(BIT_DEPTH, 34);       // BitsPerSample

    // data sub-chunk
    buffer.write('data', 36);
    buffer.writeUInt32LE(dataLength, 40);      // Subchunk2Size

    stream.write(buffer);
}

/**
 * Update WAV header with final data size
 */
function updateWavHeader(filePath, dataLength) {
    const fd = fs.openSync(filePath, 'r+');
    const buffer = Buffer.alloc(4);

    // Update RIFF chunk size (file size - 8)
    buffer.writeUInt32LE(36 + dataLength, 0);
    fs.writeSync(fd, buffer, 0, 4, 4);

    // Update data chunk size
    buffer.writeUInt32LE(dataLength, 0);
    fs.writeSync(fd, buffer, 0, 4, 40);

    fs.closeSync(fd);
}

/**
 * Start recording audio from the microphone
 */
function startRecording() {
    // Prevent multiple simultaneous recordings
    if (recording) {
        logger.log('[audioRecorder] Already recording, ignoring start request');
        return;
    }

    try {
        const recordingsDir = getRecordingsDir();
        const filename = generateFilename();
        currentFilePath = path.join(recordingsDir, filename);
        const soxPath = getSoxPath();

        logger.log(`[audioRecorder] Starting recording: ${currentFilePath}`);

        // Create file stream and write placeholder WAV header
        fileStream = fs.createWriteStream(currentFilePath);
        writeWavHeader(fileStream, 0);  // Placeholder, will update on stop

        // Start recording with SoX
        recording = record.record({
            sampleRate: SAMPLE_RATE,
            channels: CHANNELS,
            audioType: 'wav',      // Direct WAV output
            recorder: 'sox',       // Use SoX on Windows
            soxPath: soxPath,     
            threshold: 0,          // Start immediately, no silence detection
            silence: '0',          // No silence trimming
            endOnSilence: false,   // Don't stop on silence
        });

        // Track data length for WAV header update
        let dataLength = 0;

        recording.stream()
            .on('data', (chunk) => {
                if (fileStream && fileStream.writable) {
                    fileStream.write(chunk);
                    dataLength += chunk.length;
                }
            })
            .on('error', (err) => {
                logger.error(`[audioRecorder] Recording stream error: ${err.message}`);
                cleanup();
            })
            .on('end', () => {
                logger.log(`[audioRecorder] Recording ended, data length: ${dataLength} bytes`);
            });

        // Store data length reference for stop function
        recording._dataLength = 0;
        recording.stream().on('data', (chunk) => {
            recording._dataLength += chunk.length;
        });

    } catch (err) {
        logger.error(`[audioRecorder] Failed to start recording: ${err.message}`);
        cleanup();
        throw err; // Rethrow so caller knows
    }
}

/**
 * Stop recording and save the audio file
 * @returns {{ filePath: string } | null} Object with file path, or null on failure
 */
function stopRecording() {
    if (!recording) {
        logger.log('[audioRecorder] Not recording, ignoring stop request');
        return null;
    }

    const filePath = currentFilePath;
    const dataLength = recording._dataLength || 0;

    logger.log(`[audioRecorder] Stopping recording: ${filePath}`);

    try {
        // Stop the recording
        recording.stop();

        // Close the file stream
        if (fileStream) {
            fileStream.end(() => {
                // Update WAV header with actual data length
                if (filePath && fs.existsSync(filePath)) {
                    try {
                        updateWavHeader(filePath, dataLength);
                        logger.log(`[audioRecorder] WAV header updated, total size: ${dataLength + 44} bytes`);
                    } catch (err) {
                        logger.error(`[audioRecorder] Failed to update WAV header: ${err.message}`);
                    }
                }
            });
        }

        cleanup();

        return { filePath };

    } catch (err) {
        logger.error(`[audioRecorder] Failed to stop recording: ${err.message}`);
        cleanup();
        return null;
    }
}

/**
 * Clean up recording state
 */
function cleanup() {
    recording = null;
    fileStream = null;
    currentFilePath = null;
}

module.exports = {
    startRecording,
    stopRecording,
    init
};
