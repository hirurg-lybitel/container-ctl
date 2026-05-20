const parseBoolean = (value, defaultValue) => {
  if (value === undefined || value === '') {
    return defaultValue;
  }

  const normalized = String(value).trim().toLowerCase();

  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }

  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }

  return defaultValue;
};

const parsePositiveInteger = (value, defaultValue) => {
  const parsed = Number.parseInt(String(value ?? ''), 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return defaultValue;
  }

  return parsed;
};

const getRuntimeConfig = (env = process.env) => ({
  apiKey: String(env.CONTAINER_CTL_API_KEY ?? '').trim(),
  dockerSocket: String(env.CONTAINER_CTL_DOCKER_SOCKET ?? '/var/run/docker.sock').trim(),
  allowContainerDelete: parseBoolean(env.CONTAINER_CTL_ALLOW_DELETE, false),
  listenHost: String(env.CONTAINER_CTL_LISTEN_HOST ?? '0.0.0.0').trim(),
  listenPort: parsePositiveInteger(env.CONTAINER_CTL_LISTEN_PORT, 3080)
});

module.exports = {
  getRuntimeConfig,
  parseBoolean,
  parsePositiveInteger
};
