# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```sh
npm ci                 # install (Node.js >= 20; CI and Docker use Node 24)
npm test               # node --test, runs every test/*.test.js
npm run lint           # eslint .
npm run format:check   # prettier --check . (CI fails on unformatted files)
npm run format         # prettier --write .
npm start              # node index.js — needs a live Gladys instance, rarely useful locally
```

Run a single test file or a single case:

```sh
node --test test/metrics.test.js
node --test --test-name-pattern 'coalesces concurrent DSM refreshes'
```

CI (`.github/workflows/ci.yml`) runs `format:check`, `lint`, then `test`. Releases are manual:
the **Release** workflow bumps `package.json`, rewrites `version` + `docker_image` in
`gladys-assistant-integration.json`, tags `vX.Y.Z`, and `build.yml` publishes
`ghcr.io/prohand/gladys-synology` for linux/amd64 + linux/arm64. Never bump the version or the
manifest image by hand — `test/manifest.test.js` asserts they stay in sync.

## Architecture

An external Gladys Assistant integration: a standalone Node process (ESM, no build step) that
talks to Gladys over the `@gladysassistant/integration-sdk` websocket and to one to four Synology
NAS over the DSM WebAPI. It is strictly read-only towards DSM.

Data flows in one direction through four layers:

1. **`index.js`** — SDK wiring only. Registers `onScanRequest`, `onPoll`, `onDeviceCreated`,
   `onAction('test_connection')`, `onConfigUpdated`, `connected` and `handleShutdown`; owns the
   `setInterval` refresh loop, the `createBackoff()` reconnection retry, and the `ready()` gate.
   `initialization` is deliberately kept as an _always-resolving_ promise (`.catch(() => {})`) so a
   failed startup never poisons later handlers.
2. **`src/fleet-service.js`** — fans every operation across the configured NAS with
   `Promise.allSettled`; partial failures are collected in `lastErrors` and only rethrown when
   _every_ NAS failed.
3. **`src/service.js`** (one per NAS) — coalesces concurrent refreshes into a single
   `inFlightRefresh`, throttles `publishStates` to `poll_frequency` unless `{ force: true }`, and
   derives `nasId` from the DSM serial (falling back to the URL hostname).
4. **`src/synology/client.js`** — DSM protocol: `SYNO.API.Info` discovery, version clamping between
   each API's `minVersion`/`maxVersion`, POST-only requests (credentials never in a URL), session
   re-login on codes 106/107/119/498, and `optionalCall()` which downgrades a missing or forbidden
   backup API to `null` instead of breaking system monitoring.

`src/synology/metrics.js` turns raw DSM payloads into a stable snapshot shape
(`{ nas, volumes, disks, backups }`), absorbing the field-name variation across DSM versions —
this is where the defensive `??` chains belong, not in the device builders. `src/devices/*.js`
then map that snapshot to Gladys devices and states; each module owns one device type and exports
both a `build*Device` and a `build*States` function keyed by the same feature constants.

### Conventions that matter

- **External IDs are a contract.** `gladys.externalIds(type, platformId)` builds them from
  `synology-nas|synology-volume|synology-disk|synology-backup` plus a platform ID
  (`nasId`, `nasId:volumeId`, `nasId:diskId`, `nasId:provider:taskId`). Changing a device type
  string, a platform-ID shape or a feature key orphans every existing device in users' databases.
- **Undefined means "do not publish".** Normalizers return `undefined` for missing values and the
  state builders filter them out; never substitute `0` or `''`.
- **`keep_history: false`** on capacities, DSM version and backup text features keeps the Gladys
  database small — keep it that way for slow-moving values.
- **Secrets.** Password and OTP go in the POST body only, are never logged, and each NAS slot has
  its own `secret`-typed manifest field. The DSM trusted-device token lives in `/data`
  (`src/synology/mfa-device-store.js`, mode 0600, overridable via `SYNOLOGY_MFA_DEVICE_PATH`).
- **User-facing strings are bilingual**: every message returned to Gladys is `{ en, fr }`, and
  `docs/en.md` + `docs/fr.md` must be updated together.

### Manifest and config

`gladys-assistant-integration.json` is the store manifest (config schema, actions, cover image).
`src/config.js` mirrors it: `DEFAULT_CONFIG`, poll-frequency clamping to
`[MIN_POLL_FREQUENCY, MAX_POLL_FREQUENCY]`, URL normalization (adds `https://`, strips trailing
slashes) and `getNasConfigs()` which expands the flat `nas_2_*`/`nas_3_*`/`nas_4_*` fields into
per-NAS connection objects. Adding a config field means touching both, and
`test/manifest.test.js` enforces the defaults, the `secret` types and the cover-image constraints.

### Testing

`node:test` + `node:assert/strict`, no framework. Everything is tested through injection rather
than network mocks: `new SynologyClient(config, { fetchImpl })` for DSM payloads,
`new SynologyService(config, { clientFactory, now })` for timing, and
`test/helpers/fakeGladys.js` for the SDK surface (`externalIds`, `publishStates`). New DSM
payload shapes belong in `test/metrics.test.js`; new device features in `test/devices.test.js`.
