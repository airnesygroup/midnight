import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { meQuery } from "@/hooks/use-auth";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ location, context }) => {
    const me = await context.queryClient.ensureQueryData(meQuery);
    if (!me) throw redirect({ to: "/auth", search: { redirect: location.pathname } });
  },
  component: () => <Outlet />,
});
