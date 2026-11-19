// Ajouts à la politique de confidentialité, version SITE (lot politique du
// 2026-11-15) : l'essayage virtuel photo, qui n'existe que sur le site.
// Adapté des brouillons du 13 novembre 2026 (section « Essayage virtuel
// photo », FR et EN), sans les notes pour l'avocat ; les points restés
// ouverts sont listés dans le rapport du lot, pas dans le texte publié. Faits
// relus dans le code : migration 0042, lib/tryon (images, fournisseur FASHN,
// purge), catalogue tryon-fr.web.ts. Même plan et mêmes faits en anglais.
// La version iPhone (confidentialite-extra.ts) n'ajoute rien : l'app iPhone
// ne contient aucune trace de l'essayage (tests/tryon-web-only.test.ts).
// Jamais l'adresse du site de FASHN ici (même test) : la liste de ses
// sous-traitants est désignée sans lien.
import { APP_NAME_DISPLAY as BRAND } from "../constants/brand";
import { PUBLISHER, PUBLISHER_EN } from "../legal/publisher";
import type { PrivacyExtra } from "../legal/types";

const TRYON_TITLE_FR = "Essayage virtuel photo";
const TRYON_TITLE_EN = "Virtual photo try-on";

export const NO_PRIVACY_EXTRA: PrivacyExtra = {
  summary: [],
  sections: [],
  bases: [],
  providers: [],
  transfers: [],
  retention: [],
  rights: [],
  age: [],
};

