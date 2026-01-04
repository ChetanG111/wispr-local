const { app, BrowserWindow, screen, globalShortcut, ipcMain } = require('electron');
const path = require('path');

let pillWindow;

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

app.whenReady().then(() => {
    createPillWindow();

    // Register global 'G' key to cycle states
    globalShortcut.register('G', () => {
        if (pillWindow) {
            pillWindow.webContents.send('cycle-state');
        }
    });
});

// Unregister shortcuts on quit
app.on('will-quit', () => {
    globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
    app.quit();
});

app.on('before-quit', () => {
    app.isQuitting = true;
});
