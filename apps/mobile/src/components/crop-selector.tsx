import { useMemo, useRef, useState } from "react";
import { PanResponder, StyleSheet, View, type LayoutChangeEvent } from "react-native";
import { Image } from "expo-image";
import type { CropRect } from "@monapp/shared-types";
import { color } from "@/theme/tokens";
import { containBox, cropToBox, moveCrop, resizeCrop, scaleCrop, type Corner, type Size } from "@/lib/crop-geometry";

const HANDLE_TOUCH = 44; // zone tactile d'un coin (norme Apple)
const HANDLE_ARM = 22; // longueur visible des équerres
const CORNERS: Corner[] = ["topLeft", "topRight", "bottomLeft", "bottomRight"];

interface Props {
  uri: string;
  crop: CropRect;
  onChange: (crop: CropRect) => void;
  /** Taille réelle de l'image, une fois chargée. */
  onImageSize?: (size: Size) => void;
  /** Vrai pendant un glissement — le parent coupe alors son défilement. */
  onDragChange?: (dragging: boolean) => void;
  height: number;
}

// Sélection de la zone à analyser : l'image entière (jamais rognée), un
// cadre à déplacer ou à étirer par ses quatre coins, l'extérieur assombri.
// PanResponder fonctionne au doigt (iPhone) comme à la souris (web). Pour
// VoiceOver, le cadre est « réglable » : balayer vers le haut ou le bas
// l'agrandit ou le réduit autour de son centre.
export function CropSelector({ uri, crop, onChange, onImageSize, onDragChange, height }: Props) {
  const [container, setContainer] = useState<Size>({ width: 0, height });
  const [imageSize, setImageSize] = useState<Size | null>(null);

  const imageBox = imageSize ? containBox(container, imageSize) : null;
  const frame = imageBox ? cropToBox(crop, imageBox) : null;

  // Les gestionnaires de geste sont créés une fois ; ils lisent les valeurs
  // à jour via ces références.
  const latest = useRef({ crop, imageBox, onChange, onDragChange });
  latest.current = { crop, imageBox, onChange, onDragChange };
  const dragStart = useRef<CropRect>(crop);

  const responders = useMemo(() => {
    const make = (apply: (start: CropRect, dx: number, dy: number) => CropRect) =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          dragStart.current = latest.current.crop;
          latest.current.onDragChange?.(true);
        },
        onPanResponderMove: (_event, gesture) => {
          const box = latest.current.imageBox;
          if (!box || !box.width || !box.height) return;
          latest.current.onChange(apply(dragStart.current, gesture.dx / box.width, gesture.dy / box.height));
        },
        onPanResponderRelease: () => latest.current.onDragChange?.(false),
        onPanResponderTerminate: () => latest.current.onDragChange?.(false),
      });

    return {
      move: make((start, dx, dy) => moveCrop(start, dx, dy)),
      corners: Object.fromEntries(
        CORNERS.map((corner) => [corner, make((start, dx, dy) => resizeCrop(start, corner, dx, dy))])
      ) as Record<Corner, ReturnType<typeof PanResponder.create>>,
    };
  }, []);

  function handleLayout(event: LayoutChangeEvent) {
    const { width, height: measured } = event.nativeEvent.layout;
    setContainer({ width, height: measured });
  }

  return (
    <View style={[styles.container, { height }]} onLayout={handleLayout}>
      <Image
        source={{ uri }}
        style={StyleSheet.absoluteFill}
        contentFit="contain"
        onLoad={(event) => {
          const size = { width: event.source.width, height: event.source.height };
          setImageSize(size);
          onImageSize?.(size);
        }}
        accessibilityIgnoresInvertColors
      />

      {imageBox && frame ? (
        <>
          {/* Extérieur du cadre assombri, en quatre bandes */}
          <View pointerEvents="none" style={[styles.dim, { left: imageBox.left, top: imageBox.top, width: imageBox.width, height: frame.top - imageBox.top }]} />
          <View pointerEvents="none" style={[styles.dim, { left: imageBox.left, top: frame.top + frame.height, width: imageBox.width, height: imageBox.top + imageBox.height - frame.top - frame.height }]} />
          <View pointerEvents="none" style={[styles.dim, { left: imageBox.left, top: frame.top, width: frame.left - imageBox.left, height: frame.height }]} />
          <View pointerEvents="none" style={[styles.dim, { left: frame.left + frame.width, top: frame.top, width: imageBox.left + imageBox.width - frame.left - frame.width, height: frame.height }]} />

          <View
            {...responders.move.panHandlers}
            style={[styles.frame, { left: frame.left, top: frame.top, width: frame.width, height: frame.height }]}
            accessible
            accessibilityRole="adjustable"
            accessibilityLabel="Zone analysée"
            accessibilityHint="Faites glisser le cadre ou ses coins. Balayez vers le haut ou le bas pour l'agrandir ou le réduire."
            accessibilityValue={{ text: `${Math.round(crop.width * 100)} % de la largeur, ${Math.round(crop.height * 100)} % de la hauteur` }}
            accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
            onAccessibilityAction={(event) =>
              onChange(scaleCrop(crop, event.nativeEvent.actionName === "increment" ? 1.15 : 1 / 1.15))
            }
          >
            <View pointerEvents="none" style={[styles.grid, { left: "33.33%", top: 0, bottom: 0, width: StyleSheet.hairlineWidth }]} />
            <View pointerEvents="none" style={[styles.grid, { left: "66.66%", top: 0, bottom: 0, width: StyleSheet.hairlineWidth }]} />
            <View pointerEvents="none" style={[styles.grid, { top: "33.33%", left: 0, right: 0, height: StyleSheet.hairlineWidth }]} />
            <View pointerEvents="none" style={[styles.grid, { top: "66.66%", left: 0, right: 0, height: StyleSheet.hairlineWidth }]} />
          </View>

          {CORNERS.map((corner) => {
            const isLeft = corner === "topLeft" || corner === "bottomLeft";
            const isTop = corner === "topLeft" || corner === "topRight";
            const x = isLeft ? frame.left : frame.left + frame.width;
            const y = isTop ? frame.top : frame.top + frame.height;
            return (
              <View
                key={corner}
                {...responders.corners[corner].panHandlers}
                importantForAccessibility="no-hide-descendants"
                accessibilityElementsHidden
                style={[styles.handle, { left: x - HANDLE_TOUCH / 2, top: y - HANDLE_TOUCH / 2 }]}
              >
                <View
                  pointerEvents="none"
                  style={[
                    styles.arm,
                    {
                      [isLeft ? "left" : "right"]: HANDLE_TOUCH / 2 - 2,
                      [isTop ? "top" : "bottom"]: HANDLE_TOUCH / 2 - 2,
                      borderLeftWidth: isLeft ? 3 : 0,
                      borderRightWidth: isLeft ? 0 : 3,
                      borderTopWidth: isTop ? 3 : 0,
                      borderBottomWidth: isTop ? 0 : 3,
                    },
                  ]}
                />
              </View>
            );
          })}
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { width: "100%", backgroundColor: color.plinthe, borderRadius: 4, overflow: "hidden" },
  dim: { position: "absolute", backgroundColor: "rgba(20,19,18,0.58)" },
  frame: { position: "absolute", borderWidth: 1, borderColor: "rgba(255,255,255,0.9)" },
  grid: { position: "absolute", backgroundColor: "rgba(255,255,255,0.3)" },
  handle: { position: "absolute", width: HANDLE_TOUCH, height: HANDLE_TOUCH },
  arm: { position: "absolute", width: HANDLE_ARM, height: HANDLE_ARM, borderColor: color.blanc },
});
