import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

/**
 * Clerk reads its session cookie on every request so `auth()` can answer in the account API
 * (docs/adr/011-coach-accounts.md). Without Clerk's keys (a fork, the browser journeys) every
 * request passes straight through and the fixture or nothing signs coaches in.
 */
const clerk = !!process.env.CLERK_SECRET_KEY && !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

export default clerk ? clerkMiddleware({ debug: process.env.CLERK_DEBUG === "1" }) : () => NextResponse.next();

export const config = {
  // every page and API route; never the build output, the service worker or a static file
  matcher: ["/((?!_next|sw\\.js|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|json|txt|webmanifest)).*)", "/(api)(.*)"],
};
