import * as grpc from '@grpc/grpc-js';
import { loadSync } from '@grpc/proto-loader';
import path from 'node:path';

export type Wire = Record<string, any>;
export interface TelemetrySource { status(): Promise<Wire>; history(): Promise<Wire>; close(): void }

export class StarlinkClient implements TelemetrySource {
  private readonly client: grpc.Client & { Handle: Function };
  constructor(host = '192.168.100.1', port = 9200, private readonly timeoutMs = 5000) {
    const schema = loadSync(path.join(__dirname, '../proto/starlink.proto'), {
      keepCase: true, longs: String, enums: String, defaults: true, oneofs: true,
    });
    const root = grpc.loadPackageDefinition(schema) as any;
    const address = `${host.includes(':') ? `[${host}]` : host}:${port}`;
    this.client = new root.SpaceX.API.Device.Device(address, grpc.credentials.createInsecure(), {
      'grpc.max_receive_message_length': 4 * 1024 * 1024,
      'grpc.enable_retries': 0,
    });
  }
  private read(request: 'get_status' | 'get_history', responseKey: string): Promise<Wire> {
    return new Promise((resolve, reject) => {
      this.client.Handle({ [request]: {} }, { deadline: Date.now() + this.timeoutMs }, (error: Error | null, response: Wire) => {
        if (error) return reject(new Error(`Dish ${request}: ${error.message}`));
        if (response?.status?.code) return reject(new Error(`Dish rejected ${request}: ${response.status.code}`));
        if (!response?.[responseKey]) return reject(new Error(`Dish did not return ${responseKey}; firmware schema may have changed`));
        resolve(response[responseKey]);
      });
    });
  }
  status(): Promise<Wire> { return this.read('get_status', 'dish_get_status'); }
  history(): Promise<Wire> { return this.read('get_history', 'dish_get_history'); }
  close(): void { this.client.close(); }
}
