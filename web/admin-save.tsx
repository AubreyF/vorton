import type { ReactNode } from "react";
import "./admin-save.css";

/** One submit action, in the same place, for every editable Admin page. */
export function AdminSave({ busy, disabled = false, children }: { busy: boolean; disabled?: boolean; children?: ReactNode }) {
  return <footer className="admin-save"><span role="status">{children}</span><button type="submit" className="primary" disabled={busy || disabled}>{busy ? "Saving…" : "Save changes"}</button></footer>;
}
