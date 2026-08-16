# Synology DSM integration

This integration monitors a Synology NAS from Gladys Assistant. It is read-only and uses the DSM WebAPI available on the NAS.

## Before you start

1. In **Control Panel → User & Group → User**, create a dedicated user for Gladys.
2. On the group assignment page, add this user to the **administrators** group. This is mandatory: the DSM WebAPIs used for system utilization and storage reject an ordinary user with error `105` (insufficient privilege). The delegated **System monitoring** role is not a reliable substitute for these APIs.
3. Set **No access** for every shared folder.
4. Set **Deny** for every application. The monitoring WebAPIs remain available through the administrator group even though the account cannot use DSM or browse files interactively.
5. Do not grant a quota, File Station, Surveillance Station, SSH or any other service permission.
6. In **Control Panel → Login Portal**, note the DSM HTTPS port (usually `5001`).
7. Make sure the machine running Gladys can reach that address. Do not expose DSM to the public internet just for this integration.

MFA is supported through DSM verification codes (OTP). **Approve sign-in** and hardware security keys only work with interactive web login, so configure **Verification code (OTP)** for this account. On the first login, the integration exchanges the current OTP for a DSM trusted-device identifier and stores it in its private `/data` volume. You can clear the OTP field after the first successful connection. If the trusted device is later revoked in DSM, enter a fresh OTP and save the configuration to enroll it again.

## Configuration

- **DSM URL**: full local URL, for example `https://192.168.1.20:5001`.
- **Username / password**: credentials of the dedicated DSM user.
- **Current OTP code (MFA)**: a current 6-digit code for the first MFA login or after the DSM trusted device is revoked. It is not sent once the remembered device is accepted.
- **Verify the TLS certificate**: keep enabled for a trusted certificate. Disable only for a self-signed local certificate after verifying the NAS address yourself.
- **Refresh interval**: 30 or 60 seconds.

Click **Test the DSM connection**. A successful result shows the NAS model, DSM version and number of detected volumes. Then scan for devices in Gladys.

## Devices

The integration creates one device for the NAS and one device for every storage volume. The NAS triggers the periodic refresh; every refresh updates both the system and volume values in one batch.

## Troubleshooting

- **Invalid credentials**: verify the dedicated account and its login policy.
- **MFA code required / error 403 or 406**: configure OTP for the DSM account, enter a current 6-digit code in Gladys and save. Approval notifications and hardware keys are not supported by the DSM API.
- **Invalid or expired MFA code / error 404**: wait for the next OTP and save it before it expires.
- **Insufficient privileges / error 105**: add the dedicated account to the DSM `administrators` group. A delegated System monitoring role alone is not sufficient for these APIs.
- **Unable to reach DSM**: test the URL from the Gladys host and verify the NAS firewall.
- **Certificate error**: install a trusted certificate in DSM. For a private, self-signed installation only, certificate verification can be disabled.
- **A volume is missing**: rescan after creating or removing a volume.
