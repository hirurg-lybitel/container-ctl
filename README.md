# container-ctl

Standalone HTTP API for Docker containers: list, inspect (ports and networks), and lifecycle actions (`start`, `stop`, `restart`, optional `delete`).

Works on any host with access to the Docker socket.

## Use cases

- **Automation / CI** — query container state and ports before or after deploys.
- **Internal tooling** — start, stop, or restart services from scripts or dashboards.
- **Routing helpers** — `inspect` returns `suggestedUpstream` (`host` = container name, `port` = first exposed port) when you wire traffic elsewhere; pick an explicit port from `ports` when several are exposed.

## API

Auth: `Authorization: Bearer <key>` or `X-API-Key`.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/containers` | List containers (`id`, `name`, `state`, `statusText`) |
| `GET` | `/api/containers/:name` | Inspect + `suggestedUpstream`, `ports`, `networks` |
| `POST` | `/api/containers/:name` | Body `{"action":"start\|stop\|restart\|delete"}` |

Default listen: `http://0.0.0.0:3080`.

### Inspect example

```json
{
  "id": "abc123",
  "name": "my_app",
  "state": "running",
  "statusText": "running",
  "suggestedUpstream": { "host": "my_app", "port": 3000 },
  "ports": [{ "containerPort": 3000, "hostPort": null, "protocol": "tcp" }],
  "networks": {
    "bridge": { "ipAddress": "172.17.0.2", "aliases": ["my_app"] }
  }
}
```

If several ports are exposed, `suggestedUpstream.port` is the first discovered; choose explicitly from `ports` when ambiguous.

### Lifecycle example

```bash
curl -sS -H "Authorization: Bearer $CONTAINER_CTL_API_KEY" \
  http://127.0.0.1:3080/api/containers/my_app

curl -sS -X POST -H "Authorization: Bearer $CONTAINER_CTL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"action":"restart"}' \
  http://127.0.0.1:3080/api/containers/my_app
```

`delete` is rejected unless `CONTAINER_CTL_ALLOW_DELETE=true`.

## Configuration

| Variable | Description |
|----------|-------------|
| `CONTAINER_CTL_API_KEY` | API key (required) |
| `CONTAINER_CTL_DOCKER_SOCKET` | Docker socket (default `/var/run/docker.sock`) |
| `CONTAINER_CTL_ALLOW_DELETE` | Allow `action: delete` (default `false`) |
| `CONTAINER_CTL_LISTEN_HOST` | Bind address (default `0.0.0.0`) |
| `CONTAINER_CTL_LISTEN_PORT` | Port (default `3080`) |

## Run

**Node (local or VM)**

```bash
npm install
cp .env.example .env
# set CONTAINER_CTL_API_KEY in .env
npm start
```

**Docker Compose**

```bash
docker compose up -d --build
```

Only `docker.sock` is mounted.

Bind to a private interface or protect the port with a firewall — the API can control every container on the host.

## Tests

```bash
npm test
```

Docker integration: `CONTAINER_CTL_INTEGRATION_DOCKER=1 npm test`
