const { test } = require('node:test');
const assert = require('node:assert/strict');
const grpc = require('@grpc/grpc-js');
const loader = require('@grpc/proto-loader');
const path = require('node:path');
const { StarlinkClient } = require('../dist/client');
test('gRPC wire client reads status/history and enforces deadlines', { timeout: 10000 }, async t => {
  const schema = loader.loadSync(path.join(__dirname, '../proto/starlink.proto'), { keepCase: true });
  const root = grpc.loadPackageDefinition(schema);
  const server = new grpc.Server(); const requests = [];
  server.addService(root.SpaceX.API.Device.Device.service, { Handle(call, done) {
    requests.push(call.request);
    if (call.request.get_status) done(null, { dish_get_status: { device_state: { uptime_s: 123 }, pop_ping_latency_ms: 20 } });
    else done(null, { dish_get_history: { current: 1, pop_ping_latency_ms: [20] } });
  } });
  const port = await new Promise((resolve, reject) => server.bindAsync('127.0.0.1:0', grpc.ServerCredentials.createInsecure(), (err, port) => err ? reject(err) : resolve(port)));
  t.after(() => server.forceShutdown());
  const client = new StarlinkClient('127.0.0.1', port, 1000); t.after(() => client.close());
  assert.equal((await client.status()).device_state.uptime_s, '123');
  assert.equal((await client.history()).pop_ping_latency_ms[0], 20);
  assert.deepEqual(Object.keys(requests[0]), ['get_status']); assert.deepEqual(Object.keys(requests[1]), ['get_history']);
  server.forceShutdown();
  await assert.rejects(client.status(), /Dish get_status/);
});
