const { app, BrowserWindow, screen, globalShortcut, ipcMain, Tray, Menu, nativeImage, clipboard, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const audioRecorder = require('./audioRecorder');
const whisperRunner = require('./whisperRunner');
const db = require('./db');
const { format } = require('./formatter');
const logger = require('./logger');

let pillWindow;
let transcriptWindow;
let tray;

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

    // Position window relative to taskbar
    // Y = WorkArea Bottom - Window Height + Manual Offset
    const bottomY = workArea.height - windowHeight + 9;

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
        skipTaskbar: true,
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

function createTray() {
    const iconPath = path.join(__dirname, 'tray-icon.png');
    // Resize icon to suitable size (16x16 is standard for Windows tray)
    const trayIcon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
    tray = new Tray(trayIcon);
    tray.setToolTip('Wispr Local');

    const contextMenu = Menu.buildFromTemplate([
        {
            label: 'Open History',
            click: () => showTranscriptWindow()
        },
        {
            label: 'Quit',
            click: () => {
                app.isQuitting = true;
                app.quit();
            }
        }
    ]);
    tray.setContextMenu(contextMenu);
}

// Helper to show transcript window (can be called from IPC or menu)
function showTranscriptWindow() {
    if (transcriptWindow) {
        transcriptWindow.show();
        transcriptWindow.focus();
    }
}

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
    app.quit();
} else {
    app.on('second-instance', (event, commandLine, workingDirectory) => {
        // Someone tried to run a second instance, we should focus our window.
        if (transcriptWindow) {
            if (transcriptWindow.isMinimized()) transcriptWindow.restore();
            transcriptWindow.show();
            transcriptWindow.focus();
        }
    });

    app.whenReady().then(() => {
        // Initialize modules with production-safe paths
        const userDataPath = app.getPath('userData');

        // Initialize logger
        logger.init();
        logger.log('App started');

        // Database: stored in userData/data/app.db
        db.init(path.join(userDataPath, 'data'));

        // Audio Recorder: recordings stored in userData/audio/recordings
        audioRecorder.init(userDataPath);

        // Whisper: binary and model paths
        const whisperBase = app.isPackaged
            ? path.join(process.resourcesPath, 'whisper')
            : path.join(__dirname, 'whisper');

        const whisperCli = path.join(whisperBase, 'bin', 'whisper-cli.exe');
        const whisperModel = path.join(whisperBase, 'models', 'ggml-base.en.bin');

        whisperRunner.init(whisperCli, whisperModel);

        createPillWindow();
        createTranscriptWindow();
        createTray();

        // Enable auto-launch on startup (only in production)
        if (app.isPackaged) {
            app.setLoginItemSettings({
                openAtLogin: true,
                openAsHidden: true,
                path: app.getPath('exe')
            });
        }

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

        // IPC handler for close button in transcript window
        ipcMain.on('hide-transcript-window', () => {
            if (transcriptWindow) {
                transcriptWindow.hide();
            }
        });

        // IPC handlers for audio recording
        ipcMain.on('audio:start', () => {
            console.log('[main] Received audio:start');
            logger.log('[main] Received audio:start');
            try {
                audioRecorder.startRecording();
            } catch (err) {
                console.error('[main] Failed to start recording:', err.message);
                logger.error(`[main] Failed to start recording: ${err.message}`);
                dialog.showErrorBox('Recording Error', `Failed to start recording:\n${err.message}`);
            }
        });

        ipcMain.on('audio:stop', async () => {
            console.log('[main] Received audio:stop');
            logger.log('[main] Received audio:stop');
            try {
                const result = audioRecorder.stopRecording();
                if (result && result.filePath) {
                    console.log('[main] Recording saved:', result.filePath);
                    logger.log(`[main] Recording saved: ${result.filePath}`);

                    // Small delay to ensure WAV file is fully written
                    await new Promise(resolve => setTimeout(resolve, 200));

                    if (!fs.existsSync(result.filePath)) {
                        logger.error(`[main] Recording file not found on disk: ${result.filePath}`);
                        if (pillWindow) pillWindow.webContents.send('transcription-complete', '');
                        return;
                    }

                    // Run Whisper transcription
                    console.log('[main] Starting Whisper transcription...');
                    logger.log('[main] Starting Whisper transcription...');
                    try {
                        const text = await whisperRunner.transcribe(result.filePath);
                        console.log('[main] Transcription result:', text);
                        logger.log(`[main] Transcription result length: ${text.length}`);

                        // Apply formatting
                        const formattedText = format(text);
                        console.log('[main] Formatted text:', formattedText);
                        logger.log('[main] Text formatted');

                        // Save to database
                        db.insertTranscript({
                            created_at: new Date().toISOString(),
                            audio_path: result.filePath,
                            raw_text: text,
                            final_text: formattedText,
                            duration_ms: null,
                            model: 'whisper.cpp base',
                            status: 'ok'
                        });

                        // Auto-paste text
                        try {
                            const previousText = clipboard.readText();
                            // Small delay to ensure clipboard is ready
                            await new Promise(resolve => setTimeout(resolve, 50));
                            clipboard.writeText(formattedText);
                            logger.log('[main] Clipboard updated with new text');

                            // Execute VBScript to simulate Ctrl+V
                            // Using VBScript because it's built-in and reliable on Windows without native node modules
                            const vbsPath = app.isPackaged
                                ? path.join(process.resourcesPath, 'paste.vbs')
                                : path.join(__dirname, 'paste.vbs');

                            logger.log(`[main] Executing paste script: ${vbsPath}`);
                            execFile('wscript', [vbsPath], (error) => {
                                if (error) {
                                    console.error('[main] Paste failed:', error.message);
                                    logger.error(`[main] Paste script failed: ${error.message}`);
                                } else {
                                    logger.log('[main] Paste script executed successfully');
                                }
                                // Restore clipboard after a delay to ensure paste has occurred
                                // Increased delay to 300ms to be safe
                                setTimeout(() => {
                                    if (previousText) {
                                        clipboard.writeText(previousText);
                                    } else {
                                        clipboard.clear();
                                    }
                                    logger.log('[main] Clipboard restored');
                                }, 300);
                            });
                        } catch (pasteErr) {
                            console.error('[main] Auto-paste logic error:', pasteErr.message);
                            logger.error(`[main] Auto-paste logic error: ${pasteErr.message}`);
                        }

                        // Send transcription to renderer (Pill)
                        if (pillWindow) {
                            pillWindow.webContents.send('transcription-complete', formattedText);
                        }

                        // Refresh transcript window (History) if it exists
                        if (transcriptWindow) {
                            // Send event to reload history
                            transcriptWindow.webContents.send('refresh-history');
                        }
                    } catch (transcribeErr) {
                        console.error('[main] Transcription failed:', transcribeErr.message);
                        logger.error(`[main] Transcription failed: ${transcribeErr.message}`);

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
                    console.log('[main] No recording file saved');
                    logger.log('[main] No recording file saved from audioRecorder');
                    if (pillWindow) {
                        pillWindow.webContents.send('transcription-complete', '');
                    }
                }
            } catch (err) {
                console.error('[main] Failed to stop recording:', err.message);
                logger.error(`[main] Failed to stop recording handler: ${err.message}`);
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
}

// Clean up hook on quit
app.on('will-quit', () => {
    // We don't need to explicitly stop uIOhook here as the process is dying,
    // but unregistering globalShortcut is good practice if any were used.
});

app.on('window-all-closed', () => {
    // Do not quit when windows are closed (background utility behavior)
});

app.on('before-quit', () => {
    app.isQuitting = true;

    // Stop any active recording
    try {
        audioRecorder.stopRecording();
    } catch (e) {
        console.error('[main] Failed to stop recording on quit', e);
    }

    // Kill Whisper if running
    try {
        whisperRunner.cancel();
    } catch (e) {
        console.error('[main] Failed to cancel whisper on quit', e);
    }

    // Stop uIOhook to unhook keyboard events
    const { uIOhook } = require('uiohook-napi');
    uIOhook.stop();
    // Close database connection
    db.close();
});

