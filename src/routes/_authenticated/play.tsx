import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { CloudGame } from "@/game/CloudGame";

export const Route = createFileRoute("/_authenticated/play")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Play — Bellmont City" },
      { name: "description", content: "Walk, run and jump through a living downtown with a full day and night cycle." },
      { property: "og:title", content: "Play — Bellmont City" },
      { property: "og:description", content: "Walk, run and jump through a living downtown with a full day and night cycle." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Play,
});

function Play() {
  const navigate = useNavigate();
  const { queryClient } = Route.useRouteContext();
  const router = useRouter();
  const signOut = async () => {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    await navigate({ to: "/", replace: true });
    void router.invalidate();
  };
  return <CloudGame onSignOut={signOut} />;
}
