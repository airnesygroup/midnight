import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ user: null as { id: string; email: string; username: string } | null, navigate: vi.fn() }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: state.user, loading: false, signOut: vi.fn() }) }));
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => state.navigate,
  useRouterState: () => false,
  Link: ({ to, children, ...props }: { to: string; children: React.ReactNode }) => <a {...props} href={to} onClick={(event) => { event.preventDefault(); state.navigate(to); }}>{children}</a>,
}));
vi.mock("@/components/account-button", () => ({
  UserAvatar: () => <span />,
  AccountButton: () => <a aria-label="Your account" href="/profile" onClick={(event) => { event.preventDefault(); state.navigate("/profile"); }}>Account</a>,
}));
vi.mock("@/components/news-bits", () => ({ MidnightLogo: () => <span /> }));
import { CompactHeader } from "@/components/compact-header";

afterEach(() => { cleanup(); state.user = null; state.navigate.mockClear(); });

describe("compact header account destination", () => {
  it("signed-in readers can open their profile without a Report action", () => {
    state.user = { id: "reader", email: "reader@example.com", username: "reader" };
    render(<CompactHeader />);
    fireEvent.click(screen.getByRole("link", { name: "Your account" }));
    expect(state.navigate).toHaveBeenCalledWith("/profile");
    expect(document.querySelector('a[href="/midnight-report"]')).toBeNull();
  });

  it("signed-out readers open the Report instead of a profile", () => {
    render(<CompactHeader />);
    fireEvent.click(screen.getByRole("link", { name: "The Report" }));
    expect(state.navigate).toHaveBeenCalledWith("/midnight-report");
    expect(document.querySelector('a[href="/profile"]')).toBeNull();
  });

  it("signed-out menu offers sign in (no sign up) and the Report", () => {
    render(<CompactHeader />);
    fireEvent.keyDown(screen.getByRole("button", { name: "Open menu" }), { key: "Enter" });
    expect(screen.getByRole("link", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Sign up" })).toBeNull();
    expect(document.querySelectorAll('a[href="/midnight-report"]').length).toBe(2);
  });

  it("signed-in menu shows the reader's profile summary instead of sign in", () => {
    state.user = { id: "reader", email: "reader@example.com", username: "nightowl" };
    render(<CompactHeader />);
    fireEvent.keyDown(screen.getByRole("button", { name: "Open menu" }), { key: "Enter" });
    expect(screen.getByText("nightowl")).toBeInTheDocument();
    expect(screen.getByText("reader@example.com")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Sign in" })).toBeNull();
    expect(screen.getByRole("menuitem", { name: /Your profile/ })).toBeInTheDocument();
  });
});
