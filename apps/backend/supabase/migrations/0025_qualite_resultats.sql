-- Fiabilité des résultats, phase 1 (décisions du fondateur, 2026-10-15). Une
-- seule migration pour les deux parties :
-- (a) la mesure de chaque recherche : des nombres et des valeurs d'une liste
--     fermée, rangés avec la recherche, donc gardés comme elle (12 mois au
--     plus), exportés et effacés avec le compte. Jamais d'image, de titre,
--     d'adresse ni de texte ;
-- (c) le bouton « Résultat incohérent » : un signalement par proposition et
--     par personne, avec un motif parmi cinq ; 30 par jour au plus et par
--     personne, comptés par le serveur dans cette table.
-- Rejouable sans effet (if not exists).

-- ---- (a) Mesure de chaque recherche ----
-- outcome : found (au moins une proposition gardée), nothing_buyable (Google
-- a répondu, tout a été écarté), empty_lens (Google n'a rien renvoyé), failure
-- (panne, avec failure_kind). refused_before_call : lancements refusés avant
-- l'appel (image illisible, zone trop petite, aperçu indisponible), sans crédit.
alter table product_searches
  add column if not exists outcome text check (outcome in ('found', 'nothing_buyable', 'empty_lens', 'failure')),
  add column if not exists failure_kind text check (failure_kind in ('timeout', 'serpapi_error', 'unreadable_response', 'save_failed')),
  add column if not exists received_count smallint check (received_count >= 0),
  add column if not exists removed_incomplete smallint check (removed_incomplete >= 0),
  add column if not exists removed_social smallint check (removed_social >= 0),
  add column if not exists removed_professional smallint check (removed_professional >= 0),
  add column if not exists removed_duplicates smallint check (removed_duplicates >= 0),
  add column if not exists kept_count smallint check (kept_count >= 0),
  add column if not exists kept_with_price smallint check (kept_with_price >= 0),
  add column if not exists kept_other_currency smallint check (kept_other_currency >= 0),
  add column if not exists distinct_sites smallint check (distinct_sites >= 0),
  add column if not exists lens_sections text[] check (lens_sections <@ array['visual_matches', 'related_content', 'ai_overview', 'organic_results', 'other']::text[]),
  add column if not exists google_state text check (google_state in ('empty', 'other')),
  add column if not exists crop_area_pct smallint check (crop_area_pct between 0 and 100),
  add column if not exists call_seconds smallint check (call_seconds >= 0),
  add column if not exists refused_before_call smallint not null default 0 check (refused_before_call >= 0);

-- ---- (c) Signalements « Résultat incohérent » ----
-- Motifs (validés par le fondateur, 2026-10-15) : l'image et le titre ne
-- correspondent pas ; ce n'est pas la pièce cherchée ; impossible à acheter ;
-- prix faux ou absent ; doublon d'une autre proposition. Effacé avec la
-- proposition (donc avec la recherche, 12 mois au plus) ou avec le compte.
create table if not exists match_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  match_id uuid not null references product_matches(id) on delete cascade,
  reason text not null check (reason in ('image_title_mismatch', 'wrong_item', 'not_for_sale', 'wrong_price', 'duplicate')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, match_id)
);
-- Un index par clé étrangère (charte, règle 16) ; le premier sert aussi au
-- compte des signalements du jour.
create index if not exists match_feedback_user_created_idx on match_feedback (user_id, created_at);
create index if not exists match_feedback_match_idx on match_feedback (match_id);
-- Protection ligne par ligne sans aucune règle : seul le serveur, avec sa clé
-- secrète, lit et écrit cette table.
alter table match_feedback enable row level security;

notify pgrst, 'reload schema';
