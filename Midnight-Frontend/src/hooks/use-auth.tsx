import { createContext, useContext, type ReactNode } from "react";
import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { getMe, signOut as signOutFn } from "@/lib/signup.functions";

export type AuthUser = { id: string; email: string; username: string };
type AuthState = { user: AuthUser | null; loading: boolean; refresh: () => Promise<void>; signOut: (everywhere?: boolean) => Promise<void> };
const AuthContext = createContext<AuthState | null>(null);

export const meQuery = queryOptions({ queryKey: ["auth", "me"], queryFn: () => getMe(), staleTime: 60_000 });

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const me = useQuery(meQuery);

  const refresh = async () => {
    await queryClient.invalidateQueries();
    await queryClient.fetchQuery({ ...meQuery, staleTime: 0 });
    router.invalidate();
  };

  const signOut = async (everywhere = false) => {
    await queryClient.cancelQueries();
    await signOutFn({ data: { everywhere } });
    queryClient.clear();
    queryClient.setQueryData(meQuery.queryKey, null);
    navigate({ to: "/auth", replace: true });
  };

  return (
    <AuthContext.Provider value={{ user: me.data ?? null, loading: me.isPending, refresh, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
