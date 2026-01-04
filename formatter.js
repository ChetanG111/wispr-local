/**
 * formatter.js
 * Deterministic text formatting module for post-processing Whisper transcription output.
 * 
 * Rules applied in order:
 * A. Spoken command replacements
 * B. Sentence casing
 * C. Length-based sentence breaks
 * D. Paragraph heuristics
 * E. Cleanup
 */

const COMMANDS = [
    // Phrases mapping to Newlines
    { pattern: /\bnew\s+paragraph\b/gi, replacement: '\n\n' },
    { pattern: /\bnew\s+line\b/gi, replacement: '\n' },
    { pattern: /\bnext\s+line\b/gi, replacement: '\n' },

    // Bullets
    { pattern: /\bnext\s+point\b/gi, replacement: '\n•' },
    { pattern: /\bbullet\b/gi, replacement: '•' }, // Default bullet
    { pattern: /\bpoint\s+(?:one|1)\b/gi, replacement: '\n1.' },
    { pattern: /\bpoint\s+(?:two|2)\b/gi, replacement: '\n2.' },

    // Punctuation
    { pattern: /\bcomma\b/gi, replacement: ',' },
    { pattern: /\b(?:period|full\s+stop)\b/gi, replacement: '.' }
];

/**
 * Format raw transcription text with strict deterministic rules
 * @param {string} rawText - Raw Whisper transcription output
 * @returns {string} - Formatted text
 */
function format(rawText) {
    if (!rawText || typeof rawText !== 'string') {
        return '';
    }

    let text = rawText;

    // A. Spoken command replacements (HIGHEST PRIORITY)
    // Remove the spoken words completely and replace with symbols
    for (const cmd of COMMANDS) {
        text = text.replace(cmd.pattern, cmd.replacement);
    }

    // B. Sentence casing
    // Capitalize first letter: At start, After . ? !, After \n or \n\n
    // Do NOT change words otherwise
    text = applySentenceCasing(text);

    // C. Length-based sentence breaks
    // If > 140 chars without punctuation, insert . at nearest space
    text = applyLengthBreaks(text);

    // D. Paragraph heuristics
    // Insert \n\n when sentence starts with specific keywords
    text = applyParagraphHeuristics(text);

    // E. Cleanup (LAST)
    text = applyCleanup(text);

    return text;
}

function applySentenceCasing(text) {
    if (!text) return '';

    // 1. Capitalize start of text
    let res = text.charAt(0).toUpperCase() + text.slice(1);

    // 2. Capitalize after . ? !
    res = res.replace(/([.?!]\s*)([a-z])/g, (match, sep, char) => {
        return sep + char.toUpperCase();
    });

    // 3. Capitalize after newlines (\n or \n\n)
    res = res.replace(/(\n+\s*)([a-z])/g, (match, sep, char) => {
        return sep + char.toUpperCase();
    });

    return res;
}

function applyLengthBreaks(text) {
    let newText = text;
    const LIMIT = 140;
    let scanStart = 0;

    // Iterate until no chunks exceed limit
    // This looks for sequences of characters that are NOT . ? ! or newline
    // We break them if they exceed 140 chars
    while (true) {
        let changed = false;
        let counter = 0;
        let lastSpaceIndex = -1;
        let chunkStartIndex = scanStart;

        // Scan the text tracking distance from last punctuation
        for (let i = scanStart; i < newText.length; i++) {
            const char = newText[i];

            // Punctuation resets the counter
            if (['.', '?', '!', '\n'].includes(char)) {
                counter = 0;
                lastSpaceIndex = -1;
                chunkStartIndex = i + 1;
                // Safe to advance scanStart as this chunk is valid
                if (!changed) scanStart = i + 1;
            } else {
                counter++;
                if (char === ' ') {
                    lastSpaceIndex = i;
                }
            }

            if (counter > LIMIT) {
                // Break at last space found in this chunk
                if (lastSpaceIndex !== -1 && lastSpaceIndex > chunkStartIndex) {       
                    const before = newText.substring(0, lastSpaceIndex);
                    const after = newText.substring(lastSpaceIndex + 1);

                    // Insert period, space, and simple manual capitalization for the next word
                    // to ensure "Output is pleasant to read"
                    const nextChar = after.charAt(0).toUpperCase();
                    newText = before + '. ' + nextChar + after.slice(1);

                    changed = true;
                    // Resume scanning from the character after the inserted period
                    scanStart = lastSpaceIndex + 1; 
                    break; // Restart loop
                } else {
                    // If no space found (single super long word?), we can't insert at space.
                    // Just reset counter to avoid infinite loop and move on.
                    counter = 0;
                }
            }
        }

        if (!changed) break;
    }
    return newText;
}
function applyParagraphHeuristics(text) {
    // Keywords to trigger paragraph break
    const keywords = ['Okay', 'So', 'Next', 'Moving on', 'Now'];

    // Pattern: 
    // Group 1: Sentence terminator + whitespace (or start of line/str)
    // Group 2: The keyword (case insensitive match, though we largely capitalized already)
    // Boundary \b ensures we don't match "Someone"
    const pattern = new RegExp(`((?:[.?!]\\s+)|(?:^)|(?:\\n+))(${keywords.join('|')})\\b`, 'gi');

    return text.replace(pattern, (match, prefix, word) => {
        // If it's already on a new line (prefix contains \n), we might just enforce \n\n?
        // But rule says: "Insert \n\n when a sentence starts with..."

        // If match is start of string, likely don't want \n\n
        if (!prefix) return match;

        // If prefix is punct+space (e.g. ". So") -> ".\n\nSo"
        if (/[.?!]/.test(prefix)) {
            const punct = prefix.match(/[.?!]/)[0];
            // Ensure word is capitalized (it should be from casing step, but let's correct casing just in case)
            const capWord = word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
            return `${punct}\n\n${capWord}`;
        }

        // If prefix matches existing newlines, ensure we have \n\n?
        // User didn't strictly say normalize specific newlines here, but "Insert \n\n".

        return match;
    });
}

function applyCleanup(text) {
    let res = text;

    // Collapse multiple spaces -> one space
    res = res.replace(/[ \t]{2,}/g, ' ');

    // Trim each line
    res = res.split('\n').map(line => line.trim()).join('\n');

    // Remove empty bullet points (lines that are just "•" or "• ")
    res = res.replace(/^•\s*$/gm, '');

    // Collapse 3+ newlines to 2 (cleanup empty gaps)
    res = res.replace(/\n{3,}/g, '\n\n');

    // Remove trailing spaces / newlines
    res = res.trim();

    return res;
}

module.exports = {
    format
};
