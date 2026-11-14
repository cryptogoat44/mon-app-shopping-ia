// Essayage virtuel photo, app iPhone (branche feature/essayage-virtuel-mobile,
// jamais fusionnée) : la fenêtre du parcours, ouverte par « Essayer » d'une
// fiche, sans nouvel écran (rien sous src/app/). Même parcours que sur le
// site (tryon-sheet.web.tsx), avec les mêmes étapes, les mêmes textes et les
// mêmes règles : statut relu à l'ouverture, porte d'âge, consentement, photo,
// essai, résultat (étapes : lib/tryon-flow.web.ts). Ce qui change sur
// l'iPhone : la photo vient de la photothèque ou de l'appareil photo et
// devient un JPEG sur l'iPhone (lib/tryon-photo.ios.ts) ; l'image produite
// est affichée depuis la mémoire, jamais écrite ; « Enregistrer l'image »
// l'ajoute à Photos ; un texte de consentement plus récent que celui de
// l'app demande une mise à jour de l'app. Fichiers temporaires : chacun
// effacé dès qu'il ne sert plus, et le dossier de l'essayage vidé à
// l'ouverture comme à la fermeture (lib/tryon-files.ios.ts). Fermer abandonne
// l'essai en cours. Aucun partage vers le fil ou une publication, aucun
// suivi d'usage.
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { AccessibilityInfo, Modal, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { color, font, size, space } from "@/theme/tokens";
import { themedStyles } from "@/theme/themed-styles";
import { getActiveLocale } from "@/i18n";
import { tryonText } from "@/i18n/tryon.ios";
import { useAuth } from "@/lib/auth-context";
import { acceptTryonConsent, runTryon, submitBirthDate } from "@/lib/tryon-api.ios";
import { LOADING, failureNeedsCounter, failureNeedsStatus, failureOf, failureView, quotaMessage, tryonFlow, type TryonFailure } from "@/lib/tryon-flow.ios";
import { discardTryonFile, sweepTryonFiles } from "@/lib/tryon-files.ios";
import { iphonePhotoRefusalMessage, photoBody, pickTryonPhoto, prepareTryonPhoto, type IphonePhotoRefusal, type PhotoSource, type TryonPhoto } from "@/lib/tryon-photo.ios";
import { refreshTryonStatus, tryonStatus, updateTryonStatus } from "@/lib/tryon-status.ios";
import { useTryonStatus } from "@/lib/use-tryon-status.ios";
import { AgeStep, ConsentStep, ConsentUpdateStep, LoadFailedStep, LoadingStep, MinorStep, UnavailableStep } from "./tryon-steps.ios";
import { PhotoStep, RunningStep } from "./tryon-photo-step.ios";
import { ResultStep } from "./tryon-result.ios";

/** Au-delà, l'essai est abandonné côté app : le même délai que le site
 * (tryon-sheet.web.tsx, qui en donne la raison), au-dessus de celui du
 * serveur ; tests/tryon-platforms.test.ts vérifie qu'ils restent égaux.
 * Abandonné quand même : les essais restants sont relus, et le message dit
 * que l'essai a pu être décompté. */
const CLIENT_TIMEOUT_MS = 120_000;

export function TryonSheet({ itemId, title, onClose }: { itemId: string; title: string; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const status = useTryonStatus();
  const [flow, dispatch] = useReducer(tryonFlow, LOADING);
  const [photo, setPhoto] = useState<TryonPhoto | null>(null);
  const [attested, setAttested] = useState(false);
  const [refusal, setRefusal] = useState<IphonePhotoRefusal | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // L'image produite (adresse « data: »), en mémoire seulement.
  const [result, setResult] = useState<string | null>(null);
  // Valeurs lues après une attente (sélecteur, réponse du serveur) : les dernières, pas celles du rendu de départ.
  const photoRef = useRef<TryonPhoto | null>(null);
  const running = useRef<AbortController | null>(null);
  // Double appui avant le nouveau rendu : une seule demande part (porte d'âge, consentement), un seul sélecteur s'ouvre.
  const acting = useRef(false);
  const picking = useRef(false);
  const mounted = useRef(false);
  const owner = useRef(userId);

  // Ouverture : les restes d'une fenêtre précédente (app fermée de force)
  // sont effacés. Fermeture : l'essai en cours est abandonné, puis la photo
  // et tout autre fichier de l'essayage sont effacés.
  useEffect(() => {
    mounted.current = true;
    sweepTryonFiles();
    return () => {
      mounted.current = false;
      running.current?.abort();
      photoRef.current = null;
      sweepTryonFiles();
    };
  }, []);

  // Autre compte (ou déconnexion) : la fenêtre se ferme, rien n'est montré au compte suivant.
  useEffect(() => {
    if (userId !== owner.current) onClose();
  }, [userId, onClose]);

  // VoiceOver : l'attente et le résultat sont annoncés (les refus le sont par ErrorMessage).
  useEffect(() => {
    if (flow.step === "running") AccessibilityInfo.announceForAccessibility(tryonText.running.title);
    if (flow.step === "result") AccessibilityInfo.announceForAccessibility(tryonText.result.title);
  }, [flow.step]);

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

  /** Nouvelle photo (ou aucune) : la case est à recocher, et le fichier de l'ancienne est effacé. */
  function replacePhoto(next: TryonPhoto | null) {
    const previous = photoRef.current;
    photoRef.current = next;
    setPhoto(next);
    setAttested(false);
    if (previous && previous.uri !== next?.uri) discardTryonFile(previous.uri);
  }

  /** Photothèque ou appareil photo, puis conversion sur l'iPhone. */
  async function choosePhoto(source: PhotoSource) {
    if (picking.current || running.current) return;
    picking.current = true;
    try {
      const pick = await pickTryonPhoto(source);
      if (!mounted.current) {
        // Fenêtre fermée pendant le choix : la copie remise ne servira pas.
        if (pick.kind === "picked") discardTryonFile(pick.picked.uri);
        return;
      }
      if (pick.kind === "cancelled") return;
      if (pick.kind === "refused") {
        // Aucune nouvelle photo (appareil photo refusé ou absent, photo restée sur iCloud) : la précédente reste.
        setRefusal(pick.reason);
        return;
      }
      setPreparing(true);
      setRefusal(null);
      dispatch({ type: "dismiss" });
      const prepared = await prepareTryonPhoto(pick.picked);
      if (!mounted.current) {
        if (prepared.kind === "ready") discardTryonFile(prepared.photo.uri);
        return;
      }
      setPreparing(false);
      if (prepared.kind === "refused") {
        replacePhoto(null);
        setRefusal(prepared.reason);
        return;
      }
      replacePhoto(prepared.photo);
    } finally {
      picking.current = false;
    }
  }

  async function launch() {
    const chosen = photoRef.current;
    // `running` est posé avant toute attente : un second appui ne relance rien.
    if (running.current || picking.current || !chosen || !attested || flow.step !== "photo") return;
    dispatch({ type: "run" });
    const controller = new AbortController();
    running.current = controller;
    const timer = setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);
    try {
      const response = await runTryon({ itemId, photo: photoBody(chosen), attestSelf: true, signal: controller.signal });
      if (!mounted.current) return;
      updateTryonStatus({ remaining: response.remaining });
      // Essai réussi : la photo n'a plus de raison de rester, ni en mémoire ni sur l'iPhone.
      replacePhoto(null);
      setResult(response.image);
      dispatch({ type: "succeeded", remaining: response.remaining });
    } catch (e) {
      if (!mounted.current) return;
      let failure: TryonFailure;
      if (controller.signal.aborted) {
        // Pas de réponse dans le délai de l'app : l'essai a pu aboutir sur le
        // serveur, et y être décompté (le message le dit). Sur iPhone, un
        // abandon arrive comme une coupure du réseau : vérifié d'abord.
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

  /** « Essayer une autre photo » : l'image produite quitte la mémoire. */
  function tryAnother() {
    setResult(null);
    dispatch({ type: "again" });
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
        return <ConsentUpdateStep onClose={onClose} />;
      case "photo":
        return (
          <PhotoStep
            remaining={status.enabled ? status.remaining : null}
            quotaText={quotaMessage(status, locale)}
            photoUri={photo?.uri ?? null}
            attested={attested}
            preparing={preparing}
            refusal={refusal ? iphonePhotoRefusalMessage(refusal) : null}
            failure={flow.failure ? failureView(flow.failure, status, locale) : null}
            onLibrary={() => void choosePhoto("library")}
            onCamera={() => void choosePhoto("camera")}
            onToggleAttest={() => setAttested(!attested)}
            onLaunch={() => void launch()}
          />
        );
      case "running":
        return <RunningStep />;
      case "result":
        return result ? <ResultStep itemId={itemId} imageUri={result} remaining={flow.remaining} onAnother={tryAnother} onClose={onClose} /> : null;
    }
  }

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={[styles.screen, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <View style={styles.header}>
          <Text style={styles.heading} accessibilityRole="header">
            {tryonText.sheet.title}
          </Text>
          <Pressable onPress={onClose} hitSlop={12} style={styles.close} accessibilityRole="button" accessibilityLabel={tryonText.sheet.close}>
            <Text style={styles.closeLabel}>{tryonText.sheet.close}</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
          <Text style={styles.piece} numberOfLines={2}>
            {title}
          </Text>
          {renderStep()}
        </ScrollView>
      </View>
    </Modal>
  );
}

// Même présentation que sur le site (tryon-sheet.web.tsx).
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
