const { test } = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const { DashboardRenderer, dashboardSvg } = require('../dist/dashboard');
const { normalize } = require('../dist/telemetry');
const { demoTelemetry } = require('../dist/demo');
const d = demoTelemetry(1700000000000);
const view = { snapshot: normalize(d.status, d.history, 1700000000000, 1700000000000), now: 1700000000000, revision: 1, health: { outage: false, degraded: false, unreachable: false, fault: false } };
test('HomeKit snapshots are JPEG at the requested dimensions, with PNG preview support', async () => {
  const renderer = new DashboardRenderer(() => view);
  const image = await renderer.render(640, 480);
  const info = await sharp(image).metadata();
  assert.equal(info.format, 'jpeg'); assert.equal(info.width, 640); assert.equal(info.height, 480);
  assert.ok(image.length > 15000);
  assert.equal((await sharp(await renderer.render(1280, 720, 'png')).metadata()).format, 'png');
});
test('unreachable, waiting, and offline panels cannot display a live healthy state', () => {
  const stale = dashboardSvg({ ...view, now: view.now + 60000, health: { ...view.health, fault: true, unreachable: true } });
  assert.match(stale, /TELEMETRY UNAVAILABLE/); assert.match(stale, /STALE READINGS/); assert.doesNotMatch(stale, /LINK ONLINE/);
  const waiting = dashboardSvg({ ...view, snapshot: undefined, health: { ...view.health, fault: true } });
  assert.match(waiting, /WAITING FOR DISH/);
  assert.match(dashboardSvg({ ...view, snapshot: { ...view.snapshot, connected: false } }), /LINK OFFLINE/);
});
test('names are XML escaped, not interpreted as dashboard markup', () => {
  const svg = dashboardSvg(view, '<script>test&</script>');
  assert.doesNotMatch(svg, /<script>/); assert.match(svg, /&lt;script&gt;/);
});
