import { Check, ChevronDown } from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

export interface WorkspaceSwitchOption {
  id: string;
  displayName: string;
  realm: "personal" | "organizational";
}

export function resolveSelectedWorkspace<T extends WorkspaceSwitchOption>(
  workspaces: readonly T[],
  requestedId: string | null | undefined,
): T | undefined {
  return (
    workspaces.find((workspace) => workspace.id === requestedId) ??
    workspaces[0]
  );
}

function realmLabel(realm: WorkspaceSwitchOption["realm"]) {
  return realm === "personal" ? "Personal" : "Organization";
}

export function WorkspaceSwitcher({
  workspaces,
  selectedWorkspace,
  onSelect,
}: {
  workspaces: readonly WorkspaceSwitchOption[];
  selectedWorkspace: WorkspaceSwitchOption;
  onSelect(workspaceId: string): void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [open, setOpen] = useState(false);
  const menuId = useId();

  const close = useCallback((restoreFocus = true) => {
    setOpen(false);
    if (restoreFocus) {
      triggerRef.current?.focus({ preventScroll: true });
    }
  }, []);

  const focusOption = useCallback(
    (index: number) => {
      if (workspaces.length === 0) return;
      const normalized = (index + workspaces.length) % workspaces.length;
      optionRefs.current[normalized]?.focus({ preventScroll: true });
    },
    [workspaces.length],
  );

  const openMenu = useCallback(() => {
    setOpen(true);
    window.requestAnimationFrame(() => {
      const selectedIndex = Math.max(
        0,
        workspaces.findIndex(
          (workspace) => workspace.id === selectedWorkspace.id,
        ),
      );
      focusOption(selectedIndex);
    });
  }, [focusOption, selectedWorkspace.id, workspaces]);

  useEffect(() => {
    function dismiss(event: PointerEvent) {
      if (open && !rootRef.current?.contains(event.target as Node)) {
        close(false);
      }
    }

    function dismissWithKeyboard(event: KeyboardEvent) {
      if (event.key === "Escape" && open) {
        event.preventDefault();
        close();
      }
    }

    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", dismissWithKeyboard);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", dismissWithKeyboard);
    };
  }, [close, open]);

  function moveFocus(event: ReactKeyboardEvent<HTMLDivElement>) {
    const activeIndex = optionRefs.current.findIndex(
      (option) => option === document.activeElement,
    );
    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusOption(activeIndex + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      focusOption(activeIndex - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      focusOption(0);
    } else if (event.key === "End") {
      event.preventDefault();
      focusOption(workspaces.length - 1);
    }
  }

  return (
    <div className="workspace-switcher" ref={rootRef}>
      <button
        ref={triggerRef}
        className="brand-mark workspace-switcher-trigger"
        type="button"
        aria-label={`Switch workspace. Current workspace: ${selectedWorkspace.displayName}`}
        aria-haspopup="menu"
        aria-controls={menuId}
        aria-expanded={open}
        onClick={() => (open ? close(false) : openMenu())}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            openMenu();
          }
        }}
      >
        <span className="workspace-switcher-name">
          {selectedWorkspace.displayName}
        </span>
        <ChevronDown
          className="workspace-switcher-chevron"
          size={15}
          strokeWidth={2}
          aria-hidden="true"
        />
      </button>
      <div
        id={menuId}
        className="workspace-switcher-panel"
        role="menu"
        aria-label="Workspaces"
        hidden={!open}
        onKeyDown={moveFocus}
      >
        <header className="workspace-switcher-heading">
          <p>Workspaces</p>
          <span>{workspaces.length} available</span>
        </header>
        <div className="workspace-switcher-options">
          {workspaces.map((workspace, index) => {
            const selected = workspace.id === selectedWorkspace.id;
            return (
              <button
                key={workspace.id}
                ref={(element) => {
                  optionRefs.current[index] = element;
                }}
                type="button"
                className="workspace-switcher-option"
                role="menuitemradio"
                aria-checked={selected}
                onClick={() => {
                  if (!selected) onSelect(workspace.id);
                  close();
                }}
              >
                <span
                  className={`workspace-realm-mark workspace-realm-${workspace.realm}`}
                  aria-hidden="true"
                />
                <span className="workspace-switcher-option-copy">
                  <strong>{workspace.displayName}</strong>
                  <span>{realmLabel(workspace.realm)}</span>
                </span>
                <span className="workspace-switcher-current" aria-hidden="true">
                  {selected ? <Check size={16} strokeWidth={2.2} /> : null}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
