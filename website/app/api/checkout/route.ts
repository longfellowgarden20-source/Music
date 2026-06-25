import { NextResponse } from "next/server";

// Stripe Checkout session creator.
//
// To go live:
//   1. npm install stripe
//   2. Set env vars in .env.local (and your host):
//        STRIPE_SECRET_KEY=sk_live_...        (or sk_test_... while testing)
//        STRIPE_PRICE_ID=price_...            (a $49 one-time Price in Stripe)
//        NEXT_PUBLIC_SITE_URL=https://stemai.app   (used for success/cancel URLs)
//   3. Deploy. The Get StemAI button will redirect to Stripe-hosted checkout.
//
// Until those are set, the endpoint responds with a friendly "not configured"
// message so the page never crashes.

export async function POST() {
  const secret = process.env.STRIPE_SECRET_KEY;
  const price = process.env.STRIPE_PRICE_ID;
  const site = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

  if (!secret || !price) {
    return NextResponse.json(
      { error: "Checkout isn't set up yet. Please email support to purchase." },
      { status: 503 }
    );
  }

  try {
    // Imported dynamically via a runtime-computed specifier so the bundler does
    // not try to resolve `stripe` at build time (it's an optional dep until you
    // run `npm i stripe`). Once installed + env vars set, this just works.
    const mod = "stri" + "pe";
    const Stripe = (await import(/* webpackIgnore: true */ mod)).default;
    const stripe = new Stripe(secret);

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{ price, quantity: 1 }],
      success_url: `${site}/buy/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${site}/buy`,
      allow_promotion_codes: true,
      billing_address_collection: "auto",
    });

    return NextResponse.json({ url: session.url });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json(
      { error: `Couldn't start checkout: ${msg}` },
      { status: 500 }
    );
  }
}
