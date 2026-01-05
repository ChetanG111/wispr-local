/**
 * SoundManager for UI feedback effects
 * Uses Web Audio API to generate procedural sounds (no assets needed)
 */

const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

function playFeedbackSound(type) {
    try {
        if (audioCtx.state === 'suspended') {
            audioCtx.resume();
        }

        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();

        osc.connect(gain);
        gain.connect(audioCtx.destination);

        const now = audioCtx.currentTime;

        if (type === 'start') {
            // "Bloop" (Rising) - Active/On state
            osc.type = 'sine';
            osc.frequency.setValueAtTime(400, now);
            osc.frequency.exponentialRampToValueAtTime(600, now + 0.1);

            // Envelope (Quick attack, smooth decay)
            gain.gain.setValueAtTime(0, now);
            gain.gain.linearRampToValueAtTime(0.15, now + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.2);

            osc.start(now);
            osc.stop(now + 0.2);

        } else if (type === 'stop') {
            // "Blip" (Falling) - Off/Done state
            osc.type = 'sine';
            osc.frequency.setValueAtTime(400, now);
            osc.frequency.exponentialRampToValueAtTime(200, now + 0.1);

            // Envelope
            gain.gain.setValueAtTime(0, now);
            gain.gain.linearRampToValueAtTime(0.15, now + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.2);

            osc.start(now);
            osc.stop(now + 0.2);
        }
    } catch (e) {
        console.error('Audio playback failed', e);
    }
}

module.exports = {
    play: playFeedbackSound
};
