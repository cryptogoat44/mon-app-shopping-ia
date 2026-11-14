// Essayage virtuel photo (site) : la fenêtre du parcours, ouverte par le
// bouton « Essayer » d'une fiche, sans nouvelle adresse (aucun écran sous
// src/app/ : ceux-là partent dans l'app iPhone). Elle relit le statut à
// l'ouverture, puis enchaîne porte d'âge, consentement, photo, essai et
// résultat (étapes : lib/tryon-flow.web.ts). La photo et l'image produite ne
// vivent qu'en mémoire : leurs adresses blob: sont libérées à la fermeture,
// un essai en cours est abandonné, rien n'est écrit dans le navigateur
// (ni localStorage, ni IndexedDB). Aucun partage vers le fil ou une
// publication, aucun suivi d'usage. Fichier .web : jamais dans l'app iPhone.
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { color, font, size, space } from "@/theme/tokens";
import { themedStyles } from "@/theme/themed-styles";
import { getActiveLocale } from "@/i18n";
import { tryonText } from "@/i18n/tryon.web";
import { useAuth } from "@/lib/auth-context";
import { acceptTryonConsent, runTryon, submitBirthDate } from "@/lib/tryon-api.web";
import {
  LOADING,
  failureNeedsCounter,
  failureNeedsStatus,
  failureOf,
  failureView,
  parisDay,
  photoRefusalMessage,
  quotaMessage,
  tryonFlow,
  type TryonFailure,
} from "@/lib/tryon-flow.web";
import { downloadImage, jpegBlobFromDataUri, tryonFileName } from "@/lib/tryon-image.web";
import { chooseTryonFile, preparePhoto, type PhotoRefusal, type PreparedPhoto } from "@/lib/tryon-photo.web";
import { refreshTryonStatus, tryonStatus, updateTryonStatus } from "@/lib/tryon-status.web";
import { useTryonStatus } from "@/lib/use-tryon-status.web";
import { AgeStep, ConsentReloadStep, ConsentStep, LoadFailedStep, LoadingStep, MinorStep, UnavailableStep } from "./tryon-steps.web";
import { PhotoStep, RunningStep } from "./tryon-photo-step.web";
import { ResultStep } from "./tryon-result.web";

/** Au-delà, l'essai est abandonné côté site. Le serveur abandonne le sien au
 * plus tard 100 s après l'avoir réservé (un seul délai pour tout l'appel au
 * fournisseur, repli compris : routes/tryon.ts) ; les 20 s de plus couvrent
 * l'envoi de la photo, le bandeau et le décompte. Abandonné quand même : les
 * essais restants sont relus, et le message dit que l'essai a pu être
 * décompté. */
const CLIENT_TIMEOUT_MS = 120_000;

interface ChosenPhoto {
  blob: Blob;
  /** Adresse blob: de l'aperçu, libérée dès qu'elle ne sert plus. */
  url: string;
}

/** Adresses blob: créées par la fenêtre : chacune est libérée quand elle ne
 * sert plus, et toutes à la fermeture. */
function useBlobUrls() {
  const urls = useRef<Set<string>>(new Set());
  useEffect(() => {
    const created = urls.current;
    return () => {
      for (const url of created) URL.revokeObjectURL(url);
      created.clear();
    };
  }, []);
  return useMemo(
    () => ({
      create(blob: Blob): string {
        const url = URL.createObjectURL(blob);
        urls.current.add(url);
        return url;
      },
      revoke(url: string | null | undefined): void {
        if (url && urls.current.delete(url)) URL.revokeObjectURL(url);
      },
    }),
    []
  );
}

