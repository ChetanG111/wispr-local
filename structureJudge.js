/**
 * structureJudge.js
 * Service to add structure to transcribed text using a local LLM.
 * 
 * Pipeline:
 * 1. Receives raw Whisper text + soft rule-based suggestions
 * 2. Calls local llama-server (OpenAI compatible)
 * 3. Enforces strict content preservation (Word-by-word check)
 * 4. Fallback to soft suggestions on any failure/timeout
 */

const http = require('http');
const logger = require('./logger');

const ENDPOINT_HOST = '127.0.0.1';
const ENDPOINT_PORT = 8089;
const ENDPOINT_PATH = '/v1/chat/completions';

const TIMEOUT_MS = 2500; // Adjusted for CPU (was 800ms)

const SYSTEM_PROMPT = `You are a text structure judge.

Rules:
- You MUST preserve every word exactly as provided.
- You may ONLY add:
  - punctuation
  - line breaks
  - paragraph breaks
  - bullet/list structure
- You MUST NOT:
  - add words
  - remove words
  - rephrase
  - fix grammar
  - change tense
  - change capitalization except where required by punctuation
- If uncertain, do nothing.
- Output the full final text only.`;

/**
 * Apply structural improvements to text using local LLM
 * @param {string} rawText - Verbatim Whisper output
 * @param {string} softCandidates - Output from rule-based formatter
 * @returns {Promise<string>} - The structured text, or softCandidates on failure
 */
async function improve(rawText, softCandidates) {
    // Fail fast if server not likely running (optimization)
    // Actually, we'll just try and catch error.

    logger.log('[structureJudge] Starting pass...');
    const startTime = Date.now();

    const userMessage = `RAW TEXT:
${rawText}

SOFT STRUCTURE SUGGESTIONS:
${softCandidates}

TASK:
Return the same text with improved structure only.`;

    const payload = JSON.stringify({
        messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: userMessage }
        ],
        temperature: 0.1,
        top_p: 1.0,
        max_tokens: 2048,
        stream: false
    });

    try {
        const result = await callServer(payload);
        const duration = Date.now() - startTime;

        logger.log(`[structureJudge] LLM responded in ${duration}ms`);

        // Mandatory Guardrail check
        if (validateContent(rawText, result)) {
            logger.log('[structureJudge] Validation passed');
            return result;
        } else {
            logger.warn('[structureJudge] Validation FAILED (content mismatch). Fallback to rules.');
            return softCandidates;
        }

    } catch (err) {
        logger.warn(`[structureJudge] Failed/Timeout: ${err.message}. Fallback to rules.`);
        return softCandidates;
    }
}

/**
 * Send request to llama-server with timeout
 */
function callServer(payload) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: ENDPOINT_HOST,
            port: ENDPOINT_PORT,
            path: ENDPOINT_PATH,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload)
            },
            timeout: TIMEOUT_MS // Strict timeout
        };

        const req = http.request(options, (res) => {
            let data = '';

            if (res.statusCode !== 200) {
                // Consume response to free resources
                res.resume();
                reject(new Error(`Server status ${res.statusCode}`));
                return;
            }

            res.setEncoding('utf8');
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    const content = json.choices?.[0]?.message?.content || '';
                    resolve(content.trim());
                } catch (e) {
                    reject(new Error('Invalid JSON response'));
                }
            });
        });

        req.on('error', (e) => reject(e));

        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Request timed out'));
        });

        req.write(payload);
        req.end();
    });
}

/**
 * Compare words in raw text vs structured text.
 * Returns true if the sequence of alphanumeric words is identical (ignoring case/punctuation).
 */
function validateContent(raw, structured) {
    const rawWords = getWords(raw);
    const structWords = getWords(structured);

    if (rawWords.length !== structWords.length) {
        logger.log(`[structureJudge] Word count mismatch: Raw=${rawWords.length}, Struct=${structWords.length}`);
        logger.log(`[structureJudge] REJECTED MODEL OUTPUT: "${structured}"`);
        return false;
    }

    for (let i = 0; i < rawWords.length; i++) {
        if (rawWords[i] !== structWords[i]) {
            logger.log(`[structureJudge] Word mismatch at index ${i}: "${rawWords[i]}" vs "${structWords[i]}"`);
            logger.log(`[structureJudge] REJECTED MODEL OUTPUT: "${structured}"`);
            return false;
        }
    }

    return true;
}

function getWords(text) {
    if (!text) return [];
    // Remove all non-alphanumeric chars (keep underscores if any? No, remove typical punctuation)
    // We want to match "Hello" with "hello", "it's" with "its" (maybe? Whisper says "it's" usually)
    // Let's strip standard punctuation: period, comma, question, exclam, parens, brackets, etc.
    // Keep apostrophes attached? "It's" -> "It's". 
    // If standardizer changes "it is" to "it's" -> fail.
    // If standardizer changes "gonna" to "going to" -> fail.
    // So simple punctuation strip is best.

    // Using regex to replace NOT (alphanumeric or space or apostrophe)
    // Start with strictly alphanumeric for robust check.
    // Actually prompt says "Correct grammar" is FORBIDDEN.
    // So "its" vs "it's" diff is a PASS (if only punct added), but prompt says "ONLY add punctuation".
    // So "its" -> "it's" is adding punctuation. "hello" -> "Hello" is capitalization.

    // Normalization:
    // 1. Lowercase
    // 2. Remove all chars except letters/numbers (remove apostrophes too to be safe? "dont" vs "don't" should match)
    // If I strip apostrophes, "we'll" becomes "well". "well" matches "well".
    // If whisper output "well" and judge outputs "we'll", strip -> "well" == "well". Valid.
    // If whisper output "we'll" and judge outputs "well", strip -> "well" == "well". Valid. (Removing punct is effectively forbidden by user prompt "NOT remove words", but "add punctuation" is allowed).
    // Actually the prompt says "may ONLY add punctuation". It does not say "remove punctuation".
    // But typically judge might fix punctuation.
    // Let's go with: remove all non-alphanumeric characters.

    return text.toLowerCase()
        .replace(/[^a-z0-9\s]/g, '') // remove punct
        .replace(/\s+/g, ' ')        // collapse space
        .trim()
        .split(' ');
}

module.exports = {
    improve,
    validateContent
};
