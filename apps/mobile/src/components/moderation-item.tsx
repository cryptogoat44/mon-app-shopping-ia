import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Image } from "expo-image";
import type {
  ModerationAuthor,
  ModerationCollectionItem,
  ModerationItem,
  ModerationLogEntry,
  ModerationPreview,
  ModerationStatus,
  ReportReason,
} from "@monapp/shared-types";
import { color, font, radius, space } from "@/theme/tokens";
import { getActiveLocale, t } from "@/i18n";
import { timeAgo } from "@/lib/format";
import { applyModerationDecision, removeCopiedImage, undoModerationDecision } from "@/lib/api";
import { loadErrorMessage } from "@/lib/load-error";
import { collectionPreviewView, hideRestoreLabels, moderationActionLabel, moderationReasonLabel, mostReportedReason, reasonsSummary } from "@/lib/moderation-labels";
import { useToast } from "@/lib/toast-context";
import { ErrorMessage } from "@/components/error-message";
import { ImageUnavailable } from "@/components/image-unavailable";
import { DecisionPanel, RemoveImagePanel, type DecisionKind } from "@/components/moderation-decision";
import { themedStyles } from "@/theme/themed-styles";
import { Avatar } from "@/components/avatar";

// Un contenu signalé, vu par un administrateur (lot 5) : les signalements
// regroupés (jamais qui les a faits), l'aperçu du contenu, les décisions
// possibles et leur historique (qui, quoi, quand, motif). Lot modération des
// collections : une collection montre son nom, son auteur et ses dernières
// envies (titre et copie de l'image), chacune avec « Retirer l'image ».

const ago = (iso: string) => timeAgo(iso, getActiveLocale());

function ActionButton({
  label,
  accessibilityLabel,
  onPress,
  disabled,
  danger,
}: {
  label: string;
  accessibilityLabel?: string;
  onPress: () => void;
  disabled: boolean;
  danger?: boolean;
}) {
  return (
    <Pressable
      style={[styles.action, disabled ? styles.actionDisabled : null]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled }}
    >
      <Text style={[styles.actionLabel, danger ? styles.actionDanger : null, disabled ? styles.actionLabelDisabled : null]}>{label}</Text>
    </Pressable>
  );
}

function AuthorLine({ author }: { author: ModerationAuthor }) {
  return (
    <View style={styles.authorRow}>
      <Avatar uri={author.avatarUrl} userId={author.id} displayName={author.displayName} username={author.username} size={28} />
      <Text style={styles.authorName}>{author.displayName}</Text>
      <Text style={styles.meta}>@{author.username}</Text>
    </View>
  );
}

function Badges({ hidden, autoHidden, suspended, imageRemoved }: { hidden: boolean; autoHidden: boolean; suspended: boolean; imageRemoved: boolean }) {
  const labels = [
    hidden ? (autoHidden ? t.accountSafety.autoHidden : t.moderationQueue.hidden) : null,
    imageRemoved ? t.moderationQueue.imageRemoved : null,
    suspended ? t.moderationQueue.suspended : null,
  ].filter((label): label is string => label !== null);
  return labels.length > 0 ? <Text style={styles.badge}>{labels.join(" · ")}</Text> : null;
}

/** Vignette du contenu ; « Image indisponible » si la modération l'a retirée (lot 5, partie B). */
function PreviewImage({ uri, removed, label }: { uri: string | null; removed: boolean; label: string }) {
  if (uri) return <Image source={{ uri }} style={styles.postImage} contentFit="cover" accessible accessibilityLabel={label} />;
  if (!removed) return null;
  return (
    <View style={styles.postImage}>
      <ImageUnavailable variant="thumb" />
    </View>
  );
}

/** Lot modération des collections : les dernières envies d'une collection
 * signalée, comme les amis les voient (titre, copie de l'image). */
function CollectionExtract({
  preview,
  busy,
  onRemoveImage,
}: {
  preview: Extract<ModerationPreview, { kind: "collection" }>;
  busy: boolean;
  onRemoveImage: (item: ModerationCollectionItem) => void;
}) {
  const view = collectionPreviewView(preview);
  return (
    <View style={styles.extract} testID="apercu-collection">
      <Text style={styles.collectionName}>{view.name}</Text>
      <Text style={styles.meta}>{view.visibility}</Text>
      <Text style={styles.sectionLabel}>{view.itemsTitle}</Text>
      {view.items.map((entry, index) => (
        <View key={entry.id} style={styles.collectionItem}>
          {entry.imageUrl ? (
            <Image source={{ uri: entry.imageUrl }} style={styles.itemImage} contentFit="cover" accessible accessibilityLabel={entry.title} />
          ) : (
            <View style={styles.itemImage}>
              <ImageUnavailable variant="thumb" />
            </View>
          )}
          <View style={styles.postText}>
            <Text style={styles.body} numberOfLines={2}>
              {entry.title}
            </Text>
            {entry.removedLabel ? <Text style={styles.badge}>{entry.removedLabel}</Text> : null}
            {entry.removeLabel ? (
              <ActionButton label={t.moderationQueue.removeImage} accessibilityLabel={entry.removeLabel} onPress={() => onRemoveImage(preview.items[index]!)} disabled={busy} danger />
            ) : null}
          </View>
        </View>
      ))}
    </View>
  );
}

