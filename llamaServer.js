/**
 * llamaServer.js
 * Manages the local llama.cpp server instance.
 * 
 * Responsibilities:
 * - Start the server process (llama-server.exe)
 * - Ensure single instance
 * - Manage lifecycle (start on boot, kill on quit)
 * - Handle errors/crashes
 */

const { spawn } = require('child_process');
const path = require('path');
const logger = require('./logger');
const http = require('http');

let serverProcess = null;
let isStarting = false;

// Configuration
const HOST = '127.0.0.1';
const PORT = 8089;

/**
 * Start the llama-server process
 * @param {string} executablePath - Path to llama-server.exe
 * @param {string} modelPath - Path to the GGUF model file
 */
/**
 * Start the llama-server process
 * @param {string} executablePath - Path to llama-server.exe
 * @param {string} modelPath - Path to the GGUF model file
 * @param {Function} onReady - Callback when server is HTTP 200 OK
 */
function start(executablePath, modelPath, onReady) {
    if (serverProcess || isStarting) {
        logger.log('[llamaServer] Server already running or starting');
        return;
    }

    isStarting = true;
    logger.log(`[llamaServer] Starting server on port ${PORT}...`);

    const args = [
        '-m', modelPath,
        '--port', PORT.toString(),
        '--host', HOST,
        '-c', '2048'
    ];

    try {
        serverProcess = spawn(executablePath, args, {
            windowsHide: true,
            stdio: ['ignore', 'ignore', 'pipe']
        });

        serverProcess.stderr.on('data', (data) => {
            logger.error(`[llama-server] ${data.toString()}`);
        });

        serverProcess.on('spawn', () => {
            logger.log('[llamaServer] Process spawned, waiting for health check...');
            // Start polling for readiness
            waitForHealth(onReady);
        });

        serverProcess.on('error', (err) => {
            logger.error(`[llamaServer] Failed to spawn: ${err.message}`);
            isStarting = false;
            serverProcess = null;
        });

        serverProcess.on('close', (code) => {
            logger.log(`[llamaServer] Process exited with code ${code}`);
            serverProcess = null;
            isStarting = false;
        });

    } catch (e) {
        logger.error(`[llamaServer] Exception starting server: ${e.message}`);
        isStarting = false;
    }
}

function waitForHealth(callback) {
    let attempts = 0;
    const maxAttempts = 60; // 30 seconds

    const interval = setInterval(() => {
        attempts++;
        const req = http.get(`http://${HOST}:${PORT}/health`, (res) => {
            if (res.statusCode === 200) {
                logger.log('[llamaServer] Server is healthy and ready!');
                clearInterval(interval);
                isStarting = false;
                if (callback) callback();
            }
        });

        req.on('error', () => {
            // Still starting...
        });
        req.end();

        if (attempts >= maxAttempts) {
            clearInterval(interval);
            logger.error('[llamaServer] Timed out waiting for server health');
            isStarting = false;
        }
    }, 500);
}

/**
 * Stop the server process
 */
function stop() {
    if (serverProcess) {
        logger.log('[llamaServer] Stopping server...');
        serverProcess.kill();
        serverProcess = null;
    }
}

/**
 * Check if server is ready by pinging /health or root
 * @returns {Promise<boolean>}
 */
function isReady() {
    return new Promise((resolve) => {
        const req = http.get(`http://${HOST}:${PORT}/health`, (res) => {
            resolve(res.statusCode === 200);
        });

        req.on('error', () => {
            resolve(false);
        });

        req.end();
    });
}

module.exports = {
    start,
    stop,
    isReady
};
