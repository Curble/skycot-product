// Find in a conversation, the drawing half: the word being found, and a text that paints it.
// Only text inside a message bubble (see Bubble) is painted; cards and notes are left alone.
import { createContext, useContext, type ReactNode } from "react";

import { splitHighlights } from "../features/tidy/findInConversation";

const FindWordContext = createContext("");
const InMessageContext = createContext(false);

export const FindWordProvider = FindWordContext.Provider;

/** Wrap a message's content so the words inside it can be highlighted. */
export function InMessage({
  on,
  children,
}: {
  readonly on: boolean;
  readonly children: ReactNode;
}) {
  return <InMessageContext.Provider value={on}>{children}</InMessageContext.Provider>;
}

/** The text, with the word being found marked. Plain text when nothing is being found. */
export function Highlight({ text }: { readonly text: string }) {
  const word = useContext(FindWordContext);
  const inMessage = useContext(InMessageContext);
  if (!inMessage || word.trim().length === 0) return <>{text}</>;
  const pieces = splitHighlights(text, word);
  if (!pieces.some((piece) => piece.match)) return <>{text}</>;
  return (
    <>
      {pieces.map((piece, index) =>
        piece.match ? (
          <mark key={index} className="fm-find-mark" data-find="">
            {piece.text}
          </mark>
        ) : (
          piece.text
        ),
      )}
    </>
  );
}
