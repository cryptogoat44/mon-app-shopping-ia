import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View, type StyleProp, type TextStyle } from "react-native";
import { useRouter } from "expo-router";
import Head from "expo-router/head";
import { LEGAL_DOCUMENT_VERSIONS, isProfileComplete, type ConsentStatus, type VersionedConsentType } from "@monapp/shared-types";
import { acceptConsents, fetchConsentStatus } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useToast } from "@/lib/toast-context";
import { consentFor, formatLongDate, parseLegalVersion, pendingConsents, splitPlaceholders } from "@/lib/legal";
import type { LegalDocument } from "@/legal/types";
import { APP_NAME_DISPLAY } from "@/constants/brand";
import { fr } from "@/i18n/fr";
import { color, font, radius, serifFont, space } from "@/theme/tokens";
import { ErrorMessage } from "@/components/error-message";
import { CheckboxRow } from "@/components/checkbox-row";

// Affiche un document juridique (Lot Q, bloc 5). Lisible par tous, connecté
// ou non (lien depuis l'inscription, adresse publique du site). Pour une
// personne connectée au profil complet : état de son acceptation et bouton
// « J'accepte cette version » si la version en vigueur n'est pas acceptée.

function Paragraph({ text, style }: { text: string; style: StyleProp<TextStyle> }) {
  return (
    <Text style={style}>
      {splitPlaceholders(text).map((part, index) =>
        part.placeholder ? (
          <Text key={index} style={styles.placeholder}>
            {part.text}
          </Text>
        ) : (
          part.text
        )
      )}
    </Text>
  );
}

type AcceptanceState =
  | { kind: "loading" }
  | { kind: "failed" }
  | { kind: "ready"; consent: ConsentStatus | null; pending: VersionedConsentType[] };

function Acceptance({ document }: { document: LegalDocument }) {
  const { showToast } = useToast();
  const [state, setState] = useState<AcceptanceState>({ kind: "loading" });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [ageChecked, setAgeChecked] = useState(false);

  const load = useCallback(() => {
    setState({ kind: "loading" });
    fetchConsentStatus()
      .then((statuses) =>
        setState({ kind: "ready", consent: consentFor(statuses, document.type), pending: pendingConsents(statuses, document.type) })
      )
      .catch(() => setState({ kind: "failed" }));
  }, [document.type]);

  useEffect(load, [load]);

  async function accept(pending: VersionedConsentType[]) {
    setSaving(true);
    setSaveError(false);
    try {
      await acceptConsents(pending);
      showToast(fr.legal.acceptedToast);
      load();
    } catch {
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  }

  if (state.kind === "loading") return <ActivityIndicator color={color.acier} style={styles.acceptance} />;
  if (state.kind === "failed") {
    return (
      <View style={styles.acceptance}>
        <ErrorMessage style={styles.body}>{fr.legal.statusFailed}</ErrorMessage>
        <Pressable accessibilityRole="button" onPress={load} hitSlop={12}>
          <Text style={styles.link}>{fr.legal.retry}</Text>
        </Pressable>
      </View>
    );
  }
  if (state.pending.length === 0 && state.consent?.grantedAt) {
    return <Text style={[styles.body, styles.acceptance]}>{fr.legal.accepted(formatLongDate(state.consent.grantedAt))}</Text>;
  }
  const pending = state.pending;
  const needsAge = pending.includes("age_declaration");
  const disabled = saving || (needsAge && !ageChecked);
  return (
    <View style={styles.acceptance}>
      {saveError ? <ErrorMessage style={styles.body}>{fr.legal.acceptFailed}</ErrorMessage> : null}
      {needsAge ? (
        <CheckboxRow style={styles.ageRow} label={fr.legal.ageDeclaration} checked={ageChecked} onToggle={() => setAgeChecked((c) => !c)} />
      ) : null}
      <Pressable
        accessibilityRole="button"
        style={[styles.cta, disabled ? styles.ctaDisabled : null]}
        onPress={() => accept(pending)}
        disabled={disabled}
      >
        <Text style={styles.ctaLabel}>{saving ? fr.legal.accepting : fr.legal.accept}</Text>
      </Pressable>
    </View>
  );
}

export function LegalDocumentView({ document }: { document: LegalDocument }) {
  const router = useRouter();
  const { profile } = useAuth();
  const version = parseLegalVersion(LEGAL_DOCUMENT_VERSIONS[document.type]);
  const versionLabel = version.day
    ? version.isDraft
      ? fr.legal.draftVersion(formatLongDate(version.day))
      : formatLongDate(version.day)
    : LEGAL_DOCUMENT_VERSIONS[document.type];

  return (
    <SafeAreaView style={styles.screen}>
      <Head>
        <title>{`${document.title} — ${APP_NAME_DISPLAY}`}</title>
      </Head>
      <View style={styles.nav}>
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Retour"
        >
          <Text style={styles.back}>‹</Text>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title} accessibilityRole="header">
          {document.title}
        </Text>
        <Text style={styles.meta}>{fr.legal.version(versionLabel)}</Text>
        {version.isDraft ? (
          <View style={styles.banner}>
            <Text style={styles.bannerText}>{fr.legal.draftBanner}</Text>
          </View>
        ) : null}

        {document.sections.map((section) => (
          <View key={section.title} style={styles.section}>
            <Text style={styles.sectionTitle} accessibilityRole="header">
              {section.title}
            </Text>
            {section.blocks.map((block, index) =>
              typeof block === "string" ? (
                <Paragraph key={index} text={block} style={styles.body} />
              ) : (
                <View key={index} style={styles.list}>
                  {block.map((item) => (
                    <View key={item} style={styles.listItem}>
                      <Text style={styles.body}>•</Text>
                      <Paragraph text={item} style={[styles.body, styles.listText]} />
                    </View>
                  ))}
                </View>
              )
            )}
          </View>
        ))}

        {profile && isProfileComplete(profile) ? <Acceptance document={document} /> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.porcelaine },
  nav: { height: 47, justifyContent: "center", paddingHorizontal: 12 },
  back: { fontSize: 26, color: color.encre },
  content: { paddingHorizontal: space.lg, paddingBottom: space.xxl, maxWidth: 640, alignSelf: "center", width: "100%" },
  title: { fontFamily: serifFont, fontWeight: "500", fontSize: font.title, color: color.encre },
  meta: { fontSize: font.caption, color: color.acier, marginTop: space.xs },
  banner: { borderWidth: 1, borderColor: color.encre, borderRadius: radius.sm, padding: space.sm, marginTop: space.md },
  bannerText: { fontSize: font.secondary, fontWeight: "600", color: color.encre },
  section: { marginTop: space.lg },
  sectionTitle: { fontFamily: serifFont, fontWeight: "500", fontSize: font.body, color: color.encre, marginBottom: space.sm },
  body: { fontSize: font.secondary, color: color.encre, lineHeight: 22, marginBottom: space.sm },
  placeholder: { fontWeight: "700", textDecorationLine: "underline" },
  list: { marginBottom: space.sm },
  listItem: { flexDirection: "row", gap: space.sm },
  listText: { flex: 1 },
  acceptance: { marginTop: space.xl },
  ageRow: { marginBottom: space.md },
  link: { fontSize: font.secondary, color: color.vert, fontWeight: "600" },
  cta: { backgroundColor: color.vert, borderRadius: radius.md, minHeight: 48, alignItems: "center", justifyContent: "center" },
  ctaDisabled: { opacity: 0.5 },
  ctaLabel: { color: color.blanc, fontSize: font.body, fontWeight: "600" },
});
