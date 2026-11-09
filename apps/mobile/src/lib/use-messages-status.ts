import { useEffect, useState } from "react";
import type { MessagesStatus } from "@monapp/shared-types";
import { messagesStatus, onMessagesStatus } from "./conversations";

/** Disponibilité de la messagerie et conversations non lues, telles que lues
 * au dernier rafraîchissement (barre d'onglets, écrans des messages). Sans
 * la messagerie sur le serveur, `enabled` est faux : l'entrée est cachée. */
export function useMessagesStatus(): MessagesStatus {
  const [status, setStatus] = useState<MessagesStatus>(messagesStatus);
  useEffect(() => {
    setStatus(messagesStatus());
    return onMessagesStatus(setStatus);
  }, []);
  return status;
}
