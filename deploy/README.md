# Production foundation

This Compose model is an interim single-VM foundation. The app binds to loopback by default; set `APP_BIND_ADDRESS` in the VM-only `.env` to its trusted LAN address when Caddy runs on another host. PostgreSQL has no host port. Restrict port 3000 to the trusted LAN at the VM or Proxmox firewall before public routing. Runtime secrets belong in `secrets/`, which is ignored by Git.

```bash
export SOURCE_REVISION="$(git rev-parse HEAD)"
test "$(printf '%s' "$SOURCE_REVISION" | wc -c)" -eq 40
git rev-parse --verify "$SOURCE_REVISION^{commit}" >/dev/null
docker compose config --quiet
docker compose build
docker compose --profile tools run --rm migrate
docker compose up -d db app
docker compose ps
curl --fail http://127.0.0.1:3000/ready
```

`SOURCE_REVISION` is embedded into the web bundle. The visible **Исходный код** link points to
that exact public GitHub commit. Set it again after every checkout, including rollback, before
building the image.

Rollback deploys the previous Git commit and rebuilds `app`; PostgreSQL data is preserved. Never use `down -v`. Before a migration, create a PostgreSQL dump and a Proxmox backup on `Array-Backup`.
