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

## CI/CD (GitHub Actions)

On every push to `main`, the workflow [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml):

1. Runs `npm test`
2. Builds and pushes the image to `ghcr.io/gsbelarus/container-ctl` (`latest` + commit SHA tag)
3. Copies `docker-compose.yml` to the server and runs `docker compose pull && up -d`

### Server setup (once)

- Docker and Docker Compose v2
- External network `proxy_network` (as in `docker-compose.yml`)
- Deploy directory, e.g. `/opt/container-ctl`:
  - `docker-compose.yml` (updated automatically by CI)
  - `.env` with `CONTAINER_CTL_API_KEY` and other settings (create manually, not in git)

```bash
sudo mkdir -p /opt/container-ctl
sudo chown "$USER:$USER" /opt/container-ctl
cp .env.example /opt/container-ctl/.env
# edit /opt/container-ctl/.env — set CONTAINER_CTL_API_KEY
```

### GitHub repository secrets

| Secret | Description |
|--------|-------------|
| `SSH_HOST` | Server hostname or IP |
| `SSH_USER` | SSH user (must run `docker` without sudo, or use root) |
| `SSH_PRIVATE_KEY` | Private key (PEM), matching `authorized_keys` on the server |
| `DEPLOY_PATH` | Absolute path on the server, e.g. `/opt/container-ctl` |
| `SSH_PORT` | Optional, default `22` |
| `GHCR_TOKEN` | Optional: PAT with `read:packages` if the GHCR image is **private** |

For a **public** package, `GHCR_TOKEN` is not required — the server pulls without login.

After the first workflow run, make the GHCR package public (if needed): **GitHub → Packages → container-ctl → Package settings → Change visibility**.
