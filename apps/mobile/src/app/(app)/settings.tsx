import { useCallback, useState } from "react";
import { Platform, Pressable, ScrollView, Text, View } from "react-native";
import { Switch } from "@/components/switch";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { LEGAL_DOCUMENT_VERSIONS, type ConsentStatus } from "@monapp/shared-types";
import { color, font, serifDisplayLetterSpacing, serifFont, serifLineHeight, space } from "@/theme/tokens";
import { couleursInterrupteur } from "@/theme/accent";
import { getActiveLocale, t } from "@/i18n";
import { SettingsChoice } from "@/components/settings-choice";
import { usePreferences } from "@/lib/preferences-context";
import { LOCALES, THEME_PREFERENCES } from "@/lib/preferences";
import { useAuth } from "@/lib/auth-context";
import { ApiError, exportMyData, fetchConsentStatus, recordAnalyticsChoice } from "@/lib/api";
import { exportFile, type ExportFile, type ExportFormat } from "@/lib/export-file";
import { useToast } from "@/lib/toast-context";
import { hasAnalyticsConsent } from "@/lib/policy-notice";
import { ErrorMessage } from "@/components/error-message";
import { LatestVideoSetting } from "@/components/latest-video-setting";
import { PlayerConsentSetting } from "@/components/player-consent-setting";
import { ExtraDataSettings } from "@/components/extra-data-settings";
import { VideoAiSetting } from "@/components/video-ai-setting";
import { PieceSendsSetting } from "@/components/piece-sends-setting";
import { PrivateAccountSetting } from "@/components/private-account-setting";
import { MentionsFromSetting } from "@/components/mentions-from-setting";
import { DiscoverableSetting } from "@/components/discoverable-setting";
import { FriendShelvesSetting } from "@/components/friend-shelves-setting";
import { MessagesFromSetting } from "@/components/messages-from-setting";
import { ReadReceiptsSetting } from "@/components/read-receipts-setting";
import { MessagePushSetting } from "@/components/message-push-setting";
import { WishAlertsSetting } from "@/components/wish-alerts-setting";
import { ActivityPushSetting } from "@/components/activity-push-setting";
import { DeleteAccountSection } from "@/components/delete-account-section";
import { ContactEntry } from "@/components/contact-entry";
import { CONTACT_EMAIL } from "@/lib/contact";
import { consentFor, pendingConsents } from "@/lib/legal";
import { formatLongDate } from "@/lib/format";
import { settingsGroup, settingsGroupValues } from "@/components/settings-group";
import { themedStyles } from "@/theme/themed-styles";
import { useLookPagesStatus } from "@/lib/look-pages";

// Le site ne garde le lien du fichier que le temps que le navigateur lance le
// téléchargement.
const REVOKE_DELAY_MS = 30_000;

/** Site : téléchargement direct. Le fichier n'est jamais ouvert dans un
 * onglet ni un cadre de l'app : on l'ouvre depuis ses téléchargements.
 * iPhone : écrit dans le cache, proposé par la feuille de partage, puis effacé. */
async function saveExportFile(file: ExportFile) {
  if (Platform.OS === "web") {
    const url = URL.createObjectURL(new Blob([file.content], { type: file.mimeType }));
    const link = document.createElement("a");
    link.href = url;
    link.download = file.name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
    return;
  }
  const [{ File, Paths }, Sharing] = await Promise.all([import("expo-file-system"), import("expo-sharing")]);
  const cached = new File(Paths.cache, file.name);
  try {
    // Un fichier du même nom, resté d'un export interrompu, est remplacé.
    if (cached.exists) cached.delete();
    cached.write(file.content);
    await Sharing.shareAsync(cached.uri, { mimeType: file.mimeType, UTI: file.uti, dialogTitle: t.settings.exportData });
  } finally {
    // Le fichier contient toutes les données du compte : il ne reste pas dans le cache.
    try {
      if (cached.exists) cached.delete();
    } catch {
      // Déjà effacé par le système (dossier de cache) : rien à faire.
    }
  }
}

