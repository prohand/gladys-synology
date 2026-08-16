# Intégration Synology DSM

Cette intégration supervise un NAS Synology depuis Gladys Assistant. Elle fonctionne en lecture seule et utilise la WebAPI DSM disponible sur le NAS.

## Avant de commencer

1. Dans **Panneau de configuration → Utilisateur et groupe → Utilisateur**, créez un utilisateur dédié à Gladys.
2. À l'étape d'affectation aux groupes, ajoutez-le au groupe **administrators**. Ce droit est obligatoire : les WebAPI DSM utilisées pour la charge système et le stockage refusent un utilisateur ordinaire avec l'erreur `105` (droits insuffisants). Le rôle délégué **Surveillance du système** ne remplace pas ce droit de manière fiable pour ces API.
3. Attribuez **Pas d'accès** à tous les dossiers partagés.
4. Attribuez **Refuser** à toutes les applications. Les API de supervision restent accessibles grâce au groupe administrators, même si le compte ne peut pas utiliser DSM ni parcourir les fichiers.
5. N'accordez aucun quota ni accès à File Station, Surveillance Station, SSH ou à un autre service.
6. Dans **Panneau de configuration → Portail de connexion**, relevez le port HTTPS de DSM (généralement `5001`).
7. Vérifiez que la machine qui exécute Gladys peut joindre cette adresse. N'exposez pas DSM à Internet uniquement pour cette intégration.

Cette intégration ne transmet pas encore les mots de passe à usage unique de DSM. N'imposez donc pas la double authentification à ce compte dédié. Compensez avec un mot de passe long et unique, ainsi qu'une règle du pare-feu DSM qui n'autorise le port HTTPS que depuis l'adresse IP de l'hôte Gladys.

## Configuration

- **URL DSM** : URL locale complète, par exemple `https://192.168.1.20:5001`.
- **Nom d'utilisateur / mot de passe** : identifiants du compte DSM dédié.
- **Vérifier le certificat TLS** : laissez cette option activée avec un certificat de confiance. Ne la désactivez que pour un certificat local auto-signé, après avoir vérifié vous-même l'adresse du NAS.
- **Intervalle de rafraîchissement** : entre 30 et 3 600 secondes.

Cliquez sur **Tester la connexion DSM**. En cas de succès, le résultat indique le modèle du NAS, la version DSM et le nombre de volumes détectés. Lancez ensuite une recherche d'appareils dans Gladys.

## Appareils

L'intégration crée un appareil pour le NAS et un appareil par volume de stockage. Le NAS déclenche le rafraîchissement périodique ; chaque cycle met à jour en une seule fois les valeurs du système et des volumes.

## Dépannage

- **Identifiants incorrects** : vérifiez le compte dédié et sa politique de connexion.
- **Droits insuffisants / erreur 105** : ajoutez le compte dédié au groupe DSM `administrators`. Le seul rôle délégué Surveillance du système ne suffit pas pour ces API.
- **DSM injoignable** : testez l'URL depuis l'hôte Gladys et vérifiez le pare-feu du NAS.
- **Erreur de certificat** : installez un certificat de confiance dans DSM. Pour une installation privée auto-signée uniquement, la vérification peut être désactivée.
- **Volume absent** : relancez une recherche après la création ou la suppression d'un volume.
