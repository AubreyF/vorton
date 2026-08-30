import { LogOut } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";

import { ExportMenuSection } from "./export-controls.js";
import { AppearanceMenuSections } from "./theme-controls.js";

export function accountInitial(email: string | null | undefined) {
  return (email?.trim()[0] ?? "?").toUpperCase();
}

export function AccountMenu({
  email,
  installationName,
  onSignOut,
}: {
  email: string | null | undefined;
  installationName: string;
  onSignOut: () => void | Promise<void>;
}) {
  const controlsRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const accountHeadingId = useId();
  const identity = email ?? installationName;

  const closeMenu = useCallback((restoreFocus = true) => {
    setOpen(false);
    if (restoreFocus) {
      triggerRef.current?.focus({ preventScroll: true });
    }
  }, []);

  const openMenu = useCallback((focusTarget?: HTMLElement) => {
    setOpen(true);
    if (focusTarget) {
      window.requestAnimationFrame(() => {
        focusTarget.focus({ preventScroll: true });
      });
    }
  }, []);

  useEffect(() => {
    function dismiss(event: PointerEvent) {
      if (open && !controlsRef.current?.contains(event.target as Node)) {
        closeMenu(false);
      }
    }

    function dismissWithKeyboard(event: KeyboardEvent) {
      if (event.key === "Escape" && open) {
        closeMenu();
      }
    }

    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", dismissWithKeyboard);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", dismissWithKeyboard);
    };
  }, [closeMenu, open]);

  async function signOut() {
    closeMenu(false);
    await onSignOut();
  }

  return (
    <div className="account-controls" ref={controlsRef}>
      <button
        type="button"
        className="account-menu-trigger"
        ref={triggerRef}
        aria-label={`Account menu for ${identity}`}
        aria-controls={panelId}
        aria-expanded={open}
        title="Account and tools"
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setOpen((current) => !current);
          }
        }}
      >
        <span className="account-avatar" aria-hidden="true">
          {accountInitial(email)}
        </span>
      </button>
      <div
        className="account-menu-panel"
        id={panelId}
        aria-label="Account and tools"
        hidden={!open}
      >
        <AppearanceMenuSections
          open={open}
          onRequestClose={() => closeMenu()}
        />
        <ExportMenuSection
          installationName={installationName}
          onRequestClose={() => closeMenu()}
          onRequestOpen={openMenu}
        />
        <section
          className="account-menu-section account-menu-identity"
          aria-labelledby={accountHeadingId}
        >
          <p id={accountHeadingId}>Account</p>
          <div className="account-identity-row">
            <span
              className="account-avatar account-avatar-large"
              aria-hidden="true"
            >
              {accountInitial(email)}
            </span>
            <span className="account-identity-copy">
              <strong>{identity}</strong>
              <span>{installationName}</span>
            </span>
          </div>
          <button
            className="account-sign-out"
            type="button"
            onClick={() => void signOut()}
          >
            <LogOut size={17} strokeWidth={1.8} aria-hidden="true" />
            Log out
          </button>
        </section>
      </div>
    </div>
  );
}
