import type { ReactNode } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, Text, View } from "react-native";
import type { MemberRow } from "@monapp/shared-types";
import { color, font, radius, space } from "@/theme/tokens";
import { t } from "@/i18n";
import { Avatar } from "@/components/avatar";
import { ErrorMessage } from "@/components/error-message";
import { LoadFailure } from "@/components/load-failure";
import { LockIcon } from "@/components/icons";
import { MEMBER_NAME_MIN_WIDTH, MEMBER_ROW_GAP } from "@/lib/member-lists";
import { Skeleton } from "@/components/skeleton";
import { themedStyles } from "@/theme/themed-styles";

// Une liste de membres (lot « vie sociale ») : demandes d'abonnement reçues,
// abonnés, abonnements, « Aimé par ». Le serveur décide seul de qui
// y figure (lib/memberRows.ts) : une page peut être plus courte que prévu, ou
// vide, alors qu'il en reste — seul `hasMore` dit s'il y a une suite. Jamais
// de date dans une ligne. La liste occupe l'écran et défile elle-même.

export interface MemberListProps {
  /** null : premier chargement en cours. */
  members: MemberRow[] | null;
  /** Échec du premier chargement (avec « Réessayer »). */
  error: string | null;
  onRetry: () => void;
  /** Phrase affichée quand il n'y a personne (et plus rien à charger). */
  emptyText: string;
  hasMore: boolean;
  loadingMore: boolean;
  /** Échec du chargement de la suite. */
  moreError: string | null;
  onLoadMore: () => void;
  loadMoreLabel: string;
  onOpenProfile: (member: MemberRow) => void;
  /** Boutons propres à la liste, à droite de chaque ligne (Accepter / Refuser…). */
  renderActions?: (member: MemberRow) => ReactNode;
  /** Sous la phrase d'une liste vide (par exemple « Trouver des profils »). */
  emptyAction?: ReactNode;
  /** La fin de la liste est atteinte en défilant : charger la suite, si l'écran le veut. */
  onEndReached?: () => void;
  /** Tirer pour rafraîchir. */
  refreshing?: boolean;
  onRefresh?: () => void;
  /** Une phrase sous la liste (« Aimé par » : certains comptes n'apparaissent pas). */
  footerNote?: string | null;
}

export function MemberList({
  members,
  error,
  onRetry,
  emptyText,
  hasMore,
  loadingMore,
  moreError,
  onLoadMore,
  loadMoreLabel,
  onOpenProfile,
  renderActions,
  emptyAction,
  onEndReached,
  refreshing,
  onRefresh,
  footerNote,
}: MemberListProps) {
  if (members === null) {
    if (error) {
      return (
        <View style={styles.content}>
          <LoadFailure message={error} onRetry={onRetry} />
        </View>
      );
    }
    return (
      <View style={styles.content}>
        {[0, 1, 2].map((index) => (
          <View key={index} style={styles.row}>
            <Skeleton style={styles.avatarPlaceholder} />
            <View style={styles.rowText}>
              <Skeleton style={{ width: "50%", height: 13, marginBottom: 6 }} />
              <Skeleton style={{ width: "30%", height: 11 }} />
            </View>
          </View>
        ))}
      </View>
    );
  }

  return (
    <FlatList
      data={members}
      keyExtractor={(member) => member.id}
      contentContainerStyle={styles.content}
      renderItem={({ item: member }) => (
        <View style={styles.row}>
          <Pressable onPress={() => onOpenProfile(member)} style={styles.person} accessibilityRole="link" accessibilityLabel={t.common.viewProfile(member.displayName)}>
            <Avatar uri={member.avatarUrl} userId={member.id} displayName={member.displayName} username={member.username} size={40} />
            <View style={styles.rowText}>
              <View style={styles.nameLine}>
                <Text style={styles.displayName} numberOfLines={1}>
                  {member.displayName}
                </Text>
                {member.isPrivate ? (
                  <View accessible accessibilityLabel={t.privateAccount.lockLabel}>
                    <LockIcon size={14} tint={color.acier} />
                  </View>
                ) : null}
              </View>
              <Text style={styles.username} numberOfLines={1}>
                @{member.username}
              </Text>
            </View>
          </Pressable>
          {renderActions ? <View style={styles.actions}>{renderActions(member)}</View> : null}
        </View>
      )}
      // Personne à montrer, et plus rien à charger : la phrase de la liste vide.
      ListEmptyComponent={
        hasMore ? null : (
          <View>
            <Text style={styles.empty}>{emptyText}</Text>
            {emptyAction}
          </View>
        )
      }
      ListFooterComponent={
        <View>
          {moreError ? <ErrorMessage style={styles.moreError}>{moreError}</ErrorMessage> : null}
          {loadingMore ? <ActivityIndicator color={color.encre} style={styles.loader} /> : null}
          {hasMore && !loadingMore ? (
            <Pressable style={styles.more} onPress={onLoadMore} accessibilityRole="button">
              <Text style={styles.moreLabel}>{loadMoreLabel}</Text>
            </Pressable>
          ) : null}
          {footerNote ? <Text style={styles.footerNote}>{footerNote}</Text> : null}
        </View>
      }
      onEndReached={onEndReached}
      onEndReachedThreshold={0.4}
      refreshControl={onRefresh ? <RefreshControl refreshing={refreshing === true} onRefresh={onRefresh} tintColor={color.encre} /> : undefined}
    />
  );
}

const styles = themedStyles(() => ({
  content: { paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.xxl, maxWidth: 480, alignSelf: "center", width: "100%" },
  // Écran étroit ou texte agrandi : les boutons passent sous le nom, alignés à
  // droite, plutôt que de l'écraser (lib/member-lists.ts).
  row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: MEMBER_ROW_GAP, paddingVertical: space.sm, borderBottomWidth: 1, borderBottomColor: color.filet },
  person: { flex: 1, minWidth: MEMBER_NAME_MIN_WIDTH, flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: 44 },
  avatarPlaceholder: { width: 40, height: 40, borderRadius: radius.full },
  rowText: { flex: 1 },
  nameLine: { flexDirection: "row", alignItems: "center", gap: 6 },
  displayName: { flexShrink: 1, fontSize: font.secondary, fontWeight: "600", color: color.encre },
  username: { fontSize: font.caption, color: color.acier },
  actions: { flexDirection: "row", alignItems: "center", gap: space.xs, marginLeft: "auto" },
  empty: { fontSize: font.secondary, color: color.acier, textAlign: "center", marginTop: space.lg, lineHeight: 20 },
  moreError: { fontSize: font.secondary, marginTop: space.md },
  loader: { marginTop: space.md },
  more: { alignSelf: "center", marginTop: space.md, minHeight: 44, paddingHorizontal: space.lg, borderRadius: radius.md, borderWidth: 1, borderColor: color.filet, alignItems: "center", justifyContent: "center" },
  moreLabel: { fontSize: font.secondary, fontWeight: "600", color: color.vert },
  footerNote: { fontSize: font.caption, color: color.acier, textAlign: "center", marginTop: space.lg, lineHeight: 18 },
}));
