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

La MFA est prise en charge avec les codes de vérification DSM (OTP). **Approuver la connexion** et les clés de sécurité matérielles fonctionnent uniquement avec une connexion Web interactive : configurez donc **Code de vérification (OTP)** pour ce compte. Lors de la première connexion, l'intégration échange le code OTP actuel contre un identifiant d'appareil DSM approuvé et le conserve dans son volume privé `/data`. Vous pouvez effacer le champ OTP après la première connexion réussie. Si l'appareil approuvé est ensuite révoqué dans DSM, saisissez un nouvel OTP puis enregistrez la configuration pour l'inscrire à nouveau.

## Configuration

- **URL DSM** : URL locale complète, par exemple `https://192.168.1.20:5001`.
- **Nom d'utilisateur / mot de passe** : identifiants du compte DSM dédié.
- **Code OTP actuel (MFA)** : code actuel à 6 chiffres pour la première connexion MFA ou après révocation de l'appareil approuvé dans DSM. Il n'est plus transmis lorsque l'appareil mémorisé est accepté.
- **Vérifier le certificat TLS** : laissez cette option activée avec un certificat de confiance. Ne la désactivez que pour un certificat local auto-signé, après avoir vérifié vous-même l'adresse du NAS.
- **Intervalle de rafraîchissement** : 5 minutes, 15 minutes (recommandé et utilisé par défaut) ou 1 heure. Un intervalle modéré évite de remplir inutilement la base Gladys.

Cliquez sur **Tester la connexion DSM**. En cas de succès, le résultat indique le modèle du NAS, la version DSM et le nombre de volumes détectés. Lancez ensuite une recherche d'appareils dans Gladys.

## Appareils

L'intégration crée un appareil pour le NAS et un appareil par volume de stockage. Un premier instantané est envoyé immédiatement après l'ajout d'un appareil, puis chaque cycle met à jour en une seule fois les valeurs du système et des volumes. L'historique est conservé pour les taux d'utilisation, la température et l'état de santé ; les capacités et informations statiques ne créent pas d'historique redondant.

## Dépannage

- **Identifiants incorrects** : vérifiez le compte dédié et sa politique de connexion.
- **Code MFA requis / erreur 403 ou 406** : configurez OTP pour le compte DSM, saisissez un code actuel à 6 chiffres dans Gladys puis enregistrez. Les notifications d'approbation et les clés matérielles ne sont pas prises en charge par l'API DSM.
- **Code MFA invalide ou expiré / erreur 404** : attendez le prochain code OTP et enregistrez-le avant son expiration.
- **Droits insuffisants / erreur 105** : ajoutez le compte dédié au groupe DSM `administrators`. Le seul rôle délégué Surveillance du système ne suffit pas pour ces API.
- **DSM injoignable** : testez l'URL depuis l'hôte Gladys et vérifiez le pare-feu du NAS.
- **Erreur de certificat** : installez un certificat de confiance dans DSM. Pour une installation privée auto-signée uniquement, la vérification peut être désactivée.
- **Volume absent** : relancez une recherche après la création ou la suppression d'un volume.
