const { app, BrowserWindow, screen, globalShortcut, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const audioRecorder = require('./audioRecorder');
const { transcribe } = require('./whisperRunner');
const db = require('./db');

let pillWindow;
let transcriptWindow;

function createPillWindow() {
    const display = screen.getPrimaryDisplay();

    // Use full screen bounds for horizontal centering (pill center = screen center)
    const screenBounds = display.bounds;
    // Use work area for vertical positioning (above taskbar)
    const workArea = display.workAreaSize;

    // Window size (Large enough to allow for animation overshoot/bounce without clipping)
    const windowWidth = 150;
    const windowHeight = 60;

    // Center of screen = screenBounds.width / 2
    // Window x = center of screen - half of window width
    const centerX = Math.round((screenBounds.width / 2) - (windowWidth / 2));

    // Position window bottom 10px above taskbar
    // Y = WorkArea Bottom - Window Height - Margin
    const bottomY = workArea.height - windowHeight - 10;

    pillWindow = new BrowserWindow({
        width: windowWidth,
        height: windowHeight,
        x: centerX,
        y: bottomY,
        transparent: true,
        frame: false,
        resizable: false,
        alwaysOnTop: true,
        skipTaskbar: true,
        focusable: false,
        hasShadow: false,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    pillWindow.loadFile('index.html');

    // Prevent window from being closed accidentally
    pillWindow.on('close', (e) => {
        if (!app.isQuitting) {
            e.preventDefault();
        }
    });
}

function createTranscriptWindow() {
    const display = screen.getPrimaryDisplay();
    const workArea = display.workAreaSize;

    // Reasonable floating window size (not fullscreen)
    const windowWidth = 380;
    const windowHeight = 520;

    // Center the window on screen
    const centerX = Math.round((workArea.width - windowWidth) / 2);
    const centerY = Math.round((workArea.height - windowHeight) / 2);

    transcriptWindow = new BrowserWindow({
        width: windowWidth,
        height: windowHeight,
        x: centerX,
        y: centerY,
        transparent: true,
        frame: false,
        resizable: true,
        minWidth: 320,
        minHeight: 400,
        maxWidth: 600,
        maxHeight: 800,
        show: false, // Hidden by default
        skipTaskbar: false,
        hasShadow: false, // Disable window shadow for clean edges
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    transcriptWindow.loadFile('transcript-window.html');

    // Handle window close - hide instead of destroy
    transcriptWindow.on('close', (e) => {
        if (!app.isQuitting) {
            e.preventDefault();
            transcriptWindow.hide();
        }
    });
}

// Helper to show transcript window (can be called from IPC or menu)
function showTranscriptWindow() {
    if (transcriptWindow) {
        transcriptWindow.show();
        transcriptWindow.focus();
    }
}

app.whenReady().then(() => {
    createPillWindow();
    createTranscriptWindow();

    /* 
       Using uiohook-napi for global key release detection (Hold-to-Talk).
       This allows us to detect when the user *releases* keys.
    */
    const { uIOhook, UiohookKey } = require('uiohook-napi');

    let isCtrlPressed = false;
    let isSpacePressed = false;
    let isRecording = false;

    uIOhook.on('keydown', (e) => {
        if (e.keycode === UiohookKey.Ctrl) isCtrlPressed = true;
        if (e.keycode === UiohookKey.Space) isSpacePressed = true;

        if (isCtrlPressed && isSpacePressed && !isRecording) {
            isRecording = true;
            if (pillWindow) pillWindow.webContents.send('start-recording');
        }
    });

    uIOhook.on('keyup', (e) => {
        if (e.keycode === UiohookKey.Ctrl) isCtrlPressed = false;
        if (e.keycode === UiohookKey.Space) isSpacePressed = false;

        // If either key is released, stop recording
        if ((!isCtrlPressed || !isSpacePressed) && isRecording) {
            isRecording = false;
            if (pillWindow) pillWindow.webContents.send('stop-recording');
        }
    });

    uIOhook.start();

    // Register global shortcut to toggle transcript window (Ctrl+Shift+T)
    globalShortcut.register('CommandOrControl+Shift+T', () => {
        if (transcriptWindow) {
            if (transcriptWindow.isVisible()) {
                transcriptWindow.hide();
            } else {
                transcriptWindow.show();
                transcriptWindow.focus();
            }
        }
    });

    // IPC handler for close button in transcript window
    ipcMain.on('hide-transcript-window', () => {
        if (transcriptWindow) {
            transcriptWindow.hide();
        }
    });

    // IPC handlers for audio recording
    ipcMain.on('audio:start', () => {
        console.log('[main] Received audio:start');
        try {
            audioRecorder.startRecording();
        } catch (err) {
            console.error('[main] Failed to start recording:', err.message);
        }
    });

    ipcMain.on('audio:stop', async () => {
        console.log('[main] Received audio:stop');
        try {
            const result = audioRecorder.stopRecording();
            if (result && result.filePath) {
                console.log('[main] Recording saved:', result.filePath);

                // Small delay to ensure WAV file is fully written
                await new Promise(resolve => setTimeout(resolve, 200));

                // Run Whisper transcription
                console.log('[main] Starting Whisper transcription...');
                try {
                    const text = await transcribe(result.filePath);
                    console.log('[main] Transcription result:', text);

                    // Save to database (raw_text = final_text, no processing)
                    db.insertTranscript({
                        created_at: new Date().toISOString(),
                        audio_path: result.filePath,
                        raw_text: text,
                        final_text: text,
                        duration_ms: null,
                        model: 'whisper.cpp base',
                        status: 'ok'
                    });

                    // Send transcription to renderer
                    if (pillWindow) {
                        pillWindow.webContents.send('transcription-complete', text);
                    }
                } catch (transcribeErr) {
                    console.error('[main] Transcription failed:', transcribeErr.message);

                    // Save error to database (keep WAV for debugging)
                    db.insertTranscript({
                        created_at: new Date().toISOString(),
                        audio_path: result.filePath,
                        raw_text: '',
                        final_text: '',
                        duration_ms: null,
                        model: 'whisper.cpp base',
                        status: 'error'
                    });

                    // Still notify renderer so it can reset state
                    if (pillWindow) {
                        pillWindow.webContents.send('transcription-complete', '');
                    }
                }
            } else {
                // No file saved, send empty result
                if (pillWindow) {
                    pillWindow.webContents.send('transcription-complete', '');
                }
            }
        } catch (err) {
            console.error('[main] Failed to stop recording:', err.message);
            // Notify renderer on error
            if (pillWindow) {
                pillWindow.webContents.send('transcription-complete', '');
            }
        }
    });

    // IPC handler for loading history
    ipcMain.handle('history:load', (event, limit = 50) => {
        console.log('[main] Loading history, limit:', limit);
        return db.getHistory(limit);
    });

    // IPC handler for deleting a transcript
    ipcMain.handle('history:delete', (event, id) => {
        console.log('[main] Deleting transcript id:', id);
        const audioPath = db.deleteTranscript(id);

        // Delete the audio file from disk
        if (audioPath && fs.existsSync(audioPath)) {
            try {
                fs.unlinkSync(audioPath);
                console.log('[main] Deleted audio file:', audioPath);
            } catch (err) {
                console.error('[main] Failed to delete audio file:', err.message);
            }
        }

        return { success: true };
    });
});

// Clean up hook on quit
app.on('will-quit', () => {
    // We don't need to explicitly stop uIOhook here as the process is dying,
    // but unregistering globalShortcut is good practice if any were used.
});

app.on('window-all-closed', () => {
    app.quit();
});

app.on('before-quit', () => {
    app.isQuitting = true;
    // Close database connection
    db.close();
});

