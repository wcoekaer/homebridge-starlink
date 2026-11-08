import type { API, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig, Service } from 'homebridge' with { 'resolution-mode': 'import' };
import { settings, PLUGIN_NAME, PLATFORM_NAME, type Settings } from './config';
import { StarlinkClient } from './client';
import { TelemetryMonitor, type View } from './telemetry';
import { DashboardRenderer } from './dashboard';
import { DashboardCamera } from './camera';

type SensorKind = 'outage' | 'degraded' | 'unreachable';
export class StarlinkPlatform implements DynamicPlatformPlugin {
  private readonly config: Settings;
  private readonly accessories = new Map<string, PlatformAccessory>();
  private readonly sensors = new Map<SensorKind, Service>();
  private monitor?: TelemetryMonitor;
  private camera?: DashboardCamera;
  private lastState?: string;
  constructor(private readonly log: Logger, config: PlatformConfig, private readonly api: API) {
    this.config = settings(config);
    api.on('didFinishLaunching', () => this.launch());
    api.on('shutdown', () => { this.monitor?.stop(); this.camera?.shutdown(); });
  }
  configureAccessory(accessory: PlatformAccessory): void { this.accessories.set(accessory.UUID, accessory); }
  private launch(): void {
    const source = new StarlinkClient(this.config.host, this.config.port, this.config.timeoutSeconds * 1000);
    this.monitor = new TelemetryMonitor(source, this.config);
    const keep = new Set<string>();
    const accessory = (kind: string, name: string, category?: number): PlatformAccessory => {
      const uuid = this.api.hap.uuid.generate(`${PLUGIN_NAME}:${this.config.host}:${this.config.port}:${kind}`);
      keep.add(uuid);
      let a = this.accessories.get(uuid);
      if (!a) { a = new this.api.platformAccessory(name, uuid, category); this.accessories.set(uuid, a); }
      a.displayName = name;
      a.getService(this.api.hap.Service.AccessoryInformation)!
        .setCharacteristic(this.api.hap.Characteristic.Manufacturer, 'Starlink Monitor')
        .setCharacteristic(this.api.hap.Characteristic.Model, kind === 'camera' ? 'Telemetry Dashboard' : 'Connection Health')
        .setCharacteristic(this.api.hap.Characteristic.SerialNumber, uuid.slice(0, 18))
        .setCharacteristic(this.api.hap.Characteristic.FirmwareRevision, '0.1.0');
      return a;
    };
    const newlyCreated: PlatformAccessory[] = [];
    const existingIds = new Set(this.accessories.keys());
    const labels: Record<SensorKind, string> = { outage: 'Outage', degraded: 'Degraded', unreachable: 'Monitor Unreachable' };
    for (const kind of Object.keys(labels) as SensorKind[]) {
      if (!this.config.sensors[kind]) continue;
      const name = `${this.config.name} ${labels[kind]}`;
      const a = accessory(kind, name, this.api.hap.Categories.SENSOR);
      const service = a.getService(this.api.hap.Service.ContactSensor) || a.addService(this.api.hap.Service.ContactSensor, name);
      service.setCharacteristic(this.api.hap.Characteristic.Name, name);
      service.getCharacteristic(this.api.hap.Characteristic.ContactSensorState).onGet(() => {
        const view = this.monitor!.view();
        if (kind !== 'unreachable' && view.health.fault) throw new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
        return view.health[kind] ? 1 : 0;
      });
      this.sensors.set(kind, service);
      if (!existingIds.has(a.UUID)) newlyCreated.push(a);
    }
    if (this.config.camera.enabled) {
      const a = accessory('camera', this.config.camera.name, this.api.hap.Categories.CAMERA);
      const renderer = new DashboardRenderer(() => this.monitor!.view(), this.config.name);
      this.camera = new DashboardCamera(this.api.hap, renderer, this.config.camera, this.log);
      a.configureController(this.camera.controller);
      if (!existingIds.has(a.UUID)) newlyCreated.push(a);
    }
    if (newlyCreated.length) this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, newlyCreated);
    const removed = [...this.accessories.values()].filter(a => !keep.has(a.UUID));
    if (removed.length) this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, removed);
    this.api.updatePlatformAccessories([...this.accessories.values()].filter(a => keep.has(a.UUID)));
    this.monitor.on('update', (view: View) => this.update(view));
    this.update(this.monitor.view());
    this.monitor.start();
    this.log.info('Monitoring %s:%s; %s health sensors%s. All dish requests are read-only.', this.config.host, this.config.port, this.sensors.size, this.config.camera.enabled ? ' and dashboard camera' : '');
  }
  private update(view: View): void {
    const C = this.api.hap.Characteristic;
    for (const [kind, service] of this.sensors) {
      const faulty = kind !== 'unreachable' && view.health.fault;
      service.updateCharacteristic(C.StatusFault, faulty ? C.StatusFault.GENERAL_FAULT : C.StatusFault.NO_FAULT);
      service.updateCharacteristic(C.StatusActive, !faulty);
      // Preserve the previous alarm during a telemetry outage; fault does not mean recovery.
      if (!faulty) service.updateCharacteristic(C.ContactSensorState, view.health[kind] ? 1 : 0);
    }
    const state = JSON.stringify(view.health);
    if (state !== this.lastState) {
      this.lastState = state;
      if (view.health.unreachable) this.log.warn('Dish telemetry is stale; check power and the route to %s. Starlink Internet state is unknown.', this.config.host);
      else if (view.snapshot) this.log.info('Health: outage=%s degraded=%s', view.health.outage, view.health.degraded);
    }
    if (view.error) this.log.debug('%s', view.error);
  }
}
