import { PitchDetector } from "pitchy";

export interface PitchSample {
  /** AudioContext time at which this sound reached the microphone (centre of the analysis window). */
  time: number;
  /** Fractional MIDI pitch, or null when no clear pitch was found. */
  midi: number | null;
  /** Input level, 0..1 (RMS). */
  level: number;
}

const WINDOW = 2048;
const MIN_HZ = 60;
const MAX_HZ = 1400;

/** Tracks the singer's pitch from the microphone using the McLeod pitch method. */
export class PitchTracker {
  onSample: (s: PitchSample) => void = () => {};
  /**
   * Receives the raw analysis window on every poll, with the AudioContext time of its last sample.
   * The buffer is reused, so read it synchronously.
   */
  onBuffer: ((buf: Float32Array, endTime: number) => void) | null = null;
  /** Minimum clarity (0..1) for a pitch to be accepted. */
  clarity = 0.88;
  /** RMS below this counts as silence. */
  gate = 0.008;

  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private analyser: AnalyserNode | null = null;
  private timer = 0;
  private detector = PitchDetector.forFloat32Array(WINDOW);
  private buf = new Float32Array(WINDOW);
  private history: (number | null)[] = [];

  constructor(private ctx: AudioContext) {}

  get active(): boolean {
    return this.stream !== null;
  }

  /** Input latency reported by the browser, in seconds (0 if unknown). */
  get inputLatency(): number {
    const s = this.stream?.getAudioTracks()[0]?.getSettings() as MediaTrackSettings & { latency?: number };
    return s?.latency ?? 0;
  }

  async start(deviceId?: string): Promise<void> {
    this.stop();
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        // Processing meant for speech distorts sung pitch; turn it all off.
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
    await this.ctx.resume();
    this.source = this.ctx.createMediaStreamSource(this.stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = WINDOW;
    this.source.connect(this.analyser);
    this.history = [];
    this.timer = window.setInterval(() => this.poll(), 15);
  }

  stop(): void {
    window.clearInterval(this.timer);
    this.source?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.source = null;
    this.analyser = null;
  }

  private poll(): void {
    if (!this.analyser) return;
    const sr = this.ctx.sampleRate;
    const time = this.ctx.currentTime - WINDOW / sr / 2;
    this.analyser.getFloatTimeDomainData(this.buf);
    this.onBuffer?.(this.buf, this.ctx.currentTime);
    let sum = 0;
    for (let i = 0; i < this.buf.length; i++) sum += this.buf[i] * this.buf[i];
    const level = Math.sqrt(sum / this.buf.length);

    let midi: number | null = null;
    if (level >= this.gate) {
      const [hz, clarity] = this.detector.findPitch(this.buf, sr);
      if (clarity >= this.clarity && hz >= MIN_HZ && hz <= MAX_HZ) midi = 69 + 12 * Math.log2(hz / 440);
    }
    this.onSample({ time, midi: this.smooth(midi), level });
  }

  /** 3-point median filter that also drops isolated octave glitches. */
  private smooth(midi: number | null): number | null {
    this.history.push(midi);
    if (this.history.length > 3) this.history.shift();
    const voiced = this.history.filter((m): m is number => m !== null);
    if (midi === null) return null;
    if (voiced.length < 3) return midi;
    return [...voiced].sort((a, b) => a - b)[1];
  }
}

const NAMES = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];

export function midiName(midi: number): string {
  const n = Math.round(midi);
  return `${NAMES[((n % 12) + 12) % 12]}${Math.floor(n / 12) - 1}`;
}
