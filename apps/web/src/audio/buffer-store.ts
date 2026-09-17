export class AudioBufferStore {
  readonly #entries = new Map<string, { buffer: AudioBuffer; bytes: number }>();
  #bytes = 0;

  constructor(private readonly maxBytes = 48 * 1024 * 1024) {}

  get(key: string): AudioBuffer | undefined {
    const entry = this.#entries.get(key);
    if (!entry) return undefined;
    this.#entries.delete(key);
    this.#entries.set(key, entry);
    return entry.buffer;
  }

  set(key: string, buffer: AudioBuffer): void {
    this.delete(key);
    const bytes = buffer.length * buffer.numberOfChannels * 4;
    if (bytes > this.maxBytes) return;
    this.#entries.set(key, { buffer, bytes });
    this.#bytes += bytes;
    while (this.#bytes > this.maxBytes) {
      const oldest = this.#entries.keys().next().value as string | undefined;
      if (!oldest) break;
      this.delete(oldest);
    }
  }

  retain(keys: ReadonlySet<string>): void {
    for (const key of this.#entries.keys()) if (!keys.has(key)) this.delete(key);
  }

  delete(key: string): void {
    const entry = this.#entries.get(key);
    if (!entry) return;
    this.#bytes -= entry.bytes;
    this.#entries.delete(key);
  }

  get size(): number { return this.#entries.size; }
}
