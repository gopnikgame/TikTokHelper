# Third-party notices

TikTokHelper depends on third-party software. Each dependency remains subject
to its own copyright notices and license terms. This file highlights the
runtime dependency whose license directly affects operation of the hosted
service; it is not a complete replacement for the notices distributed with
all installed packages.

## tiktok-live-connector

- Package: `tiktok-live-connector`
- Version locked by this repository: `2.4.4`
- Copyright holder/author identified by the package: `zerodytrash`
- Declared license: `AGPL-3.0-only` with additional permissions and
  exceptions in sections 18–21 of the package license
- Source: <https://github.com/zerodytrash/TikTok-Live-Connector/tree/v2.4.4>
- Exact license for this version:
  <https://github.com/zerodytrash/TikTok-Live-Connector/blob/v2.4.4/LICENSE>

The additional terms belong to `tiktok-live-connector`; they are not added to
the TikTokHelper project license. The installed package includes its complete
license text in its own package directory.

In particular, section 19 excludes hosted SaaS/network services from the
section 18 integration exception when the complete server-side source is not
made available under AGPL-3.0. TikTokHelper therefore keeps its server-side
source public under AGPL-3.0-only. See
[ADR-0001](docs/decisions/0001-tiktok-connector-license.md) for the project
decision and operational requirements.
