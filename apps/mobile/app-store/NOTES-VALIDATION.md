# Les notes pour l'équipe de validation d'Apple

*Chantier 8, point 8 de la feuille de route V1. Pour le fondateur. Remis à jour le 21 novembre 2026 sur le code de `main` (0474313) : vie sociale (compte privé, réponses et mentions, plusieurs photos, épingles, lien en bio), fil « Pour vous », messages (« Vu », j'aime, réponses, suppression), notifications d'activité, part du mois, liens TikTok et Instagram (lecteur officiel, analyse d'un lien, pièces déjà repérées), recherche d'image d'iOS 26.*

*Lot « textes juridiques et dossier Apple » (retours du build 3, 26 novembre 2026, sur l'assemblage `3978878`) : lecteur dont le premier appui sur Lecture vaut accord, image du moment préparée par le service vidéo (`VIDEO_LINK_FRAME_ENABLED`, nouvelle ligne dans les interrupteurs), boutons cités sans leur libellé (le lot « fidélité aux maquettes » les renomme), ligne « Permissions » retirée faute de place (point 14). Texte anglais recompté.*

**Où coller** : App Store Connect → votre app → la version → section **Informations pour la validation de l'app** (*App Review Information*) :
- **Identifiant** et **mot de passe** du compte de démonstration : dans leurs deux cases (pas seulement dans les notes) ;
- **Remarques** (*Notes*) : la **version anglaise** ci-dessous (partie 3). Apple lit l'anglais. **Limite d'Apple : 4 000 octets** (page d'aide d'App Store Connect, relue le 21 novembre 2026 : « The Notes field can contain up to 4000 bytes »). Le texte anglais en fait **3 960 caractères, soit 3 968 octets**, crochets compris : il reste 32 octets de marge. Il est écrit en caractères simples (ni emoji, ni guillemets typographiques) : une lettre accentuée compte 2 octets. La version française (partie 2, pour vous) n'est pas collée chez Apple.
- **Pièce jointe** (facultative, conseillée) : une courte vidéo d'écran de votre iPhone qui montre le partage d'une photo vers l'app depuis Photos, et un lien TikTok ou Instagram ouvert dans l'app. Elle évite un aller-retour si le testeur ne trouve pas l'extension.

**Règle** : Apple refuse les descriptions vagues (règle 2.3.1 (a) : « All new features, functionality, and product changes must be described with specificity in the Notes for Review section of App Store Connect (generic descriptions will be rejected) and accessible for review. »). Chaque phrase vient du code de `main` (0474313) ; les preuves sont en partie 4. Si le code change d'ici l'envoi, revérifiez le paragraphe concerné, **et recomptez** : `wc -c` sur le texte copié dans un fichier (le nombre d'octets).

Le nom de l'app va changer : le texte dit « the app ». Seuls les libellés lus à l'écran sont cités entre guillemets ; relisez-les sur le build, l'app réglée en anglais (Réglages de l'app → Langue → English).

---

## 1. Avant de coller : ce qu'il reste à remplir, à vérifier ou à décider

**À remplir** (tous les crochets `[…]` de la version anglaise) :

1. **`[À compléter]`** (4 fois) : l'e-mail et le mot de passe du compte de démonstration ; le nom d'utilisateur du compte **ami** (ils se suivent l'un l'autre) ; celui du **troisième compte**, qui lui a envoyé une invitation et dont une publication publique apparaît dans « Pour vous ». Le scénario à préparer est dans [CONTROLE-BUILD.md](CONTROLE-BUILD.md), partie E.
2. **`[8]` et `[25]`** : les plafonds réels de Render (`SERPAPI_USER_DAILY_CAP` et `SERPAPI_DAILY_CAP`). 8 et 25 sont les valeurs par défaut du code. Les 100 recherches par mois sont écrites dans le code (`apps/backend/src/lib/memberQuotas.ts`) : rien à remplir.
3. **`[ON/OFF]`** (8 fois, dont la nouvelle ligne « Moment frame »), l'état **le jour de l'envoi** (gardez un seul des deux mots) :
   - les notifications : `PUSH_ENABLED` chez Render ;
   - le lecteur officiel, TikTok puis Instagram : **ON** seulement si l'option du build est allumée chez Expo (`EXPO_PUBLIC_FEATURE_TIKTOK_PLAYER`, `EXPO_PUBLIC_FEATURE_INSTAGRAM_PLAYER` : absente, ou autre chose que `false`) **et** si Render ne le coupe pas (`TIKTOK_PLAYER_ENABLED`, `INSTAGRAM_PLAYER_ENABLED` : même règle) ;
   - l'analyse d'un lien : **ON** seulement si `VIDEO_LINK_ANALYSIS_ENABLED` vaut exactement `true`, avec le service vidéo réglé (`VIDEO_WORKER_URL`, `VIDEO_WORKER_SECRET`) et `ANTHROPIC_API_KEY` saisie ;
   - l'image du moment (« Moment frame ») : **ON** seulement si `VIDEO_LINK_FRAME_ENABLED` vaut exactement `true`, avec le service vidéo réglé (`VIDEO_WORKER_URL`, `VIDEO_WORKER_SECRET`, service vidéo mis en ligne AVANT d'allumer : `SETUP.md`) ; elle ne demande pas `ANTHROPIC_API_KEY` ;
   - les autres boutiques : `VOIE_C_ENABLED`, puis son étape IA : `VOIE_C_AI_ENABLED` ;
   - l'analyse des vidéos du téléphone : **ON** si `ANTHROPIC_API_KEY` est saisie.

   Règle 2.5.19 d'Apple (relue le 21 novembre 2026) : « Don't include any hidden, dormant, or undocumented features in your app; your app's functionality should be clear to end users and App Review. » Chaque interrupteur est donc décrit avec son état, même coupé.

**À vérifier** (sinon la phrase est fausse : corrigez-la ou retirez-la) :

4. **`ANTHROPIC_PHOTO_ENABLED` est bien coupé** chez Render (absent, ou différent de `true`). Les notes disent « OFF » : s'il est allumé, n'envoyez pas.
5. **Les migrations en production** ([REGISTRE-MIGRATIONS.md](../../backend/supabase/REGISTRE-MIGRATIONS.md)) : toutes celles que les notes supposent sont appliquées (état du registre au 20 novembre 2026, jusqu'à 0053) : masquage automatique (0030), messages et collections (0032 à 0034), notifications et alertes (0035, 0036, 0040, 0041), bio et photo retirées par la modération (0037), pièces déjà repérées (0038, 0039), « Vu » (0043), j'aime, réponses et suppression des messages (0044), vie sociale (0045 à 0049), « Pour vous » (0050), notifications d'activité (0051), part du mois (0053). Si une migration plus récente est arrivée dans `main` d'ici l'envoi, elle doit être appliquée elle aussi.
6. **« photo backup: 7 days max »** : vrai si la copie de sécurité hebdomadaire des photos est en service (`apps/backend/supabase/SAUVEGARDE-PHOTOS.md`). Sans copie de sécurité, retirez la parenthèse.
7. **« none is affiliated »** : vrai tant qu'aucun programme d'affiliation n'est actif. À réécrire le jour où un lien rapporte une commission.
8. **« no … tracking »** : vrai pour Spotto lui-même, et tant que votre déclaration « App Privacy » répond « Suivi : non ». Le lecteur officiel de TikTok ou d'Instagram pose une question à part ([CONFIDENTIALITE-APPLE.md](CONFIDENTIALITE-APPLE.md), partie 6) : si vous y cochez « Suivi », retirez « or tracking ».

**À décider** (ce sont des engagements ou des risques pris en votre nom) :

9. **« We review within 24 hours »** : ne laissez cette phrase que si vous prenez cet engagement (alerte reçue sur votre téléphone, week-end compris).
10. **Si `PUSH_ENABLED` reste coupé le jour de l'envoi** : une personne qui allume la cloche d'une envie lit « Your alerts are saved; notifications will be available soon. » (« les notifications seront bientôt disponibles », `wishAlerts.pushSoon`). Les alertes sont en service depuis le 15 novembre 2026 : cette phrase s'affiche donc dès la première cloche. Apple demande une version finale (règle 2.1 (a) : « placeholder text, empty websites, and other temporary content should be scrubbed before submission ») : une fonction annoncée pour « bientôt » risque d'être lue comme un contenu provisoire. Deux sorties : allumer les notifications avant l'envoi, ou faire réécrire cette phrase (travail de code).
11. **Le lecteur officiel dans le build** (allumé par défaut : [CONTROLE-BUILD.md](CONTROLE-BUILD.md), partie A). Règle 5.2.2 d'Apple : « If your app uses, accesses, monetizes access to, or displays content from a third-party service, ensure that you are specifically permitted to do so under the service's terms of use. Authorization must be provided upon request. » Il change aussi la déclaration « App Privacy » ([CONFIDENTIALITE-APPLE.md](CONFIDENTIALITE-APPLE.md), partie 6). Pour un build sans lecteur : les deux options à `false` chez Expo, un nouveau build, et `OFF` dans les notes ; le texte reste juste (« else "Spot this video" explains the screenshot »). Depuis les retours du build 3 : plus de feuille d'accord, le premier appui sur Lecture vaut accord, et rien n'est chargé chez TikTok ou Meta avant (`PLAYER_CONSENT_BY_PLAY_BUTTON`, `apps/mobile/src/lib/spot-flags.ts` ; l'ancien écran revient si cette constante passe à `false`, et la ligne anglaise reste juste : son bouton « Play the video here » est aussi un appui sur Lecture). Pour TikTok, les commandes du lecteur sont cachées par ses paramètres officiels (`controls=0`, `progress_bar=0` : `TIKTOK_PLAYER_PARAMS`, `apps/mobile/src/lib/player-link.ts`) et remplacées par la barre de l'app, qui passe par les commandes officielles du lecteur ; la vidéo a des coins arrondis. Le lecteur n'est donc plus « jamais modifié » : la réponse de la partie 5 a été corrigée en conséquence.
12. **L'analyse d'un lien** (`VIDEO_LINK_ANALYSIS_ENABLED`, coupée par défaut). Allumée, les notes disent que votre service vidéo récupère la vidéo publique. Règle 5.2.3 d'Apple : « Apps should not facilitate illegal file sharing or include the ability to save, convert, or download media from third-party sources (such as Apple Music, YouTube, SoundCloud, Vimeo, etc.) without explicit authorization from those sources. […] Authorization must be provided upon request. » La vidéo n'est ni gardée ni remise à la personne, mais elle est bien récupérée chez TikTok ou Instagram : n'allumez cette analyse le jour de l'envoi que si vous pouvez montrer une autorisation de ces plateformes. Coupée, l'écran de la vidéo reste celui du lecteur ou de la capture, et les notes disent OFF. **L'image du moment** (`VIDEO_LINK_FRAME_ENABLED`, coupée par défaut, retours du build 3) relève de la même règle 5.2.3 : allumée, chaque « Spot this moment » sur une vidéo TikTok du lecteur fait récupérer la vidéo publique par votre service vidéo (sans IA, sans rien garder) pour en extraire une seule image ; ne l'allumez le jour de l'envoi que dans les mêmes conditions. Pour l'essayer, le correcteur ouvre une vidéo TikTok publique dans le lecteur, la met en pause, puis touche « Spot this moment » : c'est ce que dit la ligne « SPOT A PIECE ». Coupée, « Spot this moment » prend l'instantané de la vue, comme avant. Les **propositions de l'IA** (`VIDEO_PIECES_ENABLED`, coupées par défaut, lot « propositions ») n'existent qu'avec cette analyse : si elle est ON le jour de l'envoi, dites aussi leur état à la fin de la ligne « Link analysis » de la version anglaise, ` AI suggestions (VIDEO_PIECES_ENABLED): ON.` ou ` AI suggestions (VIDEO_PIECES_ENABLED): OFF.` (44 octets au plus, espace du début comprise), puis recomptez : depuis la ligne « Moment frame », il ne reste que 32 octets de marge, donc cette phrase à elle seule fait dépasser 4 000 octets ; raccourcissez alors une autre ligne (la ligne « Permissions » a déjà été retirée, point 14).
13. **Une phrase facultative**, à ajouter à la fin de « SERVER SWITCHES TODAY » seulement si vous vous y tenez : `Switches that are OFF will only be turned on with a new submission.` (67 caractères : depuis la ligne « Moment frame », elle ne tient plus dans la marge de 32 octets ; raccourcissez une autre ligne pour l'ajouter). C'est la lecture prudente de la règle 2.5.19 : allumer plus tard une fonction qu'Apple a vue coupée passe par une nouvelle version.
14. **Si le serveur s'endort encore** (offre gratuite de Render) le jour de l'envoi, ajoutez : `SERVER: it may sleep when unused; the first launch can then take up to one minute (a wake-up message is shown).` (111 caractères). La marge n'est plus que de 32 octets : la dernière ligne (« Permissions: camera; photos only for the optional latest-video suggestion; notifications optional. », 98 caractères) a déjà été retirée le 26 novembre 2026 pour faire place à la ligne « Moment frame » ; il faut donc raccourcir ailleurs (par exemple retirer la ligne « ANTHROPIC_PHOTO_ENABLED », 61 caractères, si vous le jugez possible), puis recompter. Les autorisations restent visibles par Apple dans les phrases d'iOS (`apps/mobile/app.json`). Le mieux reste une offre sans veille (CONTROLE-BUILD.md, partie C).

*Ce que ces notes ne disent pas, faute de place* : l'écran « Mettez à jour » (`APP_MIN_IOS_BUILD`, coupé par défaut : CONTROLE-BUILD.md, partie C) ; l'alerte « Épuisé » (construite, cachée dans l'app : décision à prendre, rapport d'audit partie 2) ; le détail des « autres boutiques » (3 recherches au plus par photo) et la recherche automatique avec la description d'un lien quand aucun résultat n'affiche de prix (autres boutiques allumées) ; la source des résultats (réponse prête en partie 5) ; ce qui se voit tout seul dans l'app : listes d'abonnés et « Retirer », « Aimé par », j'aime des commentaires, « Retirer ma mention », « Retirer mon identification », publications enregistrées, comptes à découvrir ; les grandes images lues par le serveur sur la page publique de la boutique (`MERCHANT_IMAGE_UPGRADE_ENABLED` pour les pièces gardées, `MERCHANT_IMAGE_RESULTS_ENABLED` pour les résultats, coupés par défaut) et la couleur des bords des petites images (`EDGE_COLOR_ENABLED`, coupée par défaut) : elles ne changent que la netteté et le fond des images, sans écran ni geste nouveau, et sont décrites dans la politique de confidentialité ; si l'un de ces interrupteurs est allumé le jour de l'envoi et qu'il reste de la place, une ligne `Shop images (server reads public shop pages for larger images): ON.` peut être ajoutée (règle 2.5.19, lecture prudente). L'essayage virtuel n'existe que sur le site : il n'est pas dans l'app iPhone (CONTROLE-BUILD.md, partie A) et n'a rien à faire dans ces notes.

---

## 2. Version française (pour vous : ce que dit le texte anglais)

```text
COMPTE DE DÉMO
E-mail : [À compléter] / Mot de passe : [À compléter]
E-mail confirmé ; exemples : Vault, Envies, collection, publications. Ami @[À compléter] (abonnement mutuel) : publication, commentaire, collection montrée, conversation. @[À compléter] (non suivi) : invitation en attente, publication publique dans Fil > « Pour vous ». Pour essayer Signaler/Bloquer.
Un compte est nécessaire : les recherches sont gardées et limitées par personne.

SPOTTER UNE PIÈCE (onglet Spotter)
Photo, appareil photo ou vidéo (la vidéo reste sur l'iPhone), entourer la pièce, lancer la recherche. « Garder » > Envies, « Je l'ai achetée » > Vault. Aussi Photos > Partager > l'app ; iOS 26 : capture > « Recherche d'image » > l'app.
Un lien TikTok ou Instagram ouvre un écran vidéo : lecteur officiel si ON plus bas (rien n'est chargé avant un premier appui sur Lecture, qui vaut accord) : pause, « Spotter ce moment » prend l'instantané de la vue (ou l'image de TikTok préparée par notre serveur, plus bas) ; sinon « Spottez cette vidéo » explique la capture. « Pièces déjà repérées dans cette vidéo » : trouvées par au moins 2 membres, jamais qui.

MODÈLE ÉCONOMIQUE
Gratuit : ni achat intégré, ni abonnement, ni publicité, ni suivi. Les liens des boutiques s'ouvrent dans une fenêtre Safari intégrée ; aucun n'est affilié.

VIE SOCIALE
Publications (jusqu'à 5 photos, personnes identifiées), j'aime, réponses aux commentaires, mentions @ (réglage « Qui peut me mentionner »), compte privé avec demandes d'abonnement, 3 publications épinglées. Le lien https d'un profil s'ouvre dans Safari après la feuille « Vous allez quitter… ». Fil > « Pour vous » : publications publiques récentes de comptes non suivis, même classement pour tous, aucun profilage ; refus : Réglages > « Proposer mon compte aux autres membres ».

MESSAGES (onglet Activité > Messages, ou « Message » sur un profil)
Texte, cartes d'envies, publications ; aimer, répondre, supprimer son message (gardé pour la modération s'il avait été signalé) ; « Vu »/« Envoyé », avec le réglage réciproque « Confirmations de lecture ». Entre amis : directement ; sinon UNE invitation (acceptée, refusée sans le dire, ou bloquée). Réglage « Qui peut m'écrire » : Tout le monde (par défaut), Comptes que je suis, Mes amis seulement.

NOTIFICATIONS
Facultatives. Autorisation d'iOS demandée seulement après « Activer » sur une feuille d'explication, ou quand la personne allume un interrupteur dans les Réglages, jamais au lancement. Interrupteurs : messages (qui écrit, jamais le texte), alertes prix et stock (texte générique), 4 sortes d'activité ; tous éteints au départ.

INTERRUPTEURS DU SERVEUR
- Notifications (PUSH_ENABLED) : [ON/OFF] (coupé : autorisation jamais demandée).
- Lecteur officiel : TikTok [ON/OFF], Instagram [ON/OFF].
- Analyse d'un lien (VIDEO_LINK_ANALYSIS_ENABLED) : [ON/OFF]. Allumé : « Trouver la pièce » ; avec accord, notre service vidéo récupère la vidéo publique (sans la garder) ; 16 images au plus partent chez Anthropic.
- Image du moment (VIDEO_LINK_FRAME_ENABLED) : [ON/OFF]. Allumé : notre service vidéo récupère la vidéo TikTok publique pour cette seule image (sans IA, sans la garder).
- Autres boutiques (VOIE_C_ENABLED) : [ON/OFF] ; étape IA (VOIE_C_AI_ENABLED) : [ON/OFF]. Allumé : recherches Google Shopping écrites par une IA (Anthropic) d'après les titres des résultats, jamais l'image ; on peut aussi taper des mots.
- Analyse des vidéos du téléphone (clé Anthropic) : [ON/OFF] ; avec accord, 12 images au plus.
- ANTHROPIC_PHOTO_ENABLED : OFF (aucune photo de membre envoyée à une IA).

PLAFONDS
[8] recherches par jour et 100 par mois par personne (heure de Paris), [25] par jour pour tout le service, 10 par heure. À zéro, la recherche est désactivée.

MODÉRATION (1.2)
- Les conditions d'utilisation (EULA ; à l'inscription et dans Réglages > Documents) interdisent les contenus choquants et les abus.
- Filtre de mots interdits (FR/EN) : légendes, commentaires, messages, noms, bios, liens de profil, noms de collections.
- Signaler : « ••• » sur une publication, un commentaire, un profil, une pièce reçue, la collection d'un ami, ou à côté d'un message reçu (ou appui long) > « Signaler ». Le contenu signalé disparaît aussitôt pour qui signale.
- Bloquer : même menu ; cache publications, profil, conversation, mentions. Réglages > Comptes bloqués.
- Publication, commentaire, pièce ou collection signalés par 3 personnes différentes : masqués avant examen.
- Chaque signalement nous prévient. Examen sous 24 heures ; contenus masqués, bios, photos ou liens retirés, comptes suspendus.
- Contact : Réglages > Aide et contact.

SUPPRESSION DU COMPTE
Profil > roue dentée > Supprimer mon compte > taper SUPPRIMER > Confirmer la suppression. Tout est effacé aussitôt (copie de sécurité des photos : 7 jours au plus).
```

---

## 3. Version anglaise (à coller dans « Remarques »)

```text
DEMO ACCOUNT
Email: [À compléter] / Password: [À compléter]
Email confirmed; sample Vault, Wishlist, collection, posts. Friend @[À compléter] (mutual follow): post, comment, shared collection, conversation. @[À compléter] (not followed): pending invitation, public post in Feed > "For you". To test Report/Block.
An account is needed: searches are saved and limited per person.

SPOT A PIECE (Spotter tab)
Photo, camera or video (video stays on device), circle the piece, start the search. "Save" > Wishlist, "I bought it" > Vault. Also Photos > Share > the app; iOS 26 screenshot > "Image Search" > the app.
A TikTok/Instagram link opens a video screen: official player if ON below (nothing loads before a first Play press = consent): pause, "Spot this moment" snapshots the view (or uses our TikTok frame, below); else "Spot this video" explains the screenshot. "Pieces already spotted in this video": found by 2+ members, never who.

BUSINESS MODEL
Free: no in-app purchase, subscription, ads or tracking. Shop links open in an in-app Safari view; none is affiliated.

SOCIAL
Posts (up to 5 photos, people tags), likes, comment replies, @mentions ("Who can mention me" setting), private account with follow requests, 3 pinned posts. A profile https link opens Safari after a "You are about to leave..." sheet. Feed > "For you": recent public posts of accounts you don't follow, same ranking for all, no profiling; opt-out: Settings > "Suggest my account to other members".

MESSAGES (Activity tab > Messages, or "Message" on a profile)
Text, wish cards, posts; like, reply, delete own message (kept for moderation if reported); "Seen"/"Sent" with a reciprocal "Read receipts" setting. Friends write directly; others send ONE invitation (accept, decline silently or block). "Who can write to me" setting: Everyone (default), Accounts I follow, Friends only.

NOTIFICATIONS
Optional. iOS permission is asked only after "Turn on" on an explanation sheet, or when the person turns on a switch in Settings, never at launch. Switches: messages (sender only, never the text), price/stock alerts (generic), 4 activity kinds; all off at first.

SERVER SWITCHES TODAY
- Push (PUSH_ENABLED): [ON/OFF] (off: never asked).
- Official player: TikTok [ON/OFF], Instagram [ON/OFF].
- Link analysis (VIDEO_LINK_ANALYSIS_ENABLED): [ON/OFF]. On: "Find the piece": with consent, our video service fetches the public video (not kept); up to 16 frames go to Anthropic.
- Moment frame (VIDEO_LINK_FRAME_ENABLED): [ON/OFF]. On: our video service fetches the public TikTok video for that frame (no AI, not kept).
- Other shops (VOIE_C_ENABLED): [ON/OFF]; AI step (VOIE_C_AI_ENABLED): [ON/OFF]. On: Google Shopping queries written by an AI (Anthropic) from result titles, never the image; users can also type words.
- Phone video analysis (Anthropic key): [ON/OFF]; with consent, 12 frames max.
- ANTHROPIC_PHOTO_ENABLED: OFF (no user photo goes to an AI).

LIMITS
[8] searches a day and 100 a month per person (Paris time), [25] a day for the service, 10 an hour. At zero, searching is disabled.

MODERATION (1.2)
- Terms of use (EULA; at sign-up and in Settings > Documents) forbid objectionable content and abuse.
- Banned-words filter (FR/EN): captions, comments, messages, names, bios, profile links, collection names.
- Report: "..." on a post, comment, profile, received piece, friend's collection, or next to a received message (or long-press) > "Report". Reported content vanishes for the reporter.
- Block: same menu; hides posts, profile, conversation, mentions. Settings > Blocked accounts.
- A post, comment, piece or collection reported by 3 different people is hidden until reviewed.
- Each report alerts us. We review within 24 hours, hide content, remove bios, photos or links, suspend accounts.
- Contact: Settings > Help and contact.

ACCOUNT DELETION
Profile > gear > Delete my account > type DELETE > Confirm deletion. Deleted at once (photo backup: 7 days max).
```

3 960 caractères (3 968 octets), crochets compris, recomptés le 26 novembre 2026. Limite d'Apple : 4 000 octets.

---

## 4. Les preuves, paragraphe par paragraphe

Relues le 21 novembre 2026 sur `main` (0474313). Chaque preuve cite le fichier et le nom à y chercher (les numéros de ligne glissent vite). Les libellés anglais cités viennent de `apps/mobile/src/i18n/en.ts`, les français de `fr.ts`.

- **DEMO ACCOUNT** : compte obligatoire, groupes d'écrans protégés : `apps/mobile/src/app/_layout.tsx` et `apps/mobile/src/lib/root-route.ts` ; confirmation de l'e-mail : `apps/mobile/src/app/sign-up.tsx` ; amis = chacun suit l'autre : `apps/backend/src/lib/messaging.ts` ; ce qui entre dans « Pour vous » (publication publique avec photo de moins de 14 jours, compte public inscrit depuis plus de 24 heures, non suivi par la personne) : `apps/backend/src/lib/forYou.ts`, `packages/shared-types/src/index.ts` (`FOR_YOU_DAYS`, `FOR_YOU_MIN_ACCOUNT_AGE_HOURS`) ; compte de démonstration jamais administrateur (sa suppression serait refusée) : `apps/backend/src/routes/account.ts`.
- **SPOT A PIECE** : les trois boutons : `apps/mobile/src/app/(app)/(tabs)/index.tsx`, `apps/mobile/src/components/spot-entry.tsx` (`spotter.addPhoto`, `cameraCapture.takePhoto`, `spotter.addVideo`) ; entourer puis « Search » : `apps/mobile/src/app/(app)/spot/lancer.tsx` (`launch.launch`) ; « Save » et « I bought it » : `result.keep`, `result.markAsBought` ; extension de partage : `apps/mobile/app.json` (`expo-share-intent`), `apps/mobile/plugins/extension-partage.js` ; recherche d'image d'iOS 26 : `apps/mobile/plugins/recherche-image.js` et `plugins/recherche-image/SpottoRechercheImage.swift`, texte `videoLink.steps`.
- **Liens TikTok et Instagram** : l'écran « vidéo partagée » : `apps/mobile/src/lib/link-step.ts`, `apps/mobile/src/app/(app)/spot/lecteur.tsx` ; lecteur = option du build × interrupteur du serveur × accord : `apps/mobile/src/lib/player-decision.ts`, `apps/mobile/src/lib/features.ts`, `apps/backend/src/lib/videoPlayers.ts` ; accord : `PLAYER_CONSENT_GATE` et `PLAYER_CONSENT_BY_PLAY_BUTTON` (`apps/mobile/src/lib/spot-flags.ts`), premier appui sur Lecture (`player.firstPlay`, étape « firstPlay » de `lecteur.tsx` ; ancien écran `player.gate`), accord rangé sur l'iPhone par plateforme (`apps/mobile/src/lib/player-access.ts`) ; instantané de la vue : module `apps/mobile/modules/spotto-player-snapshot`, test `apps/mobile/tests/player-access.test.ts` ; écran de secours « Spot this video » : `apps/mobile/src/components/video-fallback.tsx` ; pièces déjà repérées, à partir de 2 membres, sans nom : `apps/backend/src/lib/videoMemory.ts` (migrations 0038 et 0039) ; le serveur principal ne télécharge rien de TikTok ni d'Instagram (deux seuls appels : suivre un lien court TikTok, demander à Meta le code d'intégration d'Instagram) : en-tête de `apps/backend/src/routes/videoLinks.ts`, test `apps/backend/tests/aucunMediaTiktokInstagram.test.ts`.
- **BUSINESS MODEL** : aucun achat intégré ni publicité dans le code de l'app ; abonnements coupés par défaut, et rien ne les écrit encore : `SUBSCRIPTIONS_ENABLED` (`apps/backend/src/env.ts`), registre des migrations (0053) ; lien du marchand dans la fenêtre Safari intégrée : `apps/mobile/src/lib/merchant-links.ts` (`WebBrowser.openBrowserAsync`) ; un lien n'est « affilié » que s'il diffère du lien du marchand : `apps/mobile/src/lib/affiliate-link.ts` ; « aucun programme d'affiliation n'est actif » : `apps/mobile/src/legal/conditions.ts`.
- **SOCIAL** : 5 photos et 5 personnes identifiées : `packages/shared-types/src/index.ts` (`POST_PHOTOS_MAX`, `PEOPLE_TAGS_MAX`), `apps/backend/src/lib/postExtras.ts`, `peopleTags.ts` ; réponses, j'aime des commentaires, mentions, réglage « Qui peut me mentionner » (au départ « Accounts I follow ») : `apps/backend/src/lib/comments.ts`, `mentions.ts`, `DEFAULT_MENTIONS_FROM` ; compte privé et demandes d'abonnement : `apps/backend/src/lib/audience.ts`, `apps/backend/src/routes/follows.ts` ; 3 épingles : `PINNED_POSTS_MAX`, `apps/backend/src/lib/profileExtras.ts` ; lien du profil, https seulement, ouvert hors de l'app après la feuille : `apps/mobile/src/components/external-link-sheet.tsx` (`Linking.openURL`), `profilePins.leaveTitle` ; « Pour vous », même classement pour tous, rien d'enregistré de ce qui est vu : `apps/backend/src/lib/forYou.ts` ; réglage « Suggest my account to other members » : `apps/mobile/src/components/discoverable-setting.tsx`.
- **MESSAGES** : règles (amis, une invitation, refus discret, 30 jours, blocage) : `apps/backend/src/lib/messaging.ts` ; « Qui peut m'écrire », défaut « tout le monde » : `DEFAULT_MESSAGES_FROM`, `messagesFromTitle` ; entrée « Messages » de l'onglet Activité : `apps/mobile/src/app/(app)/(tabs)/activite.tsx` ; aimer, répondre, supprimer, publication envoyée, message supprimé gardé pour la modération s'il avait été signalé : `apps/backend/src/lib/messageActions.ts`, `apps/mobile/src/app/(app)/conversation.tsx` (`Bubble`, `MessageActionsSheet`), migration 0044 ; « Vu »/« Envoyé », réglage allumé par défaut et réciproque : `apps/backend/src/lib/readReceipts.ts`, `apps/mobile/src/components/read-receipts-setting.tsx`, migration 0043.
- **NOTIFICATIONS** : autorisation demandée seulement après « Turn on » / « Activer » d'une feuille (`push.offerAccept`, `activityPush.enable`, `apps/mobile/src/components/push-offer-sheet.tsx`) ou un interrupteur des Réglages : `apps/mobile/src/lib/push.ts` (`enablePush`), `apps/mobile/src/components/activity-push-setting.tsx` ; texte d'un message limité à « qui écrit », phrase fixe de l'activité : `apps/backend/src/lib/push.ts` ; alerte générique, sans pièce, boutique ni prix : `apps/backend/src/lib/wishAlertsSend.ts`, `wishAlerts.pushOfferBody` ; les interrupteurs : `message-push-setting.tsx`, `wish-alerts-setting.tsx`, `activity-push-setting.tsx`.
- **SERVER SWITCHES TODAY** : `apps/backend/src/env.ts` — `PUSH_ENABLED`, `VOIE_C_ENABLED`, `VOIE_C_AI_ENABLED`, `ANTHROPIC_PHOTO_ENABLED`, `VIDEO_LINK_FRAME_ENABLED`, `VIDEO_LINK_ANALYSIS_ENABLED`, `VIDEO_PIECES_ENABLED` : seule la valeur exacte `true` allume ; `TIKTOK_PLAYER_ENABLED`, `INSTAGRAM_PLAYER_ENABLED` : seule la valeur exacte `false` coupe, et le serveur ne peut que couper un lecteur du build ; analyse d'un lien, accord sur le texte qui parle des liens, 16 images au plus, rien de gardé : `apps/backend/src/routes/videoLinkAnalysis.ts`, `apps/backend/src/lib/videoWorker.ts`, `apps/video-worker/README.md`, texte d'accord `videoAuto.consentBody` ; image du moment (TikTok seulement, une seule image, sans IA, 30 par heure et par membre, rien de gardé) : route `POST /api/video-links/frame` (`apps/backend/src/routes/videoLinkAnalysis.ts`), `videoLinkFrame` (`apps/backend/src/lib/rateLimits.ts`), champ `atSeconds` du service vidéo (`apps/video-worker/src/contract.js`), dans l'app `fetchVideoLinkFrame` (`apps/mobile/src/lib/api.ts`) et `spotMoment` (`lecteur.tsx`) ; propositions de l'IA (3 noms au plus, filtrés, jamais gardés, seulement avec l'analyse d'un lien) : `askVideoPieces` (`apps/backend/src/services/videoMoments.ts`), `pieceLabel` (`packages/shared-types/src/index.ts`), `videoLinkAuto.pieces` ; recherche écrite par l'IA à partir des titres des 15 premiers résultats : `apps/backend/src/services/shoppingQueryAi.ts` ; écran d'accord des vidéos du téléphone, 12 images au plus : `apps/mobile/src/components/spot-launch-views.tsx`, accord revérifié par `apps/backend/src/routes/videoMoments.ts`.
- **LIMITS** : `SERPAPI_USER_DAILY_CAP` et `SERPAPI_DAILY_CAP` (`apps/backend/src/env.ts`) ; 100 par mois : `FREE_MONTHLY_SEARCH_CAP` (`apps/backend/src/lib/memberQuotas.ts`) ; 10 par heure : `searchCreate` (`apps/backend/src/lib/rateLimits.ts`) ; minuit et 1er du mois, heure de Paris : `apps/backend/src/lib/searchCapacityStatus.ts` ; « Search » désactivé à zéro : `apps/mobile/src/lib/search-limits.ts`.
- **MODERATION** : conditions acceptées à l'inscription (case et liens) : `apps/mobile/src/app/sign-up.tsx` ; dans Réglages → Documents : `apps/mobile/src/app/(app)/settings.tsx` ; règles de conduite : `apps/mobile/src/legal/conditions.ts` ; filtre : `apps/backend/src/lib/contentFilter.ts`, appliqué dans `routes/posts.ts`, `comments.ts`, `conversations.ts`, `me.ts` (nom d'utilisateur, nom affiché, bio, lien), `collections.ts` ; six types signalables : `REPORT_TARGET_TYPES` ; contenu signalé (pas un profil) retiré de la vue de qui signale : `apps/mobile/src/lib/report-target.ts` (`isContentReport`), `apps/backend/src/lib/reportedByViewer.ts` ; blocage : `apps/backend/src/routes/blocks.ts`, `apps/backend/src/lib/blocks.ts` ; masquage à 3 personnes : `apps/backend/src/lib/autoHide.ts` (publication, commentaire, pièce, collection ; pas un message ni un profil) ; alerte à chaque signalement : `apps/backend/ALERTES.md` (`signalement`) ; retirer une bio, une photo de profil ou un lien, suspendre : `apps/backend/src/routes/moderation.ts`, `apps/backend/src/lib/profileModeration.ts` ; « 24 heures » : un ENGAGEMENT du fondateur, pas du code.
- **ACCOUNT DELETION** : `apps/mobile/src/components/delete-account-section.tsx` ; mot à taper : `ACCOUNT_DELETION_WORDS` ; suppression des fichiers puis du compte : `apps/backend/src/routes/account.ts` ; copie de sécurité, 7 jours au plus : `apps/backend/supabase/SAUVEGARDE-PHOTOS.md`.
- **Permissions** : `apps/mobile/app.json` (phrases de l'appareil photo et des photos, micro coupé) ; notifications : seulement après un geste (ci-dessus).

---

## 5. Si Apple pose une question

Répondez dans App Store Connect (Centre de résolution), en anglais, court et factuel. Les cas les plus probables :
- **« Nous n'avons pas pu nous connecter »** : vérifiez que le compte existe encore (Apple essaie souvent la suppression du compte, et peut l'avoir supprimé), qu'il n'est pas suspendu, puis recréez-le si besoin et redonnez les identifiants.
- **« Le serveur ne répond pas »** : ouvrez https://spotto-api.onrender.com/health puis /health/deep ([CONTROLE-BUILD.md](CONTROLE-BUILD.md), partie F).
- **« Nous ne trouvons pas l'extension de partage »** : joignez la vidéo d'écran (Photos → Partager → Spotto ; si « Spotto » n'apparaît pas, « Modifier les actions » en bas de la feuille de partage).
- **« D'où viennent les résultats ? »** : `Results come from Google Lens (visual search) and Google Shopping, through our provider SerpApi; the cropped image is read through a 5-minute link and then deleted.`
- **Une question sur l'IA ou les données** : renvoyez aux lignes « SERVER SWITCHES TODAY » et à la politique de confidentialité.
- **Une question sur les vidéos TikTok ou Instagram** (règles 5.2.2 et 5.2.3, « Authorization must be provided upon request ») : le lecteur est le lecteur officiel de la plateforme, jamais caché (seuls ses coins sont arrondis) ; pour TikTok, ses commandes sont cachées par ses paramètres officiels et remplacées par les nôtres, qui passent par ses commandes officielles. « Spot this moment » prend l'instantané de la vue ; si l'image du moment est allumée (`VIDEO_LINK_FRAME_ENABLED`), notre service vidéo récupère aussi la vidéo TikTok publique pour en extraire cette seule image, sans la garder : c'est alors une récupération de média au sens de la règle 5.2.3 (point 12). Si Apple demande une autorisation écrite de TikTok ou de Meta et que vous ne l'avez pas, ne discutez pas : faites un build sans lecteur (CONTROLE-BUILD.md, partie A) et coupez l'analyse d'un lien.
- **« Comment gagnez-vous de l'argent ? »** : le paragraphe « BUSINESS MODEL ». Ne promettez rien de plus que ce qu'il dit.
- **« Pourquoi faut-il un compte ? »** (règle 5.1.1 (v)) : la dernière ligne de « DEMO ACCOUNT », plus la vie sociale et les messages, qui demandent une identité.
- **Une question sur l'essayage virtuel** (la politique de confidentialité en ligne le décrit, pour le site) : `Virtual try-on exists only on our website for adults; it is not in the iOS app.` C'est vrai tant que le contrôle de la partie A de CONTROLE-BUILD.md dit « Conforme ».
- **Une question sur vos droits d'afficher les résultats de Google** (règle 5.2.2) : ne répondez pas seul ; c'est une question de droits, à préparer avant l'envoi (voir le rapport d'audit, partie 2).
