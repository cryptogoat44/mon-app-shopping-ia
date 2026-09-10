import Svg, { Circle, Path, Rect } from "react-native-svg";
import { color } from "@/theme/tokens";

interface IconProps {
  size?: number;
  tint?: string;
  strokeWidth?: number;
}

export function SearchIcon({ size = 24, tint = color.encre, strokeWidth = 1.5 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={11} cy={11} r={6.5} stroke={tint} strokeWidth={strokeWidth} />
      <Path d="M20 20l-4.3-4.3" stroke={tint} strokeWidth={strokeWidth} strokeLinecap="round" />
    </Svg>
  );
}

export function FeedIcon({ size = 24, tint = color.encre, strokeWidth = 1.4 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x={3.5} y={5} width={17} height={14} rx={2} stroke={tint} strokeWidth={strokeWidth} />
      <Path d="M3.5 9.5h17" stroke={tint} strokeWidth={strokeWidth} />
    </Svg>
  );
}

export function BookmarkIcon({ size = 24, tint = color.encre, strokeWidth = 1.4 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M6.5 4.5h11a1 1 0 011 1V20l-6.5-4L5.5 20V5.5a1 1 0 011-1z"
        stroke={tint}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function PersonIcon({ size = 24, tint = color.encre, strokeWidth = 1.4 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={8.5} r={3.5} stroke={tint} strokeWidth={strokeWidth} />
      <Path d="M5 20c1.2-3.8 4-5.5 7-5.5s5.8 1.7 7 5.5" stroke={tint} strokeWidth={strokeWidth} strokeLinecap="round" />
    </Svg>
  );
}

export function VerifiedIcon({ size = 16, tint = color.vert, strokeWidth = 1.4 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <Circle cx={8} cy={8} r={7} stroke={tint} strokeWidth={strokeWidth} />
      <Path d="M5 8.2l2 2 4-4.4" stroke={tint} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function LinkIcon({ size = 18, tint = color.blanc, strokeWidth = 1.3 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 18 18" fill="none">
      <Path
        d="M7 11l4-4M6.5 4.5l1.6-1.6a2.5 2.5 0 013.5 3.5L10 8M11.5 13.5l-1.6 1.6a2.5 2.5 0 01-3.5-3.5L8 10"
        stroke={tint}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
      />
    </Svg>
  );
}

export function CameraIcon({ size = 18, tint = color.encre, strokeWidth = 1.2 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 18 18" fill="none">
      <Rect x={2.5} y={4} width={13} height={10.5} rx={1.5} stroke={tint} strokeWidth={strokeWidth} />
      <Circle cx={6.5} cy={8} r={1.4} stroke={tint} strokeWidth={strokeWidth * 0.9} />
      <Path d="M15.5 11.5L11.5 8.5 6 13" stroke={tint} strokeWidth={strokeWidth * 0.9} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function ClockIcon({ size = 24, tint = color.encre, strokeWidth = 1.1 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={12} r={7.5} stroke={tint} strokeWidth={strokeWidth} />
      <Path d="M12 8v4l3 1.6" stroke={tint} strokeWidth={strokeWidth} strokeLinecap="round" />
    </Svg>
  );
}

export function HeartIcon({ size = 19, tint = color.acier, filled = false }: IconProps & { filled?: boolean }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 18 18" fill="none">
      <Path
        d="M9 15.3S2.5 11.4 2.5 6.9A3.4 3.4 0 019 4.8a3.4 3.4 0 016.5 2.1c0 4.5-6.5 8.4-6.5 8.4z"
        stroke={tint}
        strokeWidth={1.2}
        fill={filled ? tint : "none"}
      />
    </Svg>
  );
}

export function GearIcon({ size = 22, tint = color.encre, strokeWidth = 1.3 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={12} r={3.2} stroke={tint} strokeWidth={strokeWidth} />
      <Path
        d="M12 3.5v2M12 18.5v2M20.5 12h-2M5.5 12h-2M17.7 6.3l-1.4 1.4M7.7 16.3l-1.4 1.4M17.7 17.7l-1.4-1.4M7.7 7.7L6.3 6.3"
        stroke={tint}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
      />
    </Svg>
  );
}

export function NotFoundIcon({ size = 44, tint = color.acier, strokeWidth = 1.3 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={10.5} cy={10.5} r={6.5} stroke={tint} strokeWidth={strokeWidth} />
      <Path d="M15.2 15.2L19 19" stroke={tint} strokeWidth={strokeWidth} strokeLinecap="round" />
      <Path d="M8 13l5-5" stroke={tint} strokeWidth={strokeWidth * 0.9} strokeLinecap="round" />
    </Svg>
  );
}