function ItemPreview({
  preview,
  autoHidden,
  busy,
  onRemoveItemImage,
}: {
  preview: ModerationPreview;
  autoHidden: boolean;
  busy: boolean;
  onRemoveItemImage: (item: ModerationCollectionItem) => void;
}) {
  if (preview.kind === "missing") return <Text style={styles.missing}>{t.moderationQueue.missing}</Text>;
  return (
    <View style={styles.preview}>
      <AuthorLine author={preview.author} />
      {preview.kind === "post" ? (
        <View style={styles.postRow}>
          <PreviewImage uri={preview.imageUrl} removed={preview.imageRemoved} label={t.post.photoBy(preview.author.displayName)} />
          <View style={styles.postText}>
            {preview.caption ? <Text style={styles.body}>{preview.caption}</Text> : null}
            <Text style={styles.meta}>{t.vaultLabels.privacy[preview.privacy]}</Text>
          </View>
        </View>
      ) : preview.kind === "piece" ? (
        <View style={styles.postRow}>
          <PreviewImage uri={preview.imageUrl} removed={preview.imageRemoved} label={preview.title} />
          <View style={styles.postText}>
            <Text style={styles.body}>{preview.title}</Text>
            <Text style={styles.meta}>{t.moderationQueue.target.piece}</Text>
          </View>
        </View>
      ) : preview.kind === "comment" ? (
        <Text style={styles.body}>{t.common.quoted(preview.body)}</Text>
      ) : preview.kind === "message" ? (
        <MessageExtract preview={preview} />
      ) : preview.kind === "collection" ? (
        <CollectionExtract preview={preview} busy={busy} onRemoveImage={onRemoveItemImage} />
      ) : preview.bio ? (
        <Text style={styles.body}>{preview.bio}</Text>
      ) : null}
      <Badges
        hidden={preview.kind !== "user" && preview.hidden}
        autoHidden={autoHidden}
        suspended={preview.author.suspended}
        imageRemoved={(preview.kind === "post" || preview.kind === "piece") && preview.imageRemoved}
      />
    </View>
  );
}

