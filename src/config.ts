export const PLUGIN_NAME = '@wcoekaer/homebridge-starlink';
// Keep HomeKit identities stable for installations of the original unscoped package.
export const ACCESSORY_NAMESPACE = 'homebridge-starlink';
export const PLATFORM_NAME = 'Starlink';

export interface Settings {
  name: string; host: string; port: number; pollIntervalSeconds: number;
  historyIntervalSeconds: number; timeoutSeconds: number; staleAfterSeconds: number;
  outageDelaySeconds: number; degradedDelaySeconds: number; recoveryDelaySeconds: number;
  lossThresholdPercent: number; latencyThresholdMs: number; qualityWindowSeconds: number;
  sensors: { outage: boolean; degraded: boolean; unreachable: boolean };
  camera: { enabled: boolean; name: string; ffmpegPath: string; maxStreams: number };
}

export function settings(raw: Record<string, any> = {}): Settings {
  const n = (key: string, fallback: number, min: number, max: number): number => {
    const value = raw[key] ?? fallback;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
      throw new Error(`${key} must be a number between ${min} and ${max}`);
    }
    return value;
  };
  const name = String(raw.name || 'Starlink').trim().slice(0, 50);
  const host = String(raw.host || '192.168.100.1').trim();
  if (!/^[a-zA-Z0-9.:-]+$/.test(host)) throw new Error('host must be an IP address or hostname, without a URL or port');
  if (host.includes(':') && !host.includes('::') && host.split(':').length < 3) throw new Error('Set the port separately from host');
  const camera = raw.camera ?? {};
  const streams = camera.maxStreams ?? 2;
  if (!Number.isInteger(streams) || streams < 1 || streams > 4) throw new Error('camera.maxStreams must be 1–4');
  const poll = n('pollIntervalSeconds', 5, 2, 60);
  const stale = n('staleAfterSeconds', 30, 10, 300);
  if (stale < poll * 2) throw new Error('staleAfterSeconds must be at least twice pollIntervalSeconds');
  const port = n('port', 9200, 1, 65535);
  if (!Number.isInteger(port)) throw new Error('port must be an integer');
  return {
    name, host, port, pollIntervalSeconds: poll,
    historyIntervalSeconds: n('historyIntervalSeconds', 30, 10, 300),
    timeoutSeconds: n('timeoutSeconds', 5, 1, 20), staleAfterSeconds: stale,
    outageDelaySeconds: n('outageDelaySeconds', 30, 0, 600),
    degradedDelaySeconds: n('degradedDelaySeconds', 120, 0, 1800),
    recoveryDelaySeconds: n('recoveryDelaySeconds', 30, 0, 600),
    lossThresholdPercent: n('lossThresholdPercent', 2, 0.01, 100),
    latencyThresholdMs: n('latencyThresholdMs', 150, 1, 5000),
    qualityWindowSeconds: n('qualityWindowSeconds', 60, 10, 900),
    sensors: { outage: raw.sensors?.outage !== false, degraded: raw.sensors?.degraded !== false, unreachable: raw.sensors?.unreachable !== false },
    camera: { enabled: camera.enabled !== false, name: String(camera.name || `${name} Dashboard`).slice(0, 64), ffmpegPath: String(camera.ffmpegPath || ''), maxStreams: streams },
  };
}
