import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { LogOut, UserRound, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ThemeMenuItem } from "@/components/theme-toggle";
import { UserAvatar } from "@/components/account-button";
import { PremiumMenuIcon } from "@/components/premium-menu-icon";
import { useAuth } from "@/hooks/use-auth";

/**
 * Compact-header menu: light/dark switch, then account actions (sign in / sign up, or the
 * reader's profile summary). On small screens it also holds The Report button.
 */
export function CompactMenu() {
  const { user, loading, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const name = user ? user.username || user.email || "Reader" : "";

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        aria-label={open ? "Close menu" : "Open menu"}
        className={`grid h-12 w-12 place-items-center rounded-full border outline-none hover:bg-navigation-highlight focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-7 ${open ? "border-border bg-navigation-highlight shadow-sm" : "border-transparent"}`}
      >
        {open ? <X className="h-7 w-7" /> : <PremiumMenuIcon className="h-7 w-7" />}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={10} className="glass-strong w-64 rounded-2xl p-2">
        {user && (
          <>
            <div className="flex min-w-0 items-center gap-3 px-2 py-2">
              <UserAvatar name={name} size="md" />
              <div className="min-w-0">
                <p className="truncate text-sm font-bold">{name}</p>
                <p className="truncate text-xs text-muted-foreground">{user.email}</p>
              </div>
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild className="rounded-xl"><Link to="/profile"><UserRound className="h-4 w-4" /> Your profile</Link></DropdownMenuItem>
          </>
        )}
        <ThemeMenuItem />
        {user ? (
          <DropdownMenuItem className="rounded-xl" onSelect={() => signOut()}><LogOut className="h-4 w-4" /> Sign out</DropdownMenuItem>
        ) : !loading && (
          <>
            <DropdownMenuSeparator />
            <div className="p-1">
              <Button asChild variant="outline" className="h-10 w-full rounded-full font-semibold">
                <Link to="/auth" search={{ mode: "signin" }} onClick={() => setOpen(false)}>Sign in</Link>
              </Button>
            </div>
          </>
        )}
        <div className="p-1 pt-2 sm:hidden">
          <Button asChild className="h-11 w-full rounded-full font-bold">
            <Link to="/midnight-report" onClick={() => setOpen(false)}>The Report</Link>
          </Button>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