export default function SettingsScreen() {
  const router = useRouter();
  const { locale, themePreference, chooseLocale, chooseTheme } = usePreferences();
  const { signOut, profile } = useAuth();
  const { showToast } = useToast();
  const lookStatus = useLookPagesStatus();
  const [consents, setConsents] = useState<ConsentStatus[] | null>(null);
  const [consentsFailed, setConsentsFailed] = useState(false);
  // Export : le format se choisit à chaque fois ; seul le choix touché
  // affiche « Préparation de l'export… ».
  const [choosingExport, setChoosingExport] = useState(false);
  const [exporting, setExporting] = useState<ExportFormat | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [analyticsSaving, setAnalyticsSaving] = useState(false);
  const [analyticsError, setAnalyticsError] = useState(false);

  // Statistiques d'usage : chaque changement est un événement daté, effet immédiat.
  async function toggleAnalytics(granted: boolean) {
    setAnalyticsSaving(true);
    setAnalyticsError(false);
    try {
      await recordAnalyticsChoice(granted);
      setConsents(await fetchConsentStatus());
    } catch {
      setAnalyticsError(true);
    } finally {
      setAnalyticsSaving(false);
    }
  }

  useFocusEffect(
    useCallback(() => {
      setConsentsFailed(false);
      fetchConsentStatus()
        .then(setConsents)
        .catch(() => setConsentsFailed(true));
    }, [])
  );

  async function handleExport(format: ExportFormat) {
    setExportError(null);
    setExporting(format);
    try {
      // Nom du fichier daté au moment de l'export, dans la langue de l'app.
      const file = exportFile(format, await exportMyData(format));
      await saveExportFile(file);
      setChoosingExport(false);
      if (Platform.OS === "web") showToast(t.settings.exportDone);
    } catch (e) {
      setExportError(e instanceof ApiError ? e.message : t.settings.exportError);
    } finally {
      setExporting(null);
    }
  }

  function cancelExport() {
    setChoosingExport(false);
    setExportError(null);
  }

  function consentLine(type: "terms" | "privacy_policy"): string {
    if (consentsFailed) return t.settings.consentFailed;
    if (!consents) return t.settings.consentLoading;
    const consent = consentFor(consents, type);
    if (pendingConsents(consents, type).length > 0 || !consent?.grantedAt) return t.settings.notAccepted;
    const date = formatLongDate(consent.grantedAt, getActiveLocale());
    return consent.version === LEGAL_DOCUMENT_VERSIONS[type] ? t.settings.acceptedOn(date) : t.settings.acceptedEarlier(date);
  }

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.nav}>
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/profile"))}
          style={styles.navBack}
          accessibilityRole="button"
          accessibilityLabel={t.common.back}
        >
          {/* « ‹ Retour » (jamais « ‹ Profil ») : l'écran s'ouvre aussi depuis le lecteur. */}
          <Text style={styles.back}>‹ {t.common.back}</Text>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title} accessibilityRole="header">{t.settings.title}</Text>

        {/* Lot « fidélité aux maquettes » (maquette « Écrin » 7) : des blocs groupés à la façon d'iOS — un surtitre, une carte
            (components/settings-group.tsx). Mêmes composants, mêmes textes ; ordre de la maquette : Compte, confidentialité,
            notifications, Langue, Apparence, Vos données, Documents, Aide. */}
        <View style={group.section}>
          <Text style={group.label}>{t.settings.account}</Text>
          <View style={group.card}>
            {profile?.username ? (
              <>
                <View style={group.row}>
                  <Text style={group.rowTitle}>{t.settings.usernameLabel}</Text>
                  <Text style={styles.username} numberOfLines={1}>
                    @{profile.username}
                  </Text>
                </View>
                <View style={group.divider} />
              </>
            ) : null}
            <Pressable accessibilityRole="button" onPress={() => router.push("/edit-profile")} style={group.linkRow}>
              <Text style={styles.link}>{t.settings.editProfile}</Text>
            </Pressable>
            <View style={group.divider} />
            <Pressable accessibilityRole="button" onPress={() => router.push("/blocked-users")} style={group.linkRow}>
              <Text style={styles.link}>{t.blockedUsers.title}</Text>
            </Pressable>
          </View>
        </View>

        {/* Lot « vie sociale » : bloc « Confidentialité du compte », caché tant que le serveur n'a pas le compte privé. */}
        <PrivateAccountSetting />
        {/* Migration 0046 : « Qui peut me mentionner », caché tant que le serveur n'a pas les mentions. */}
        <MentionsFromSetting />
        {/* Migration 0050 : « Proposer mon compte aux autres membres », caché tant que le serveur n'a pas le réglage. */}
        <DiscoverableSetting />
        {/* Migration 0058 : « Montrer mes Envies / mon Vault à mes amis », allumés au départ (rien n'est montré avant
            la carte d'information), une carte par réglage, cachés tant que le serveur ne les a pas. */}
        <FriendShelvesSetting />
        <PieceSendsSetting />
        <MessagesFromSetting />
        {/* Lot « messages vus » : « Confirmations de lecture », caché tant que le serveur ne le propose pas. */}
        <ReadReceiptsSetting />
        {/* Lot notifications : caché sur le site et tant que le serveur ne les propose pas. Pas de surtitre commun : chaque
            réglage de notification se cache séparément, il pourrait rester seul au-dessus de rien. */}
        <MessagePushSetting />
        {/* Lot 2 : « Alertes prix et stock », caché tant que le serveur n'a pas les alertes (site compris). */}
        <WishAlertsSetting />
        {/* Migration 0051 : « Notifications d'activité », sur l'iPhone seulement, caché tant que le serveur ne les propose pas. */}
        <ActivityPushSetting />

        <View style={group.section}>
          <Text style={group.label}>{t.preferences.language}</Text>
          {/* Lot « finitions de l'œil » : la même liste à cocher que les autres choix des Réglages. */}
          <View style={group.card}>
            <SettingsChoice
              label={t.preferences.language}
              options={LOCALES.map((value) => ({ value, label: t.preferences.languageNames[value] }))}
              value={locale}
              onChange={(value) => chooseLocale(value, "settings")}
            />
          </View>
        </View>

        <View style={group.section}>
          <Text style={group.label}>{t.preferences.appearance}</Text>
          <View style={group.card}>
            <SettingsChoice
              label={t.preferences.appearance}
              options={THEME_PREFERENCES.map((value) => ({ value, label: t.preferences.themeNames[value] }))}
              value={themePreference}
              onChange={chooseTheme}
            />
            <Text style={styles.sectionBody}>{t.preferences.appearanceHint}</Text>
          </View>
        </View>

        <View style={group.section}>
          <Text style={group.label}>{t.settings.dataSection}</Text>
          {/* Une seule carte : les statistiques, puis les lignes des composants (chacune précédée de son filet). */}
          <View style={group.card}>
            <View style={group.row}>
              <Text style={styles.analyticsTitle}>{t.settings.analyticsTitle}</Text>
              <Switch
                accessibilityLabel={t.settings.analyticsSwitchLabel}
                value={consents ? hasAnalyticsConsent(consents) : false}
                disabled={!consents || analyticsSaving}
                onValueChange={toggleAnalytics}
                {...couleursInterrupteur(consents ? hasAnalyticsConsent(consents) : false)}
              />
            </View>
            <Text style={styles.sectionBody}>
              {consentsFailed
                ? t.settings.consentFailed
                : !consents
                  ? t.settings.analyticsLoading
                  : hasAnalyticsConsent(consents)
                    ? t.settings.analyticsOn
                    : t.settings.analyticsOff}
            </Text>
            {analyticsError ? <ErrorMessage style={styles.sectionBody}>{t.settings.analyticsFailed}</ErrorMessage> : null}
            <VideoAiSetting consents={consents} failed={consentsFailed} onChange={setConsents} />
            <LatestVideoSetting />
            <PlayerConsentSetting />
            {/* Lignes propres au site, rien sur iPhone (components/extra-data-settings). */}
            <ExtraDataSettings />
            {/* Lot « page look » : « Pages look partagées », caché tant que le serveur n'a pas la migration 0057. */}
            {lookStatus?.manage ? (
              <>
                <View style={group.divider} />
                <Pressable accessibilityRole="button" onPress={() => router.push("/looks-partages")} style={group.linkRow}>
                  <Text style={styles.link}>{t.look.settingsEntry}</Text>
                </Pressable>
              </>
            ) : null}
            <View style={group.divider} />
            {!choosingExport ? (
              <Pressable accessibilityRole="button" onPress={() => setChoosingExport(true)} style={group.linkRow}>
                <Text style={styles.link}>{t.settings.exportData}</Text>
              </Pressable>
            ) : (
              <View style={styles.exportChoice}>
                <Text style={styles.sectionBody}>{t.settings.exportChoiceIntro}</Text>
                <Pressable accessibilityRole="button" onPress={() => handleExport("html")} disabled={exporting !== null} style={group.linkRow}>
                  <Text style={styles.link}>{exporting === "html" ? t.settings.exporting : t.settings.exportReadable}</Text>
                </Pressable>
                <Text style={styles.sectionBody}>{t.settings.exportReadableHint}</Text>
                <Pressable accessibilityRole="button" onPress={() => handleExport("json")} disabled={exporting !== null} style={group.linkRow}>
                  <Text style={styles.link}>{exporting === "json" ? t.settings.exporting : t.settings.exportJson}</Text>
                </Pressable>
                <Text style={styles.sectionBody}>{t.settings.exportJsonHint}</Text>
                {exportError ? <ErrorMessage style={styles.sectionBody}>{exportError}</ErrorMessage> : null}
                <Pressable accessibilityRole="button" onPress={cancelExport} disabled={exporting !== null} style={group.linkRow}>
                  <Text style={styles.cancelLabel}>{t.common.cancel}</Text>
                </Pressable>
              </View>
            )}
          </View>
        </View>

        <View style={group.section}>
          <Text style={group.label}>{t.settings.documents}</Text>
          <View style={group.card}>
            <Pressable accessibilityRole="link" onPress={() => router.push("/conditions")} style={group.linkRow}>
              <Text style={styles.link}>{t.settings.terms}</Text>
            </Pressable>
            <Text style={styles.sectionBody}>{consentLine("terms")}</Text>
            <View style={group.divider} />
            <Pressable accessibilityRole="link" onPress={() => router.push("/confidentialite")} style={group.linkRow}>
              <Text style={styles.link}>{t.settings.privacyPolicy}</Text>
            </Pressable>
            <Text style={styles.sectionBody}>{consentLine("privacy_policy")}</Text>
          </View>
        </View>

        {/* Aide : « Aide et contact » toujours (chantier 3) ; « Nous contacter » seulement avec une adresse réelle. */}
        <View style={group.section}>
          <Text style={group.label}>{t.contact.settingsSection}</Text>
          <View style={group.card}>
            <Pressable accessibilityRole="link" onPress={() => router.push("/aide")} style={group.linkRow}>
              <Text style={styles.link}>{t.help.entry}</Text>
            </Pressable>
            {CONTACT_EMAIL ? (
              <>
                <View style={group.divider} />
                <ContactEntry email={CONTACT_EMAIL} style={styles.contact} linkStyle={styles.link} textStyle={styles.sectionBody} />
              </>
            ) : null}
          </View>
        </View>

        <View style={[group.section, group.card]}>
          <Pressable accessibilityRole="button" onPress={signOut} style={group.linkRow}>
            <Text style={styles.link}>{t.settings.signOut}</Text>
          </Pressable>
        </View>

        <DeleteAccountSection onDeleted={signOut} />

        {/* Lot 5 : entrée discrète, visible des seuls administrateurs (le
            serveur revérifie le rôle à chaque appel). */}
        {profile?.isAdmin ? (
          <View style={styles.adminSection}>
            <Pressable accessibilityRole="link" onPress={() => router.push("/moderation")} style={styles.adminLink}>
              <Text style={styles.adminLabel}>{t.moderationQueue.settingsEntry}</Text>
            </Pressable>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = themedStyles(() => {
  const g = settingsGroupValues();
  return {
    screen: { flex: 1, backgroundColor: color.porcelaine },
    nav: { height: 44, flexDirection: "row", alignItems: "center", paddingHorizontal: 8 },
    navBack: { minHeight: 44, minWidth: 44, paddingHorizontal: 8, justifyContent: "center" },
    back: { fontSize: font.body, fontWeight: "400", color: color.encre },
    content: { paddingHorizontal: space.md, paddingBottom: space.xxl, maxWidth: 480, alignSelf: "center", width: "100%" },
    title: { fontFamily: serifFont, fontWeight: "500", fontSize: font.display, lineHeight: serifLineHeight.display, letterSpacing: serifDisplayLetterSpacing, color: color.encre, marginBottom: 0 },
    username: { flexShrink: 1, fontSize: font.secondary, color: color.acier },
    analyticsTitle: g.rowTitle,
    // Explications et lignes d'acceptation : 13 pt acier, sous leur ligne, dans la carte, mot pour mot.
    sectionBody: g.hint,
    link: g.link,
    contact: { paddingTop: 0 },
    exportChoice: { paddingTop: 12 },
    cancelLabel: { color: color.acier, fontSize: font.secondary, fontWeight: "600" },
    adminSection: { marginTop: space.xl, borderTopWidth: 1, borderTopColor: color.filet, paddingTop: space.sm },
    adminLink: { minHeight: 44, minWidth: 44, justifyContent: "center", alignSelf: "flex-start" },
    adminLabel: { fontSize: font.caption, fontWeight: "600", color: color.acier },
  };
});
const group = settingsGroup;
