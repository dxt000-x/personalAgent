import { I18nProvider, LanguageSwitcher } from "@/components/i18n-provider";
export const dynamic = "force-dynamic";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <I18nProvider userId={null}><main className="flex min-h-screen flex-col items-center justify-center gap-6 px-6 py-12">
      <div className="w-full max-w-md"><LanguageSwitcher /></div>{children}
    </main></I18nProvider>
  );
}
