import type { NextAuthOptions } from "next-auth";
import NextAuth from "next-auth";
import AzureADProvider from "next-auth/providers/azure-ad";
import CredentialsProvider from "next-auth/providers/credentials";
import GoogleProvider from "next-auth/providers/google";
import { AuthProvider } from "@prisma/client";
import { getPayloadForUserId, validateCredentialsLogin, validateSocialLogin } from "@/lib/auth/access";

const providers: NextAuthOptions["providers"] = [
  CredentialsProvider({
    name: "Email and Password",
    credentials: {
      email: { label: "Email", type: "email" },
      password: { label: "Password", type: "password" },
      tenantCode: { label: "Tenant Code", type: "text" },
    },
    async authorize(credentials) {
      const email = credentials?.email;
      const password = credentials?.password;
      const tenantCode = credentials?.tenantCode;

      if (!email || !password) {
        throw new Error("Email and password are required.");
      }

      const result = await validateCredentialsLogin({
        email,
        password,
        tenantCode,
      });

      if (!result.ok) {
        throw new Error(result.message);
      }

      return result.payload;
    },
  }),
];

if (process.env.AUTH_GOOGLE_CLIENT_ID && process.env.AUTH_GOOGLE_CLIENT_SECRET) {
  providers.push(
    GoogleProvider({
      clientId: process.env.AUTH_GOOGLE_CLIENT_ID,
      clientSecret: process.env.AUTH_GOOGLE_CLIENT_SECRET,
    }),
  );
}

if (
  process.env.AUTH_MICROSOFT_CLIENT_ID &&
  process.env.AUTH_MICROSOFT_CLIENT_SECRET &&
  process.env.AUTH_MICROSOFT_TENANT_ID
) {
  providers.push(
    AzureADProvider({
      clientId: process.env.AUTH_MICROSOFT_CLIENT_ID,
      clientSecret: process.env.AUTH_MICROSOFT_CLIENT_SECRET,
      tenantId: process.env.AUTH_MICROSOFT_TENANT_ID,
    }),
  );
}

export const authOptions: NextAuthOptions = {
  secret: process.env.NEXTAUTH_SECRET,
  session: {
    strategy: "jwt",
  },
  pages: {
    signIn: "/login",
  },
  providers,
  callbacks: {
    async signIn({ user, account }) {
      if (!account || account.provider === "credentials") {
        return true;
      }

      if (!user.email) {
        return "/login?error=The%20provider%20did%20not%20return%20an%20email%20address";
      }

      const provider =
        account.provider === "google"
          ? AuthProvider.GOOGLE
          : account.provider === "azure-ad"
            ? AuthProvider.MICROSOFT
            : null;

      if (!provider || !account.providerAccountId) {
        return "/login?error=This%20social%20login%20provider%20is%20not%20supported";
      }

      const result = await validateSocialLogin({
        email: user.email,
        provider,
        providerAccountId: account.providerAccountId,
      });

      if (!result.ok) {
        return `/login?error=${encodeURIComponent(result.message)}`;
      }

      return true;
    },
    async jwt({ token, user }) {
      if (user && "id" in user && user.id) {
        Object.assign(token, user);
        return token;
      }

      if (token.sub) {
        const payload = await getPayloadForUserId(token.sub);

        if (payload) {
          Object.assign(token, payload);
        }
      }

      return token;
    },
    async session({ session, token }) {
      if (!session.user) {
        session.user = {
          id: "",
          name: "",
          email: "",
          firstName: "",
          lastName: "",
          isSuperadmin: false,
          role: null,
          tenantId: null,
          tenantCode: null,
          tenantName: null,
        };
      }

      session.user.id = token.id ?? token.sub ?? "";
      session.user.name = token.name ?? "";
      session.user.email = token.email ?? "";
      session.user.firstName = token.firstName ?? "";
      session.user.lastName = token.lastName ?? "";
      session.user.isSuperadmin = Boolean(token.isSuperadmin);
      session.user.role = token.role ?? null;
      session.user.tenantId = token.tenantId ?? null;
      session.user.tenantCode = token.tenantCode ?? null;
      session.user.tenantName = token.tenantName ?? null;

      return session;
    },
    async redirect({ url, baseUrl }) {
      if (url.startsWith("/")) {
        return `${baseUrl}${url}`;
      }

      if (url.startsWith(baseUrl)) {
        return url;
      }

      return `${baseUrl}/post-auth`;
    },
  },
};

export default NextAuth(authOptions);
