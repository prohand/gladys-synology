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
- **NAS 2, NAS 3 et NAS 4** : connexions facultatives utilisant les mêmes champs URL, nom d'utilisateur, mot de passe, OTP et TLS que le NAS principal. Laissez l'URL d'un NAS vide pour ignorer cet emplacement. Chaque mot de passe et chaque OTP est conservé dans un champ secret Gladys dédié et n'apparaît jamais dans un document JSON.
- **Intervalle de rafraîchissement** : valeur saisie manuellement en secondes, entre 60 et 86400. La valeur recommandée et utilisée par défaut est 900 secondes (15 minutes). Un intervalle modéré évite de remplir inutilement la base Gladys.

Cliquez sur **Tester la connexion DSM**. En cas de succès, le résultat indique le modèle du NAS, la version DSM et le nombre de volumes détectés. Lancez ensuite une recherche d'appareils dans Gladys.

## Appareils

L'intégration crée un appareil par NAS, un appareil par volume de stockage, un appareil par disque interne et, lorsqu'elles sont disponibles, un appareil par tâche Hyper Backup ou Active Backup. Chaque disque expose l'état SMART exact renvoyé par DSM, un indicateur binaire de bonne santé SMART et, lorsque DSM la communique, sa température. Une tâche de sauvegarde expose son état, son dernier résultat et la date de sa dernière sauvegarde. Les API de ces paquets DSM ne sont pas présentes sur tous les modèles et versions : leur absence ne bloque pas les métriques système et stockage.

Un premier instantané est envoyé immédiatement après l'ajout d'un appareil, puis chaque cycle met à jour en une seule fois les valeurs de tous les NAS. Le pourcentage d'occupation des volumes est arrondi à deux décimales. L'historique est conservé pour les taux d'utilisation, la température et l'état de santé ; les capacités et informations textuelles ne créent pas d'historique redondant.

Les indicateurs de bonne santé ne prennent une valeur que sur un état clairement signalé par DSM comme sain ou comme une panne. Pendant une opération de maintenance (extension, vérification, réparation) ou lorsque SMART n'est pas pris en charge, la valeur précédente est conservée plutôt que de déclencher une fausse alerte.

## Dépannage

- **Identifiants incorrects** : vérifiez le compte dédié et sa politique de connexion.
- **Code MFA requis / erreur 403 ou 406** : configurez OTP pour le compte DSM, saisissez un code actuel à 6 chiffres dans Gladys puis enregistrez. Les notifications d'approbation et les clés matérielles ne sont pas prises en charge par l'API DSM.
- **Code MFA invalide ou expiré / erreur 404** : attendez le prochain code OTP et enregistrez-le avant son expiration.
- **Droits insuffisants / erreur 105** : ajoutez le compte dédié au groupe DSM `administrators`. Le seul rôle délégué Surveillance du système ne suffit pas pour ces API.
- **Connexion perdue après un redémarrage du NAS ou une mise à jour DSM / erreur 498** : rien à faire. DSM peut refuser la connexion mémorisée pendant son redémarrage ; l'intégration se reconnecte d'elle-même et réessaie toutes les 30 secondes, puis de plus en plus espacé jusqu'à 15 minutes, tant que le NAS ne répond pas.
- **DSM injoignable** : testez l'URL depuis l'hôte Gladys et vérifiez le pare-feu du NAS.
- **DSM n'a pas répondu à temps** : le NAS a accepté la connexion mais n'a rien renvoyé en 20 secondes. Le cycle est abandonné puis réessayé au suivant ; vérifiez la charge du NAS et le réseau.
- **Un seul NAS injoignable dans une configuration multi-NAS** : les autres NAS continuent de publier leurs valeurs et l'écran de configuration Gladys indique l'adresse en défaut. Seule une panne de tous les NAS signale l'intégration comme déconnectée.
- **Erreur de certificat** : installez un certificat de confiance dans DSM. Pour une installation privée auto-signée uniquement, la vérification peut être désactivée.
- **Volume absent** : relancez une recherche après la création ou la suppression d'un volume.
- **Tâches de sauvegarde absentes** : vérifiez que Hyper Backup ou Active Backup est installé, qu'au moins une tâche existe et que le compte DSM dédié peut ouvrir le paquet correspondant, puis relancez la recherche.
- **La date d'une sauvegarde n'a aucune valeur** : mettez l'intégration à jour, enregistrez de nouveau la connexion et attendez le prochain rafraîchissement. Les détails Active Backup sont interrogés tâche par tâche, car la liste générale ne fournit pas toujours les dates des versions.
