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
});

// Listen for stop recording (Release)
ipcRenderer.on('stop-recording', () => {
    setLoading();

    // Mock processing delay
    setTimeout(() => {
        setIdle();
    }, 2000);
});
