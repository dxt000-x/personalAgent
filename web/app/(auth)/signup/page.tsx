import { AuthForm } from "@/components/auth-form";
import { getSupabaseConfig } from "@/lib/supabase/config";

export default function SignupPage() {
  return <AuthForm mode="signup" configured={!!getSupabaseConfig()} />;
}
