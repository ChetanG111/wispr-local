const { ipcRenderer } = require('electron');

const pill = document.getElementById('pill');

const states = ['idle', 'recording', 'loading'];
let currentStateIndex = 0;

function setIdle() {
    pill.className = 'pill idle';
    currentStateIndex = 0;
}

function setRecording() {
    pill.className = 'pill recording';
    currentStateIndex = 1;
}

function setLoading() {
    pill.className = 'pill loading';
    currentStateIndex = 2;
}

// Listen for start recording (Hold Start)
ipcRenderer.on('start-recording', () => {
    setRecording();
    // Notify main process to start audio capture
    ipcRenderer.send('audio:start');
});

// Listen for stop recording (Release)
ipcRenderer.on('stop-recording', () => {
    setLoading();
    // Notify main process to stop audio capture
    ipcRenderer.send('audio:stop');
});

// Listen for transcription complete (from main process after Whisper finishes)
ipcRenderer.on('transcription-complete', (event, text) => {
    console.log('[pill] Transcription complete:', text);
    setIdle();
});
