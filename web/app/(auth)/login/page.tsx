import { AuthForm } from "@/components/auth-form";
import { getSupabaseConfig } from "@/lib/supabase/config";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;
  return (
    <AuthForm
      mode="login"
      configured={!!getSupabaseConfig()}
      confirmationFailed={params.error === "confirmation"}
    />
  );
}
