// Generates the extension's PNG icons and the notification chime WAV.
// No image/audio dependencies -- everything is encoded by hand with zlib.
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/* ---------------------------------- PNG ---------------------------------- */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(data.length + 12);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function encodePng(size, rgba) {
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // truecolour + alpha
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* -------------------------------- Artwork -------------------------------- */

// All shape math runs in a normalized 0..1 square so it scales to any icon size.

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a, b, t) => a + (b - a) * t;

function insideRoundedSquare(x, y, radius) {
  const dx = Math.max(radius - x, 0, x - (1 - radius));
  const dy = Math.max(radius - y, 0, y - (1 - radius));
  return dx * dx + dy * dy <= radius * radius;
}

function insideBell(x, y) {
  const dx = Math.abs(x - 0.5);

  // Top knob.
  if (Math.hypot(dx, y - 0.225) <= 0.05) return true;

  // Flaring body: half-width grows from the crown down to the rim.
  if (y >= 0.25 && y <= 0.63) {
    const t = (y - 0.25) / 0.38;
    const halfWidth = 0.105 + 0.2 * Math.pow(t, 1.7);
    if (dx <= halfWidth) return true;
  }

  // Rim bar.
  if (y > 0.63 && y <= 0.695 && dx <= 0.325) return true;

  // Clapper.
  if (Math.hypot(dx, y - 0.775) <= 0.062) return true;

  return false;
}

function renderIcon(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const SS = 4; // supersampling factor per axis
  const radius = 0.22;

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let bgHits = 0;
      let bellHits = 0;

      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = (px + (sx + 0.5) / SS) / size;
          const y = (py + (sy + 0.5) / SS) / size;
          if (insideRoundedSquare(x, y, radius)) {
            bgHits++;
            if (insideBell(x, y)) bellHits++;
          }
        }
      }

      const samples = SS * SS;
      const bgAlpha = bgHits / samples;
      const bellAlpha = bellHits / samples;

      // Vertical violet gradient for the tile.
      const t = clamp01(py / (size - 1));
      const bg = [
        Math.round(lerp(0x8b, 0x4c, t)),
        Math.round(lerp(0x5c, 0x2f, t)),
        Math.round(lerp(0xf6, 0xc4, t)),
      ];

      // Composite the white bell over the tile, then the tile over transparency.
      const k = bgAlpha > 0 ? bellAlpha / bgAlpha : 0;
      const r = Math.round(lerp(bg[0], 255, k));
      const g = Math.round(lerp(bg[1], 255, k));
      const b = Math.round(lerp(bg[2], 255, k));

      const i = (py * size + px) * 4;
      rgba[i] = r;
      rgba[i + 1] = g;
      rgba[i + 2] = b;
      rgba[i + 3] = Math.round(bgAlpha * 255);
    }
  }

  return encodePng(size, rgba);
}

for (const size of [16, 32, 48, 128]) {
  writeFileSync(join(ROOT, 'icons', `${size}.png`), renderIcon(size));
  console.log(`icons/${size}.png`);
}

/* ---------------------------------- WAV ---------------------------------- */

const RATE = 44100;

/**
 * Renders a set of struck notes into a 16-bit mono WAV. Each note is a sine
 * plus a quieter octave, under an exponential decay with a short attack -- a
 * cheap approximation of something being struck.
 */
function renderSound({ notes, duration, decay = 5.2, octave = 0.28, gain = 0.32, attack = 400 }) {
  const frames = Math.floor(RATE * duration);
  const pcm = Buffer.alloc(frames * 2);

  for (let i = 0; i < frames; i++) {
    const t = i / RATE;
    let sample = 0;

    for (const { freq, start } of notes) {
      const age = t - start;
      if (age < 0) continue;
      const envelope = Math.exp(-age * decay) * (1 - Math.exp(-age * attack));
      sample +=
        envelope *
        (Math.sin(2 * Math.PI * freq * age) + octave * Math.sin(4 * Math.PI * freq * age));
    }

    const value = Math.max(-1, Math.min(1, sample * gain));
    pcm.writeInt16LE(Math.round(value * 32767), i * 2);
  }

  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(pcm.length, 40);

  return Buffer.concat([header, pcm]);
}

// Keep these ids in sync with SOUNDS in src/lib/constants.js.
const SOUNDS = {
  // Two struck notes, A5 then E6.
  chime: { notes: [{ freq: 880.0, start: 0 }, { freq: 1318.51, start: 0.16 }], duration: 0.85 },

  // One bright note, gone quickly.
  ping: { notes: [{ freq: 1567.98, start: 0 }], duration: 0.4, decay: 11, gain: 0.28 },

  // Low and soft, for people who find the bright ones sharp.
  knock: {
    notes: [{ freq: 196.0, start: 0 }, { freq: 293.66, start: 0.07 }],
    duration: 0.55,
    decay: 9,
    octave: 0.12,
    gain: 0.42,
  },

  // A rising three-note figure.
  marimba: {
    notes: [
      { freq: 659.25, start: 0 },
      { freq: 880.0, start: 0.09 },
      { freq: 1174.66, start: 0.18 },
    ],
    duration: 0.9,
    decay: 7,
    octave: 0.18,
  },

  /* The soft set. Quieter, no octave harmonic to keep them dull rather than
     bright, and a slow attack so they fade in instead of clicking. */

  // A single low note that swells and goes.
  hush: {
    notes: [{ freq: 329.63, start: 0 }],
    duration: 1.1,
    decay: 4,
    octave: 0,
    gain: 0.17,
    attack: 45,
  },

  // Two soft notes a fifth apart, the gentlest of the set.
  drift: {
    notes: [{ freq: 392.0, start: 0 }, { freq: 587.33, start: 0.22 }],
    duration: 1.3,
    decay: 3.4,
    octave: 0.05,
    gain: 0.15,
    attack: 30,
  },

  // Rounded and short, like a fingertip on a glass.
  droplet: {
    notes: [{ freq: 698.46, start: 0 }, { freq: 1046.5, start: 0.03 }],
    duration: 0.7,
    decay: 8,
    octave: 0,
    gain: 0.19,
    attack: 90,
  },

  // Very low and very quiet, for when even the soft ones intrude.
  felt: {
    notes: [{ freq: 146.83, start: 0 }],
    duration: 0.8,
    decay: 6.5,
    octave: 0.04,
    gain: 0.24,
    attack: 60,
  },
};

for (const [name, spec] of Object.entries(SOUNDS)) {
  writeFileSync(join(ROOT, 'sounds', `${name}.wav`), renderSound(spec));
  console.log(`sounds/${name}.wav`);
}
