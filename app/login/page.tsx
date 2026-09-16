import { safeNextPath } from "@/lib/safe-redirect";
import { LoginForm } from "./login-form";

/**
 * Server wrapper: reads the `next` destination (set by route protection when
 * an unauthenticated visitor hits a protected page) and the `error` flag set
 * by the auth callback when a magic/recovery link is no longer valid, then
 * hands both to the client form.
 */
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string | string[]; error?: string | string[] }> }) {
  const params = await searchParams;
  const nextParam = Array.isArray(params.next) ? params.next[0] : params.next;
  const errorParam = Array.isArray(params.error) ? params.error[0] : params.error;
  return <LoginForm next={safeNextPath(nextParam)} linkError={errorParam === "link"} />;
}
