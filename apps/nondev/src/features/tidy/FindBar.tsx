// The find bar under a conversation's header, like the one in Safari and Notes. It counts and
// walks the highlighted words on the page (the stream paints them, see ui/Highlight), so the
// number always matches what the person can see.
import { ChevronDown, ChevronUp, Search } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import { isMacPlatform } from "@t3tools/shared/keybindings";

import { Button, IconButton } from "../../ui/Button";
import { matchCountLabel, stepMatch } from "./findInConversation";

const MARKS = ".fm-stream mark[data-find]";

/** Cmd+F on a Mac, Ctrl+F anywhere else. */
export function isFindShortcut(event: {
  readonly key: string;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
}): boolean {
  if (event.key.toLowerCase() !== "f" || event.altKey || event.shiftKey) return false;
  return isMacPlatform(navigator.platform) ? event.metaKey : event.ctrlKey;
}

function marks(): ReadonlyArray<HTMLElement> {
  return Array.from(document.querySelectorAll<HTMLElement>(MARKS));
}

export function FindBar({
  query,
  onQueryChange,
  onClose,
}: {
  readonly query: string;
  readonly onQueryChange: (query: string) => void;
  readonly onClose: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [count, setCount] = useState(0);
  // The match the person is on; null until they type or step.
  const [at, setAt] = useState<number | null>(null);
  // Bumped when the person moves, so the page scrolls then and not while a reply streams in.
  const [moved, setMoved] = useState(0);

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);

  // Count what is painted, now and whenever messages change.
  useEffect(() => {
    let frame = 0;
    const refresh = () => {
      frame = 0;
      setCount(marks().length);
    };
    const schedule = () => {
      if (frame === 0) frame = window.requestAnimationFrame(refresh);
    };
    schedule();
    const stream = document.querySelector(".fm-stream");
    const observer = new MutationObserver(schedule);
    if (stream) observer.observe(stream, { childList: true, subtree: true, characterData: true });
    return () => {
      observer.disconnect();
      if (frame !== 0) window.cancelAnimationFrame(frame);
    };
  }, [query]);

  // A new word starts at its first match.
  useEffect(() => {
    setAt(null);
    setMoved((n) => n + 1);
  }, [query]);

  const current = count === 0 ? null : at !== null && at < count ? at : 0;

  useEffect(() => {
    const all = marks();
    all.forEach((mark, index) => mark.classList.toggle("fm-find-mark--current", index === current));
  }, [current, count, query]);

  useEffect(() => {
    if (current === null) return;
    marks()[current]?.scrollIntoView({ block: "center", behavior: "smooth" });
    // Only when the person moves or types, not on every streamed word.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moved, count > 0]);

  const step = (direction: 1 | -1) => {
    const next = stepMatch(current, count, direction);
    if (next === null) return;
    setAt(next);
    setMoved((n) => n + 1);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      step(event.shiftKey ? -1 : 1);
    } else if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  };
  const label = matchCountLabel(query, current, count);
  return (
    <div className="fm-findbar" role="search">
      <div className="fm-search fm-findbar__field">
        <Search size={13} strokeWidth={1.8} aria-hidden />
        <input
          ref={input}
          type="search"
          className="fm-search__input"
          value={query}
          onChange={(event) => onQueryChange(event.currentTarget.value)}
          onKeyDown={onKeyDown}
          placeholder="Find in this conversation"
          aria-label="Find in this conversation"
          autoComplete="off"
          spellCheck={false}
        />
      </div>
      <span className="fm-findbar__count" role="status" aria-live="polite">
        {label}
      </span>
      <IconButton
        icon={ChevronUp}
        label="Previous match"
        size="sm"
        disabled={count === 0}
        onClick={() => step(-1)}
      />
      <IconButton
        icon={ChevronDown}
        label="Next match"
        size="sm"
        disabled={count === 0}
        onClick={() => step(1)}
      />
      <Button variant="plain" size="sm" onClick={onClose}>
        Done
      </Button>
    </div>
  );
}
