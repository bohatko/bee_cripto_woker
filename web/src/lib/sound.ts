/**
 * Sound notification utilities using Web Audio API.
 * Synthesizes harmonious fintech audio chimes without external asset dependencies.
 */

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioCtxClass) return null;

  if (!audioCtx) {
    audioCtx = new AudioCtxClass();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

/**
 * Play a clear, harmonious ascending chime for new trade entries (C5 -> E5 -> G5 -> C6).
 */
export function playTradeOpenSound() {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    // Ascending major chord chime (C5=523.25, E5=659.25, G5=783.99, C6=1046.50)
    const notes = [
      { freq: 523.25, start: 0, duration: 0.2 },
      { freq: 659.25, start: 0.08, duration: 0.22 },
      { freq: 783.99, start: 0.16, duration: 0.26 },
      { freq: 1046.5, start: 0.24, duration: 0.45 },
    ];

    const now = ctx.currentTime;

    notes.forEach(({ freq, start, duration }) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + start);

      // Smooth attack and soft exponential decay
      gain.gain.setValueAtTime(0.0001, now + start);
      gain.gain.exponentialRampToValueAtTime(0.22, now + start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + start + duration);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now + start);
      osc.stop(now + start + duration);
    });
  } catch (err) {
    console.warn('[Sound] Failed to play trade open sound:', err);
  }
}

/**
 * Play a gentle 2-tone warning sound for system alerts (e.g. insufficient margin).
 */
export function playWarningSound() {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const notes = [
      { freq: 440, start: 0, duration: 0.16 }, // A4
      { freq: 349.23, start: 0.14, duration: 0.25 }, // F4
    ];

    notes.forEach(({ freq, start, duration }) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now + start);

      gain.gain.setValueAtTime(0.0001, now + start);
      gain.gain.exponentialRampToValueAtTime(0.18, now + start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + start + duration);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now + start);
      osc.stop(now + start + duration);
    });
  } catch (err) {
    console.warn('[Sound] Failed to play warning sound:', err);
  }
}
