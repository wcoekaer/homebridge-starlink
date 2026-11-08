import { Resvg } from '@resvg/resvg-js';
import sharp from 'sharp';
import path from 'node:path';
import type { View } from './telemetry';
import { mean, percentile } from './telemetry';

const C = { bg: '#080f1b', panel: '#111e30', border: '#243348', text: '#f1f5fb', muted: '#99abc1', green: '#b8f37c', blue: '#6fcaff', amber: '#ffbf72', red: '#ff7f8e' };
export const escapeXml = (s: string): string => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]!));
const fmt = (n: number | null | undefined, decimals = 1): string => n == null || !Number.isFinite(n) ? '—' : n.toFixed(decimals);
const duration = (n: number): string => n >= 86400 ? `${Math.floor(n / 86400)}d ${Math.floor(n % 86400 / 3600)}h` : n >= 3600 ? `${Math.floor(n / 3600)}h ${Math.floor(n % 3600 / 60)}m` : `${Math.floor(n / 60)}m`;
const text = (x: number, y: number, value: string, size = 20, color = C.text, weight = 500, extra = '') => `<text x="${x}" y="${y}" fill="${color}" font-size="${size}" font-weight="${weight}" ${extra}>${escapeXml(value)}</text>`;
const rect = (x: number, y: number, w: number, h: number, fill = C.panel, r = 20) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" stroke="${C.border}"/>`;

function line(values: Array<number | null>, x: number, y: number, w: number, h: number, color: string, maxValue?: number): string {
  if (values.length < 2) return '';
  // Keep spikes visible while limiting SVG complexity to the available pixel width.
  const bucket = Math.max(1, Math.ceil(values.length / Math.max(2, Math.floor(w / 2))));
  const points: Array<number | null> = [];
  for (let i = 0; i < values.length; i += bucket) {
    const valid = values.slice(i, i + bucket).filter((v): v is number => v !== null && Number.isFinite(v));
    points.push(valid.length ? Math.max(...valid) : null);
  }
  const max = Math.max(maxValue ?? Math.max(...points.map(v => v ?? 0)) * 1.12, 1);
  let d = '', gap = true;
  points.forEach((v, i) => {
    if (v === null) { gap = true; return; }
    const px = x + i / (points.length - 1) * w, py = y + h - Math.max(0, Math.min(1, v / max)) * h;
    d += `${gap ? 'M' : 'L'}${px.toFixed(1)},${py.toFixed(1)} `; gap = false;
  });
  return `<path d="${d}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`;
}

