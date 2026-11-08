import fs from 'node:fs/promises';
import path from 'node:path';
import { StarlinkClient } from './client';
import { settings } from './config';
import { normalize, HealthEvaluator, mean, percentile, type View } from './telemetry';
import { DashboardRenderer, dashboardSvg } from './dashboard';
import { demoTelemetry } from './demo';

async function main(): Promise<void> {
  const args = process.argv.slice(2), command = args.shift();
  const option = (flag: string, fallback?: string) => { const at = args.indexOf(flag); return at >= 0 ? args[at + 1] : fallback; };
  if (!['preview', 'probe'].includes(command || '')) throw new Error('Usage: node dist/cli.js preview|probe [--host 192.168.100.1] [--fixture file.json] [--output artifacts/dashboard.png]');
  let status: any, history: any;
  const fixture = option('--fixture'), now = Date.now();
  if (args.includes('--demo')) ({ status, history } = demoTelemetry(now));
  else if (fixture) ({ status, history } = JSON.parse(await fs.readFile(fixture, 'utf8')));
  else {
    const source = new StarlinkClient(option('--host', '192.168.100.1'));
    try { status = await source.status(); history = await source.history(); } finally { source.close(); }
  }
  const snapshot = normalize(status, history, now, now);
  const health = new HealthEvaluator(settings()).evaluate(snapshot, now);
  const view: View = { snapshot, health, now, revision: 1 };
  console.log(JSON.stringify({ connected: snapshot.connected, cause: snapshot.cause, firmware: snapshot.firmware,
    latencyMs: snapshot.latency, historySamples: snapshot.points.length, historyMeanLatencyMs: mean(snapshot.points.map(p => p.latency)),
    historyP95LatencyMs: percentile(snapshot.points.map(p => p.latency)), historyLossPercent: (mean(snapshot.points.map(p => p.loss)) ?? 0) * 100,
    powerWatts: snapshot.power, alerts: snapshot.alerts, eventCount: snapshot.events.length }, null, 2));
  if (command === 'preview') {
    const output = path.resolve(option('--output', 'artifacts/dashboard.png')!);
    await fs.mkdir(path.dirname(output), { recursive: true });
    const name = args.includes('--demo') ? 'Starlink · Demo' : 'Starlink';
    await fs.writeFile(output, await new DashboardRenderer(() => view, name).render(1280, 720, 'png'));
    await fs.writeFile(output.replace(/\.[^.]+$/, '') + '.svg', dashboardSvg(view, name));
    console.log(`Dashboard: ${output}`);
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
