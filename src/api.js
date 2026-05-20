const { URL } = require('url');

const { createAuthGuard } = require('./auth');
const { validateContainerName } = require('./dockerClient');

const VALID_CONTAINER_ACTIONS = new Set(['start', 'stop', 'restart', 'delete']);
const MAX_REQUEST_BODY_BYTES = 64 * 1024;

const sendJson = (res, statusCode, payload) => {
  const body = JSON.stringify(payload);

  res.writeHead(statusCode, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
};

const readRequestBody = (req, limitBytes) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    let totalBytes = 0;

    req.on('data', (chunk) => {
      totalBytes += chunk.length;

      if (totalBytes > limitBytes) {
        reject(new Error('REQUEST_BODY_TOO_LARGE'));
        req.destroy();
        return;
      }

      chunks.push(chunk);
    });

    req.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf8'));
    });

    req.on('error', reject);
  });

const parseApiPath = (rawUrl = '/') => {
  try {
    const url = new URL(String(rawUrl ?? '/'), 'http://container-ctl.local');
    const pathname = url.pathname.endsWith('/') && url.pathname.length > 1
      ? url.pathname.slice(0, -1)
      : url.pathname;

    if (pathname === '/api/containers') {
      return { kind: 'containers' };
    }

    const containerMatch = pathname.match(/^\/api\/containers\/([^/]+)$/);

    if (containerMatch) {
      return {
        kind: 'container',
        name: decodeURIComponent(containerMatch[1])
      };
    }

    return { kind: 'none' };
  } catch {
    return { kind: 'none' };
  }
};

const createApiHandler = ({
  apiKey,
  dockerClient,
  allowContainerDelete
}) => {
  const isAuthorized = createAuthGuard(apiKey);

  return async (req, res) => {
    const route = parseApiPath(req.url);

    if (route.kind === 'none') {
      sendJson(res, 404, { error: 'Not Found' });
      return;
    }

    if (!isAuthorized(req)) {
      sendJson(res, 401, { error: 'Unauthorized' });
      return;
    }

    try {
      if (route.kind === 'containers' && req.method === 'GET') {
        const containers = await dockerClient.listContainers();
        sendJson(res, 200, containers);
        return;
      }

      if (route.kind === 'container' && req.method === 'GET') {
        try {
          validateContainerName(route.name);
        } catch (error) {
          if (error.code === 'INVALID_CONTAINER_NAME') {
            sendJson(res, 400, { error: error.message });
            return;
          }

          throw error;
        }

        try {
          const detail = await dockerClient.inspectContainer(route.name);
          sendJson(res, 200, detail);
        } catch (error) {
          if (error.code === 'CONTAINER_NOT_FOUND') {
            sendJson(res, 404, { error: error.message });
            return;
          }

          throw error;
        }

        return;
      }

      if (route.kind === 'container' && req.method === 'POST') {
        try {
          validateContainerName(route.name);
        } catch (error) {
          if (error.code === 'INVALID_CONTAINER_NAME') {
            sendJson(res, 400, { error: error.message });
            return;
          }

          throw error;
        }

        let rawBody;

        try {
          rawBody = await readRequestBody(req, MAX_REQUEST_BODY_BYTES);
        } catch (error) {
          if (error.message === 'REQUEST_BODY_TOO_LARGE') {
            sendJson(res, 413, { error: 'Request body is too large' });
            return;
          }

          throw error;
        }

        let parsedBody;

        try {
          parsedBody = rawBody ? JSON.parse(rawBody) : {};
        } catch {
          sendJson(res, 400, { error: 'Request body must be valid JSON' });
          return;
        }

        const action = String(parsedBody.action ?? '').trim().toLowerCase();

        if (!action) {
          sendJson(res, 400, { error: 'Action is required' });
          return;
        }

        if (!VALID_CONTAINER_ACTIONS.has(action)) {
          sendJson(res, 400, { error: 'Unsupported container action' });
          return;
        }

        try {
          const result = await dockerClient.runContainerAction({
            containerName: route.name,
            action,
            allowDelete: allowContainerDelete
          });
          sendJson(res, 200, { message: 'Ok', ...result });
        } catch (error) {
          if (error.code === 'CONTAINER_NOT_FOUND') {
            sendJson(res, 404, { error: error.message });
            return;
          }

          if (error.code === 'CONTAINER_DELETE_DISABLED') {
            sendJson(res, 403, { error: error.message });
            return;
          }

          throw error;
        }

        return;
      }

      sendJson(res, 405, { error: 'Method Not Allowed' });
    } catch (error) {
      console.error('[container-ctl]', error);
      sendJson(res, 500, { error: error.message ?? 'Internal Server Error' });
    }
  };
};

module.exports = {
  VALID_CONTAINER_ACTIONS,
  createApiHandler,
  parseApiPath
};
