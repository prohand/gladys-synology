# Changelog

All notable changes to this integration are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[semantic versioning](https://semver.org/), bumped by the Release workflow.

## [Unreleased]

## [2.3.0] - 2026-10-08

### Fixed

- A NAS with a self-signed certificate and the certificate check disabled was unreachable since
  2.2.0 (`fetch failed`, `UND_ERR_INVALID_ARG invalid onRequestStart method`): the DSM client now
  takes `fetch` and its connection agent from the same undici package.
- A reconnection and a configuration save arriving together no longer run two initializations at
  once: the first connection is no longer closed while in use, and no refresh timer is left behind.
- Adding several devices from the Discovery screen no longer reads the whole NAS once per device:
  a snapshot younger than 30 seconds is replayed.
- A certificate error now says so (`certificate rejected`) instead of a bare "Unable to reach
  Synology DSM".

### Changed

- The status of the backup tasks is read at most 4 tasks at a time.
- Docker image: `dumb-init` runs as PID 1 so the shutdown signal reaches the integration, the npm
  cache is cleaned, and the unneeded `chown` layer is gone.
- An unhandled promise rejection is logged instead of stopping the container.

### Security

- New optional **pinned certificate fingerprint (SHA-256)** per NAS: a self-signed certificate is
  accepted only if it matches, and the connection is dropped before the password is sent
  otherwise. The documentation now explains the man-in-the-middle risk of disabling the
  certificate check.

## [2.2.0] - 2026-10-07

### Fixed

- A NAS with many disks, volumes and backup tasks published nothing at all: its states are now
  sent in batches of 100, the most the Gladys API accepts per request.

### Changed

- undici updated to 8.11 and Node.js 22.19 or later required (Node 20 is end-of-life; the Docker
  image runs Node 24).

## [2.1.0] - 2026-10-06

### Added

- `SECURITY.md`: how to report a vulnerability.
- `CHANGELOG.md`, rebuilt from the release history.

### Changed

- Development dependencies updated to their latest versions (ESLint 10.12, Prettier 3.9.9, globals 17.13).
- undici updated to 7.30 (8.x needs Node 22, the package still supports Node 20).

## [2.0.1] - 2026-09-23

### Fixed

- Round the storage gauge value to a whole percent

## [2.0.0] - 2026-09-23

### Added

- Dashboard widgets, scene triggers and scene actions (Gladys 5.1)

## [1.0.4] - 2026-08-20

### Added

- Let the user choose the backup date format

## [1.0.3] - 2026-08-19

### Changed

- Add CLAUDE.md with commands and architecture overview

### Fixed

- Harden the DSM connection and report partial failures

## [1.0.2] - 2026-08-19

### Fixed

- Reconnect to DSM on its own after a NAS reboot

## [1.0.1] - 2026-08-16

First public release.

### Added

- Add Synology DSM monitoring integration
- Add Synology OTP authentication
- Monitor multiple NAS and backup tasks
- Secure multi-NAS setup and monitor disk SMART

### Changed

- Clarify required DSM permissions

### Fixed

- Publish valid Gladys poll frequencies
- Satisfy Gladys device state contracts
- Publish Synology metrics reliably
- Migrate fast polling to safe default

[Unreleased]: https://github.com/prohand/gladys-synology/compare/v2.3.0...HEAD
[2.3.0]: https://github.com/prohand/gladys-synology/compare/v2.2.0...v2.3.0
[2.2.0]: https://github.com/prohand/gladys-synology/compare/v2.1.0...v2.2.0
[2.1.0]: https://github.com/prohand/gladys-synology/compare/v2.0.1...v2.1.0
[2.0.1]: https://github.com/prohand/gladys-synology/compare/v2.0.0...v2.0.1
[2.0.0]: https://github.com/prohand/gladys-synology/compare/v1.0.4...v2.0.0
[1.0.4]: https://github.com/prohand/gladys-synology/compare/v1.0.3...v1.0.4
[1.0.3]: https://github.com/prohand/gladys-synology/compare/v1.0.2...v1.0.3
[1.0.2]: https://github.com/prohand/gladys-synology/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/prohand/gladys-synology/releases/tag/v1.0.1
