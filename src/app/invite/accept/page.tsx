"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";

type PageState = "checking" | "sign-in" | "accepted" | "error";

export default function AcceptInvitationPage() {
  const router = useRouter();
  const [status, setStatus] = useState<PageState>("checking");
  const [message, setMessage] = useState("Checking your invitation…");

  useEffect(() => {
    let cancelled = false;
    const accept = async () => {
      const fragmentToken = new URLSearchParams(window.location.hash.slice(1)).get("token");
      if (fragmentToken) {
        window.sessionStorage.setItem("ledgerly.invitationToken", fragmentToken);
        window.history.replaceState(null, "", window.location.pathname);
      }
      const token = fragmentToken || window.sessionStorage.getItem("ledgerly.invitationToken");
      if (!token) {
        setMessage("This invitation link is missing its token. Ask the workspace administrator for a new link.");
        setStatus("error");
        return;
      }
      try {
        const sessionResponse = await fetch("/api/auth/session", { cache: "no-store", credentials: "same-origin" });
        const session = await sessionResponse.json() as { user?: { id?: string } };
        if (!session.user?.id) {
          setStatus("sign-in");
          setMessage("Sign in with the email address this invitation was sent to.");
          return;
        }
        const response = await fetch("/api/v1/invitations/accept", {
          method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });
        const result = await response.json() as { data?: { organisationId?: string }; error?: { message?: string } };
        if (!response.ok) throw new Error(result.error?.message || "This invitation could not be accepted.");
        if (result.data?.organisationId) window.localStorage.setItem("ledgerly.activeWorkspace", result.data.organisationId);
        window.sessionStorage.removeItem("ledgerly.invitationToken");
        if (cancelled) return;
        setMessage("Invitation accepted. Opening your workspace…");
        setStatus("accepted");
        window.setTimeout(() => router.replace("/"), 600);
      } catch (error) {
        window.sessionStorage.removeItem("ledgerly.invitationToken");
        if (cancelled) return;
        setMessage(error instanceof Error ? error.message : "This invitation could not be accepted.");
        setStatus("error");
      }
    };
    void accept();
    return () => { cancelled = true; };
  }, [router]);

  return (
    <main className="connection-state">
      <section className="setup-card invitation-accept-card" aria-live="polite">
        <span className="brand-mark" aria-hidden="true">l</span>
        <p className="eyebrow">LEDGERLY WORKSPACE INVITATION</p>
        <h1>{status === "accepted" ? "You’re in" : status === "sign-in" ? "Sign in to accept" : status === "error" ? "Invitation unavailable" : "Accept invitation"}</h1>
        <p role={status === "error" ? "alert" : "status"}>{message}</p>
        {status === "sign-in" && <button className="primary" type="button" onClick={() => void signIn("ledgerly-oidc", { redirectTo: "/invite/accept" })}>Sign in with invited email</button>}
        {status === "error" && <a className="secondary-btn" href="/login">Go to sign in</a>}
      </section>
    </main>
  );
}
