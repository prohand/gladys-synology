# Synology DSM-Integration

Diese Integration überwacht ein Synology-NAS aus Gladys Assistant heraus. Sie arbeitet ausschließlich lesend und verwendet die auf dem NAS verfügbare DSM-WebAPI.

## Bevor Sie beginnen

1. Erstellen Sie unter **Systemsteuerung → Benutzer und Gruppe → Benutzer** einen eigenen Benutzer für Gladys.
2. Fügen Sie diesen Benutzer im Schritt der Gruppenzuweisung der Gruppe **administrators** hinzu. Das ist zwingend erforderlich: Die für Systemauslastung und Speicher verwendeten DSM-WebAPIs lehnen einen gewöhnlichen Benutzer mit dem Fehler `105` (unzureichende Berechtigungen) ab. Die delegierte Rolle **Systemüberwachung** ist für diese APIs kein zuverlässiger Ersatz.
3. Setzen Sie für jeden freigegebenen Ordner **Kein Zugriff**.
4. Setzen Sie für jede Anwendung **Verweigern**. Die Überwachungs-WebAPIs bleiben über die Administratorgruppe verfügbar, auch wenn das Konto DSM nicht interaktiv nutzen und keine Dateien durchsuchen kann.
5. Gewähren Sie weder ein Kontingent noch Berechtigungen für File Station, Surveillance Station, SSH oder einen anderen Dienst.
6. Notieren Sie unter **Systemsteuerung → Anmeldeportal** den HTTPS-Port von DSM (meist `5001`).
7. Stellen Sie sicher, dass der Rechner, auf dem Gladys läuft, diese Adresse erreichen kann. Machen Sie DSM nicht nur für diese Integration aus dem Internet erreichbar.

MFA wird über DSM-Bestätigungscodes (OTP) unterstützt. **Anmeldung genehmigen** und Hardware-Sicherheitsschlüssel funktionieren nur bei einer interaktiven Web-Anmeldung. Richten Sie daher für dieses Konto **Bestätigungscode (OTP)** ein. Bei der ersten Anmeldung tauscht die Integration den aktuellen OTP gegen eine DSM-Kennung für ein vertrauenswürdiges Gerät und speichert sie in ihrem privaten Volume `/data`. Nach der ersten erfolgreichen Verbindung können Sie das OTP-Feld leeren. Wird das vertrauenswürdige Gerät später in DSM widerrufen, geben Sie einen neuen OTP ein und speichern Sie die Konfiguration, um es erneut zu registrieren.

## Konfiguration