export function dashboardSvg(view: View, name = 'Starlink'): string {
  const s = view.snapshot, points = s?.points ?? [];
  const historyAge = s?.historyAt ? Math.max(0, (view.now - s.historyAt) / 1000) : undefined;
  const historyOld = view.historyStale ?? (historyAge === undefined || historyAge > 90);
  const age = s ? Math.max(0, Math.floor((view.now - s.observedAt) / 1000)) : undefined;
  const state = !s ? 'WAITING FOR DISH' : view.health.fault ? 'TELEMETRY UNAVAILABLE' : !s.connected ? 'LINK OFFLINE' : view.health.degraded ? 'LINK DEGRADED' : 'LINK ONLINE';
  const accent = !s || view.health.fault ? C.amber : !s.connected ? C.red : view.health.degraded ? C.amber : C.green;
  const latencies = points.map(p => p.latency), loss = mean(points.map(p => p.loss));
  const avgPower = mean(points.map(p => p.power));
  const healthRows = [
    ['Obstruction estimate', `${fmt(s?.obstruction == null ? null : s.obstruction * 100, 2)}%`, s?.obstructed ? C.amber : C.text],
    ['Ethernet link', s?.ethernetMbps ? `${s.ethernetMbps.toLocaleString('en-US')} Mbps` : '—', C.text],
    ['Thermal / heating', s?.alerts.some(a => a.includes('thermal')) ? 'Thermal alert' : s?.heating ? 'Heating' : s ? 'Normal' : '—', s?.alerts.some(a => a.includes('thermal')) ? C.amber : C.text],
    ['Dish uptime', s ? duration(s.uptime) : '—', C.text],
  ];
  const card = (x: number, label: string, value: string, unit: string, detail: string, series: Array<number | null>, color: string) =>
    rect(x, 132, 285, 150) + text(x + 22, 165, label, 18, C.muted) + text(x + 22, 222, value, 45, C.text, 700) +
    text(x + 253, 219, unit, 18, C.muted, 500, 'text-anchor="end"') + line(series, x + 22, 235, 241, 25, color) + text(x + 22, 272, detail, 13, C.muted);
  const events = (s?.events ?? []).filter(e => e.cause !== 'BOOTING').slice(-3).reverse();
  const chartMax = Math.max(40, Math.ceil(Math.max(...latencies.map(v => v ?? 0)) / 20) * 20);
  const graphLabel = points.length ? `${Math.round(points.length / 60)} MIN HISTORY${historyOld ? ' · STALE' : ''}` : 'HISTORY NOT AVAILABLE';
  const footer = !s ? 'Connecting to the local dish API…' : view.health.fault ? `STALE READINGS · Last received ${age}s ago · Check the route to the dish` :
    `LOCAL TELEMETRY · Updated ${age}s ago${historyOld ? ' · History delayed' : ''}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
  <defs><linearGradient id="bg" x2="1" y2="1"><stop stop-color="#13243a"/><stop offset="1" stop-color="${C.bg}"/></linearGradient></defs>
  <rect width="1280" height="720" fill="url(#bg)"/>
  <g font-family="Manrope, sans-serif">
  <circle cx="62" cy="57" r="22" fill="none" stroke="${C.green}" stroke-width="1.5"/>
  <path d="M47 63 L77 49 M52 47 Q49 64 70 68 M62 64 L62 78 M53 78 H71" fill="none" stroke="${C.green}" stroke-width="2.5" stroke-linecap="round"/>
  ${text(100, 53, name.slice(0, 32), 32, C.text, 700)}
  ${text(100, 81, 'CONNECTION HEALTH', 14, C.muted, 600, 'letter-spacing="2"')}
  <rect x="871" y="36" width="369" height="45" rx="23" fill="${accent}" fill-opacity="0.1" stroke="${accent}" stroke-opacity="0.3"/>
  <circle cx="895" cy="58" r="5" fill="${accent}"/>${text(916, 64, state, 16, accent, 700)}
  ${text(1240, 109, new Date(view.now).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }), 14, C.muted, 500, 'text-anchor="end"')}
  <g opacity="${view.health.fault ? 0.55 : 1}">
  ${card(40, 'STARLINK LATENCY', fmt(s?.latency), 'ms', `History p95  ${fmt(percentile(latencies))} ms`, latencies, C.blue)}
  ${card(345, 'PING LOSS · HISTORY', fmt(loss === null ? null : loss * 100, 3), '%', 'Dish → Starlink network', points.map(p => p.loss == null ? null : p.loss * 100), C.amber)}
  ${card(650, 'DOWNLOAD TRAFFIC', fmt(s?.down == null ? null : s.down / 1e6, 2), 'Mbps', `Upload  ${fmt(s?.up == null ? null : s.up / 1e6, 2)} Mbps · actual traffic`, points.map(p => p.down), C.green)}
  ${card(955, 'DISH POWER', fmt(s?.power), 'W', `History average  ${fmt(avgPower)} W`, points.map(p => p.power), C.blue)}
  ${rect(40, 302, 760, 232)}${text(64, 337, 'Latency over time', 22, C.text, 650)}
  ${text(774, 336, graphLabel, 13, historyOld ? C.amber : C.muted, 600, 'text-anchor="end"')}
  ${[0, 0.5, 1].map(f => `<path d="M101 ${370 + f * 122} H773" stroke="${C.border}" stroke-dasharray="3 5"/>${text(86, 375 + f * 122, String(Math.round(chartMax * (1 - f))), 13, C.muted, 500, 'text-anchor="end"')}`).join('')}
  ${line(latencies, 101, 370, 672, 122, C.blue, chartMax)}
  ${text(64, 516, 'ms', 12, C.muted)}${text(101, 516, points.length ? `${Math.round(points.length / 60)} min ago` : 'Waiting for samples', 13, C.muted)}
  ${text(773, 516, 'Latest sample', 13, C.muted, 500, 'text-anchor="end"')}
  ${rect(820, 302, 420, 232)}${text(844, 337, 'Dish & link', 22, C.text, 650)}
  ${healthRows.map(([label, value, color], i) => text(844, 378 + i * 42, label, 17, C.muted) + text(1216, 378 + i * 42, value, 18, color, 650, 'text-anchor="end"')).join('')}
  ${rect(40, 554, 1200, 111)}${text(64, 588, 'Recent interruptions', 20, C.text, 650)}
  ${text(1216, 586, 'RETAINED DISH EVENT LOG', 12, C.muted, 600, 'text-anchor="end"')}
  ${events.length ? events.map((event, i) => {
    const x = 64 + i * 390;
    const when = event.timestamp ? new Date(event.timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }) : 'Recorded';
    return `<circle cx="${x + 4}" cy="626" r="4" fill="${C.amber}"/>` + text(x + 18, 631, event.cause.replaceAll('_', ' ').slice(0, 24), 17, C.text, 600) + text(x + 345, 631, `${when} · ${fmt(event.durationSeconds, 2)}s`, 14, C.muted, 500, 'text-anchor="end"');
  }).join('') : text(64, 631, s ? 'No interruptions in the available event log' : 'Waiting for dish telemetry', 18, C.muted)}
  </g>
  ${text(40, 698, footer, 14, view.health.fault ? C.amber : C.muted)}
  ${text(1240, 698, s ? `FW ${s.firmware.slice(0, 35)}` : 'READ-ONLY MONITOR', 12, C.muted, 500, 'text-anchor="end"')}
  </g></svg>`;
}

export class DashboardRenderer {
  private cache = new Map<string, Promise<Buffer>>();
  constructor(private readonly getView: () => View, private readonly name = 'Starlink') {}
  async render(width = 1280, height = 720, format: 'jpeg' | 'png' = 'jpeg'): Promise<Buffer> {
    const w = Math.min(1920, Math.max(160, Math.round(width))), h = Math.min(1080, Math.max(90, Math.round(height)));
    const view = this.getView();
    const key = `${view.revision}:${Math.floor(view.now / 5000)}:${w}:${h}:${format}`;
    let output = this.cache.get(key);
    if (!output) {
      if (this.cache.size > 8) this.cache.clear();
      output = (async () => {
        const image = new Resvg(dashboardSvg(view, this.name), {
          font: { fontFiles: ['Manrope-Regular.ttf', 'Manrope-Bold.ttf'].map(file => path.join(__dirname, '../assets', file)), loadSystemFonts: false, defaultFontFamily: 'Manrope' },
        }).render().asPng();
        const resized = sharp(image).resize(w, h, { fit: 'contain', background: C.bg });
        return format === 'png' ? resized.png().toBuffer() : resized.jpeg({ quality: 88 }).toBuffer();
      })();
      this.cache.set(key, output);
      output.catch(() => this.cache.delete(key));
    }
    return output;
  }
}