export function TryonSheet({ itemId, title, onClose }: { itemId: string; title: string; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const status = useTryonStatus();
  const [flow, dispatch] = useReducer(tryonFlow, LOADING);
  const blobs = useBlobUrls();
  const [photo, setPhoto] = useState<ChosenPhoto | null>(null);
  const [attested, setAttested] = useState(false);
  const [refusal, setRefusal] = useState<PhotoRefusal | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  // Valeurs lues après une attente (réponse du serveur) : les dernières, pas celles du rendu de départ.
  const photoRef = useRef<ChosenPhoto | null>(null);
  const resultRef = useRef<string | null>(null);
  const running = useRef<AbortController | null>(null);
  // Double appui avant le nouveau rendu : une seule demande part (porte d'âge, consentement).
  const acting = useRef(false);
  const mounted = useRef(false);
  const owner = useRef(userId);

  // Fermeture : l'essai en cours est abandonné (les adresses blob: sont libérées par useBlobUrls).
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      running.current?.abort();
    };
  }, []);

  // Autre compte (ou déconnexion) : la fenêtre se ferme, rien n'est montré au compte suivant.
  useEffect(() => {
    if (userId !== owner.current) onClose();
  }, [userId, onClose]);

  const reload = useCallback(async () => {
    dispatch({ type: "reload" });
    try {
      const fresh = await refreshTryonStatus();
      if (mounted.current) dispatch({ type: "status", status: fresh });
    } catch (e) {
      if (mounted.current) dispatch({ type: "load_failed", failure: failureOf(e) });
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  /** Refus d'une action : s'il change l'état (fonction coupée, âge, consentement), le statut relu décide de l'étape. */
  async function settleFailure(error: unknown): Promise<TryonFailure> {
    const failure = failureOf(error);
    if (!failureNeedsStatus(failure)) {
      dispatch({ type: "failed", failure });
      return failure;
    }
    try {
      const fresh = await refreshTryonStatus();
      if (mounted.current) dispatch({ type: "status", status: fresh, cause: failure });
    } catch (e) {
      if (mounted.current) dispatch({ type: "load_failed", failure: failureOf(e) });
    }
    return failure;
  }

  /** Porte d'âge ou consentement : une action à la fois, puis l'étape suit l'état mis à jour. */
  async function act(action: () => Promise<void>) {
    if (acting.current) return;
    acting.current = true;
    setSubmitting(true);
    try {
      await action();
      if (mounted.current) dispatch({ type: "status", status: tryonStatus() });
    } catch (e) {
      if (mounted.current) await settleFailure(e);
    } finally {
      acting.current = false;
      if (mounted.current) setSubmitting(false);
    }
  }

  function confirmBirthDate(birthDate: string) {
    void act(async () => updateTryonStatus({ ageGate: await submitBirthDate(birthDate) }));
  }

  function acceptConsent(version: string) {
    void act(async () => updateTryonStatus({ consent: await acceptTryonConsent(version) }));
  }

  /** Nouvelle photo (ou aucune) : l'ancien aperçu est libéré, la case est à recocher. */
  function replacePhoto(next: PreparedPhoto | null) {
    blobs.revoke(photoRef.current?.url);
    const chosen = next ? { blob: next.blob, url: blobs.create(next.blob) } : null;
    photoRef.current = chosen;
    setPhoto(chosen);
    setAttested(false);
  }

  /** Appelée directement par l'appui : le navigateur n'ouvre le choix du fichier qu'à la suite d'un geste. */
  async function choosePhoto() {
    const file = await chooseTryonFile();
    if (!file || !mounted.current) return;
    setPreparing(true);
    setRefusal(null);
    dispatch({ type: "dismiss" });
    const choice = await preparePhoto(file);
    if (!mounted.current) return;
    setPreparing(false);
    if (choice.kind === "refused") {
      replacePhoto(null);
      setRefusal(choice.reason);
      return;
    }
    replacePhoto(choice.photo);
  }

  async function launch() {
    const chosen = photoRef.current;
    // `running` est posé avant toute attente : un second appui ne relance rien.
    if (running.current || !chosen || !attested || flow.step !== "photo") return;
    dispatch({ type: "run" });
    const controller = new AbortController();
    running.current = controller;
    const timer = setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);
    try {
      const result = await runTryon({ itemId, photo: chosen.blob, attestSelf: true, signal: controller.signal });
      if (!mounted.current) return;
      updateTryonStatus({ remaining: result.remaining });
      const image = jpegBlobFromDataUri(result.image);
      if (!image) {
        dispatch({ type: "failed", failure: { kind: "unexpected" } });
        return;
      }
      // Essai réussi : la photo n'a plus de raison de rester en mémoire.
      replacePhoto(null);
      const url = blobs.create(image);
      resultRef.current = url;
      setResultUrl(url);
      dispatch({ type: "succeeded", remaining: result.remaining });
    } catch (e) {
      if (!mounted.current) return;
      let failure: TryonFailure;
      if (controller.signal.aborted) {
        // Pas de réponse dans le délai du site : l'essai a pu aboutir sur le
        // serveur, et y être décompté (le message le dit).
        failure = { kind: "no_answer" };
        dispatch({ type: "failed", failure });
      } else {
        failure = await settleFailure(e);
      }
      // Issue incertaine, ou quota épuisé : les compteurs affichés suivent ce
      // que le serveur a vraiment décompté (sans attendre).
      if (failureNeedsCounter(failure)) refreshTryonStatus().catch(() => {});
    } finally {
      clearTimeout(timer);
      if (running.current === controller) running.current = null;
    }
  }

  function tryAnother() {
    blobs.revoke(resultRef.current);
    resultRef.current = null;
    setResultUrl(null);
    dispatch({ type: "again" });
  }

  /** Texte du consentement mis à jour depuis l'ouverture de la page : la recharger l'apporte. */
  function reloadPage() {
    window.location.reload();
  }

  function saveImage() {
    if (resultUrl) downloadImage(resultUrl, tryonFileName(tryonText.result.fileBase, parisDay(new Date())));
  }

  const locale = getActiveLocale();
  const messageOf = (failure: TryonFailure | null) => (failure ? failureView(failure, status, locale).message : null);

  function renderStep() {
    switch (flow.step) {
      case "loading":
        return <LoadingStep />;
      case "load_failed":
        return <LoadFailedStep message={failureView(flow.failure, status, locale).message} onRetry={() => void reload()} onClose={onClose} />;
      case "unavailable":
        return <UnavailableStep onClose={onClose} />;
      case "age":
        return <AgeStep failure={messageOf(flow.failure)} busy={submitting} onSubmit={confirmBirthDate} />;
      case "minor":
        return <MinorStep onClose={onClose} />;
      case "consent": {
        // La version du texte affiché ici (jamais celle annoncée par le serveur).
        const version = flow.version;
        return <ConsentStep renewed={flow.renewed} failure={messageOf(flow.failure)} busy={submitting} onAccept={() => acceptConsent(version)} onCancel={onClose} />;
      }
      case "consent_reload":
        return <ConsentReloadStep onReload={reloadPage} onClose={onClose} />;
      case "photo":
        return (
          <PhotoStep
            remaining={status.enabled ? status.remaining : null}
            quotaText={quotaMessage(status, locale)}
            photoUrl={photo?.url ?? null}
            attested={attested}
            preparing={preparing}
            refusal={refusal ? photoRefusalMessage(refusal) : null}
            failure={flow.failure ? failureView(flow.failure, status, locale) : null}
            onChoose={() => void choosePhoto()}
            onToggleAttest={() => setAttested(!attested)}
            onLaunch={() => void launch()}
          />
        );
      case "running":
        return <RunningStep />;
      case "result":
        return resultUrl ? <ResultStep itemId={itemId} imageUrl={resultUrl} remaining={flow.remaining} onSave={saveImage} onAnother={tryAnother} onClose={onClose} /> : null;
    }
  }

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={[styles.screen, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <View style={styles.header}>
          <Text style={styles.heading}>{tryonText.sheet.title}</Text>
          <Pressable onPress={onClose} hitSlop={12} style={styles.close} accessibilityRole="button" accessibilityLabel={tryonText.sheet.close}>
            <Text style={styles.closeLabel}>{tryonText.sheet.close}</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={styles.piece} numberOfLines={2}>
            {title}
          </Text>
          {renderStep()}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = themedStyles(() => ({
  screen: { flex: 1, backgroundColor: color.porcelaine },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 52,
    paddingHorizontal: space.lg,
    borderBottomWidth: 1,
    borderBottomColor: color.filet,
  },
  heading: { fontSize: font.secondary, fontWeight: "600", color: color.acier },
  close: { minHeight: size.touchTarget, minWidth: size.touchTarget, alignItems: "flex-end", justifyContent: "center" },
  closeLabel: { fontSize: font.secondary, fontWeight: "600", color: color.vert },
  content: { padding: space.lg, paddingBottom: space.xxl, maxWidth: size.contentMaxWidth, alignSelf: "center", width: "100%" },
  piece: { fontSize: font.caption, color: color.acier, marginBottom: space.sm },
}));
