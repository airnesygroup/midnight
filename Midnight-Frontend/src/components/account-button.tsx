import { Link } from "@tanstack/react-router";
import { LogOut, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useAuth } from "@/hooks/use-auth";
import { ThemeMenuItem } from "@/components/theme-toggle";

export function UserAvatar({ name, hue = 280, size = "md" }: { name: string; hue?: number; size?: "sm" | "md" | "lg" }) {
  const dims = size === "lg" ? "h-24 w-24 text-3xl" : size === "sm" ? "h-8 w-8 text-xs" : "h-10 w-10 text-sm";
  return (
    <span aria-hidden className={`avatar-orb ${dims}`} style={{ ["--avatar-hue" as string]: hue }}>
      {(name || "?").slice(0, 1).toUpperCase()}
    </span>
  );
}

export function AccountButton({ compact = false, onNavigate }: { compact?: boolean; onNavigate?: () => void }) {
  const { user, loading, signOut } = useAuth();
  if (loading) return <span className="h-10 w-10" aria-hidden />;
  if (!user) {
    return (
      // On phone widths the compact header keeps only the Report button.
      <Button asChild variant="ghost" className={`rounded-full px-4 font-medium whitespace-nowrap hover:bg-navigation-highlight ${compact ? "hidden sm:inline-flex" : ""}`}>
        <Link to="/auth" onClick={onNavigate}>Sign in</Link>
      </Button>
    );
  }
  const name = user.username || user.email || "Reader";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger aria-label="Your account" className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <UserAvatar name={name} size="sm" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="glass-strong w-56 rounded-2xl p-2">
        <DropdownMenuLabel className="truncate text-xs font-medium text-muted-foreground">{user.email}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild className="rounded-xl"><Link to="/profile" onClick={onNavigate}><UserRound className="h-4 w-4" /> Your profile</Link></DropdownMenuItem>
        <ThemeMenuItem />
        <DropdownMenuItem className="rounded-xl" onSelect={() => signOut()}><LogOut className="h-4 w-4" /> Sign out</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