export const privacyExtraFr: PrivacyExtra = {
  summary: [
    `Si vous utilisez l'essayage virtuel photo (sur le site, 18 ans et plus, avec votre consentement), votre photo est envoyée à notre prestataire FASHN pour créer l'image ; ${BRAND} ne la conserve pas.`,
  ],
  sections: [
    {
      title: TRYON_TITLE_FR,
      blocks: [
        `Sur le site, si vous avez 18 ans ou plus, vous pouvez envoyer une photo de vous, choisir une pièce trouvée par ${BRAND} et recevoir une image de vous portant cette pièce, créée par l'intelligence artificielle de notre prestataire FASHN. Cette fonction est facultative : elle ne démarre qu'avec votre consentement.`,
        "À quoi elle sert : votre photo sert uniquement à créer, à votre demande, l'image de vous portant la pièce choisie. Ni votre photo ni l'image produite ne servent à entraîner une IA. Les autres données décrites ci-dessous servent à faire fonctionner et à protéger la fonction : la réserver aux membres majeurs, compter les essais et leur coût, corriger les erreurs, prévenir les abus, traiter les signalements, gérer les essais offerts et garder la preuve de votre consentement.",
        "Sur quelle base : votre consentement, demandé avant votre premier essai, puis de nouveau à chaque nouvelle version du texte de consentement. Sans lui, aucun essai n'est possible. Vous pouvez le retirer à tout moment, dans Réglages → Vos données (« Essayage virtuel : retirer mon consentement ») ; le retrait vaut pour l'avenir et ne remet pas en cause les essais déjà réalisés.",
        "Les données traitées :",
        [
          `Votre photo : convertie en JPEG sur votre appareil, puis réduite par notre serveur (1 296 pixels au plus sur le grand côté), sans aucune métadonnée (dont la position GPS), et transmise à FASHN pour créer l'image. ${BRAND} ne la conserve jamais.`,
          `L'image produite : renvoyée sur votre appareil. ${BRAND} ne la conserve jamais.`,
          `La pièce choisie : sa référence dans ${BRAND}. FASHN reçoit l'adresse publique de son image, ou l'image elle-même si FASHN n'a pas pu la charger.`,
          "Des informations d'usage, sans aucune image : la date de chaque essai, la pièce essayée, son résultat (réussi ou échoué), le code d'erreur éventuel, les crédits consommés et la durée.",
          "Votre statut d'âge : majeur ou mineur, et la date de cette déclaration. Votre date de naissance sert seulement au calcul : elle n'est jamais conservée.",
          "Votre consentement : la version acceptée, sa date et, le cas échéant, la date de son retrait.",
          "Vos signalements, sans aucune image : la pièce concernée, le motif choisi (« Image choquante ou inappropriée », « Ce n'est pas la bonne pièce », « Résultat de mauvaise qualité » ou « Autre chose »), un commentaire facultatif de 500 caractères au plus et la date. Vous ne pouvez signaler qu'une pièce que vous avez essayée.",
          "Les essais offerts qui vous ont été attribués : pour chaque attribution, la référence de la commande, le nombre d'essais offerts (5), le nombre restant, la date d'attribution et la date d'expiration (365 jours plus tard). Aujourd'hui, seule notre équipe peut en attribuer.",
        ],
        "Combien d'essais : un compte gratuit a 5 essais par mois civil, remis à zéro le 1er de chaque mois à 0 h (heure de Paris), puis ses essais offerts, ceux qui expirent le plus tôt d'abord. Un essai n'est décompté que s'il réussit : un essai refusé ou échoué ne vous coûte rien. Le décompte se fait à partir des informations d'usage ci-dessus, sans aucune donnée de plus.",
        `Comme pour le reste de ${BRAND}, notre serveur reçoit les données techniques habituelles d'une requête (adresse IP, informations techniques), qui figurent dans ses journaux. Votre photo et l'image produite n'y figurent jamais, ni dans les rapports d'erreur. Aucune donnée de l'essayage n'est envoyée aux statistiques d'usage.`,
        "Qui les reçoit :",
        [
          "FASHN, au Royaume-Uni : reçoit votre photo et l'image de la pièce, crée l'image avec son modèle d'essayage virtuel et la renvoie à notre serveur. FASHN agit pour notre compte, comme sous-traitant. Ni votre nom, ni votre adresse e-mail, ni aucun identifiant de votre compte ne lui sont transmis.",
          "Les sous-traitants de FASHN, dont certains sont situés aux États-Unis et en Asie. FASHN en publie la liste sur son site.",
          "Render, qui héberge notre serveur dans l'Union européenne (Francfort) : votre photo et l'image produite y transitent, en mémoire seulement.",
          "Supabase, qui héberge notre base de données : uniquement les informations décrites ci-dessus, jamais votre photo ni l'image produite.",
        ],
        "Hors de l'Union européenne : le transfert vers le Royaume-Uni, où FASHN est établi, repose sur la décision de la Commission européenne reconnaissant à ce pays un niveau de protection adéquat. Les transferts vers les États-Unis et l'Asie, où se trouvent certains sous-traitants de FASHN, reposent sur les garanties prévues par l'accord de traitement des données de FASHN, comme les clauses contractuelles types de la Commission européenne. Pour Render et Supabase, voir « Transferts hors de l'Union européenne ».",
        `Combien de temps, chez ${BRAND} :`,
        [
          "Votre photo et l'image produite : aucune conservation. Elles restent en mémoire pendant le traitement seulement, et ne sont jamais écrites dans une base de données, un espace de stockage, sur un disque, dans les journaux ni dans les rapports d'erreur.",
          "Les informations d'usage et vos signalements : 12 mois, puis suppression automatique.",
          "Les essais offerts : supprimés 12 mois après leur expiration.",
          "Votre statut d'âge et votre consentement : tant que votre compte existe.",
          "Quand vous supprimez votre compte, tout ce qui précède est supprimé avec lui. Seuls subsistent des compteurs mensuels anonymes (crédits consommés et nombre d'essais réussis par mois), sans lien avec aucun membre.",
        ],
        "Combien de temps, chez FASHN, selon sa documentation publique :",
        [
          "la copie temporaire de votre photo est supprimée à la fin de la demande, et au plus tard sous un jour par un nettoyage automatique ;",
          `l'image produite reste récupérable pendant 60 minutes après la fin du traitement, uniquement avec la clé d'accès de ${BRAND}, puis elle expire ;`,
          `une trace de la demande, sans votre photo (date, modèle, réglages, adresse publique de l'image de la pièce, résultat et erreur éventuelle), est gardée tant que ${BRAND} n'en demande pas la suppression ;`,
          "FASHN n'utilise pas les contenus de ses clients pour entraîner ses modèles d'IA, sauf accord distinct de leur part.",
        ],
        `Vos droits : vos données d'essayage figurent dans l'export de vos données (Réglages → Exporter mes données). Si votre statut d'âge est erroné, écrivez-nous : ${PUBLISHER.email}. La suppression de votre compte efface toutes vos données d'essayage. Vous pouvez aussi vous opposer à un traitement, en demander la limitation ou la portabilité, lorsque ces droits s'appliquent (voir « Vos droits »).`,
        "Une image signalée comme générée par IA : chaque image produite porte un bandeau visible « Image générée par IA » et une métadonnée intégrée au fichier (« DigitalSourceType = trainedAlgorithmicMedia », vocabulaire de l'IPTC), qui permet à des logiciels de reconnaître une image générée par IA. Ne retirez pas ce bandeau, et ne présentez jamais l'image comme une vraie photo.",
      ],
    },
  ],
  bases: [`Créer un essayage virtuel photo, sur le site : votre consentement, que vous pouvez retirer à tout moment (voir « ${TRYON_TITLE_FR} »).`],
  providers: [
    `FASHN (Royaume-Uni) : création de l'essayage virtuel photo, avec ses propres sous-traitants, dont certains aux États-Unis et en Asie ; seulement si vous l'utilisez (voir « ${TRYON_TITLE_FR} »).`,
  ],
  transfers: [
    `si vous utilisez l'essayage virtuel photo : votre photo et l'image de la pièce, envoyées à FASHN, au Royaume-Uni, et à certains de ses sous-traitants, aux États-Unis et en Asie (voir « ${TRYON_TITLE_FR} ») ;`,
  ],
  retention: [`Les données de l'essayage virtuel photo : voir « ${TRYON_TITLE_FR} ». Votre photo et l'image produite ne sont jamais conservées par ${BRAND}.`],
  rights: ["Retirer votre consentement à l'essayage virtuel photo : Réglages → Vos données."],
  age: [`L'essayage virtuel photo, sur le site, est réservé aux personnes de 18 ans et plus. Votre date de naissance vous est demandée une fois : seul votre statut « majeur » ou « mineur » est conservé (voir « ${TRYON_TITLE_FR} »).`],
};

