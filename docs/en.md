# Synology DSM integration

This integration monitors a Synology NAS from Gladys Assistant. It is read-only and uses the DSM WebAPI available on the NAS.

## Before you start

1. In DSM, create a dedicated user for Gladys.
2. Grant that user only the minimum read permissions needed for system and storage information.
3. In **Control Panel → Login Portal**, note the DSM HTTPS port (usually `5001`).
4. Make sure the machine running Gladys can reach that address. Do not expose DSM to the public internet just for this integration.

Two-factor authentication cannot be completed interactively by a background integration. Use a dedicated restricted account whose policy permits API login, and protect it with the DSM firewall and a strong unique password.

## Configuration

- **DSM URL**: full local URL, for example `https://192.168.1.20:5001`.
- **Username / password**: credentials of the dedicated DSM user.
- **Verify the TLS certificate**: keep enabled for a trusted certificate. Disable only for a self-signed local certificate after verifying the NAS address yourself.
- **Refresh interval**: between 30 and 3600 seconds.

Click **Test the DSM connection**. A successful result shows the NAS model, DSM version and number of detected volumes. Then scan for devices in Gladys.

## Devices

The integration creates one device for the NAS and one device for every storage volume. The NAS triggers the periodic refresh; every refresh updates both the system and volume values in one batch.

## Troubleshooting

- **Invalid credentials**: verify the dedicated account and its login policy.
- **Insufficient privileges**: grant read access to DSM system and storage information.
- **Unable to reach DSM**: test the URL from the Gladys host and verify the NAS firewall.
- **Certificate error**: install a trusted certificate in DSM. For a private, self-signed installation only, certificate verification can be disabled.
- **A volume is missing**: rescan after creating or removing a volume.
