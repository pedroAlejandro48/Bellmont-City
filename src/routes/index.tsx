import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { UsernameForm } from "@/components/UsernameForm";
import { AuthForm } from "@/components/AuthForm";
import { signInWithUsername } from "@/lib/accounts.functions";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Bellmont City — Sign in" },
      { name: "description", content: "An open-world downtown with a real day and night cycle. Sign in to save your progress." },
      { property: "og:title", content: "Bellmont City" },
      { property: "og:description", content: "An open-world downtown with a real day and night cycle." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const signIn = useServerFn(signInWithUsername);
  const account = useQuery({ queryKey: ["player-account"], queryFn: async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) return null;
    const profile = await supabase.from("profiles").select("username").eq("id", data.user.id).maybeSingle();
    if (profile.error) throw profile.error;
    if (profile.data?.username) void navigate({ to: "/play" });
    return { id: data.user.id, username: profile.data?.username };
  } });

  if (account.data && !account.data.username) return <UsernameForm userId={account.data.id} onComplete={() => { void account.refetch(); }} onSignOut={async () => {
    await supabase.auth.signOut(); await account.refetch();
  }} />;

  return <AuthForm onSignedIn={() => account.refetch()} usernameLogin={(data) => signIn({ data })}>
    {account.isError && <Button type="button" variant="outline" onClick={() => { void account.refetch(); }}>Retry account loading</Button>}
  </AuthForm>;
}
