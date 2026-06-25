"use client";
import { useState } from "react";
import { T } from "../_shared/ui";

export default function BuyButton() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function checkout() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/checkout", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.url) {
        window.location.href = data.url; // redirect to Stripe Checkout
        return;
      }
      setError(data.error || "Checkout isn't available right now. Please try again or email support.");
    } catch {
      setError("Couldn't reach checkout. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <button
        onClick={checkout}
        disabled={loading}
        style={{
          width: "100%", background: T.green, color: "#000", fontSize: 16, fontWeight: 800,
          padding: "18px 0", borderRadius: 500, border: "none",
          cursor: loading ? "wait" : "pointer", opacity: loading ? 0.7 : 1, transition: "all .15s",
        }}
        onMouseEnter={e => { if (!loading) { e.currentTarget.style.background = T.greenBright; e.currentTarget.style.transform = "scale(1.02)"; } }}
        onMouseLeave={e => { e.currentTarget.style.background = T.green; e.currentTarget.style.transform = "scale(1)"; }}
      >
        {loading ? "Redirecting…" : "Get StemAI — $49"}
      </button>
      {error && (
        <div style={{ marginTop: 12, fontSize: 13, color: "#f87171", textAlign: "center", lineHeight: 1.5 }}>
          {error}
        </div>
      )}
    </div>
  );
}
