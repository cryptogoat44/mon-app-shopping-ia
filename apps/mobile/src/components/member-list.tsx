import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import type { MemberRow } from "@monapp/shared-types";
import { color, font, radius, space } from "@/theme/tokens";
import { t } from "@/i18n";
import { Avatar } from "@/components/avatar";
import { ErrorMessage } from "@/components/error-message";
import { LoadFailure } from "@/components/load-failure";
import { LockIcon } from "@/components/icons";
import { Skeleton } from "@/components/skeleton";
import { themedStyles } from "@/theme/themed-styles";

// Une liste de membres (lot « vie sociale ») : demandes d'abonnement reçues
// aujourd'hui ; abonnés, abonnements, « Aimé par »… ensuite. Le serveur décide
// seul de qui y figure (lib/memberRows.ts) : une page peut être plus courte
// que prévu, ou vide, alors qu'il en reste — seul `hasMore` dit s'il y a une
// suite. Jamais de date dans une ligne.

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
}

export function MemberList({ members, error, onRetry, emptyText, hasMore, loadingMore, moreError, onLoadMore, loadMoreLabel, onOpenProfile, renderActions }: MemberListProps) {
  if (members === null) {
    if (error) return <LoadFailure message={error} onRetry={onRetry} />;
    return (
      <View>
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
    <View>
      {members.length === 0 && !hasMore ? <Text style={styles.empty}>{emptyText}</Text> : null}
      {members.map((member) => (
        <View key={member.id} style={styles.row}>
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
      ))}
      {moreError ? <ErrorMessage style={styles.moreError}>{moreError}</ErrorMessage> : null}
      {loadingMore ? <ActivityIndicator color={color.encre} style={styles.loader} /> : null}
      {hasMore && !loadingMore ? (
        <Pressable style={styles.more} onPress={onLoadMore} accessibilityRole="button">
          <Text style={styles.moreLabel}>{loadMoreLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = themedStyles(() => ({
  row: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingVertical: space.sm, borderBottomWidth: 1, borderBottomColor: color.filet },
  person: { flex: 1, flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: 44 },
  avatarPlaceholder: { width: 40, height: 40, borderRadius: radius.full },
  rowText: { flex: 1 },
  nameLine: { flexDirection: "row", alignItems: "center", gap: 6 },
  displayName: { flexShrink: 1, fontSize: font.secondary, fontWeight: "600", color: color.encre },
  username: { fontSize: font.caption, color: color.acier },
  actions: { flexDirection: "row", alignItems: "center", gap: space.xs },
  empty: { fontSize: font.secondary, color: color.acier, textAlign: "center", marginTop: space.lg, lineHeight: 20 },
  moreError: { fontSize: font.secondary, marginTop: space.md },
  loader: { marginTop: space.md },
  more: { alignSelf: "center", marginTop: space.md, minHeight: 44, paddingHorizontal: space.lg, borderRadius: radius.md, borderWidth: 1, borderColor: color.filet, alignItems: "center", justifyContent: "center" },
  moreLabel: { fontSize: font.secondary, fontWeight: "600", color: color.vert },
}));
