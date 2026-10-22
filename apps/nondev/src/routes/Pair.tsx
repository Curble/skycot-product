// The local pairing screen, restyled as a centered card. Same working flow as
// before: a token in the URL fragment is submitted automatically; on success
// the fragment is reset and the page reloads so the WebSocket picks up the new
// session cookie, as the stock /pair route does.
import type { AuthSessionState } from "@t3tools/contracts";
import React, { startTransition, useEffect, useEffectEvent, useRef, useState } from "react";

import {
  peekPairingTokenFromUrl,
  stripPairingTokenFromUrl,
  submitServerAuthCredential,
} from "~/environments/primary/auth";

import { CLI_NAME, PRODUCT_NAME } from "../brand";
import { Mascot } from "../features/brand/Mascot";
import { Banner } from "../ui/Banner";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { TextField } from "../ui/TextField";

export function PairRoute({
  auth,
  initialErrorMessage,
}: {
  readonly auth: AuthSessionState["auth"];
  readonly initialErrorMessage?: string;
}) {
  const [autoPairToken] = useState(peekPairingTokenFromUrl);
  const [credential, setCredential] = useState(autoPairToken ?? "");
  const [problem, setProblem] = useState(
    initialErrorMessage ? calmPairingError(initialErrorMessage) : "",
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const autoSubmitAttemptedRef = useRef(false);
  const fieldRef = useRef<HTMLInputElement>(null);

  const submitCredential = async (nextCredential: string) => {
    setIsSubmitting(true);
    setProblem("");
    const submitError = await submitServerAuthCredential(nextCredential).then(
      () => null,
      (error: unknown) => (error instanceof Error ? error.message : String(error)),
    );
    setIsSubmitting(false);
    if (submitError !== null) {
      setProblem(calmPairingError(submitError));
      // The field is read-only while submitting, never disabled, so focus
      // stays; selecting the rejected code makes retyping one keystroke.
      fieldRef.current?.focus();
      fieldRef.current?.select();
      return;
    }
    startTransition(() => {
      window.location.hash = "/";
      window.location.reload();
    });
  };

  const handleSubmit = async (event?: React.SubmitEvent<HTMLFormElement>) => {
    event?.preventDefault();
    await submitCredential(credential);
  };

  const autoSubmit = useEffectEvent((token: string) => {
    void submitCredential(token);
  });

  useEffect(() => {
    if (!autoPairToken || autoSubmitAttemptedRef.current) return;
    autoSubmitAttemptedRef.current = true;
    stripPairingTokenFromUrl();
    autoSubmit(autoPairToken);
  }, [autoPairToken]);

  const acceptsTokens = auth.bootstrapMethods.includes("one-time-token");

  return (
    <StandalonePage>
      <span className="fm-standalone__art">
        <Mascot pose="hello" size={88} />
      </span>
      <h1 className="fm-standalone__title">Connect to your Mac</h1>
      <p className="fm-standalone__text">
        {PRODUCT_NAME} talks to the part of it that runs on your Mac. Paste the connection code it
        gave you, or open the link it printed, and you're in.
      </p>
      <form className="fm-standalone__form" onSubmit={(event) => void handleSubmit(event)}>
        <TextField
          label="Connection code"
          mono
          inputRef={fieldRef}
          autoCapitalize="none"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          readOnly={isSubmitting}
          aria-busy={isSubmitting}
          placeholder="Paste the code here"
          value={credential}
          onChange={(event) => setCredential(event.currentTarget.value)}
        />
        {problem ? <Banner tone="warning">{problem}</Banner> : null}
        <div className="fm-standalone__actions">
          <Button
            variant="primary"
            type="submit"
            disabled={isSubmitting || credential.trim().length === 0}
          >
            {isSubmitting ? "Connecting…" : "Connect"}
          </Button>
          <Button disabled={isSubmitting} onClick={() => window.location.reload()}>
            Try again
          </Button>
        </div>
      </form>
      <div className="fm-standalone__foot">
        {acceptsTokens
          ? `On the Mac that runs ${PRODUCT_NAME}, open Terminal (the Mac's built-in text window) and type “${CLI_NAME} pair”. It prints a link you can open on this device, or a code to paste above.`
          : "This Mac expects a trusted connection code before the app can connect. Ask whoever set it up."}
      </div>
    </StandalonePage>
  );
}

function calmPairingError(message: string): string {
  if (/expired|used|invalid|reject|unauthori|not found/i.test(message)) {
    return "That code didn't work. Codes are single-use and expire quickly — ask for a fresh one.";
  }
  if (/network|fetch|unreachable|timeout/i.test(message)) {
    return "Can't reach your Mac right now. Check it is awake, then try again.";
  }
  return "That didn't work. Ask for a fresh code and try again.";
}

/** Centered card for pairing, connecting and error screens. */
export function StandalonePage({ children }: { readonly children: React.ReactNode }) {
  return (
    <div className="fm-standalone">
      <Card label={PRODUCT_NAME}>
        <div className="fm-standalone__card">{children}</div>
      </Card>
    </div>
  );
}
