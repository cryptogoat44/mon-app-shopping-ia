-- Lot 4, temps 1 bis : consentement « analyse automatique de la vidéo »
-- (quelques images réduites envoyées à un prestataire d'IA, Anthropic,
-- uniquement pour trouver la pièce, sans conservation). Facultatif, comme
-- « statistiques » : chaque choix (accord, refus ou retrait) est un nouvel
-- événement daté et versionné. Aucune donnée existante modifiée.
alter type consent_type add value if not exists 'analyse_video_ia';
