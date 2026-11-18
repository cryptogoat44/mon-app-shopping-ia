import { useRef, useState } from "react";
import { FlatList, Platform, Pressable, Text, View, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import type { PostPhoto } from "@monapp/shared-types";
import { SpotImage } from "@/components/spot-image";
import { carouselFrameAccessibility, clampIndex, counterText, indexFromOffset, stepIndex } from "@/lib/carousel";
import { t } from "@/i18n";
import { color, font, radius, space } from "@/theme/tokens";
import { themedStyles } from "@/theme/themed-styles";

// Plusieurs photos d'une publication (lot « vie sociale », migration 0047) :
// une liste horizontale, page par page, des points et un compteur « 2/5 ».
// Sur le site, « Photo précédente » et « Photo suivante » en boutons (pas de
// glissement à la souris). Sans glisser non plus avec VoiceOver : sur
// l'iPhone, le carrousel est « réglable » (balayer vers le haut ou le bas
// change de photo), et chaque photo a son libellé « Photo 2 sur 5 ». Sur le
// site, un simple groupe qui laisse les deux boutons aux lecteurs d'écran
// (lib/carousel.ts, carouselFrameAccessibility). Le toucher passe à
// `onPress` (double toucher : « j'aime », comme pour une seule photo).
// Logique de position : lib/carousel.ts.

export function PostCarousel({ photos, label, recyclingKey, onPress }: { photos: PostPhoto[]; label: string; recyclingKey: string; onPress: () => void }) {
  const [width, setWidth] = useState(0);
  const [index, setIndex] = useState(0);
  const listRef = useRef<FlatList<PostPhoto>>(null);
  const count = photos.length;
  const current = clampIndex(index, count);

  function goTo(next: number) {
    const target = clampIndex(next, count);
    setIndex(target);
    if (width > 0) listRef.current?.scrollToOffset({ offset: target * width, animated: true });
  }

  function onScroll(event: NativeSyntheticEvent<NativeScrollEvent>) {
    const next = indexFromOffset(event.nativeEvent.contentOffset.x, width, count);
    if (next !== current) setIndex(next);
  }

  return (
    <View
      style={styles.frame}
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      {...carouselFrameAccessibility(Platform.OS === "web", label, t.carousel.position(current + 1, count))}
      accessibilityValue={{ text: t.carousel.position(current + 1, count) }}
      accessibilityActions={[{ name: "increment" }, { name: "decrement" }, { name: "activate" }]}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === "increment") goTo(stepIndex(current, 1, count));
        else if (event.nativeEvent.actionName === "decrement") goTo(stepIndex(current, -1, count));
        else onPress();
      }}
      testID="carrousel-photos"
    >
      {width > 0 ? (
        <FlatList
          ref={listRef}
          data={photos}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          keyExtractor={(photo, position) => `${position}-${photo.url}`}
          getItemLayout={(_, position) => ({ length: width, offset: width * position, index: position })}
          onScroll={onScroll}
          scrollEventThrottle={32}
          renderItem={({ item, index: position }) => (
            <Pressable onPress={onPress} style={{ width }} accessible={false}>
              <SpotImage
                hdUri={item.url}
                fallbackUri={item.thumbUrl}
                style={styles.media}
                fit="cover"
                recyclingKey={`${recyclingKey}-${position}`}
                accessibilityLabel={t.carousel.position(position + 1, count)}
              />
            </Pressable>
          )}
        />
      ) : null}
      <View style={styles.counter} pointerEvents="none">
        <Text style={styles.counterText}>{counterText(current, count)}</Text>
      </View>
      <View style={styles.dots} pointerEvents="none">
        {photos.map((photo, position) => (
          <View key={`${position}-${photo.url}`} style={[styles.dot, position === current ? styles.dotActive : null]} />
        ))}
      </View>
      {/* Site : des boutons, la souris ne fait pas glisser une liste. */}
      {Platform.OS === "web" && current > 0 ? (
        <Pressable onPress={() => goTo(current - 1)} style={[styles.arrow, styles.arrowLeft]} accessibilityRole="button" accessibilityLabel={t.carousel.previous}>
          <Text style={styles.arrowText}>‹</Text>
        </Pressable>
      ) : null}
      {Platform.OS === "web" && current < count - 1 ? (
        <Pressable onPress={() => goTo(current + 1)} style={[styles.arrow, styles.arrowRight]} accessibilityRole="button" accessibilityLabel={t.carousel.next}>
          <Text style={styles.arrowText}>›</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = themedStyles(() => ({
  frame: { width: "100%", aspectRatio: 1, backgroundColor: color.plinthe, borderRadius: radius.sm, overflow: "hidden" },
  media: { width: "100%", aspectRatio: 1 },
  counter: { position: "absolute", top: space.sm, right: space.sm, backgroundColor: color.voileImage, borderRadius: radius.full, paddingHorizontal: 9, paddingVertical: 3 },
  counterText: { fontSize: 12, fontWeight: "600", color: color.surImage },
  dots: { position: "absolute", bottom: space.sm, left: 0, right: 0, flexDirection: "row", justifyContent: "center", gap: 5 },
  dot: { width: 6, height: 6, borderRadius: radius.full, backgroundColor: color.surImage, opacity: 0.5 },
  dotActive: { opacity: 1 },
  arrow: {
    position: "absolute",
    top: "50%",
    marginTop: -22,
    width: 44,
    height: 44,
    borderRadius: radius.full,
    backgroundColor: color.voileImage,
    alignItems: "center",
    justifyContent: "center",
  },
  arrowLeft: { left: space.sm },
  arrowRight: { right: space.sm },
  arrowText: { fontSize: font.title, lineHeight: font.title + 2, color: color.surImage, fontWeight: "600" },
}));
