import { useCallback, useState } from "react";
import { Platform, Pressable, ScrollView, Switch, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { LEGAL_DOCUMENT_VERSIONS, type ConsentStatus } from "@monapp/shared-types";
import { color, font, serifFont, space } from "@/theme/tokens";
import { getActiveLocale, t } from "@/i18n";
import { SegmentedChoice } from "@/components/segmented-choice";
import { usePreferences } from "@/lib/preferences-context";
import { LOCALES, THEME_PREFERENCES } from "@/lib/preferences";
import { useAuth } from "@/lib/auth-context";
import { ApiError, deleteMyAccount, exportMyData, fetchConsentStatus, recordAnalyticsChoice } from "@/lib/api";
import { hasAnalyticsConsent } from "@/lib/policy-notice";
import { ErrorMessage } from "@/components/error-message";
import { LatestVideoSetting } from "@/components/latest-video-setting";
import { VideoAiSetting } from "@/components/video-ai-setting";
import { consentFor, pendingConsents } from "@/lib/legal";
import { formatLongDate } from "@/lib/format";
import { themedStyles } from "@/theme/themed-styles";

async function shareExportedData(data: unknown) {
  const json = JSON.stringify(data, null, 2);
  if (Platform.OS === "web") {
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `mes-donnees-${Date.now()}.json`;
    link.click();
    URL.revokeObjectURL(url);
    return;
  }
  const [{ File, Paths }, Sharing] = await Promise.all([import("expo-file-system"), import("expo-sharing")]);
  const file = new File(Paths.cache, `mes-donnees-${Date.now()}.json`);
  file.write(json);
  await Sharing.shareAsync(file.uri);
}

export default function SettingsScreen() {
  const router = useRouter();
  const { locale, themePreference, chooseLocale, chooseTheme } = usePreferences();
  const { signOut } = useAuth();
  const [consents, setConsents] = useState<ConsentStatus[] | null>(null);
  const [consentsFailed, setConsentsFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
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

  async function handleExport() {
    setError(null);
    setExporting(true);
    try {
      const data = await exportMyData();
      await shareExportedData(data);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t.settings.exportError);
    } finally {
      setExporting(false);
    }
  }

  async function handleDelete() {
    setError(null);
    setDeleting(true);
    try {
      await deleteMyAccount();
      await signOut();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t.settings.deleteError);
      setDeleting(false);
    }
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
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={t.common.back}
        >
          <Text style={styles.back}>‹</Text>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title} accessibilityRole="header">{t.settings.title}</Text>

        {error ? <ErrorMessage style={styles.error}>{error}</ErrorMessage> : null}

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>{t.settings.account}</Text>
          <Pressable accessibilityRole="button" onPress={() => router.push("/edit-profile")} hitSlop={12}>
            <Text style={styles.link}>{t.settings.editProfile}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={() => router.push("/blocked-users")} hitSlop={12} style={styles.secondLink}>
            <Text style={styles.link}>{t.blockedUsers.title}</Text>
          </Pressable>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>{t.preferences.language}</Text>
          <SegmentedChoice
            label={t.preferences.language}
            options={LOCALES.map((value) => ({ value, label: t.preferences.languageNames[value] }))}
            value={locale}
            onChange={(value) => chooseLocale(value, "settings")}
          />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>{t.preferences.appearance}</Text>
          <SegmentedChoice
            label={t.preferences.appearance}
            options={THEME_PREFERENCES.map((value) => ({ value, label: t.preferences.themeNames[value] }))}
            value={themePreference}
            onChange={chooseTheme}
          />
          <Text style={[styles.sectionBody, styles.hint]}>{t.preferences.appearanceHint}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>{t.settings.documents}</Text>
          <Pressable accessibilityRole="link" onPress={() => router.push("/conditions")} hitSlop={12}>
            <Text style={styles.link}>{t.settings.terms}</Text>
          </Pressable>
          <Text style={styles.sectionBody}>{consentLine("terms")}</Text>
          <Pressable accessibilityRole="link" onPress={() => router.push("/confidentialite")} hitSlop={12}>
            <Text style={styles.link}>{t.settings.privacyPolicy}</Text>
          </Pressable>
          <Text style={styles.sectionBody}>{consentLine("privacy_policy")}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>{t.settings.dataSection}</Text>
          <View style={styles.analyticsRow}>
            <Text style={styles.analyticsTitle}>{t.settings.analyticsTitle}</Text>
            <Switch
              accessibilityLabel={t.settings.analyticsSwitchLabel}
              value={consents ? hasAnalyticsConsent(consents) : false}
              disabled={!consents || analyticsSaving}
              onValueChange={toggleAnalytics}
              trackColor={{ true: color.vert, false: color.filet }}
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
          <Pressable accessibilityRole="button" onPress={handleExport} disabled={exporting} hitSlop={12} style={styles.secondLink}>
            <Text style={styles.link}>{exporting ? t.settings.exporting : t.settings.exportData}</Text>
          </Pressable>
        </View>

        <Pressable accessibilityRole="button" onPress={signOut} hitSlop={12} style={styles.section}>
          <Text style={styles.link}>{t.settings.signOut}</Text>
        </Pressable>

        <View style={styles.dangerSection}>
          <Text style={styles.sectionLabel}>{t.settings.dangerZone}</Text>
          {!confirmingDelete ? (
            <Pressable accessibilityRole="button" onPress={() => setConfirmingDelete(true)} hitSlop={12}>
              <Text style={styles.deleteLabel}>{t.settings.deleteAccount}</Text>
            </Pressable>
          ) : (
            <View>
              <Text style={styles.sectionBody}>{t.settings.deleteConfirm}</Text>
              <View style={styles.confirmRow}>
                <Pressable accessibilityRole="button" onPress={() => setConfirmingDelete(false)} disabled={deleting} hitSlop={12}>
                  <Text style={styles.cancelLabel}>{t.common.cancel}</Text>
                </Pressable>
                <Pressable accessibilityRole="button" onPress={handleDelete} disabled={deleting} hitSlop={12}>
                  <Text style={styles.deleteLabel}>{deleting ? t.settings.deleting : t.settings.confirmDelete}</Text>
                </Pressable>
              </View>
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = themedStyles(() => ({
  screen: { flex: 1, backgroundColor: color.porcelaine },
  nav: { height: 47, justifyContent: "center", paddingHorizontal: 12 },
  back: { fontSize: 26, color: color.encre },
  content: { paddingHorizontal: space.lg, paddingBottom: space.xxl, maxWidth: 480, alignSelf: "center", width: "100%" },
  title: { fontFamily: serifFont, fontWeight: "500", fontSize: font.title, color: color.encre, marginBottom: space.lg },
  error: { fontSize: font.secondary, color: color.acier, marginBottom: space.md },
  section: { marginBottom: space.lg },
  sectionLabel: { fontSize: font.caption, fontWeight: "600", color: color.acier, marginBottom: space.sm },
  analyticsRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 44 },
  analyticsTitle: { fontSize: font.secondary, color: color.encre, fontWeight: "600" },
  hint: { marginTop: space.sm },
  sectionBody: { fontSize: font.secondary, color: color.acier, marginBottom: space.sm, lineHeight: 19 },
  link: { fontSize: font.secondary, color: color.vert, fontWeight: "600" },
  secondLink: { marginTop: space.sm },
  dangerSection: { borderTopWidth: 1, borderTopColor: color.filet, paddingTop: space.lg },
  deleteLabel: { color: color.danger, fontSize: font.secondary, fontWeight: "600" },
  confirmRow: { flexDirection: "row", gap: space.lg, marginTop: space.xs },
  cancelLabel: { color: color.acier, fontSize: font.secondary, fontWeight: "600" },
}));
