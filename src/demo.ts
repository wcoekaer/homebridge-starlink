import type { Wire } from './client';

/** Synthetic measurements for previews and tests. Never contains a real dish identifier. */
export function demoTelemetry(now = Date.now()): { status: Wire; history: Wire } {
  const values = (fn: (i: number) => number) => Array.from({ length: 900 }, (_, i) => fn(i));
  return {
    status: { device_info: { software_version: 'demo.1' }, device_state: { uptime_s: '351600' },
      pop_ping_latency_ms: 23.8, pop_ping_drop_rate: 0, downlink_throughput_bps: 38400000, uplink_throughput_bps: 2400000,
      obstruction_stats: { fraction_obstructed: 0.0081, currently_obstructed: false },
      eth_speed_mbps: 1000, alerts: {}, upsu_stats: { dish_power: 28.4 } },
    history: { current: '900',
      pop_ping_latency_ms: values(i => 23 + 4 * Math.sin(i / 33) + 2 * Math.sin(i / 5) + (i > 610 && i < 670 ? 12 * Math.sin((i - 610) / 60 * Math.PI) : 0)),
      pop_ping_drop_rate: values(i => i % 153 === 0 ? 0.04 : 0),
      downlink_throughput_bps: values(i => (12 + 8 * Math.sin(i / 80) + 5 * Math.cos(i / 17)) * 1e6),
      uplink_throughput_bps: values(i => (2 + Math.sin(i / 80)) * 1e6),
      power_consumption_w: values(i => 29 + 4 * Math.sin(i / 26)),
      event_log: { events: [7200, 3600, 900].map((seconds, i) => ({ reason: 'EVENT_REASON_OUTAGE_OBSTRUCTED', duration_ns: String((i + 1) * 200000000), start_timestamp_ns: String(BigInt(now - seconds * 1000) * 1000000n) })) },
    },
  };
}
