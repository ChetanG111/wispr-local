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

function cycleState() {
    currentStateIndex = (currentStateIndex + 1) % states.length;
    pill.className = 'pill ' + states[currentStateIndex];
}

// Listen for cycle-state from main process (G key)
ipcRenderer.on('cycle-state', () => {
    cycleState();
});
