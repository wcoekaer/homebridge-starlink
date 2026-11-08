// Launch a disposable Homebridge child bridge with a synthetic local dish.
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const grpc = require('@grpc/grpc-js');
const loader = require('@grpc/proto-loader');
const { demoTelemetry } = require('../dist/demo');
async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.on('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port;
}
const mac = () => ['02', ...crypto.randomBytes(5).toString('hex').match(/../g)].join(':').toUpperCase();
(async () => {
  const storage = await fs.mkdtemp(path.join(os.tmpdir(), 'starlink-child-smoke-'));
  const schema = loader.loadSync(path.join(__dirname, '../proto/starlink.proto'), { keepCase: true });
  const root = grpc.loadPackageDefinition(schema), server = new grpc.Server();
  server.addService(root.SpaceX.API.Device.Device.service, { Handle(call, done) {
    const d = demoTelemetry(); done(null, call.request.get_status ? { dish_get_status: d.status } : { dish_get_history: d.history });
  } });
  let child;
  try {
    const port = await new Promise((resolve, reject) => server.bindAsync('127.0.0.1:0', grpc.ServerCredentials.createInsecure(), (err, port) => err ? reject(err) : resolve(port)));
    await fs.writeFile(path.join(storage, 'config.json'), JSON.stringify({ bridge: { name: 'Starlink Test Only', username: mac(), port: await freePort(), pin: '781-34-629' }, plugins: ['homebridge-starlink'], accessories: [], platforms: [{ platform: 'Starlink', host: '127.0.0.1', port, name: 'Starlink Test', _bridge: { username: mac(), port: await freePort() } }] }));
    child = spawn(process.execPath, [path.join(__dirname, '../node_modules/homebridge/bin/homebridge.js'), '-U', storage, '-P', path.resolve(__dirname, '..'), '--strict-plugin-resolution'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Homebridge child bridge did not become ready:\n' + output)), 20000);
      const read = chunk => {
        output = (output + String(chunk)).slice(-20000);
        if (output.includes('Monitoring 127.0.0.1') && output.includes('Health: outage=false degraded=false') && /Starlink.*[Rr]unning on port|Homebridge.*running on port/.test(output)) { clearTimeout(timeout); resolve(); }
      };
      child.stdout.on('data', read); child.stderr.on('data', read);
      child.once('error', e => { clearTimeout(timeout); reject(e); });
      child.once('exit', code => { clearTimeout(timeout); reject(new Error(`Homebridge exited ${code}: ${output}`)); });
    });
    console.log(output.split('\n').filter(line => /Loaded plugin|Registering platform|child bridge|Monitoring|Health:|running on port|WARNING|ERROR/i.test(line)).join('\n'));
    console.log('PASS: disposable Homebridge parent and child bridge started; camera and sensors registered; telemetry polled.');
  } finally {
    if (child && child.exitCode === null) {
      child.kill('SIGTERM');
      await new Promise(resolve => { const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 5000); child.once('exit', () => { clearTimeout(timer); resolve(); }); });
    }
    server.forceShutdown(); await fs.rm(storage, { recursive: true, force: true });
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
