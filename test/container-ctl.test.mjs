import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const { createApiHandler, parseApiPath } = require('../src/api.js');
const { createAuthGuard, timingSafeEqualStrings } = require('../src/auth.js');
const {
  mapContainerInspect,
  mapContainerListItem
} = require('../src/dockerClient.js');
const { getRuntimeConfig } = require('../src/config.js');

const listen = (server) =>
  new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();

      if (!address || typeof address === 'string') {
        reject(new Error('Failed to resolve server listen port'));
        return;
      }

      resolve(address.port);
    });
  });

const closeServer = (server) =>
  new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });

const requestApi = ({ port, method, path: requestPath, body, apiKey }) =>
  new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : '';
    const headers = {
      ...(apiKey ? { 'x-api-key': apiKey } : {})
    };

    if (payload) {
      headers['content-type'] = 'application/json';
      headers['content-length'] = Buffer.byteLength(payload);
    }

    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method,
        path: requestPath,
        headers
      },
      (res) => {
        const chunks = [];

        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode,
            body: Buffer.concat(chunks).toString('utf8')
          });
        });
      }
    );

    req.on('error', reject);

    if (payload) {
      req.write(payload);
    }

    req.end();
  });

test('parseApiPath recognizes container routes only', () => {
  assert.deepEqual(parseApiPath('/api/containers'), { kind: 'containers' });
  assert.deepEqual(parseApiPath('/api/containers/app_backend'), {
    kind: 'container',
    name: 'app_backend'
  });
  assert.deepEqual(parseApiPath('/api/hosts'), { kind: 'none' });
});

test('getRuntimeConfig reads CONTAINER_CTL environment', () => {
  const config = getRuntimeConfig({
    CONTAINER_CTL_API_KEY: 'secret',
    CONTAINER_CTL_ALLOW_DELETE: 'true',
    CONTAINER_CTL_LISTEN_PORT: '4000'
  });

  assert.equal(config.apiKey, 'secret');
  assert.equal(config.allowContainerDelete, true);
  assert.equal(config.listenPort, 4000);
  assert.equal(config.dockerSocket, '/var/run/docker.sock');
});

test('mapContainerInspect builds suggestedUpstream and networks', () => {
  const detail = mapContainerInspect({
    Id: 'abc',
    Name: '/app_backend',
    State: { Status: 'running' },
    Config: {
      ExposedPorts: {
        '3000/tcp': {}
      }
    },
    NetworkSettings: {
      Ports: {
        '3000/tcp': null
      },
      Networks: {
        proxy_network: {
          IPAddress: '172.18.0.5',
          Aliases: ['app_backend', 'app_backend_alias']
        }
      }
    }
  });

  assert.equal(detail.name, 'app_backend');
  assert.equal(detail.suggestedUpstream.host, 'app_backend');
  assert.equal(detail.suggestedUpstream.port, 3000);
  assert.equal(detail.networks.proxy_network.ipAddress, '172.18.0.5');
  assert.deepEqual(detail.ports[0], {
    containerPort: 3000,
    hostPort: null,
    protocol: 'tcp'
  });
});

test('mapContainerListItem normalizes docker list shape', () => {
  const item = mapContainerListItem(
    {
      Id: 'id1',
      Names: ['/my_app'],
      State: 'running'
    },
    { Status: 'running' }
  );

  assert.deepEqual(item, {
    id: 'id1',
    name: 'my_app',
    state: 'running',
    statusText: 'running'
  });
});

test('GET /api/containers returns docker list', async (t) => {
  const dockerClient = {
    listContainers: async () => [
      { id: 'id1', name: 'app', state: 'running', statusText: 'running' }
    ],
    inspectContainer: async () => ({}),
    runContainerAction: async () => ({})
  };

  const handler = createApiHandler({
    apiKey: 'test-key',
    dockerClient,
    allowContainerDelete: false
  });

  const server = http.createServer((req, res) => {
    void handler(req, res);
  });

  t.after(() => closeServer(server));
  const port = await listen(server);

  const response = await requestApi({
    port,
    method: 'GET',
    path: '/api/containers',
    apiKey: 'test-key'
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), [
    { id: 'id1', name: 'app', state: 'running', statusText: 'running' }
  ]);
});

