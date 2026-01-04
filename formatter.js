/**
 * formatter.js
 * Text formatting module for post-processing Whisper transcription output.
 * 
 * Applies formatting rules to upgrade raw transcription to WISPR-like quality.
 * 
 * Exposed functions:
 * - format(rawText, options) → formattedText
 */

/**
 * Format raw transcription text with various enhancements
 * @param {string} rawText - Raw Whisper transcription output
 * @param {Object} options - Formatting options (optional)
 * @param {boolean} options.sentenceCasing - Apply sentence casing (default: true)
 * @param {boolean} options.spokenCommands - Replace spoken commands (default: true)
 * @param {boolean} options.cleanup - Apply cleanup rules (default: true)
 * @returns {string} - Formatted text
 */
function format(rawText, options = {}) {
    if (!rawText || typeof rawText !== 'string') {
        return '';
    }

    // Default options
    const opts = {
        sentenceCasing: true,
        spokenCommands: true,
        cleanup: true,
        ...options
    };

    let text = rawText;

    // Apply formatting in MANDATORY ORDER
    // A. Sentence casing (first)
    if (opts.sentenceCasing) {
        text = applySentenceCasing(text);
    }

    // B. Spoken commands (second)
    if (opts.spokenCommands) {
        text = applySpokenCommands(text);
    }

    // C. Pause-based structure (third)
    // TODO: Implement pause-based formatting when timestamp data is available
    // This requires Whisper to output word-level timestamps
    // Pause ≥ 800ms → paragraph break (\n\n)
    // Pause ≥ 400ms → sentence break (.)
    // Pause < 400ms → space
    // text = applyPauseBasedStructure(text, timestamps);

    // D. Cleanup (last)
    if (opts.cleanup) {
        text = applyCleanup(text);
    }

    return text;
}

/**
 * A. Sentence Casing
 * Capitalize first letter after sentence-ending punctuation (. ? !)
 * Preserves original words - no modifications except capitalization
 * @param {string} text - Input text
 * @returns {string} - Text with sentence casing applied
 */
function applySentenceCasing(text) {
    if (!text) return '';

    // Capitalize first character of the text
    let result = text.charAt(0).toUpperCase() + text.slice(1);

    // Capitalize first letter after . ? ! followed by space(s)
    // Uses regex to find sentence boundaries and capitalize the next letter
    result = result.replace(/([.?!])\s+([a-z])/g, (match, punctuation, letter) => {
        return punctuation + ' ' + letter.toUpperCase();
    });

    return result;
}

/**
 * B. Spoken Commands
 * Replace exact spoken command phrases with their symbols
 * Only exact phrases - no guessing or fuzzy matching
 * @param {string} text - Input text
 * @returns {string} - Text with spoken commands replaced
 */
function applySpokenCommands(text) {
    if (!text) return '';

    let result = text;

    // Define spoken command mappings (case-insensitive matching)
    // Order matters: longer phrases first to prevent partial matches
    const commands = [
        // Multi-word commands first
        { pattern: /\bnew line\b/gi, replacement: '\n' },
        { pattern: /\bnewline\b/gi, replacement: '\n' },
        { pattern: /\bnext point\b/gi, replacement: '\n•' },
        { pattern: /\bnext bullet\b/gi, replacement: '\n•' },
        { pattern: /\bquestion mark\b/gi, replacement: '?' },
        { pattern: /\bexclamation mark\b/gi, replacement: '!' },
        { pattern: /\bexclamation point\b/gi, replacement: '!' },

        // Single-word commands (exact word boundaries)
        { pattern: /\bcomma\b/gi, replacement: ',' },
        { pattern: /\bperiod\b/gi, replacement: '.' },
    ];

    // Apply each command replacement
    for (const cmd of commands) {
        result = result.replace(cmd.pattern, cmd.replacement);
    }

    // Re-apply sentence casing after inserting punctuation
    // This ensures proper capitalization after new periods/question marks
    result = applySentenceCasing(result);

    return result;
}

/**
 * C. Pause-based Structure (TODO)
 * Uses Whisper timestamps to insert paragraph/sentence breaks based on pauses
 * @param {string} text - Input text
 * @param {Array} timestamps - Word-level timestamp data from Whisper
 * @returns {string} - Text with pause-based structure applied
 */
// function applyPauseBasedStructure(text, timestamps) {
//     // TODO: Implement when timestamp data is available
//     // 
//     // Algorithm:
//     // 1. Parse word-level timestamps from Whisper output
//     // 2. Calculate pause duration between consecutive words
//     // 3. Insert breaks based on pause thresholds:
//     //    - Pause ≥ 800ms → paragraph break (\n\n)
//     //    - Pause ≥ 400ms → sentence break (.) 
//     //    - Pause < 400ms → space (default)
//     // 4. Re-apply sentence casing after structure changes
//     //
//     // This is where WISPR Flow's quality improvement comes from
//     return text;
// }

/**
 * D. Cleanup
 * Minimal cleanup: remove repeated spaces, trim lines
 * NO synonym replacement, NO paraphrasing
 * @param {string} text - Input text
 * @returns {string} - Cleaned up text
 */
function applyCleanup(text) {
    if (!text) return '';

    let result = text;

    // Remove repeated spaces (replace 2+ spaces with single space)
    result = result.replace(/ {2,}/g, ' ');

    // Trim each line (remove leading/trailing whitespace per line)
    result = result.split('\n').map(line => line.trim()).join('\n');

    // Remove repeated newlines (more than 2 consecutive)
    result = result.replace(/\n{3,}/g, '\n\n');

    // Fix spacing around punctuation
    // Remove space before punctuation
    result = result.replace(/ +([,.?!])/g, '$1');

    // Ensure space after punctuation (except at end or before newline)
    result = result.replace(/([,.?!])([a-zA-Z])/g, '$1 $2');

    // Trim entire text
    result = result.trim();

    return result;
}

module.exports = {
    format,
    // Export individual functions for testing/debugging
    applySentenceCasing,
    applySpokenCommands,
    applyCleanup
};
