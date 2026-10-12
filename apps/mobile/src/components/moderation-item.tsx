import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Image } from "expo-image";
import type { ModerationAuthor, ModerationItem, ModerationLogEntry, ModerationPreview, ModerationStatus, ReportReason } from "@monapp/shared-types";
import { color, font, radius, space } from "@/theme/tokens";
import { getActiveLocale, t } from "@/i18n";
import { timeAgo } from "@/lib/format";
import { applyModerationDecision, undoModerationDecision } from "@/lib/api";
import { loadErrorMessage } from "@/lib/load-error";
import { moderationActionLabel, mostReportedReason, reasonsSummary, reportReasonLabel } from "@/lib/moderation-labels";
import { useToast } from "@/lib/toast-context";
import { ErrorMessage } from "@/components/error-message";
import { PersonIcon } from "@/components/icons";
import { DecisionPanel, type DecisionKind } from "@/components/moderation-decision";
import { themedStyles } from "@/theme/themed-styles";

// Un contenu signalé, vu par un administrateur (lot 5) : les signalements
// regroupés (jamais qui les a faits), l'aperçu du contenu, les décisions
// possibles et leur historique (qui, quoi, quand, motif).

const ago = (iso: string) => timeAgo(iso, getActiveLocale());

function ActionButton({ label, onPress, disabled, danger }: { label: string; onPress: () => void; disabled: boolean; danger?: boolean }) {
  return (
    <Pressable
      style={[styles.action, disabled ? styles.actionDisabled : null]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
    >
      <Text style={[styles.actionLabel, danger ? styles.actionDanger : null, disabled ? styles.actionLabelDisabled : null]}>{label}</Text>
    </Pressable>
  );
}

function AuthorLine({ author }: { author: ModerationAuthor }) {
  return (
    <View style={styles.authorRow}>
      <View style={styles.avatar} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {author.avatarUrl ? (
          <Image source={{ uri: author.avatarUrl }} style={styles.avatarImage} contentFit="cover" />
        ) : (
          <PersonIcon size={16} tint={color.acier} />
        )}
      </View>
      <Text style={styles.authorName}>{author.displayName}</Text>
      <Text style={styles.meta}>@{author.username}</Text>
    </View>
  );
}

function Badges({ hidden, suspended }: { hidden: boolean; suspended: boolean }) {
  if (!hidden && !suspended) return null;
  const labels = [hidden ? t.moderationQueue.hidden : null, suspended ? t.moderationQueue.suspended : null].filter((label): label is string => label !== null);
  return <Text style={styles.badge}>{labels.join(" · ")}</Text>;
}

function ItemPreview({ preview }: { preview: ModerationPreview }) {
  if (preview.kind === "missing") return <Text style={styles.missing}>{t.moderationQueue.missing}</Text>;
  return (
    <View style={styles.preview}>
      <AuthorLine author={preview.author} />
      {preview.kind === "post" ? (
        <View style={styles.postRow}>
          {preview.imageUrl ? (
            <Image
              source={{ uri: preview.imageUrl }}
              style={styles.postImage}
              contentFit="cover"
              accessible
              accessibilityLabel={t.post.photoBy(preview.author.displayName)}
            />
          ) : null}
          <View style={styles.postText}>
            {preview.caption ? <Text style={styles.body}>{preview.caption}</Text> : null}
            <Text style={styles.meta}>{t.vaultLabels.privacy[preview.privacy]}</Text>
          </View>
        </View>
      ) : preview.kind === "comment" ? (
        <Text style={styles.body}>{t.common.quoted(preview.body)}</Text>
      ) : preview.bio ? (
        <Text style={styles.body}>{preview.bio}</Text>
      ) : null}
      <Badges hidden={preview.kind !== "user" && preview.hidden} suspended={preview.author.suspended} />
    </View>
  );
}

function ReportDetails({ item }: { item: ModerationItem }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>{t.moderationQueue.reasons}</Text>
      <Text style={styles.body}>{reasonsSummary(item.reasons)}</Text>
      {item.notes.length > 0 ? (
        <>
          <Text style={[styles.sectionLabel, styles.spaced]}>{t.moderationQueue.notes}</Text>
          {item.notes.map((note, index) => (
            <Text key={index} style={styles.note}>
              {t.common.quoted(note)}
            </Text>
          ))}
        </>
      ) : null}
    </View>
  );
}

function historyLine(entry: ModerationLogEntry): string {
  return [
    moderationActionLabel(entry.action),
    entry.reason ? reportReasonLabel(entry.reason) : null,
    entry.adminUsername ? t.moderationQueue.by(entry.adminUsername) : null,
    ago(entry.createdAt),
  ]
    .filter((part): part is string => part !== null)
    .join(" · ");
}

function ItemHistory({ history }: { history: ModerationLogEntry[] }) {
  if (history.length === 0) return null;
  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>{t.moderationQueue.history}</Text>
      {history.map((entry) => (
        <View key={entry.id} style={styles.historyEntry}>
          <Text style={styles.meta}>{historyLine(entry)}</Text>
          {entry.note ? <Text style={styles.note}>{t.common.quoted(entry.note)}</Text> : null}
        </View>
      ))}
    </View>
  );
}

