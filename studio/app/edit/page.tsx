import { Suspense } from "react";
import EditStudio from "./EditStudio";

export default function EditPage() {
  return (
    <Suspense fallback={<div style={{ padding: 60, textAlign: "center", color: "var(--muted)" }}>Loading…</div>}>
      <EditStudio />
    </Suspense>
  );
}
