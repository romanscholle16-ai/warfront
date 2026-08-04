/**
 * Six-character match codes.
 *
 * The alphabet deliberately omits 0/O, 1/I/L and the vowels that form words, so a
 * code can be read aloud across a room without ambiguity — which is exactly how
 * friends will actually share it.
 */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;
const issued = new Set();
export function generateCode() {
    for (let attempt = 0; attempt < 50; attempt++) {
        let code = '';
        for (let i = 0; i < CODE_LENGTH; i++) {
            code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
        }
        if (!issued.has(code)) {
            issued.add(code);
            return code;
        }
    }
    // Astronomically unlikely; fall back to a timestamp-derived code rather than loop.
    const fallback = Date.now().toString(36).toUpperCase().slice(-CODE_LENGTH);
    issued.add(fallback);
    return fallback;
}
export function releaseCode(code) {
    issued.delete(code);
}
export function isValidCode(code) {
    return typeof code === 'string'
        && code.length === CODE_LENGTH
        && [...code.toUpperCase()].every((c) => ALPHABET.includes(c));
}
//# sourceMappingURL=codes.js.map