function useDecisions(item: ModerationItem, onChanged: () => void) {
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(task: () => Promise<void>, success: string): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      await task();
      showToast(success);
      onChanged();
      return true;
    } catch (e) {
      setError(loadErrorMessage(e, t.moderationQueue.saveError));
      return false;
    } finally {
      setBusy(false);
    }
  }
  const decide = (action: "dismiss" | DecisionKind, reason?: ReportReason, note?: string) =>
    run(
      () => applyModerationDecision({ targetType: item.targetType, targetId: item.targetId, action, ...(reason ? { reason } : {}), ...(note ? { note } : {}) }),
      t.moderationQueue.saved
    );
  const undo = (actionId: string, kind: DecisionKind) => run(() => undoModerationDecision(actionId, kind), t.moderationQueue.undone);
  return { busy, error, decide, undo };
}

function ItemDecisions({ item, status, onChanged }: { item: ModerationItem; status: ModerationStatus; onChanged: () => void }) {
  const [panel, setPanel] = useState<DecisionKind | null>(null);
  const { busy, error, decide, undo } = useDecisions(item, onChanged);
  const { preview, activeHideActionId, activeSuspendActionId } = item;
  const content = preview.kind === "post" || preview.kind === "comment" ? preview : null;
  const errorView = error ? <ErrorMessage style={styles.error}>{error}</ErrorMessage> : null;

  if (panel) {
    return (
      <>
        <DecisionPanel
          kind={panel}
          initialReason={mostReportedReason(item.reasons)}
          busy={busy}
          onCancel={() => setPanel(null)}
          onConfirm={(reason, note) => void decide(panel, reason, note).then((done) => done && setPanel(null))}
        />
        {errorView}
      </>
    );
  }
  return (
    <View style={styles.actions}>
      {status === "open" ? <ActionButton label={t.moderationQueue.dismiss} onPress={() => void decide("dismiss")} disabled={busy} /> : null}
      {content && !content.hidden ? (
        <ActionButton label={content.kind === "post" ? t.moderationQueue.hidePost : t.moderationQueue.hideComment} onPress={() => setPanel("hide")} disabled={busy} />
      ) : null}
      {preview.kind !== "missing" && !preview.author.suspended ? (
        <ActionButton label={t.moderationQueue.suspend} onPress={() => setPanel("suspend")} disabled={busy} danger />
      ) : null}
      {activeHideActionId && content ? (
        <ActionButton
          label={content.kind === "post" ? t.moderationQueue.restorePost : t.moderationQueue.restoreComment}
          onPress={() => void undo(activeHideActionId, "hide")}
          disabled={busy}
        />
      ) : null}
      {activeSuspendActionId ? <ActionButton label={t.moderationQueue.unsuspend} onPress={() => void undo(activeSuspendActionId, "suspend")} disabled={busy} /> : null}
      {errorView}
    </View>
  );
}

export function ModerationItemCard({ item, status, onChanged }: { item: ModerationItem; status: ModerationStatus; onChanged: () => void }) {
  return (
    <View style={styles.card} testID={`moderation-${item.targetType}-${item.targetId}`}>
      <Text style={styles.title}>{[t.moderationQueue.target[item.targetType], t.moderationQueue.reportCount(item.reportCount)].join(" · ")}</Text>
      <Text style={styles.meta}>{t.moderationQueue.lastReport(ago(item.lastReportedAt))}</Text>
      <ItemPreview preview={item.preview} />
      <ReportDetails item={item} />
      <ItemDecisions item={item} status={status} onChanged={onChanged} />
      <ItemHistory history={item.history} />
    </View>
  );
}

const styles = themedStyles(() => ({
  card: {
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.filet,
    borderRadius: radius.md,
    padding: space.md,
    marginBottom: space.md,
  },
  title: { fontSize: font.secondary, fontWeight: "600", color: color.encre },
  meta: { fontSize: font.caption, color: color.acier, lineHeight: 18 },
  preview: { marginTop: space.md, gap: space.sm },
  authorRow: { flexDirection: "row", alignItems: "center", gap: space.sm, flexWrap: "wrap" },
  avatar: {
    width: 28,
    height: 28,
    borderRadius: radius.full,
    backgroundColor: color.plinthe,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  avatarImage: { width: "100%", height: "100%" },
  authorName: { fontSize: font.secondary, fontWeight: "600", color: color.encre },
  postRow: { flexDirection: "row", gap: space.sm },
  postImage: { width: 72, height: 72, borderRadius: radius.sm, backgroundColor: color.plinthe },
  postText: { flex: 1, gap: space.xs },
  body: { fontSize: font.secondary, color: color.encre, lineHeight: 20 },
  badge: { fontSize: font.caption, fontWeight: "600", color: color.danger },
  missing: { fontSize: font.secondary, color: color.acier, marginTop: space.md },
  section: { marginTop: space.md },
  sectionLabel: { fontSize: font.caption, fontWeight: "600", color: color.acier, marginBottom: space.xs },
  spaced: { marginTop: space.sm },
  note: { fontSize: font.secondary, color: color.encre, lineHeight: 20, marginTop: space.xs },
  historyEntry: { marginTop: space.xs },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: space.sm, marginTop: space.md },
  action: {
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.filet,
    alignItems: "center",
    justifyContent: "center",
  },
  actionDisabled: { backgroundColor: color.inactif, borderColor: color.inactif },
  actionLabel: { fontSize: font.secondary, fontWeight: "600", color: color.vert },
  actionDanger: { color: color.danger },
  actionLabelDisabled: { color: color.surInactif },
  error: { fontSize: font.secondary, marginTop: space.sm, width: "100%" },
}));
