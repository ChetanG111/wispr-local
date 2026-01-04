const fs = require('fs');
const path = require('path');
const { app } = require('electron');

let logPath;

function init() {
    logPath = path.join(app.getPath('userData'), 'debug.log');
    // Clear old log
    fs.writeFileSync(logPath, '');
}

function log(message) {
    if (!logPath) return;
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}\n`;
    try {
        fs.appendFileSync(logPath, logMessage);
    } catch (e) {
        // ignore
    }
}

function error(message) {
    log(`ERROR: ${message}`);
}

module.exports = { init, log, error };
