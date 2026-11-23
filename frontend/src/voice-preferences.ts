export type VoicePreferences = {
  input: string;
  output: string;
  inputVolume: number;
  outputVolume: number;
  noiseSuppression: boolean;
  roomSounds?: boolean;
  roomSoundVolume?: number;
  customRoomSounds?: boolean;
  lobbySounds?: boolean;
};

const defaults: VoicePreferences = { input: '', output: '', inputVolume: 100, outputVolume: 100, noiseSuppression: true };
const key = (email: string) => `discordo:voice:${email}`;

function volume(value: unknown, max: number) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(max, value)) : 100;
}

export function readVoicePreferences(email: string): VoicePreferences {
  try {
    const data = JSON.parse(localStorage.getItem(key(email)) ?? 'null');
    if (!data) return { ...defaults };
    return {
      input: typeof data.input === 'string' ? data.input : '',
      output: typeof data.output === 'string' ? data.output : '',
      inputVolume: volume(data.inputVolume, 200),
      outputVolume: volume(data.outputVolume, 100),
      noiseSuppression: data.noiseSuppression !== false,
      roomSounds: data.roomSounds !== false,
      roomSoundVolume: volume(data.roomSoundVolume ?? 60, 100),
      customRoomSounds: data.customRoomSounds !== false,
      lobbySounds: data.lobbySounds === true,
    };
  } catch {
    return { ...defaults };
  }
}

export function saveVoicePreferences(email: string, preferences: VoicePreferences) {
  localStorage.setItem(key(email), JSON.stringify(preferences));
}

export async function openMicrophone(deviceId: string, noiseSuppression: boolean) {
  const audio: MediaTrackConstraints = { echoCancellation: true, noiseSuppression, channelCount: { ideal: 1 } };
  const devices = navigator.mediaDevices;
  if (deviceId) {
    try {
      return { stream: await devices.getUserMedia({ audio: { ...audio, deviceId: { exact: deviceId } } }), fallback: false };
    } catch (error) {
      if (!(error instanceof DOMException) || !['NotFoundError', 'OverconstrainedError'].includes(error.name)) throw error;
    }
  }
  return { stream: await devices.getUserMedia({ audio }), fallback: Boolean(deviceId) };
}