/** Lot messages : le message signalé et quelques messages autour, jamais toute la conversation. */
function MessageExtract({ preview }: { preview: Extract<ModerationPreview, { kind: "message" }> }) {
  return (
    <View style={styles.extract}>
      <Text style={styles.sectionLabel}>{t.moderationQueue.messageContext}</Text>
      {preview.context.map((entry, index) => (
        <View key={`${entry.createdAt}-${index}`} style={[styles.extractEntry, entry.reported ? styles.extractReported : null]}>
          <Text style={styles.meta}>
            {[`@${entry.authorUsername}`, ago(entry.createdAt), entry.reported ? t.moderationQueue.messageReported : null, entry.hidden ? t.moderationQueue.hidden : null]
              .filter((part): part is string => part !== null)
              .join(" · ")}
          </Text>
          {entry.text ? <Text style={styles.body}>{t.common.quoted(entry.text)}</Text> : null}
          {entry.wishTitle ? <Text style={styles.meta}>{t.moderationQueue.messageWish(entry.wishTitle)}</Text> : null}
        </View>
      ))}
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
    // Chantier 3 : masquage automatique, après plusieurs signalements.
    entry.automatic ? t.accountSafety.automatic : null,
    entry.reason ? moderationReasonLabel(entry.reason) : null,
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
  // Lot 5, partie B : seulement pour une copie faite par Spotto (item.canRemoveImage) ;
  // une collection : la copie d'une de ses envies (`itemId`).
  const removeImage = async (note: string, itemId?: string) => {
    const targetType = item.targetType;
    const extra = note ? { note } : {};
    if (targetType === "collection") {
      if (!itemId) return false;
      return run(() => removeCopiedImage({ targetType, targetId: item.targetId, itemId, ...extra }), t.moderationQueue.imageRemovedSaved);
    }
    if (targetType !== "post" && targetType !== "piece") return false;
    return run(() => removeCopiedImage({ targetType, targetId: item.targetId, ...extra }), t.moderationQueue.imageRemovedSaved);
  };
  return { busy, error, decide, undo, removeImage };
}

function ItemDecisions({
  item,
  status,
  decisions,
  itemToClear,
  onItemPanelClose,
}: {
  item: ModerationItem;
  status: ModerationStatus;
  decisions: ReturnType<typeof useDecisions>;
  /** Lot modération des collections : l'envie dont on retire la copie de l'image. */
  itemToClear: ModerationCollectionItem | null;
  onItemPanelClose: () => void;
}) {
  const [panel, setPanel] = useState<DecisionKind | "remove_image" | null>(null);
  const { busy, error, decide, undo, removeImage } = decisions;
  const { preview, activeHideActionId, activeSuspendActionId } = item;
  // Chantier 3 : masqué automatiquement, signalements encore à traiter.
  // « Masquer » confirme le masquage, « Classer sans suite » le lève (le
  // serveur rétablit le contenu) : « Rétablir » ferait doublon.
  const pendingAutoHide = status === "open" && item.activeHideAutomatic && activeHideActionId !== null;
  const content = preview.kind !== "user" && preview.kind !== "missing" ? preview : null;
  const { hide: hideLabel, restore: restoreLabel } = hideRestoreLabels(content?.kind ?? "comment");
  const errorView = error ? <ErrorMessage style={styles.error}>{error}</ErrorMessage> : null;

  if (itemToClear) {
    return (
      <>
        <RemoveImagePanel
          warning={t.moderationQueue.removeItemImageWarning}
          subject={itemToClear.title}
          busy={busy}
          onCancel={onItemPanelClose}
          onConfirm={(note) => void removeImage(note, itemToClear.id).then((done) => done && onItemPanelClose())}
        />
        {errorView}
      </>
    );
  }

  if (panel === "remove_image") {
    return (
      <>
        <RemoveImagePanel busy={busy} onCancel={() => setPanel(null)} onConfirm={(note) => void removeImage(note).then((done) => done && setPanel(null))} />
        {errorView}
      </>
    );
  }
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
      {pendingAutoHide ? <Text style={[styles.meta, styles.fullWidth]}>{t.accountSafety.autoHiddenHint}</Text> : null}
      {status === "open" ? (
        <ActionButton label={pendingAutoHide ? t.accountSafety.dismissAndRestore : t.moderationQueue.dismiss} onPress={() => void decide("dismiss")} disabled={busy} />
      ) : null}
      {content && !content.hidden ? (
        <ActionButton label={hideLabel} onPress={() => setPanel("hide")} disabled={busy} />
      ) : null}
      {pendingAutoHide ? <ActionButton label={t.accountSafety.confirmAutoHide} onPress={() => setPanel("hide")} disabled={busy} /> : null}
      {item.canRemoveImage ? <ActionButton label={t.moderationQueue.removeImage} onPress={() => setPanel("remove_image")} disabled={busy} danger /> : null}
      {preview.kind !== "missing" && !preview.author.suspended ? (
        <ActionButton label={t.moderationQueue.suspend} onPress={() => setPanel("suspend")} disabled={busy} danger />
      ) : null}
      {activeHideActionId && content && !pendingAutoHide ? (
        <ActionButton
          label={restoreLabel}
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
  const decisions = useDecisions(item, onChanged);
  const [itemToClear, setItemToClear] = useState<ModerationCollectionItem | null>(null);
  return (
    <View style={styles.card} testID={`moderation-${item.targetType}-${item.targetId}`}>
      <Text style={styles.title}>{[t.moderationQueue.target[item.targetType], t.moderationQueue.reportCount(item.reportCount)].join(" · ")}</Text>
      <Text style={styles.meta}>{t.moderationQueue.lastReport(ago(item.lastReportedAt))}</Text>
      <ItemPreview preview={item.preview} autoHidden={item.activeHideAutomatic} busy={decisions.busy} onRemoveItemImage={setItemToClear} />
      <ReportDetails item={item} />
      <ItemDecisions item={item} status={status} decisions={decisions} itemToClear={itemToClear} onItemPanelClose={() => setItemToClear(null)} />
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
  extract: { gap: space.xs },
  extractEntry: { paddingVertical: space.xs, paddingHorizontal: space.sm, borderRadius: radius.sm, borderWidth: 1, borderColor: color.filet },
  extractReported: { borderColor: color.danger },
  collectionName: { fontSize: font.secondary, fontWeight: "600", color: color.encre },
  collectionItem: { flexDirection: "row", gap: space.sm, paddingVertical: space.xs, borderTopWidth: 1, borderTopColor: color.filet },
  itemImage: { width: 56, height: 56, borderRadius: radius.sm, backgroundColor: color.plinthe, overflow: "hidden" },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: space.sm, marginTop: space.md },
  fullWidth: { width: "100%" },
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
