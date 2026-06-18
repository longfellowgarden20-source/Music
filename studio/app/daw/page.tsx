import { Suspense } from "react";
import DAWStudio from "./DAWStudio";

export default function DawPage() {
  return (
    <Suspense fallback={<div style={{ background: "#070710", height: "100vh" }} />}>
      <DAWStudio />
    </Suspense>
  );
}
