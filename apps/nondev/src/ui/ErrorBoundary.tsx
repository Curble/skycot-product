import { CircleAlert } from "lucide-react";
import { Component, type ErrorInfo, type ReactNode } from "react";

import { PRODUCT_NAME } from "../brand";
import { Button } from "./Button";
import { Card } from "./Card";

interface State {
  readonly failed: boolean;
}

/**
 * The last line of defence above the whole app: one component throwing must
 * never leave a non-developer looking at a blank page. The card keeps the
 * product's own look (it is rendered outside the shell, so it cannot depend on
 * it) and offers the one action that always works.
 */
export class ErrorBoundary extends Component<{ readonly children: ReactNode }, State> {
  override state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error(`[${PRODUCT_NAME}] the app hit an error it could not recover from`, error, info);
  }

  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="fm-standalone" data-sober="">
        <Card label={PRODUCT_NAME}>
          <div className="fm-standalone__card" role="alert">
            <span className="fm-standalone__icon fm-standalone__icon--danger" aria-hidden>
              <CircleAlert size={30} strokeWidth={1.6} />
            </span>
            <h1 className="fm-standalone__title">Something went wrong</h1>
            <p className="fm-standalone__text">
              {PRODUCT_NAME} hit a snag it couldn't recover from. Your conversations and projects
              are safe on your Mac; reloading brings everything back.
            </p>
            <div className="fm-standalone__actions">
              <Button variant="primary" onClick={() => window.location.reload()}>
                Reload
              </Button>
            </div>
          </div>
        </Card>
      </div>
    );
  }
}
