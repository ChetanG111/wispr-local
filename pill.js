const { ipcRenderer } = require('electron');
const sound = require('./sound');

const pill = document.getElementById('pill');

const states = ['idle', 'recording', 'loading'];
let currentStateIndex = 0;

const infoMenu = document.getElementById('info-menu');
let infoTimeout;
let hidingTimeout;
let pendingShowTimer;

// Passthrough logic for transparent window
// By default, ignore mouse events (let them pass through)
const win = require('electron').remote?.getCurrentWindow() || { setIgnoreMouseEvents: () => { } }; // Fallback if remote not enabled, but we use IPC usually. 
// Actually since nodeIntegration is true and contextIsolation false in main.js, we can require electron.
const currentWindow = require('electron').remote?.getCurrentWindow() || require('electron').desktopCapturer ? null : null; // remote is deprecated.

// Better approach: Use mouse events to toggle ignore
window.addEventListener('mousemove', (event) => {
    // Check if hovering over pill or info-menu
    const elem = document.elementFromPoint(event.clientX, event.clientY);
    const isInteractive = elem && (elem.closest('.pill') || elem.closest('.info-menu'));

    if (isInteractive) {
        ipcRenderer.send('set-ignore-mouse-events', false);
    } else {
        ipcRenderer.send('set-ignore-mouse-events', true, { forward: true });
    }
});

function showInfo(htmlContent, duration = 4000) {
    // Clear any pending hiding cleanup
    if (hidingTimeout) clearTimeout(hidingTimeout);
    infoMenu.classList.remove('hiding');

    infoMenu.innerHTML = htmlContent;

    // Force reflow and ensure display is flex so we can transition
    infoMenu.classList.remove('show');
    void infoMenu.offsetWidth;
    infoMenu.classList.add('show');

    if (infoTimeout) clearTimeout(infoTimeout);

    if (duration > 0) {
        infoTimeout = setTimeout(() => {
            hideInfo();
        }, duration);
    }
}

function hideInfo() {
    if (infoTimeout) clearTimeout(infoTimeout);

    if (infoMenu.classList.contains('show')) {
        infoMenu.classList.remove('show');
        infoMenu.classList.add('hiding');

        if (hidingTimeout) clearTimeout(hidingTimeout);
        // Wait for animation (300ms)
        hidingTimeout = setTimeout(() => {
            infoMenu.classList.remove('hiding');
        }, 300);
    } else {
        infoMenu.classList.remove('hiding');
    }
}

function setIdle() {
    pill.className = 'pill idle';
    currentStateIndex = 0;
}

function setRecording() {
    hideInfo(); // Hide any existing info menu
    if (pendingShowTimer) clearTimeout(pendingShowTimer);
    pill.className = 'pill recording';
    currentStateIndex = 1;
}

function setLoading() {
    if (pendingShowTimer) clearTimeout(pendingShowTimer);
    pill.className = 'pill loading';
    currentStateIndex = 2;
}

// State tracking for delayed recording
let recordingDelayTimer = null;
let isRecordingActive = false;

// Listen for start recording (Hold Start)
ipcRenderer.on('start-recording', () => {
    sound.play('start');
    setRecording(); // Visual feedback immediately

    // Delay actual audio capture to allow sound to play and user to settle (300ms)
    recordingDelayTimer = setTimeout(() => {
        isRecordingActive = true;
        ipcRenderer.send('audio:start');
        recordingDelayTimer = null;
    }, 300);
});

// Listen for stop recording (Release)
ipcRenderer.on('stop-recording', () => {
    sound.play('stop');

    if (recordingDelayTimer) {
        // User released key too quickly (Tap) - Cancel recording
        clearTimeout(recordingDelayTimer);
        recordingDelayTimer = null;
        isRecordingActive = false;

        setIdle(); // Reset UI immediately
        showInfo('<span>Hold Space to record</span>', 2000);
    } else if (isRecordingActive) {
        // Normal flow: Recording was active, now stop it
        setLoading();
        ipcRenderer.send('audio:stop');
        isRecordingActive = false;
    } else {
        // Fallback
        setIdle();
    }
});

// Listen for generic notification requests
ipcRenderer.on('show-notification', (event, data) => {
    // Data can be a string or object { text, duration }
    if (typeof data === 'string') {
        showInfo(`<span>${data}</span>`, 4000);
    } else if (data && data.text) {
        showInfo(`<span>${data.text}</span>`, data.duration || 4000);
    }
});

// Listen for transcription complete (from main process after Whisper finishes)
ipcRenderer.on('transcription-complete', (event, text) => {
    console.log('[pill] Transcription complete:', text);
    setIdle();

    if (!text || text.trim() === '') {
        // Edge case: Failure or empty audio
        // Wait for pill to collapse (600ms) + slight delay (50ms)
        pendingShowTimer = setTimeout(() => {
            showInfo('<span>No speech detected</span>', 3000);
        }, 650);
    }
});
