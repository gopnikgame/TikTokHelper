# Production restore rehearsal

Status date: 2026-09-17

The production PostgreSQL dump and media volume were restored into disposable Docker resources on the TikTokHelper VM. The running application, database, network, and named volumes were not attached to the rehearsal.

## Isolation and safety

- The rehearsal used a dedicated internal Docker network with no published ports.
- PostgreSQL and media used newly created, uniquely named volumes.
- The application used the exact image digest already running in production; no image was pulled or rebuilt.
- Authentication integration was not enabled in the disposable application. Readiness was checked only from inside its container.
- A cleanup trap removed the disposable application, database, network, and volumes. A final inventory confirmed that none remained.
- The production application and database remained `running/healthy` after cleanup.

Do not use `docker compose down -v` for this procedure. Never attach a restore test to `tiktok-helper_postgres_data` or `tiktok-helper_media_data` with write access.

## Backup artifacts

A root-only evidence directory is retained in the VM's private backup storage. Its exact name is deliberately kept out of the public repository. It contains a custom-format PostgreSQL dump, a compressed media archive, SHA-256 checksums, aggregate production/restored row counts, media verification, and the final result. Database contents and uploaded media remain on the VM and are not copied into Git.

The dump catalogue was readable before restore, and both artifacts passed their recorded SHA-256 checks after the rehearsal.

## Verified result

Aggregate counts matched between production and the restored database for workspaces, users, memberships, the shared sound library, personal gift mappings, speech policies, support levels, event reactions, supporters, and stream totals. The exact production counts remain in the private evidence directory rather than the public repository.

The restored media file count and aggregate content digest matched production. Both contained zero uploaded files. The restored application completed sound metadata synchronization, started successfully, and returned a successful readiness response against the restored database.

## Remaining limitation

This run proves the archive/restore path for the current empty media volume, but it does not yet prove restoration of a non-empty user-upload set. After the first real user upload exists, repeat the media portion and verify a non-zero file count, aggregate digest, and an authenticated browser preview. This limitation does not affect the verified PostgreSQL restore.
