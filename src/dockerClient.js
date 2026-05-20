const Docker = require('dockerode');

const CONTAINER_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;

const formatStatusText = (containerInfo) => {
  if (!containerInfo?.Status) {
    return '';
  }

  return containerInfo.Status;
};

const mapContainerListItem = (summary, state) => ({
  id: summary.Id,
  name: (summary.Names?.[0] ?? '').replace(/^\//, ''),
  state: state?.Status ?? summary.State ?? '',
  statusText: formatStatusText(state ?? summary)
});

const parsePortNumber = (value) => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const collectPorts = (inspect) => {
  const ports = [];
  const bindings = inspect.NetworkSettings?.Ports ?? {};

  for (const [key, bindingsList] of Object.entries(bindings)) {
    const [containerPort, protocol = 'tcp'] = key.split('/');

    if (!bindingsList || bindingsList.length === 0) {
      ports.push({
        containerPort: parsePortNumber(containerPort),
        hostPort: null,
        protocol
      });
      continue;
    }

    for (const binding of bindingsList) {
      ports.push({
        containerPort: parsePortNumber(containerPort),
        hostPort: parsePortNumber(binding.HostPort),
        protocol: binding.Type ?? protocol
      });
    }
  }

  if (ports.length === 0) {
    for (const key of Object.keys(inspect.Config?.ExposedPorts ?? {})) {
      const [containerPort, protocol = 'tcp'] = key.split('/');
      ports.push({
        containerPort: parsePortNumber(containerPort),
        hostPort: null,
        protocol
      });
    }
  }

  return ports;
};

const collectNetworks = (inspect) => {
  const networks = {};
  const settings = inspect.NetworkSettings?.Networks ?? {};

  for (const [networkName, network] of Object.entries(settings)) {
    networks[networkName] = {
      ipAddress: network.IPAddress ?? '',
      aliases: Array.isArray(network.Aliases) ? network.Aliases : []
    };
  }

  return networks;
};

const pickSuggestedPort = (ports) => {
  if (!ports.length) {
    return null;
  }

  const withBinding = ports.find((item) => item.containerPort !== null);

  return withBinding?.containerPort ?? ports[0].containerPort ?? null;
};

const mapContainerInspect = (inspect) => {
  const name = (inspect.Name ?? '').replace(/^\//, '');
  const ports = collectPorts(inspect);
  const networks = collectNetworks(inspect);

  return {
    id: inspect.Id,
    name,
    state: inspect.State?.Status ?? '',
    statusText: formatStatusText(inspect.State),
    suggestedUpstream: {
      host: name,
      port: pickSuggestedPort(ports)
    },
    ports,
    networks
  };
};

const validateContainerName = (containerName) => {
  const normalized = String(containerName ?? '').trim();

  if (!normalized || !CONTAINER_NAME_PATTERN.test(normalized)) {
    const error = new Error('Invalid container name');
    error.code = 'INVALID_CONTAINER_NAME';
    throw error;
  }

  return normalized;
};

const createDockerClient = ({
  socketPath,
  dockerFactory = (options) => new Docker(options)
} = {}) => {
  const docker = dockerFactory({ socketPath });

  const listContainers = async () => {
    const containers = await docker.listContainers({ all: true });
    const results = [];

    for (const summary of containers) {
      let state = null;

      try {
        const inspect = await docker.getContainer(summary.Id).inspect();
        state = inspect.State;
      } catch {
        state = { Status: summary.State ?? 'unknown' };
      }

      results.push(mapContainerListItem(summary, state));
    }

    return results;
  };

  const findContainerByName = async (containerName) => {
    const normalizedName = validateContainerName(containerName);
    const containers = await listContainers();
    return containers.find((item) => item.name === normalizedName) ?? null;
  };

  const inspectContainer = async (containerName) => {
    const match = await findContainerByName(containerName);

    if (!match) {
      const error = new Error(`Container not found: ${containerName}`);
      error.code = 'CONTAINER_NOT_FOUND';
      throw error;
    }

    const inspect = await docker.getContainer(match.id).inspect();
    return mapContainerInspect(inspect);
  };

  const runContainerAction = async ({ containerName, action, allowDelete = false }) => {
    const match = await findContainerByName(containerName);

    if (!match) {
      const error = new Error(`Container not found: ${containerName}`);
      error.code = 'CONTAINER_NOT_FOUND';
      throw error;
    }

    const container = docker.getContainer(match.id);

    switch (action) {
      case 'start':
        await container.start();
        break;
      case 'stop':
        await container.stop();
        break;
      case 'restart':
        await container.restart();
        break;
      case 'delete':
        if (!allowDelete) {
          const error = new Error('Container delete is disabled');
          error.code = 'CONTAINER_DELETE_DISABLED';
          throw error;
        }

        try {
          await container.stop();
        } catch (error) {
          if (error.statusCode !== 304 && error.statusCode !== 404) {
            throw error;
          }
        }

        await container.remove({ force: true });
        break;
      default: {
        const error = new Error(`Unsupported container action: ${action}`);
        error.code = 'INVALID_CONTAINER_ACTION';
        throw error;
      }
    }

    return { containerId: match.id, containerName: match.name, action };
  };

  return {
    findContainerByName,
    inspectContainer,
    listContainers,
    runContainerAction,
    validateContainerName
  };
};

module.exports = {
  CONTAINER_NAME_PATTERN,
  createDockerClient,
  mapContainerInspect,
  mapContainerListItem,
  validateContainerName
};
