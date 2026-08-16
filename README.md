# Gladys Synology

External [Gladys Assistant](https://gladysassistant.com/) integration for monitoring a Synology NAS through the DSM WebAPI.

## Monitored values

- NAS CPU and memory usage
- System temperature and uptime
- Aggregate network receive/transmit rates
- DSM version
- Per-volume usage, used/free/total capacity and health

Volumes are discovered dynamically. Metrics are read-only: this integration does not modify the NAS.

## Setup

1. Create a dedicated DSM user and add it to the `administrators` group. DSM requires this group for the system-utilization and storage WebAPIs used here.
2. Deny that account access to every shared folder and application. Administrator group membership is still enough for the monitoring APIs.
3. Ensure the Gladys host can reach DSM, preferably through HTTPS on the local network.
4. Install the integration, enter the DSM URL, username and password, then use **Test the DSM connection** and scan for devices.

See [docs/en.md](docs/en.md) or [docs/fr.md](docs/fr.md) for the complete guide.

## Development

Requires Node.js 20 or later.

```sh
npm ci
npm run format:check
npm run lint
npm test
```

The repository keeps the structure and release workflows of the official JavaScript external-integration template. A version tag builds `linux/amd64` and `linux/arm64` images on GitHub Actions.

## Security

The password is submitted to DSM in a POST body and is never logged by the integration. Keep TLS certificate verification enabled whenever possible. The dedicated account must belong to `administrators` because of a DSM API limitation, but it should be denied access to every shared folder and application. Restrict DSM access to the Gladys host with the NAS firewall.

## License

Apache-2.0