- **DSM-URL**: vollständige lokale URL, zum Beispiel `https://192.168.1.20:5001`.
- **Benutzername / Passwort**: Zugangsdaten des eigenen DSM-Benutzers.
- **Aktueller OTP-Code (MFA)**: ein aktueller 6-stelliger Code für die erste MFA-Anmeldung oder nachdem das vertrauenswürdige DSM-Gerät widerrufen wurde. Er wird nicht mehr gesendet, sobald das gespeicherte Gerät akzeptiert ist.
- **TLS-Zertifikat überprüfen**: bei einem vertrauenswürdigen Zertifikat aktiviert lassen. Bei einem selbstsignierten Zertifikat sollten Sie lieber seinen Fingerabdruck pinnen (nächstes Feld), statt diese Prüfung zu deaktivieren: Ist sie deaktiviert, kann jedes Gerät in Ihrem Netzwerk, das den Datenverkehr zwischen Gladys und dem NAS abfangen kann, sich als NAS ausgeben und das DSM-Passwort empfangen (Man-in-the-Middle).
- **Fingerabdruck des gepinnten Zertifikats (SHA-256)**: optional. Wenn ausgefüllt, wird das NAS unabhängig von der Einstellung oben nur akzeptiert, wenn sein Zertifikat genau diesen Fingerabdruck hat; andernfalls wird die Verbindung getrennt, bevor irgendetwas – auch das Passwort – gesendet wird. Lesen Sie ihn in Ihrem Browser ab (Schloss → Zertifikat → SHA-256-Fingerabdruck) oder mit `openssl s_client -connect NAS_ADDRESS:5001 </dev/null | openssl x509 -noout -fingerprint -sha256`; Doppelpunkte, Leerzeichen und Groß-/Kleinschreibung spielen keine Rolle. Aktualisieren Sie ihn bei jeder Erneuerung des Zertifikats durch DSM, und pinnen Sie kein automatisch erneuertes Zertifikat (Let's Encrypt): Lassen Sie in diesem Fall stattdessen die Prüfung aktiviert.
- **NAS 2, NAS 3 und NAS 4**: optionale Verbindungen mit denselben Feldern für URL, Benutzername, Passwort, OTP, TLS und Fingerabdruck wie das primäre NAS. Lassen Sie die URL eines NAS leer, um diesen Platz zu ignorieren. Jedes Passwort und jeder OTP wird in einem eigenen geheimen Gladys-Feld gespeichert und erscheint nie in einem JSON-Dokument.
- **Aktualisierungsintervall**: manuell in Sekunden eingegeben, von 60 bis 86400. Der empfohlene Standardwert beträgt 900 Sekunden (15 Minuten). Ein moderates Intervall verhindert unnötiges Wachstum der Gladys-Datenbank.
- **Datumsformat**: wie Backup-Daten in Gladys angezeigt werden. `ISO 8601` (Standard, UTC) behält den rohen DSM-Zeitstempel; `JJJJ-MM-TT HH:mm`, `TT/MM/JJJJ HH:mm` und `MM/TT/JJJJ hh:mm AM/PM` zeigen die Ortszeit des Containers der Integration. Setzen Sie die Umgebungsvariable `TZ` des Containers der Integration auf Ihre Zeitzone, wenn diese Formate eine unerwartete Uhrzeit anzeigen. Eine Änderung des Formats gilt ab der nächsten Aktualisierung; bereits gespeicherte Daten behalten das Format, mit dem sie veröffentlicht wurden.

Klicken Sie auf **DSM-Verbindung testen**. Bei Erfolg zeigt das Ergebnis das NAS-Modell, die DSM-Version und die Anzahl der erkannten Volumes. Starten Sie anschließend im Reiter **Entdecken** der Integration die Gerätesuche mit **Scannen**.

## Geräte

Die Integration erstellt ein Gerät pro NAS, ein Gerät für jedes Speicher-Volume, ein Gerät für jede interne Festplatte und, sofern verfügbar, ein Gerät für jede Hyper Backup- oder Active Backup-Aufgabe. Jede Festplatte stellt den genauen von DSM gemeldeten SMART-Status, einen binären SMART-Zustandsindikator und, sofern DSM sie meldet, ihre Temperatur bereit. Eine Backup-Aufgabe stellt ihren Status, ihr letztes Ergebnis und den Zeitpunkt des letzten Backups bereit. Diese DSM-Paket-APIs sind nicht auf jedem Modell und jeder Version verfügbar; ihr Fehlen verhindert die System- und Speicherüberwachung nicht.

Ein erster Messwertsatz wird sofort nach dem Hinzufügen eines Geräts gesendet, danach aktualisiert jede Aktualisierung alle Werte des NAS. Die Belegung der Volumes in Prozent wird auf zwei Nachkommastellen gerundet. Ein Verlauf wird für Auslastung, Temperatur und Zustandswerte gespeichert; Kapazitäten und Textinformationen erzeugen keinen redundanten Verlauf.

Die Zustandsindikatoren erhalten nur dann einen Wert, wenn DSM einen Status eindeutig als fehlerfrei oder als Fehler meldet. Während eines Wartungsvorgangs (Erweiterung, Datenbereinigung, Reparatur) oder wenn SMART nicht unterstützt wird, bleibt der vorherige Wert erhalten, statt einen Fehlalarm zu veröffentlichen.

## Dashboard-Widgets

Erfordert Gladys 5.1 oder neuer. Fügen Sie sie im Bearbeitungsmodus des Dashboards (**Bearbeiten**) hinzu; jedes Widget hat eine Einstellung **NAS**, die ein beliebiges Gerät des anzuzeigenden NAS akzeptiert (das NAS selbst, ein Volume, eine Festplatte oder eine Backup-Aufgabe). Lassen Sie sie leer, um das erste NAS anzuzeigen.

- **Synology-NAS**: Modell, DSM-Version, CPU, Arbeitsspeicher und Temperatur, eine Zeile pro Volume (Belegung und Zustand), eine Zusammenfassung der Festplatten und Backups sowie eine Schaltfläche zum Öffnen von DSM, wenn dessen URL HTTPS verwendet. Sobald das NAS-Gerät zu Gladys hinzugefügt wurde, zeigt die Karte außerdem den Verlauf von CPU und Arbeitsspeicher über den in der Einstellung **Lastverlauf** gewählten Zeitraum.
- **Synology-Speicher**: eine Anzeige pro Volume, der gesamte freie Speicher und eine Zeile pro Festplatte mit ihrem SMART-Status und ihrer Temperatur.
- **Synology-Backups**: die Hyper Backup- und Active Backup-Aufgaben mit ihrem letzten Ergebnis, Fehler zuerst. Bei leerer Einstellung **NAS** listet es die Aufgaben aller NAS auf. Mit der Einstellung **Angezeigte Aufgaben** lassen sich nur die fehlgeschlagenen oder teilweise erfolgreichen behalten.

Widgets zeigen die bei der letzten Aktualisierung gelesenen Werte: Das Öffnen eines Dashboards fragt das NAS nie ab. Sie werden nach jeder Aktualisierung aktualisiert. Ein NAS, das nicht mehr antwortet, wird als **Nicht erreichbar** markiert und behält seine letzten bekannten Werte. Auf einem Dashboard mit US-Einheiten werden Temperaturen in °F angezeigt.

## Szenen

Erfordert Gladys 5.1 oder neuer.

**Auslöser** werden einmal ausgelöst, bei einer Änderung zwischen zwei Aktualisierungen. Die erste Messung nach dem Start der Integration dient nur als Referenz: Ein Fehler, der beim Start bereits vorliegt, löst nicht erneut aus, und eine Änderung, die eintritt, während die Integration gestoppt ist, wird nicht gemeldet. Jeder Auslöser kann auf ein Gerät beschränkt werden; lassen Sie das Feld leer, um auf alle zu reagieren.

| Auslöser                               | Wird ausgelöst, wenn                                                                                                                                    | Variablen                                                  |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Ein Synology-NAS antwortet nicht mehr  | Ein NAS, das bisher geantwortet hat, bei einer Aktualisierung scheitert                                                                                 | NAS-Modell, DSM-URL, Fehler                                |
| Ein Synology-NAS antwortet wieder      | Dieses NAS wieder antwortet                                                                                                                             | NAS-Modell, DSM-URL, nicht erreichbar während (min)        |
| Ein Synology-Volume ist beeinträchtigt | DSM ein fehlerfreies Volume als beeinträchtigt, abgestürzt oder fehlerhaft meldet                                                                       | NAS-Modell, Volume-Name, DSM-Status, Belegung (%)          |
| Eine Synology-Festplatte fällt aus     | Der SMART-Status einer fehlerfreien Festplatte auf einen Fehler wechselt                                                                                | NAS-Modell, Festplattenname, SMART-Status, Temperatur (°C) |
| Ein Synology-Backup ist abgeschlossen  | Ein neues Ergebnis aus einer Hyper Backup- oder Active Backup-Aufgabe gelesen wird (Filter nach Paket und nach Ergebnis: Erfolg, teilweise, Fehlschlag) | NAS-Modell, Aufgabenname, Paket, Ergebnis, Backup-Datum    |
| DSM wurde aktualisiert                 | Ein NAS eine neue DSM-Version meldet                                                                                                                    | NAS-Modell, vorherige Version, neue Version                |

Ein Wartungszustand (Erweiterung, Datenbereinigung, Reparatur) zählt nie als Fehler, und ein noch laufendes Backup wird erst gemeldet, wenn es abgeschlossen ist.

**Aktionen** fragen das NAS ab, wenn die Szene sie erreicht, und geben Werte zurück, die die folgenden Aktionen verwenden können:

- **Status eines Synology-NAS abrufen**: erreichbar (ja/nein), Modell, DSM-Version, CPU, Arbeitsspeicher, Temperatur, Anzahl beeinträchtigter Volumes, ausfallender Festplatten und fehlgeschlagener Backups sowie die Liste der gefundenen Probleme. Ein nicht erreichbares NAS hält die Szene nicht an: Prüfen Sie den Wert **Erreichbar**.
- **Status eines Synology-Volumes abrufen**: Name, DSM-Status, fehlerfrei (ja/nein), Belegung (%), belegter, freier und gesamter Speicher (GB).
- **Status eines Synology-Backups abrufen**: Aufgabenname, Paket, Status, Ergebnis, Datum des letzten Backups (im konfigurierten Datumsformat) und Stunden seit dem letzten Backup – praktisch, um vor einem Backup zu warnen, das nicht mehr läuft.

## Fehlerbehebung

- **Ungültige Zugangsdaten**: Überprüfen Sie das eigene Konto und seine Anmelderichtlinie.
- **MFA-Code erforderlich / Fehler 403 oder 406**: Richten Sie OTP für das DSM-Konto ein, geben Sie in Gladys einen aktuellen 6-stelligen Code ein und speichern Sie. Genehmigungsbenachrichtigungen und Hardware-Schlüssel werden von der DSM-API nicht unterstützt.
- **Ungültiger oder abgelaufener MFA-Code / Fehler 404**: Warten Sie auf den nächsten OTP und speichern Sie ihn, bevor er abläuft.
- **Unzureichende Berechtigungen / Fehler 105**: Fügen Sie das eigene Konto der DSM-Gruppe `administrators` hinzu. Eine delegierte Rolle Systemüberwachung allein reicht für diese APIs nicht aus.
- **Verbindung nach einem Neustart des NAS oder einem DSM-Update verloren / Fehler 498**: Nichts zu tun. DSM kann die gespeicherte Anmeldung während des Neustarts ablehnen; die Integration meldet sich selbst erneut an und versucht die Verbindung alle 30 Sekunden, dann seltener bis zu alle 15 Minuten, bis das NAS antwortet.
- **DSM nicht erreichbar**: Testen Sie die URL vom Gladys-Host aus und überprüfen Sie die Firewall des NAS.
- **DSM hat nicht rechtzeitig geantwortet**: Das NAS hat die Verbindung angenommen, aber nicht innerhalb von 20 Sekunden geantwortet. Die Aktualisierung wird abgebrochen und im nächsten Zyklus wiederholt; prüfen Sie die Last des NAS und das Netzwerk.
- **Ein einzelnes NAS ist in einer Konfiguration mit mehreren NAS nicht erreichbar**: Die anderen NAS veröffentlichen ihre Werte weiter, und der Reiter **Konfiguration** der Integration in Gladys nennt die fehlerhafte Adresse. Nur wenn alle NAS ausfallen, wird die Integration als getrennt gemeldet.
- **Zertifikatsfehler** (`certificate rejected`): Installieren Sie in DSM ein vertrauenswürdiges Zertifikat. Bei einer privaten Installation mit selbstsigniertem Zertifikat pinnen Sie den Fingerabdruck des Zertifikats; das Deaktivieren der Prüfung funktioniert ebenfalls, setzt das Passwort aber einem Man-in-the-Middle in Ihrem Netzwerk aus.
- **`certificate does not match the pinned SHA-256 fingerprint`**: DSM hat ein anderes Zertifikat vorgelegt. Wenn Sie es selbst erneuert oder ersetzt haben, fügen Sie den neuen Fingerabdruck ein; andernfalls gibt sich etwas als Ihr NAS aus – es wurde nichts dorthin gesendet.
- **Ein Volume fehlt**: Scannen Sie nach dem Erstellen oder Entfernen eines Volumes erneut.
- **Backup-Aufgaben fehlen**: Prüfen Sie, ob Hyper Backup oder Active Backup installiert ist, mindestens eine Aufgabe existiert und das eigene DSM-Konto das entsprechende Paket öffnen kann, und scannen Sie dann erneut.
- **Ein Backup-Datum hat keinen Wert**: Aktualisieren Sie die Integration, speichern Sie die Verbindung erneut und warten Sie auf die nächste Aktualisierung. Die Details von Active Backup werden Aufgabe für Aufgabe abgefragt, da seine allgemeine Aufgabenliste nicht immer die Versionsdaten enthält.
