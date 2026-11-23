type Meter = {
  track: MediaStreamTrack;
  source: MediaStreamAudioSourceNode;
  analyser: AnalyserNode;
  samples: Float32Array<ArrayBuffer>;
  activeUntil: number;
};

export function createVoiceActivityMeter(onChange: (speaking: ReadonlySet<string>) => void) {
  let context: AudioContext | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let speaking = new Set<string>();
  const meters = new Map<string, Meter>();

  function unlock() {
    try {
      context ??= new AudioContext();
      if (context.state === 'suspended') void context.resume().catch(() => {});
    } catch { /* Calls still work without the visual indicator. */ }
  }

  function publish(next: Set<string>) {
    if (next.size === speaking.size && [...next].every(id => speaking.has(id))) return;
    speaking = next;
    onChange(next);
  }

  function sample() {
    const next = new Set<string>();
    const now = performance.now();
    if (context?.state === 'running') for (const [id, meter] of meters) {
      if (!meter.track.enabled || meter.track.muted || meter.track.readyState !== 'live') {
        meter.activeUntil = 0;
        continue;
      }
      meter.analyser.getFloatTimeDomainData(meter.samples);
      let energy = 0;
      for (const value of meter.samples) energy += value * value;
      if (Math.sqrt(energy / meter.samples.length) >= 0.015) meter.activeUntil = now + 270;
      if (meter.activeUntil > now) next.add(id);
    }
    publish(next);
  }

  function sync(tracks: ReadonlyMap<string, MediaStreamTrack>) {
    const next = new Set(speaking);
    for (const [id, meter] of meters) {
      if (tracks.get(id) === meter.track) continue;
      meter.source.disconnect();
      meters.delete(id);
      next.delete(id);
    }
    publish(next);
    if (tracks.size && !context) unlock();
    if (context) for (const [id, track] of tracks) {
      if (meters.has(id) || track.readyState !== 'live') continue;
      try {
        const analyser = context.createAnalyser();
        analyser.fftSize = 1024;
        const source = context.createMediaStreamSource(new MediaStream([track]));
        // No output connection: the analyser never plays audio.
        source.connect(analyser);
        meters.set(id, { track, source, analyser, samples: new Float32Array(analyser.fftSize), activeUntil: 0 });
      } catch { /* A track may close during a call change. */ }
    }
    if (meters.size && timer === undefined) timer = setInterval(sample, 60);
    if (!meters.size && timer !== undefined) {
      clearInterval(timer);
      timer = undefined;
    }
  }

  return { sync, unlock, dispose() {
    sync(new Map());
    if (context && context.state !== 'closed') void context.close().catch(() => {});
    context = undefined;
  } };
}
