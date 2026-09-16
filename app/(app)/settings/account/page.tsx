import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { AccountDetailsForm } from "./account-details-form";

export default async function AccountSettingsPage() {
  const user = await getCurrentUser();
  let learningGoal: string | null = null;
  if (user) {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase
      .from("onboarding_profiles")
      .select("topic")
      .eq("user_id", user.id)
      .maybeSingle();
    learningGoal = data?.topic ?? null;
  }
  return <main className="container">
    <Link href="/settings" className="muted" style={{ fontSize: 12, fontWeight: 800 }}>← Settings</Link>
    <div style={{ maxWidth: 650, margin: "30px auto 0" }}>
      <div className="eyebrow">ACCOUNT</div>
      <h1 style={{ marginTop: 12 }}>Your details</h1>
      <p className="muted" style={{ marginTop: 12 }}>The basics that make your learning space feel like yours.</p>
      <AccountDetailsForm initialName={user?.fullName ?? null} email={user?.email ?? ""} learningGoal={learningGoal} signedIn={Boolean(user)} />
    </div>
  </main>;
}
