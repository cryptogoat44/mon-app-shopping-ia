import { useEffect, useRef } from "react";
import { isTrustedWebMessage, parseRobotMessage, robotCheckPageUrl, type RobotMessage } from "@/lib/robot-check";

// Site : la page hôte du widget dans une iframe de MÊME origine
// (public/verification-robot.html). Seuls comptent les messages de cette
// iframe-là, venus de l'origine du site ; tout le reste est ignoré.
export function RobotCheckFrame({ siteKey, locale, title, onMessage }: { siteKey: string; locale: string; title: string; onMessage: (message: RobotMessage) => void }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const origin = window.location.origin;

  useEffect(() => {
    function listen(event: MessageEvent) {
      if (!isTrustedWebMessage(event, { origin, source: frame.current?.contentWindow ?? null })) return;
      const message = parseRobotMessage(event.data);
      if (message) onMessage(message);
    }
    window.addEventListener("message", listen);
    return () => window.removeEventListener("message", listen);
  }, [origin, onMessage]);

  return (
    <iframe
      ref={frame}
      src={robotCheckPageUrl(origin, siteKey, locale)}
      title={title}
      onError={() => onMessage({ type: "error" })}
      style={{ width: 300, height: 65, border: 0, overflow: "hidden", colorScheme: "normal" }}
    />
  );
}
