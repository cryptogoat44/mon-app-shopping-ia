import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Image, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { Stack, useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { PEOPLE_TAGS_MAX, POST_PHOTOS_MAX, type PrivacyLevel, type PublicProfile, type VaultItem } from "@monapp/shared-types";
import { useAuth } from "@/lib/auth-context";
import { ApiError, addPostPhoto, createLifestylePost, fetchVault, searchUsers, sharePurchasePost } from "@/lib/api";
import { usePostExtrasStatus } from "@/lib/use-post-extras-status";
import {
  UPLOAD_IDLE,
  isRetryableUploadError,
  mergePicked,
  photoAdded,
  photoFailed,
  postCreated,
  remainingSlots,
  removePhotoAt,
  retryPhoto,
  skipPhoto,
  startUpload,
  uploadBusy,
  uploadMessage,
  type UploadState,
} from "@/lib/post-upload";
import { Avatar } from "@/components/avatar";
import { PrivateAccountNote } from "@/components/private-account-note";
import { SpotImage } from "@/components/spot-image";
import { PRIVACY_LEVELS } from "@/lib/vault-labels";
import { color, font, radius, size, space } from "@/theme/tokens";
import { t } from "@/i18n";
import { getRecentlySpotted } from "@/api/client";
import type { Piece } from "@/api/types";
import { CameraIcon } from "@/components/icons";
import { useToast } from "@/lib/toast-context";
import { ErrorMessage } from "@/components/error-message";
import { themedStyles } from "@/theme/themed-styles";

// iPhone : pendant l'envoi (la publication, puis les photos 2 à 5), la
// feuille ne se ferme pas non plus en la glissant vers le bas, comme
// « Annuler » (vault-item/new.tsx fait de même). Deux objets fixes : les
// options de l'écran ne changent qu'au début et à la fin d'un envoi.
const SHEET_OPEN = { gestureEnabled: true };
const SHEET_LOCKED = { gestureEnabled: false };

export default function NewPostScreen() {
  const router = useRouter();
  const { profile } = useAuth();
  const { showToast } = useToast();
  // Feuille quittée pendant l'envoi (retour du navigateur, sur le site) :
  // l'envoi va au bout sans elle. À la fin, un message flottant, sans
  // naviguer (on retirerait l'écran ouvert entre-temps) ; une photo manquée
  // arrête la suite, et le message le dit.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  function safeBack() {
    if (router.canGoBack()) router.back();
    else router.replace("/profile");
  }
  const [caption, setCaption] = useState("");
  const [privacy, setPrivacy] = useState<PrivacyLevel>(profile?.defaultPrivacy ?? "followers");
  // Plusieurs photos et identifications (migration 0047), seulement si le serveur sait les garder.
  const extras = usePostExtrasStatus();
  const [photos, setPhotos] = useState<string[]>([]);
  const imageUri = photos[0] ?? null;
  const [people, setPeople] = useState<PublicProfile[]>([]);
  const [peopleOpen, setPeopleOpen] = useState(false);
  const [peopleQuery, setPeopleQuery] = useState("");
  const [peopleResults, setPeopleResults] = useState<PublicProfile[] | null>(null);
  const [upload, setUpload] = useState<UploadState>(UPLOAD_IDLE);
  // Les photos de l'envoi en cours, figées au moment de « Publier ».
  const sending = useRef<string[]>([]);
  const [pieces, setPieces] = useState<Piece[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [recentPieces, setRecentPieces] = useState<Piece[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Lot F : une publication « achat » se fait aussi d'ici, à partir d'une
  // pièce du Vault (auparavant seulement depuis le détail de la pièce).
  const [mode, setMode] = useState<"photo" | "vault">("photo");
  const [vaultItems, setVaultItems] = useState<VaultItem[] | null>(null);
  const [vaultItemId, setVaultItemId] = useState<string | null>(null);

  function chooseMode(next: "photo" | "vault") {
    setMode(next);
    setError(null);
    if (next === "vault" && vaultItems === null) {
      fetchVault()
        .then((page) => setVaultItems(page.items))
        .catch(() => {
          setVaultItems([]);
          setError(t.publish.vaultLoadError);
        });
    }
  }

  async function handlePickPhoto() {
    // Aucune autorisation demandée : le sélecteur ne remet que les photos choisies.
    if (extras.carousel) {
      const slots = remainingSlots(photos);
      if (slots === 0) return;
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        quality: 0.8,
        allowsMultipleSelection: true,
        selectionLimit: slots,
        orderedSelection: true,
      });
      if (result.canceled) return;
      setPhotos((current) => mergePicked(current, result.assets.map((asset) => asset.uri)));
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.8 });
    if (result.canceled || !result.assets[0]) return;
    setPhotos([result.assets[0].uri]);
  }

  // Identifier des personnes : la recherche de membres, après une courte pause de frappe.
  useEffect(() => {
    if (!peopleOpen) return;
    const query = peopleQuery.trim();
    if (query.length < 2) {
      setPeopleResults(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      searchUsers(query)
        .then((found) => {
          if (!cancelled) setPeopleResults(found);
        })
        .catch(() => {
          if (!cancelled) setPeopleResults([]);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [peopleQuery, peopleOpen]);

  function addPerson(person: PublicProfile) {
    setPeople((current) => (current.some((p) => p.id === person.id) || current.length >= PEOPLE_TAGS_MAX ? current : [...current, person]));
    setPeopleOpen(false);
    setPeopleQuery("");
    setPeopleResults(null);
  }

  function removePerson(id: string) {
    setPeople((current) => current.filter((p) => p.id !== id));
  }

  function finishPublishing() {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    showToast(t.publish.published);
    setUpload(UPLOAD_IDLE);
    if (mountedRef.current) safeBack();
  }

  /** Les photos 2 à 5, l'une après l'autre ; s'arrête sur une photo manquée (l'écran propose alors la suite). */
  async function continueUpload(start: UploadState) {
    let state = start;
    while (state.step === "adding") {
      try {
        await addPostPhoto(state.postId, sending.current[state.index - 1]!);
        state = photoAdded(state);
      } catch (e) {
        state = photoFailed(state, isRetryableUploadError(e));
      }
      setUpload(state);
    }
    if (state.step === "done") finishPublishing();
    // Plus d'écran pour proposer « Réessayer » : la publication reste avec les photos déjà envoyées.
    else if (state.step === "failed" && !mountedRef.current) showToast(t.carousel.uploadStopped);
  }

  function openPicker() {
    setPickerOpen(true);
    if (recentPieces === null) {
      getRecentlySpotted()
        .then(setRecentPieces)
        .catch(() => setRecentPieces([]));
    }
  }

  function addPieceTag(piece: Piece) {
    setPieces((current) => (current.some((p) => p.id === piece.id) ? current : [...current, piece]));
    setPickerOpen(false);
  }

  function removePieceTag(id: string) {
    setPieces((current) => current.filter((p) => p.id !== id));
  }

  async function handleSubmit() {
    setError(null);
    if (mode === "vault") {
      if (!vaultItemId) {
        setError(t.publish.choosePiece);
        return;
      }
      setSubmitting(true);
      try {
        await sharePurchasePost(vaultItemId, privacy, caption.trim() || undefined);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        showToast(t.publish.published);
        if (mountedRef.current) safeBack();
      } catch (e) {
        const message = e instanceof ApiError ? e.message : t.publish.error;
        if (!mountedRef.current) showToast(message);
        else setError(message);
      } finally {
        setSubmitting(false);
      }
      return;
    }
    if (!imageUri) {
      setError(t.publish.photoRequired);
      return;
    }

    // La publication part avec la photo 1, exactement comme avant ; les
    // photos 2 à 5 lui sont ajoutées ensuite, une par une (lib/post-upload.ts).
    sending.current = extras.carousel ? photos.slice(0, POST_PHOTOS_MAX) : [imageUri];
    const creating = startUpload(sending.current.length);
    setUpload(creating);
    let postId: string;
    try {
      // Les pièces de ce picker proviennent toujours d'une recherche
      // récente (getRecentlySpotted), jamais du Vault — voir
      // docs/points-de-vigilance.md pour le sélecteur Vault, pas encore
      // ajouté à cette étape.
      const taggedPieces = pieces.map((piece) => ({ productMatchId: piece.id }));
      const peopleTags = extras.peopleTags ? people.map((person) => person.id) : [];
      postId = (await createLifestylePost({ caption: caption.trim(), imageUri, privacy, taggedPieces, peopleTags })).id;
    } catch (e) {
      const message = e instanceof ApiError ? e.message : t.publish.error;
      if (!mountedRef.current) return showToast(message);
      setUpload(UPLOAD_IDLE);
      setError(message);
      return;
    }
    const next = postCreated(creating, postId);
    setUpload(next);
    await continueUpload(next);
  }

  function retryUpload() {
    const next = retryPhoto(upload);
    setUpload(next);
    void continueUpload(next);
  }

  function skipUpload() {
    const next = skipPhoto(upload);
    setUpload(next);
    if (next.step === "done") finishPublishing();
    else void continueUpload(next);
  }

  const busy = submitting || uploadBusy(upload);
  const progress = uploadMessage(upload);
  // Ni soi-même, ni une personne déjà choisie.
  const peopleCandidates = peopleResults?.filter((person) => person.id !== profile?.id && !people.some((chosen) => chosen.id === person.id)) ?? null;

  return (
    <View style={styles.sheet}>
      <Stack.Screen options={busy ? SHEET_LOCKED : SHEET_OPEN} />
      <View style={styles.handle} />
      <View style={styles.nav}>
        <Pressable accessibilityRole="button" onPress={safeBack} disabled={busy} hitSlop={12} style={styles.navSide} accessibilityState={{ disabled: busy }}>
          <Text style={[styles.cancel, busy ? styles.publishLabelDisabled : null]}>{t.publish.cancel}</Text>
        </Pressable>
        <Text style={styles.navTitle} accessibilityRole="header">{t.publish.title}</Text>
        <Pressable
          onPress={handleSubmit}
          disabled={busy || (mode === "photo" ? !imageUri : !vaultItemId)}
          hitSlop={12}
          style={[styles.navSide, styles.navSideRight]}
          accessibilityRole="button"
          accessibilityLabel={busy ? t.publish.publishing : t.publish.publish}
        >
          <Text style={[styles.publishLabel, (busy || (mode === "photo" ? !imageUri : !vaultItemId)) ? styles.publishLabelDisabled : null]}>
            {busy ? "…" : t.publish.publish}
          </Text>
        </Pressable>
      </View>

      {/* Envoi des photos 2 à 5 : l'écran reste ouvert jusqu'à la dernière (lib/post-upload.ts). */}
      {progress ? (
        <View style={styles.progress} accessibilityLiveRegion="polite" testID="envoi-photos">
          <View style={styles.progressLine}>
            {upload.step === "failed" ? null : <ActivityIndicator color={color.encre} />}
            <Text style={styles.progressText}>{progress}</Text>
          </View>
          {upload.step === "failed" ? (
            <View style={styles.progressActions}>
              {upload.retryable ? (
                <Pressable style={styles.progressButton} onPress={retryUpload} accessibilityRole="button">
                  <Text style={styles.progressButtonLabel}>{t.common.retry}</Text>
                </Pressable>
              ) : null}
              <Pressable style={styles.progressButton} onPress={skipUpload} accessibilityRole="button">
                <Text style={styles.progressButtonLabel}>{t.carousel.publishWithout}</Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      ) : null}

      <ScrollView
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
        pointerEvents={busy ? "none" : "auto"}
      >
        {error ? <ErrorMessage style={styles.error}>{error}</ErrorMessage> : null}

        <View style={styles.modes} accessibilityRole="radiogroup">
          {(["photo", "vault"] as const).map((value) => (
            <Pressable
              key={value}
              style={[styles.mode, mode === value ? styles.modeActive : null]}
              onPress={() => chooseMode(value)}
              accessibilityRole="radio"
              accessibilityState={{ selected: mode === value }}
            >
              <Text style={[styles.modeLabel, mode === value ? styles.modeLabelActive : null]}>
                {value === "photo" ? t.publish.modePhoto : t.publish.modeVault}
              </Text>
            </Pressable>
          ))}
        </View>

        {mode === "vault" ? (
          <>
            <Text style={styles.hint}>{t.publish.vaultHint}</Text>
            {vaultItems === null ? (
              <ActivityIndicator color={color.encre} style={styles.vaultLoader} />
            ) : vaultItems.length === 0 ? (
              <Text style={styles.emptyPicker}>{t.publish.vaultEmpty}</Text>
            ) : (
              <View style={styles.vaultGrid}>
                {vaultItems.map((item) => (
                  <Pressable
                    key={item.id}
                    style={[styles.vaultCell, vaultItemId === item.id ? styles.vaultCellActive : null]}
                    onPress={() => setVaultItemId(item.id)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: vaultItemId === item.id }}
                    accessibilityLabel={item.title}
                  >
                    <View style={styles.vaultThumb}>
                      <SpotImage hdUri={item.imageHdUrl} fallbackUri={item.imageUrl} style={styles.photoPreview} fit="cover" size="small" />
                    </View>
                    <Text style={styles.vaultTitle} numberOfLines={1}>{item.title}</Text>
                  </Pressable>
                ))}
              </View>
            )}
          </>
        ) : (
        <>
        <Pressable
          style={imageUri ? styles.photoFilled : styles.photoEmpty}
          onPress={handlePickPhoto}
          disabled={extras.carousel && remainingSlots(photos) === 0}
          accessibilityRole="button"
          accessibilityLabel={extras.carousel ? (imageUri ? t.carousel.addMorePhotos : t.carousel.addPhotos) : imageUri ? t.publish.changePhoto : t.publish.addPhoto}
        >
          {imageUri ? (
            <Image source={{ uri: imageUri }} style={styles.photoPreview} accessibilityLabel={t.publish.selectedPhoto} />
          ) : (
            <>
              <CameraIcon size={30} tint={color.acier} />
              <Text style={styles.photoLabel}>{extras.carousel ? t.carousel.addPhotos : t.publish.addPhoto}</Text>
            </>
          )}
        </Pressable>
        {/* Plusieurs photos (migration 0047) : la bande des photos choisies, dans l'ordre, chacune retirable. */}
        {extras.carousel && photos.length > 0 ? (
          <View style={styles.strip}>
            {photos.map((uri, index) => (
              <View key={uri} style={styles.stripCell}>
                <Image source={{ uri }} style={styles.photoPreview} accessibilityLabel={t.carousel.position(index + 1, photos.length)} />
                <Pressable
                  style={styles.stripRemove}
                  onPress={() => setPhotos((current) => removePhotoAt(current, index))}
                  hitSlop={10}
                  accessibilityRole="button"
                  accessibilityLabel={t.carousel.removePhoto(index + 1)}
                >
                  <Text style={styles.stripRemoveLabel}>×</Text>
                </Pressable>
              </View>
            ))}
            {remainingSlots(photos) > 0 ? (
              <Pressable style={[styles.stripCell, styles.stripAdd]} onPress={handlePickPhoto} accessibilityRole="button" accessibilityLabel={t.carousel.addMorePhotos}>
                <Text style={styles.stripAddLabel}>+</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
        </>
        )}

        <TextInput
          style={styles.caption}
          placeholder={t.publish.captionPlaceholder}
          placeholderTextColor={color.acier}
          value={caption}
          onChangeText={setCaption}
          multiline
          maxLength={280}
          accessibilityLabel={t.publish.captionLabel}
        />

        {mode === "photo" ? (
        <>
        <Text style={styles.label}>{t.publish.piecesLabel}</Text>
        <View style={styles.tags}>
          {pieces.map((piece) => (
            <View key={piece.id} style={styles.tag}>
              <View style={styles.tagDot} />
              <Text style={styles.tagLabel}>{piece.name}</Text>
              <Pressable
                onPress={() => removePieceTag(piece.id)}
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel={t.publish.removePiece(piece.name)}
              >
                <Text style={styles.tagRemove}>×</Text>
              </Pressable>
            </View>
          ))}
          <Pressable accessibilityRole="button" style={styles.addTag} onPress={openPicker}>
            <Text style={styles.addTagLabel}>+ {t.publish.addPiece}</Text>
          </Pressable>
        </View>
        {/* Identifier des personnes (migration 0047) : le serveur ne garde que celles qui l'acceptent et voient la publication. */}
        {extras.peopleTags ? (
          <>
            <Text style={styles.label}>{t.carousel.tagPeople}</Text>
            <View style={styles.tags}>
              {people.map((person) => (
                <View key={person.id} style={styles.tag}>
                  <Avatar uri={person.avatarUrl} userId={person.id} displayName={person.displayName} username={person.username} size={20} />
                  <Text style={styles.tagLabel}>{person.displayName}</Text>
                  <Pressable onPress={() => removePerson(person.id)} hitSlop={12} accessibilityRole="button" accessibilityLabel={t.carousel.removePerson(person.displayName)}>
                    <Text style={styles.tagRemove}>×</Text>
                  </Pressable>
                </View>
              ))}
              {people.length < PEOPLE_TAGS_MAX ? (
                <Pressable accessibilityRole="button" style={styles.addTag} onPress={() => setPeopleOpen(true)} testID="identifier-des-personnes">
                  <Text style={styles.addTagLabel}>+ {t.carousel.tagPeople}</Text>
                </Pressable>
              ) : null}
            </View>
            <Text style={styles.peopleNote}>{t.carousel.peopleNote}</Text>
          </>
        ) : null}
        </>
        ) : null}

        <Text style={styles.label}>{t.publish.visibility}</Text>
        <View style={styles.tags}>
          {PRIVACY_LEVELS.map((level) => (
            <Pressable
              key={level}
              hitSlop={{ top: 8, bottom: 8, left: 2, right: 2 }}
              style={[styles.privacyPill, privacy === level ? styles.privacyPillActive : null]}
              onPress={() => setPrivacy(level)}
              accessibilityRole="radio"
              accessibilityState={{ selected: privacy === level }}
            >
              <Text style={[styles.privacyLabel, privacy === level ? styles.privacyLabelActive : null]}>{t.vaultLabels.privacy[level]}</Text>
            </Pressable>
          ))}
        </View>
        {/* Compte privé : « Public » ne veut alors dire que « mes abonnés ». */}
        <PrivateAccountNote style={styles.privateAccountNote} />
      </ScrollView>

      <Modal visible={pickerOpen} animationType="slide" transparent onRequestClose={() => setPickerOpen(false)}>
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => setPickerOpen(false)}
          accessibilityRole="button"
          accessibilityLabel={t.common.close}
        />
        <View style={styles.modalSheet}>
          <View style={styles.modalNav}>
            <Text style={styles.navTitle} accessibilityRole="header">{t.publish.addPiece}</Text>
            <Pressable accessibilityRole="button" onPress={() => setPickerOpen(false)} hitSlop={12}>
              <Text style={styles.cancel}>{t.publish.closePicker}</Text>
            </Pressable>
          </View>
          {recentPieces?.length === 0 ? (
            <Text style={styles.emptyPicker}>{t.publish.noRecentPieces}</Text>
          ) : (
            recentPieces?.map((piece) => (
              <Pressable accessibilityRole="button" key={piece.id} style={styles.pickerRow} onPress={() => addPieceTag(piece)}>
                <View style={styles.tagDot} />
                <View>
                  <Text style={styles.pickerRowName}>{piece.name}</Text>
                  {piece.material ? <Text style={styles.pickerRowMaterial}>{piece.material}</Text> : null}
                </View>
              </Pressable>
            ))
          )}
        </View>
      </Modal>

      <Modal visible={peopleOpen} animationType="slide" transparent onRequestClose={() => setPeopleOpen(false)}>
        {/* Retours du build 2 : la feuille remonte au-dessus du clavier de l'iPhone (comme wish-alert-sheet.tsx) ;
            sans cela, le champ et ce qu'on y tape restaient cachés dessous. Sur le site, une simple vue. */}
        <KeyboardAvoidingView style={styles.modalAvoider} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <Pressable style={styles.modalBackdrop} onPress={() => setPeopleOpen(false)} accessibilityRole="button" accessibilityLabel={t.common.close} />
          <View style={styles.modalSheet}>
            <View style={styles.modalNav}>
              <Text style={styles.navTitle} accessibilityRole="header">{t.carousel.tagPeople}</Text>
              <Pressable accessibilityRole="button" onPress={() => setPeopleOpen(false)} hitSlop={12}>
                <Text style={styles.cancel}>{t.publish.closePicker}</Text>
              </Pressable>
            </View>
            <TextInput
              style={styles.peopleSearch}
              placeholder={t.carousel.searchPeople}
              placeholderTextColor={color.acier}
              value={peopleQuery}
              onChangeText={setPeopleQuery}
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus
              accessibilityLabel={t.carousel.searchPeople}
              returnKeyType="search"
            />
            <ScrollView style={styles.peopleList} keyboardShouldPersistTaps="handled">
              {peopleCandidates?.length === 0 ? (
                <Text style={styles.emptyPicker}>{t.carousel.noPeopleFound}</Text>
              ) : (
                peopleCandidates?.map((person) => (
                    <Pressable accessibilityRole="button" key={person.id} style={styles.pickerRow} onPress={() => addPerson(person)} accessibilityLabel={t.carousel.addPerson(person.displayName)}>
                      <Avatar uri={person.avatarUrl} userId={person.id} displayName={person.displayName} username={person.username} size={32} />
                      <View>
                        <Text style={styles.pickerRowName}>{person.displayName}</Text>
                        <Text style={styles.pickerRowMaterial}>@{person.username}</Text>
                      </View>
                    </Pressable>
                  ))
              )}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = themedStyles(() => ({
  sheet: { flex: 1, backgroundColor: color.porcelaine },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: color.filet, alignSelf: "center", marginTop: 9 },
  nav: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: space.md, paddingTop: 14, paddingBottom: 6 },
  navSide: { minWidth: 64 },
  navSideRight: { alignItems: "flex-end" },
  cancel: { fontSize: font.secondary, color: color.acier },
  navTitle: { fontSize: font.secondary, fontWeight: "600", color: color.encre },
  publishLabel: { fontSize: font.secondary, fontWeight: "600", color: color.vert },
  publishLabelDisabled: { color: color.acier },
  body: { paddingHorizontal: space.md, paddingTop: space.sm, paddingBottom: space.xxl, maxWidth: 480, alignSelf: "center", width: "100%" },
  error: { fontSize: font.caption, color: color.acier, marginBottom: space.md },
  modes: { flexDirection: "row", gap: 8, marginBottom: 12 },
  mode: { flex: 1, minHeight: size.touchTarget, borderRadius: radius.full, borderWidth: 1, borderColor: color.filet, alignItems: "center", justifyContent: "center" },
  modeActive: { backgroundColor: color.encre, borderColor: color.encre },
  modeLabel: { fontSize: font.caption, color: color.encre, fontWeight: "600" },
  modeLabelActive: { color: color.blanc },
  hint: { fontSize: font.caption, color: color.acier, marginBottom: space.sm, lineHeight: 18 },
  vaultLoader: { marginVertical: space.lg },
  vaultGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  vaultCell: { width: "31.5%", borderRadius: radius.sm, borderWidth: 2, borderColor: "transparent", padding: 2 },
  vaultCellActive: { borderColor: color.vert },
  vaultThumb: { width: "100%", aspectRatio: 1, borderRadius: radius.pieceThumb, borderCurve: "continuous", overflow: "hidden", backgroundColor: color.plinthe },
  vaultTitle: { fontSize: 11.5, color: color.encre, marginTop: 4 },
  // Retours du build 3 (« tout est espacé ») : la case vide n'est plus un grand carré gris, mais une
  // case pointillée de 168 points ; avec une photo, le carré d'avant, coins doux.
  photoEmpty: { width: "100%", height: 168, borderWidth: 1, borderStyle: "dashed", borderColor: color.filet, backgroundColor: "transparent", borderRadius: radius.piece, borderCurve: "continuous", alignItems: "center", justifyContent: "center", gap: 8 },
  photoFilled: { width: "100%", aspectRatio: 1, backgroundColor: color.plinthe, borderRadius: radius.piece, borderCurve: "continuous", alignItems: "center", justifyContent: "center", overflow: "hidden" },
  photoPreview: { width: "100%", height: "100%" },
  photoLabel: { fontSize: font.caption, color: color.acier },
  caption: { marginTop: 12, fontSize: font.secondary, color: color.encre, lineHeight: 21, minHeight: 44 },
  label: { fontSize: font.caption, color: color.acier, marginTop: space.md, marginBottom: space.sm },
  tags: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  tag: { flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderColor: color.filet, borderRadius: radius.full, paddingVertical: 6, paddingLeft: 6, paddingRight: 10 },
  tagDot: { width: 20, height: 20, borderRadius: radius.sm - 1, backgroundColor: color.plinthe },
  tagLabel: { fontSize: font.caption, color: color.encre },
  tagRemove: { fontSize: font.caption, color: color.acier, marginLeft: 2 },
  addTag: { borderWidth: 1, borderColor: color.filet, borderStyle: "dashed", borderRadius: radius.full, paddingVertical: 6, paddingHorizontal: 12 },
  addTagLabel: { fontSize: font.caption, color: color.acier },
  privateAccountNote: { marginTop: space.sm },
  privacyPill: { borderWidth: 1, borderColor: color.filet, borderRadius: radius.full, paddingVertical: 6, paddingHorizontal: 12 },
  privacyPillActive: { backgroundColor: color.vert, borderColor: color.vert },
  privacyLabel: { fontSize: font.caption, color: color.acier },
  privacyLabelActive: { color: color.blanc, fontWeight: "600" },
  modalBackdrop: { flex: 1, backgroundColor: color.voile },
  modalSheet: { backgroundColor: color.porcelaine, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, paddingBottom: space.xl, maxHeight: "70%", flexShrink: 1 },
  // Feuille « Identifier des personnes » : posée au-dessus du clavier ; sur un petit iPhone, la liste rétrécit et défile.
  modalAvoider: { flex: 1, justifyContent: "flex-end" },
  peopleList: { flexShrink: 1 },
  modalNav: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: space.md, borderBottomWidth: 1, borderBottomColor: color.filet },
  emptyPicker: { fontSize: font.secondary, color: color.acier, textAlign: "center", padding: space.xl, lineHeight: 20 },
  pickerRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: space.md, paddingVertical: space.md, borderBottomWidth: 1, borderBottomColor: color.filet },
  pickerRowName: { fontSize: font.secondary, color: color.encre, fontWeight: "600" },
  pickerRowMaterial: { fontSize: font.caption, color: color.acier, marginTop: 2 },
  // Plusieurs photos, identifications (migration 0047).
  progress: { marginHorizontal: space.md, marginTop: space.xs, padding: space.md, borderRadius: radius.md, backgroundColor: color.plinthe, gap: space.sm },
  progressLine: { flexDirection: "row", alignItems: "center", gap: space.sm },
  progressText: { flexShrink: 1, fontSize: font.secondary, color: color.encre },
  progressActions: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  progressButton: { minHeight: 44, paddingHorizontal: space.md, borderRadius: radius.full, borderWidth: 1, borderColor: color.filet, justifyContent: "center" },
  progressButtonLabel: { fontSize: font.caption, fontWeight: "600", color: color.encre },
  strip: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: space.sm },
  stripCell: { width: 60, height: 60, borderRadius: radius.pieceThumb, borderCurve: "continuous", overflow: "hidden", backgroundColor: color.plinthe },
  stripRemove: { position: "absolute", top: 2, right: 2, width: 22, height: 22, borderRadius: radius.full, backgroundColor: color.voileImage, alignItems: "center", justifyContent: "center" },
  stripRemoveLabel: { fontSize: font.caption, color: color.surImage, fontWeight: "700", lineHeight: 15 },
  stripAdd: { borderWidth: 1, borderColor: color.filet, borderStyle: "dashed", alignItems: "center", justifyContent: "center", backgroundColor: "transparent" },
  stripAddLabel: { fontSize: font.title, color: color.acier },
  peopleNote: { fontSize: font.caption, color: color.acier, marginTop: space.sm, lineHeight: 18 },
  peopleSearch: { margin: space.md, minHeight: 44, borderWidth: 1, borderColor: color.filet, borderRadius: radius.md, paddingHorizontal: space.md, fontSize: font.secondary, color: color.encre },
}));
