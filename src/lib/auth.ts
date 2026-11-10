import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { withUserContext } from "@/lib/http";

const oidcConfigured = Boolean(
  process.env.OIDC_ISSUER && process.env.OIDC_CLIENT_ID && process.env.OIDC_CLIENT_SECRET,
);

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${derived}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, keyHex] = stored.split(":");
  if (!salt || !keyHex) return false;
  const keyBuf = Buffer.from(keyHex, "hex");
  const derived = scryptSync(password, salt, 64);
  if (keyBuf.length !== derived.length) return false;
  return timingSafeEqual(keyBuf, derived);
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: process.env.NODE_ENV !== "production" || process.env.AUTH_TRUST_HOST === "true",
  secret: process.env.AUTH_SECRET,
  pages: {
    signIn: "/login",
  },
  session: { strategy: "jwt", maxAge: 60 * 60 * 8 },
  providers: [
    Credentials({
      id: "credentials",
      name: "Email and Password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
        name: { label: "Full Name", type: "text" },
        mode: { label: "Mode", type: "text" },
      },
      async authorize(raw) {
        const email = typeof raw?.email === "string" ? raw.email.trim().toLowerCase() : "";
        const password = typeof raw?.password === "string" ? raw.password : "";
        const displayName = typeof raw?.name === "string" ? raw.name.trim() : "";
        const mode = raw?.mode === "register" ? "register" : "signin";

        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 8 || password.length > 128) {
          return null;
        }
        const userId = `usr_${createHash("sha256").update(email).digest("hex").slice(0, 28)}`;

        return withUserContext(userId, null, async (client) => {
          const existing = await client.query<{
            id: string;
            email: string;
            display_name: string;
            password_hash: string | null;
          }>(
            `SELECT id, email, display_name, password_hash FROM app_users WHERE id = $1 FOR UPDATE`,
            [userId],
          );

          if (!existing.rowCount) {
            const nameToStore = displayName || email.split("@")[0] || "Workspace Owner";
            const hashed = hashPassword(password);
            const created = await client.query<{ id: string; email: string; display_name: string }>(
              `INSERT INTO app_users (id, email, display_name, password_hash, email_verified)
               VALUES ($1, $2, $3, $4, true)
               RETURNING id, email, display_name`,
              [userId, email, nameToStore.slice(0, 120), hashed],
            );
            const row = created.rows[0];
            return { id: row.id, email: row.email, name: row.display_name };
          }

          const userRow = existing.rows[0];
          if (!userRow.password_hash) {
            if (mode === "register") {
              const hashed = hashPassword(password);
              const nextName = displayName || userRow.display_name || email.split("@")[0];
              await client.query(
                `UPDATE app_users SET password_hash = $2, display_name = $3, updated_at = now() WHERE id = $1`,
                [userId, hashed, nextName.slice(0, 120)],
              );
              return { id: userRow.id, email: userRow.email, name: nextName };
            }
            return null;
          }

          if (!verifyPassword(password, userRow.password_hash)) {
            return null;
          }
          return {
            id: userRow.id,
            email: userRow.email,
            name: userRow.display_name || email.split("@")[0],
          };
        });
      },
    }),
    ...(oidcConfigured
      ? [
          {
            id: "ledgerly-oidc",
            name: "Enterprise OIDC SSO",
            type: "oidc" as const,
            issuer: process.env.OIDC_ISSUER,
            clientId: process.env.OIDC_CLIENT_ID,
            clientSecret: process.env.OIDC_CLIENT_SECRET,
            checks: ["pkce", "state"] as ("pkce" | "state")[],
          },
        ]
      : []),
  ],
  callbacks: {
    async signIn({ user, account, profile }) {
      if (account?.provider === "credentials") {
        return Boolean(user?.id && user?.email);
      }
      // Invitations and workspace access are email-bound. Only accept identity
      // claims whose issuer explicitly attests that the address is verified.
      const verified = profile?.email_verified === true;
      return typeof profile?.email === "string" && verified;
    },
    async jwt({ token, user }) {
      if (user?.id) token.sub = user.id;
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.sub) session.user.id = token.sub;
      return session;
    },
  },
});
