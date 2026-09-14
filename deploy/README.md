# Production foundation

This Compose model is an interim single-VM foundation. The app publishes port 3000 on the VM so Caddy on the Proxmox host can reach it; PostgreSQL has no host port. Restrict port 3000 to the trusted LAN at the VM or Proxmox firewall before public routing. Runtime secrets belong in `secrets/`, which is ignored by Git.

```bash
docker compose config --quiet
docker compose build
docker compose --profile tools run --rm migrate
docker compose up -d db app
docker compose ps
curl --fail http://127.0.0.1:3000/ready
```

Rollback deploys the previous Git commit and rebuilds `app`; PostgreSQL data is preserved. Never use `down -v`. Before a migration, create a PostgreSQL dump and a Proxmox backup on `Array-Backup`.
