import { EventEmitter } from 'node:events';
import type { Settings } from './config';
import type { TelemetrySource, Wire } from './client';

export interface Point { loss: number | null; latency: number | null; down: number | null; up: number | null; power: number | null }
export interface DishEvent { cause: string; durationSeconds: number; timestamp?: number }
export interface Snapshot {
  observedAt: number; connected: boolean; cause?: string; latency: number | null; loss: number | null;
  down: number | null; up: number | null; power: number | null; uptime: number; firmware: string;
  obstruction: number | null; obstructed: boolean; ethernetMbps: number | null;
  heating: boolean; alerts: string[]; points: Point[]; historyAt?: number; events: DishEvent[];
}
export interface Health { outage: boolean; degraded: boolean; unreachable: boolean; fault: boolean }
export interface View { snapshot?: Snapshot; health: Health; now: number; error?: string; revision: number; historyStale?: boolean }
const finite = (v: unknown): number | null => typeof v === 'number' && Number.isFinite(v) ? v : null;
const fraction = (v: unknown): number | null => { const n = finite(v); return n === null || n < 0 || n > 1 ? null : n; };
export const mean = (a: Array<number | null>): number | null => { const ns = a.filter((n): n is number => n !== null && Number.isFinite(n)); return ns.length ? ns.reduce((s, n) => s + n, 0) / ns.length : null; };
export function percentile(a: Array<number | null>, p = 0.95): number | null {
  const ns = a.filter((n): n is number => n !== null && Number.isFinite(n)).sort((x, y) => x - y);
  return ns.length ? ns[Math.max(0, Math.ceil(p * ns.length) - 1)] : null;
}

// The current counter points to the next slot, not the most recently written slot.
export function unwind<T>(values: T[], current: number): T[] {
  if (!values.length || !Number.isSafeInteger(current) || current < 0) return [];
  if (current < values.length) return values.slice(0, current);
  const split = current % values.length;
  return values.slice(split).concat(values.slice(0, split));
}

export function normalize(status: Wire, history?: Wire, now = Date.now(), historyAt?: number): Snapshot {
  const alerts = status.alerts ?? {};
  const current = Number(history?.current ?? 0);
  const series = (key: string) => unwind(Array.isArray(history?.[key]) ? history[key] as unknown[] : [], current);
  const loss = series('pop_ping_drop_rate'), latency = series('pop_ping_latency_ms');
  const down = series('downlink_throughput_bps'), up = series('uplink_throughput_bps');
  const power = series(history?.power_consumption_w?.length ? 'power_consumption_w' : 'power_in');
  const count = Math.max(loss.length, latency.length, down.length, up.length, power.length);
  const points: Point[] = Array.from({ length: count }, (_, i) => ({
    loss: fraction(loss[i]), latency: fraction(loss[i]) === 1 ? null : finite(latency[i]),
    down: finite(down[i]), up: finite(up[i]), power: finite(power[i]),
  }));
  const eventLog: Wire[] = history?.event_log?.events ?? [];
  const events: DishEvent[] = eventLog.length ? eventLog.map(e => ({
    cause: String(e.reason).replace(/^SpaceX_API_Device_EventReason_/, '').replace(/^EVENT_REASON_(OUTAGE_)?/, ''),
    durationSeconds: Number(e.duration_ns || 0) / 1e9,
    timestamp: Number(e.start_timestamp_ns || 0) / 1e6,
  })) : (history?.outages ?? []).map((e: Wire) => ({
    cause: String(e.cause).replace(/^SpaceX_API_Device_DishOutage_Cause_/, ''), durationSeconds: Number(e.duration_ns || 0) / 1e9,
  }));
  const cause = status.outage ? String(status.outage.cause).replace(/^SpaceX_API_Device_DishOutage_Cause_/, '') : undefined;
  return {
    observedAt: now, connected: !status.outage, cause,
    latency: finite(status.pop_ping_latency_ms), loss: fraction(status.pop_ping_drop_rate),
    down: finite(status.downlink_throughput_bps), up: finite(status.uplink_throughput_bps),
    power: finite(status.upsu_stats?.dish_power) ?? power.map(finite).at(-1) ?? null,
    uptime: Number(status.device_state?.uptime_s || 0), firmware: String(status.device_info?.software_version || 'Unknown'),
    obstruction: fraction(status.obstruction_stats?.fraction_obstructed), obstructed: !!status.obstruction_stats?.currently_obstructed,
    ethernetMbps: finite(status.eth_speed_mbps), heating: !!alerts.is_heating,
    alerts: Object.entries(alerts).filter(([key, value]) => value === true && key !== 'is_heating').map(([key]) => key),
    points, historyAt, events,
  };
}

