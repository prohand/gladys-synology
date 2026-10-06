# Changelog

All notable changes to this integration are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[semantic versioning](https://semver.org/), bumped by the Release workflow.

## [Unreleased]

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

[Unreleased]: https://github.com/prohand/gladys-synology/compare/v2.0.1...HEAD
[2.0.1]: https://github.com/prohand/gladys-synology/compare/v2.0.0...v2.0.1
[2.0.0]: https://github.com/prohand/gladys-synology/compare/v1.0.4...v2.0.0
[1.0.4]: https://github.com/prohand/gladys-synology/compare/v1.0.3...v1.0.4
[1.0.3]: https://github.com/prohand/gladys-synology/compare/v1.0.2...v1.0.3
[1.0.2]: https://github.com/prohand/gladys-synology/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/prohand/gladys-synology/releases/tag/v1.0.1
