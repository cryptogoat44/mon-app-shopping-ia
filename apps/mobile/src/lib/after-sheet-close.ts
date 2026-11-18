// Ouvrir une fenêtre (Modal) juste après en avoir fermé une autre. Sur
// iPhone, une fenêtre demandée pendant que la précédente se referme n'est
// jamais montrée, et l'écran reste ensuite bloqué. La suite attend donc que
// la première ait fini de se fermer (`flush`, appelé par son `onDismiss`),
// avec un secours si cette fin n'est jamais signalée. Sur le site, rien à
// attendre : la suite part tout de suite. Même règle que le choix d'une photo
// de profil (components/avatar-photo-flow.tsx).

/** Secours : délai après lequel la suite part même sans signal de fermeture. */
export const SHEET_CLOSE_FALLBACK_MS = 700;

export interface AfterSheetClose {
  /** La suite à lancer une fois la feuille fermée (remplace une suite encore en attente). */
  schedule(run: () => void): void;
  /** La feuille a fini de se fermer : la suite en attente part, une seule fois. */
  flush(): void;
  /** L'écran est quitté : rien ne part plus. */
  cancel(): void;
}

export function afterSheetClose(immediate: boolean, fallbackMs: number = SHEET_CLOSE_FALLBACK_MS): AfterSheetClose {
  let pending: (() => void) | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function cancel() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    pending = null;
  }

  function flush() {
    const run = pending;
    cancel();
    if (run) run();
  }

  return {
    schedule(run) {
      cancel();
      if (immediate) {
        run();
        return;
      }
      pending = run;
      timer = setTimeout(flush, fallbackMs);
    },
    flush,
    cancel,
  };
}