class DebouncedState {
  value = false;
  private candidate?: boolean;
  private since = 0;
  resetPending(): void { this.candidate = undefined; }
  update(target: boolean, now: number, riseMs: number, fallMs: number): boolean {
    if (target === this.value) { this.resetPending(); return this.value; }
    if (this.candidate !== target) { this.candidate = target; this.since = now; }
    if (now - this.since >= (target ? riseMs : fallMs)) { this.value = target; this.resetPending(); }
    return this.value;
  }
}

export class HealthEvaluator {
  private outage = new DebouncedState();
  private degraded = new DebouncedState();
  constructor(private readonly config: Settings, private readonly startedAt = Date.now()) {}
  evaluate(s: Snapshot | undefined, now: number): Health {
    const unreachable = now - (s?.observedAt ?? this.startedAt) >= this.config.staleAfterSeconds * 1000;
    const fault = !s || unreachable;
    if (fault) {
      this.outage.resetPending(); this.degraded.resetPending();
      return { outage: this.outage.value, degraded: this.degraded.value, unreachable, fault };
    }
    const recent = s.points.slice(-this.config.qualityWindowSeconds);
    const historyFresh = s.historyAt !== undefined && now - s.historyAt < this.config.historyIntervalSeconds * 2500;
    const loss = historyFresh && recent.length ? mean(recent.map(p => p.loss)) : s.loss;
    const latency = historyFresh && recent.length ? percentile(recent.map(p => p.latency)) : s.latency;
    const unhealthy = s.connected && ((loss ?? 0) * 100 >= this.config.lossThresholdPercent ||
      (latency ?? 0) >= this.config.latencyThresholdMs || s.alerts.some(a => ['thermal_throttle', 'power_supply_thermal_throttle', 'slow_ethernet_speeds', 'slow_ethernet_speeds_100'].includes(a)));
    return {
      outage: this.outage.update(!s.connected, now, this.config.outageDelaySeconds * 1000, this.config.recoveryDelaySeconds * 1000),
      degraded: this.degraded.update(unhealthy, now, this.config.degradedDelaySeconds * 1000, this.config.recoveryDelaySeconds * 1000),
      unreachable: false, fault: false,
    };
  }
}

export class TelemetryMonitor extends EventEmitter {
  private snapshot?: Snapshot;
  private history?: Wire;
  private historyAt?: number;
  private error?: string;
  private revision = 0;
  private stopped = false;
  private timer?: NodeJS.Timeout;
  private readonly evaluator: HealthEvaluator;
  constructor(private readonly source: TelemetrySource, private readonly config: Settings) {
    super(); this.evaluator = new HealthEvaluator(config);
  }
  view(now = Date.now()): View {
    return { snapshot: this.snapshot, health: this.evaluator.evaluate(this.snapshot, now), now, error: this.error, revision: this.revision,
      historyStale: this.historyAt === undefined || now - this.historyAt > this.config.historyIntervalSeconds * 2500 };
  }
  async poll(): Promise<void> {
    try {
      const status = await this.source.status();
      const observedAt = Date.now();
      if (this.stopped) return;
      // Reboot resets the circular history; never combine it with the previous boot.
      if (this.snapshot && Number(status.device_state?.uptime_s) < this.snapshot.uptime) { this.history = undefined; this.historyAt = undefined; }
      this.error = undefined;
      if (!this.historyAt || Date.now() - this.historyAt >= this.config.historyIntervalSeconds * 1000) {
        try { this.history = await this.source.history(); this.historyAt = Date.now(); }
        catch { this.error = 'Recent history unavailable; current status is still live'; }
      }
      if (this.stopped) return;
      this.snapshot = normalize(status, this.history, observedAt, this.historyAt);
    } catch (error) { this.error = error instanceof Error ? error.message : String(error); }
    if (!this.stopped) { this.revision++; this.emit('update', this.view()); }
  }
  start(): void {
    const run = async () => {
      await this.poll();
      if (!this.stopped) { this.timer = setTimeout(run, this.config.pollIntervalSeconds * 1000); this.timer.unref(); }
    };
    void run();
  }
  stop(): void { this.stopped = true; clearTimeout(this.timer); this.source.close(); this.removeAllListeners(); }
}
