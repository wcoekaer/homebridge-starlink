const { test } = require('node:test');
const assert = require('node:assert/strict');
const { settings } = require('../dist/config');
const { unwind, normalize, HealthEvaluator, TelemetryMonitor } = require('../dist/telemetry');
const { demoTelemetry } = require('../dist/demo');
const cfg = settings({ outageDelaySeconds: 10, degradedDelaySeconds: 20, recoveryDelaySeconds: 5, staleAfterSeconds: 30 });
const sample = (at = 0) => { const d = demoTelemetry(at); return normalize(d.status, d.history, at, at); };

test('circular history is chronological before and after wrap', () => {
  assert.deepEqual(unwind([30, 40, 10, 20], 6), [10, 20, 30, 40]);
  assert.deepEqual(unwind([10, 20, 0, 0], 2), [10, 20]);
  assert.deepEqual(unwind([1, 2], 0), []);
  assert.deepEqual(unwind([], 90), []);
});
test('100% lost samples do not masquerade as zero-latency replies; missing series stay unknown', () => {
  const s = normalize({}, { current: '2', pop_ping_drop_rate: [1, 0], pop_ping_latency_ms: [0, 25] });
  assert.deepEqual(s.points.map(p => p.latency), [null, 25]);
  assert.equal(s.points[0].power, null);
  assert.equal(s.power, null);
});
test('brief outages do not alert; sustained outages and recovery are independently debounced', () => {
  const e = new HealthEvaluator(cfg, 0);
  const off = now => ({ ...sample(now), connected: false, cause: 'NO_SATS' });
  assert.equal(e.evaluate(off(0), 0).outage, false);
  assert.equal(e.evaluate(sample(5000), 5000).outage, false);
  assert.equal(e.evaluate(off(10000), 10000).outage, false);
  assert.equal(e.evaluate(off(20000), 20000).outage, true);
  assert.equal(e.evaluate(sample(21000), 21000).outage, true);
  assert.equal(e.evaluate(sample(26000), 26000).outage, false);
});
test('stale telemetry marks fault, preserves prior alarm, and resets pending transitions', () => {
  const e = new HealthEvaluator(cfg, 0);
  const off = { ...sample(0), connected: false };
  e.evaluate(off, 0);
  assert.equal(e.evaluate({ ...off, observedAt: 10000 }, 10000).outage, true);
  const stale = e.evaluate({ ...off, observedAt: 10000 }, 40000);
  assert.equal(stale.unreachable, true); assert.equal(stale.fault, true); assert.equal(stale.outage, true);
  assert.equal(e.evaluate(sample(41000), 41000).outage, true);
  assert.equal(e.evaluate(sample(46000), 46000).outage, false);
  const startup = new HealthEvaluator(cfg, 0);
  assert.equal(startup.evaluate(undefined, 0).unreachable, false);
  assert.equal(startup.evaluate(undefined, 30000).unreachable, true);
});
test('degradation uses recent history and hysteresis, not a one-off old spike', () => {
  const e = new HealthEvaluator(cfg, 0), s = sample();
  s.points[0].loss = 1; s.points[0].latency = 2000;
  assert.equal(e.evaluate(s, 0).degraded, false);
  const bad = at => ({ ...sample(at), points: Array.from({ length: 60 }, () => ({ latency: 200, loss: .04, down: 0, up: 0, power: 25 })) });
  assert.equal(e.evaluate(bad(1000), 1000).degraded, false);
  assert.equal(e.evaluate(bad(21000), 21000).degraded, true);
});
test('old history cannot mask present degradation', () => {
  const e = new HealthEvaluator(settings({ degradedDelaySeconds: 0 }), 0);
  const s = { ...sample(100000), historyAt: 0, loss: .9 };
  assert.equal(e.evaluate(s, 100000).degraded, true);
});
test('reboot discards old history, even if refreshing history fails', async () => {
  const d = demoTelemetry(); let calls = 0;
  const source = { status: async () => ({ ...d.status, device_state: { uptime_s: String(calls ? 5 : 1000) } }),
    history: async () => { if (calls++) throw new Error('history unavailable'); return d.history; }, close() {} };
  const monitor = new TelemetryMonitor(source, cfg);
  await monitor.poll(); assert.equal(monitor.view().snapshot.points.length, 900);
  await monitor.poll(); assert.equal(monitor.view().snapshot.points.length, 0);
  assert.equal(monitor.view().snapshot.uptime, 5);
  monitor.stop();
});
test('invalid configuration fails with a useful message', () => {
  assert.throws(() => settings({ host: 'https://192.168.100.1' }), /host/);
  assert.throws(() => settings({ pollIntervalSeconds: 60, staleAfterSeconds: 30 }), /twice/);
  assert.throws(() => settings({ camera: { maxStreams: 0 } }), /maxStreams/);
});
