import { DETECTORS, DetectorBank, type DetectorId, type Estimate } from "./detectors";

export interface PitchSample {
  /** AudioContext time at which this sound reached the microphone (centre of the analysis window). */
  time: number;
  /** Fractional MIDI pitch, or null when no clear pitch was found. */
  midi: number | null;
  /** Input level, 0..1 (RMS). */
  level: number;
}

/** One method's reading of the current frame, for comparing methods live. */
export interface MethodReading {
  id: DetectorId;
  estimate: Estimate | null;
  /** Confidence reached that method's threshold. */
  accepted: boolean;
}

/** Tracks the singer's pitch from the microphone with a selectable detection method. */
export class PitchTracker {
  onSample: (s: PitchSample) => void = () => {};
  /**
   * Receives the raw analysis window on every poll, with the AudioContext time of its last sample.
   * The buffer is reused, so read it synchronously.
   */
  onBuffer: ((buf: Float32Array, endTime: number) => void) | null = null;
  /** Detection method, and the minimum confidence (0..1) per method for a pitch to be accepted. */
  method: DetectorId = "mpm";
  thresholds: Record<DetectorId, number> = Object.fromEntries(DETECTORS.map((d) => [d.id, d.threshold])) as Record<DetectorId, number>;
  /** When set, every method runs on every frame and reports here (for comparing them). */
  onCompare: ((readings: MethodReading[], level: number) => void) | null = null;
  /** RMS below this counts as silence. */
  gate = 0.008;

  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private analyser: AnalyserNode | null = null;
  private timer = 0;
  private bank = new DetectorBank(2048);
  private buf = new Float32Array(2048);
  private history: (number | null)[] = [];

  constructor(private ctx: AudioContext) {}

  /** Analysis window in samples. */
  get windowSize(): number {
    return this.bank.size;
  }

  set windowSize(n: number) {
    if (n === this.bank.size) return;
    this.bank = new DetectorBank(n);
    this.buf = new Float32Array(n);
    if (this.analyser) this.analyser.fftSize = n;
    this.history = [];
  }

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
    this.analyser.fftSize = this.bank.size;
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
    const time = this.ctx.currentTime - this.buf.length / sr / 2;
    this.analyser.getFloatTimeDomainData(this.buf);
    this.onBuffer?.(this.buf, this.ctx.currentTime);
    let sum = 0;
    for (let i = 0; i < this.buf.length; i++) sum += this.buf[i] * this.buf[i];
    const level = Math.sqrt(sum / this.buf.length);

    let midi: number | null = null;
    this.bank.newFrame();
    const loud = level >= this.gate;
    const run = (id: DetectorId): MethodReading => {
      const estimate = loud ? this.bank.detect(id, this.buf, sr) : null;
      return { id, estimate, accepted: !!estimate && estimate.confidence >= this.thresholds[id] };
    };
    let mine: MethodReading;
    if (this.onCompare) {
      const all = DETECTORS.map((d) => run(d.id));
      this.onCompare(all, level);
      mine = all.find((r) => r.id === this.method)!;
    } else mine = run(this.method);
    if (mine.accepted) midi = 69 + 12 * Math.log2(mine.estimate!.hz / 440);
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
