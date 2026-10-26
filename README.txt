VINCE KAWAII — SITE WEB ET VÉRITABLES COMPTES / PAIEMENTS

1. Le visuel et les fiches produits sont intégrés dans public/index.html.
   Les trois produits de la rubrique « Les piliers » sont Boo, Halloween Latte et Tarte au citron.
   Le panier propose la case « Je souhaite recevoir des échantillons ».
   Le règlement reprend une présentation en deux colonnes proche des captures.

2. Pour publier et accepter de VRAIS paiements, vous devez disposer de :
   - un projet Supabase pour les comptes et les commandes ;
   - un compte Stripe marchand pour recevoir les paiements ;
   - un hébergeur Node.js et un domaine HTTPS.
   Les comptes créés via Supabase ne sont pas des profils enregistrés dans le navigateur.
   Leur session de connexion peut néanmoins être conservée de façon sécurisée par le SDK Supabase.
   La page « Paiement validé » n'est affichée qu'après vérification d'une transaction payée chez Stripe.
   Les numéros de carte ne sont jamais saisis ni enregistrés par le site : Stripe les collecte.

3. Installation :
   npm install
   copiez .env.example en .env et indiquez vos propres clés et PUBLIC_ORIGIN.
   Dans Supabase : exécuter schema.sql, activer e-mail/mot de passe et la confirmation d'e-mail,
   configurer l'URL du site et les URL de redirection.
   Sur Stripe : configurer le compte, les moyens de paiement et le webhook HTTPS
   POST https://votre-domaine.fr/api/stripe/webhook avec événements :
   checkout.session.completed, checkout.session.async_payment_succeeded,
   checkout.session.async_payment_failed et checkout.session.expired.
   Créer dans Stripe les codes promotionnels que vous souhaitez accepter.
   npm start

4. RÈGLES IMPORTANTES :
   - Le bouton Carte ou Apple Pay conduit au paiement Stripe. Apple Pay n'apparaît
     que sur les appareils et navigateurs compatibles, selon les réglages Stripe.
   - PayPal et Klarna requièrent leur activation dans le compte Stripe et dépendent
     des pays / devises / critères d'éligibilité. Ils peuvent donc être indisponibles.
   - Shop Pay exige une intégration marchande Shopify distincte ; son paiement
     n'est pas activé dans ce paquet. Aucun faux succès ne sera affiché.
   - Les codes sont vérifiés auprès de Stripe ; leurs conditions d'utilisation sont
     revérifiées au paiement. Le site ne fabrique pas de codes valides.
   - L'hébergement doit préserver la confidentialité des variables d'environnement,
     avoir une protection contre la fraude et assurer le suivi des commandes.
   - Vérifier prix, disponibilité, frais de port, mentions légales, CGV, confidentialité
     et droits d'utilisation des photos de produits AVANT toute ouverture publique.
   - Les comptes et paiements ne seront pas actifs en ouvrant directement
     public/index.html en fichier local : il faut le serveur configuré ci-dessus.
