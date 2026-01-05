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
let wasInteractive = false;
window.addEventListener('mousemove', (event) => {
    // Check if hovering over pill or info-menu
    const elem = document.elementFromPoint(event.clientX, event.clientY);
    const isInteractive = !!(elem && (elem.closest('.pill') || elem.closest('.info-menu')));

    if (isInteractive !== wasInteractive) {
        wasInteractive = isInteractive;
        if (isInteractive) {
            ipcRenderer.send('set-ignore-mouse-events', false);
        } else {
            ipcRenderer.send('set-ignore-mouse-events', true, { forward: true });
        }
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

function setArming() {
    hideInfo();
    if (pendingShowTimer) clearTimeout(pendingShowTimer);
    pill.className = 'pill arming'; // Expanded but Dark
    currentStateIndex = 1;
}

function setRecording() {
    pill.className = 'pill recording'; // Turns Red
    // Waveform will auto-show via CSS
}

function setLoading() {
    if (pendingShowTimer) clearTimeout(pendingShowTimer);
    pill.className = 'pill loading';
    currentStateIndex = 2;
}

// State tracking for delayed recording
// State tracking
let isRecordingActive = false;

// Audio Visualization Locals
let audioContext = null;
let analyser = null;
let microphone = null;
let currentStream = null;
let visualizerFrame = null;
const bars = document.querySelectorAll('.waveform .bar');
const waveformContainer = document.querySelector('.waveform');

// Function to start visualization
async function startVisualizer() {
    try {
        if (!audioContext) {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (audioContext.state === 'suspended') {
            await audioContext.resume();
        }

        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        currentStream = stream;

        analyser = audioContext.createAnalyser();
        analyser.fftSize = 64; // Small size for 4 bars
        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);

        microphone = audioContext.createMediaStreamSource(stream);
        microphone.connect(analyser);

        waveformContainer.classList.add('active'); // Disable CSS animation

        function animate() {
            if (!isRecordingActive) return;

            analyser.getByteFrequencyData(dataArray);

            // Map frequency data to 4 bars
            // We'll pick significant buckets or average them
            // fftSize 64 -> 32 bins. 
            // Mapping to 6 bars:

            const getAvg = (start, end) => {
                let sum = 0;
                for (let i = start; i < end; i++) sum += dataArray[i];
                return sum / (end - start);
            };

            const levels = [
                getAvg(1, 4),   // Low Bass
                getAvg(4, 7),   // Bass
                getAvg(7, 12),  // Low Mid (Fundamental)
                getAvg(12, 17), // Mid
                getAvg(17, 24), // High Mid
                getAvg(24, 32)  // Air
            ];

            bars.forEach((bar, i) => {
                // Normalize 0-255 to 4px-18px (Pill is 28px tall. 18px leaves 5px margin top/bottom)
                // adding a boost factor but capping strictly at 18
                const val = levels[i] || 0;
                const normalized = Math.max(4, Math.min(18, 4 + (val / 255) * 20 * 1.5));
                bar.style.height = `${normalized}px`;
            });

            visualizerFrame = requestAnimationFrame(animate);
        }

        animate();

    } catch (err) {
        console.error('Visualizer init failed:', err);
        // Fallback to CSS animation if mic fails (e.g. permission denied)
        waveformContainer.classList.remove('active');
    }
}

function stopVisualizer() {
    if (visualizerFrame) cancelAnimationFrame(visualizerFrame);
    waveformContainer.classList.remove('active');

    // Reset bars
    bars.forEach(bar => bar.style.height = '');

    if (microphone) {
        microphone.disconnect();
        microphone = null;
    }
    
    // Stop tracks using the stored stream reference
    if (currentStream) {
        currentStream.getTracks().forEach(track => track.stop());
        currentStream = null;
    }
}

let bloomTimer = null;

// Listen for start recording (Hold Start)
ipcRenderer.on('start-recording', () => {
    sound.play('start');

    // 1. Arming Phase (Immediate expansion, Dark)
    setArming();
    isRecordingActive = true;

    // 2. Start Visualizer (Immediate - captures audio in background)
    startVisualizer();

    // 3. The Bloom (Delayed Red Light)
    // User waits for this red light (~150ms)
    bloomTimer = setTimeout(() => {
        if (isRecordingActive) {
            setRecording();
        }
    }, 150);
});

// Listen for stop recording (Release)
ipcRenderer.on('stop-recording', () => {
    sound.play('stop');

    // Clear bloom timer if user tapped quickly
    if (bloomTimer) clearTimeout(bloomTimer);

    stopVisualizer(); // Stop visualizer
    setLoading();
    isRecordingActive = false;
    // Audio capture stopped in main process
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
