// « Envoyer dans un message » (lot « messages, plus de confort ») : d'une
// publication du fil au choix d'une conversation, puis à la conversation,
// la publication jointe d'avance. Sans écran, testé à part
// (tests/messages-confort.test.ts). Rien de la publication ne voyage dans
// l'adresse en dehors de son identifiant : le serveur la relit, pour
// l'expéditeur à l'envoi, puis pour la personne qui la reçoit à chaque
// affichage.

/** L'écran du choix d'une conversation, pour cette publication. */
export function sendPostHref(postId: string): { pathname: "/choisir-conversation"; params: { postId: string } } {
  return { pathname: "/choisir-conversation", params: { postId } };
}
