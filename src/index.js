const http = require('http');

const { createApiHandler } = require('./api');
const { getRuntimeConfig } = require('./config');
const { createDockerClient } = require('./dockerClient');

const config = getRuntimeConfig();

if (!config.apiKey) {
  console.error('CONTAINER_CTL_API_KEY is required');
  process.exit(1);
}

const dockerClient = createDockerClient({
  socketPath: config.dockerSocket
});

const handler = createApiHandler({
  apiKey: config.apiKey,
  dockerClient,
  allowContainerDelete: config.allowContainerDelete
});

const server = http.createServer((req, res) => {
  void Promise.resolve(handler(req, res)).catch((error) => {
    console.error('[container-ctl] unhandled', error);
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'Internal Server Error' }));
  });
});

server.listen(config.listenPort, config.listenHost, () => {
  console.log(
    `container-ctl listening on http://${config.listenHost}:${config.listenPort}`
  );
});