test('GET /api/containers/:name returns inspect payload', async (t) => {
  const dockerClient = {
    listContainers: async () => [],
    inspectContainer: async (name) => ({
      id: 'id1',
      name,
      state: 'running',
      statusText: 'running',
      suggestedUpstream: { host: name, port: 3000 },
      ports: [],
      networks: {}
    }),
    runContainerAction: async () => ({})
  };

  const handler = createApiHandler({
    apiKey: 'test-key',
    dockerClient,
    allowContainerDelete: false
  });

  const server = http.createServer((req, res) => {
    void handler(req, res);
  });

  t.after(() => closeServer(server));
  const port = await listen(server);

  const response = await requestApi({
    port,
    method: 'GET',
    path: '/api/containers/app_backend',
    apiKey: 'test-key'
  });

  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.name, 'app_backend');
  assert.equal(body.suggestedUpstream.port, 3000);
});

test('POST /api/containers/:name runs lifecycle action', async (t) => {
  const actions = [];
  const dockerClient = {
    listContainers: async () => [],
    inspectContainer: async () => ({}),
    runContainerAction: async (params) => {
      actions.push(params);
      return {
        containerId: 'id1',
        containerName: params.containerName,
        action: params.action
      };
    }
  };

  const handler = createApiHandler({
    apiKey: 'test-key',
    dockerClient,
    allowContainerDelete: false
  });

  const server = http.createServer((req, res) => {
    void handler(req, res);
  });

  t.after(() => closeServer(server));
  const port = await listen(server);

  const response = await requestApi({
    port,
    method: 'POST',
    path: '/api/containers/app_backend',
    apiKey: 'test-key',
    body: { action: 'restart' }
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(actions, [
    {
      containerName: 'app_backend',
      action: 'restart',
      allowDelete: false
    }
  ]);
});

test('POST delete returns 403 when disabled', async (t) => {
  const dockerClient = {
    listContainers: async () => [],
    inspectContainer: async () => ({}),
    runContainerAction: async () => {
      const error = new Error('Container delete is disabled');
      error.code = 'CONTAINER_DELETE_DISABLED';
      throw error;
    }
  };

  const handler = createApiHandler({
    apiKey: 'test-key',
    dockerClient,
    allowContainerDelete: false
  });

  const server = http.createServer((req, res) => {
    void handler(req, res);
  });

  t.after(() => closeServer(server));
  const port = await listen(server);

  const response = await requestApi({
    port,
    method: 'POST',
    path: '/api/containers/app_backend',
    apiKey: 'test-key',
    body: { action: 'delete' }
  });

  assert.equal(response.statusCode, 403);
});

test('unknown container returns 404', async (t) => {
  const dockerClient = {
    listContainers: async () => [],
    inspectContainer: async () => {
      const error = new Error('Container not found: missing');
      error.code = 'CONTAINER_NOT_FOUND';
      throw error;
    },
    runContainerAction: async () => ({})
  };

  const handler = createApiHandler({
    apiKey: 'test-key',
    dockerClient,
    allowContainerDelete: false
  });

  const server = http.createServer((req, res) => {
    void handler(req, res);
  });

  t.after(() => closeServer(server));
  const port = await listen(server);

  const response = await requestApi({
    port,
    method: 'GET',
    path: '/api/containers/missing',
    apiKey: 'test-key'
  });

  assert.equal(response.statusCode, 404);
});

test('auth guard uses timing-safe comparison', () => {
  assert.equal(timingSafeEqualStrings('abc', 'abc'), true);
  assert.equal(timingSafeEqualStrings('abc', 'abd'), false);

  const guard = createAuthGuard('secret');
  assert.equal(guard({ headers: { authorization: 'Bearer secret' } }), true);
  assert.equal(guard({ headers: { authorization: 'Bearer wrong' } }), false);
});

test(
  'integration: list docker containers when CONTAINER_CTL_INTEGRATION_DOCKER=1',
  { skip: process.env.CONTAINER_CTL_INTEGRATION_DOCKER !== '1' },
  async () => {
    const { createDockerClient } = require('../src/dockerClient.js');
    const client = createDockerClient({
      socketPath: process.env.CONTAINER_CTL_DOCKER_SOCKET ?? '/var/run/docker.sock'
    });
    const containers = await client.listContainers();

    assert.ok(Array.isArray(containers));
  }
);