export const privacyExtraEn: PrivacyExtra = {
  summary: [
    `If you use the virtual photo try-on (on the website, 18 and over, with your consent), your photo is sent to our provider FASHN to create the image; ${BRAND} does not keep it.`,
  ],
  sections: [
    {
      title: TRYON_TITLE_EN,
      blocks: [
        `On the website, if you are 18 or over, you can send a photo of yourself, choose a piece found by ${BRAND} and receive an image of yourself wearing that piece, created by the artificial intelligence of our provider FASHN. This feature is optional: it only starts with your consent.`,
        "What it is for: your photo is used only to create, at your request, the image of you wearing the chosen piece. Neither your photo nor the resulting image is used to train an AI. The other data described below are used to run and protect the feature: reserving it for adult members, counting try-ons and their cost, fixing errors, preventing abuse, handling reports, managing bonus try-ons and keeping proof of your consent.",
        "On what basis: your consent, asked before your first try-on, then again with each new version of the consent text. Without it, no try-on is possible. You can withdraw it at any time, in Settings → Your data (“Virtual try-on: withdraw my consent”); withdrawal applies to the future and does not affect try-ons already carried out.",
        "The data processed:",
        [
          `Your photo: converted to JPEG on your device, then reduced by our server (at most 1,296 pixels on its longest side), without any metadata (including GPS location), and sent to FASHN to create the image. ${BRAND} never keeps it.`,
          `The resulting image: returned to your device. ${BRAND} never keeps it.`,
          `The chosen piece: its reference in ${BRAND}. FASHN receives the public address of its image, or the image itself if FASHN could not load it.`,
          "Usage information, without any image: the date of each try-on, the piece tried on, its outcome (succeeded or failed), the error code if any, the credits consumed and the duration.",
          "Your age status: adult or minor, and the date of that declaration. Your date of birth is used only for the calculation: it is never kept.",
          "Your consent: the version accepted, its date and, where applicable, the date it was withdrawn.",
          "Your reports, without any image: the piece concerned, the reason chosen (“Offensive or inappropriate image”, “Not the right piece”, “Poor-quality result” or “Something else”), an optional comment of at most 500 characters and the date. You can only report a piece you have tried on.",
          "Bonus try-ons granted to you: for each grant, the order reference, the number of bonus try-ons (5), the number remaining, the grant date and the expiry date (365 days later). Today, only our team can grant them.",
        ],
        "How many try-ons: a free account has 5 try-ons per calendar month, reset on the 1st of each month at 12 am (Paris time), then its bonus try-ons, those expiring soonest first. A try-on is only counted if it succeeds: a refused or failed try-on costs you nothing. The count uses the usage information above, with no additional data.",
        `As for the rest of ${BRAND}, our server receives the usual technical data of a request (IP address, technical information), which appear in its logs. Your photo and the resulting image never appear in them, nor in error reports. No try-on data is sent to usage statistics.`,
        "Who receives them:",
        [
          "FASHN, in the United Kingdom: receives your photo and the piece's image, creates the image with its virtual try-on model and returns it to our server. FASHN acts on our behalf, as a processor. Neither your name, nor your email address, nor any identifier of your account is sent to it.",
          "FASHN's sub-processors, some of them located in the United States and in Asia. FASHN publishes their list on its website.",
          "Render, which hosts our server in the European Union (Frankfurt): your photo and the resulting image pass through it, in memory only.",
          "Supabase, which hosts our database: only the information described above, never your photo or the resulting image.",
        ],
        "Outside the European Union: the transfer to the United Kingdom, where FASHN is established, relies on the European Commission's decision recognising that country as providing an adequate level of protection. Transfers to the United States and Asia, where some of FASHN's sub-processors are located, rely on the safeguards provided for in FASHN's data processing agreement, such as the European Commission's standard contractual clauses. For Render and Supabase, see “Transfers outside the European Union”.",
        `How long, at ${BRAND}:`,
        [
          "Your photo and the resulting image: no retention. They stay in memory only during processing, and are never written to a database, a storage service, a disk, logs or error reports.",
          "Usage information and your reports: 12 months, then automatic deletion.",
          "Bonus try-ons: deleted 12 months after they expire.",
          "Your age status and your consent: as long as your account exists.",
          "When you delete your account, all of the above is deleted with it. Only anonymous monthly counters (credits consumed and number of successful try-ons per month), not linked to any member, remain.",
        ],
        "How long, at FASHN, according to its public documentation:",
        [
          "the temporary copy of your photo is deleted when the request ends, and within one day at the latest by an automatic clean-up;",
          `the resulting image remains retrievable for 60 minutes after processing ends, only with ${BRAND}'s access key, then it expires;`,
          `a record of the request, without your photo (date, model, settings, public address of the piece's image, outcome and error if any), is kept until ${BRAND} asks for its deletion;`,
          "FASHN does not use its customers' content to train its AI models, unless they separately agree to it.",
        ],
        `Your rights: your try-on data is included in your data export (Settings → Export my data). If your age status is wrong, write to us: ${PUBLISHER_EN.email}. Deleting your account erases all your try-on data. You can also object to processing, or ask for its restriction or portability, where these rights apply (see “Your rights”).`,
        "An image flagged as AI-generated: every resulting image carries a visible band reading “AI-generated image” (in the language of the app) and metadata embedded in the file (“DigitalSourceType = trainedAlgorithmicMedia”, IPTC vocabulary), which allows software to recognise an AI-generated image. Do not remove this band, and never present the image as a real photo.",
      ],
    },
  ],
  bases: [`Creating a virtual photo try-on, on the website: your consent, which you can withdraw at any time (see “${TRYON_TITLE_EN}”).`],
  providers: [
    `FASHN (United Kingdom): creation of the virtual photo try-on, with its own sub-processors, some of them in the United States and in Asia; only if you use it (see “${TRYON_TITLE_EN}”).`,
  ],
  transfers: [
    `if you use the virtual photo try-on: your photo and the piece's image, sent to FASHN, in the United Kingdom, and to some of its sub-processors, in the United States and in Asia (see “${TRYON_TITLE_EN}”);`,
  ],
  retention: [`Virtual photo try-on data: see “${TRYON_TITLE_EN}”. Your photo and the resulting image are never kept by ${BRAND}.`],
  rights: ["Withdraw your consent to the virtual photo try-on: Settings → Your data."],
  age: [`The virtual photo try-on, on the website, is reserved for people aged 18 and over. You are asked for your date of birth once: only your “adult” or “minor” status is kept (see “${TRYON_TITLE_EN}”).`],
};
