# Intégration Synology DSM

Cette intégration supervise un NAS Synology depuis Gladys Assistant. Elle fonctionne en lecture seule et utilise la WebAPI DSM disponible sur le NAS.

## Avant de commencer

1. Dans DSM, créez un utilisateur dédié à Gladys.
2. Accordez-lui uniquement les droits de lecture nécessaires aux informations système et de stockage.
3. Dans **Panneau de configuration → Portail de connexion**, relevez le port HTTPS de DSM (généralement `5001`).
4. Vérifiez que la machine qui exécute Gladys peut joindre cette adresse. N'exposez pas DSM à Internet uniquement pour cette intégration.

Une intégration en arrière-plan ne peut pas saisir interactivement un code de double authentification. Utilisez un compte dédié et restreint dont la politique autorise la connexion API, puis protégez-le avec le pare-feu DSM et un mot de passe unique et robuste.

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
- **Droits insuffisants** : accordez l'accès en lecture aux informations système et de stockage DSM.
- **DSM injoignable** : testez l'URL depuis l'hôte Gladys et vérifiez le pare-feu du NAS.
- **Erreur de certificat** : installez un certificat de confiance dans DSM. Pour une installation privée auto-signée uniquement, la vérification peut être désactivée.
- **Volume absent** : relancez une recherche après la création ou la suppression d'un volume.
