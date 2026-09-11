"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { LogOut } from "lucide-react";
import ThemeToggle from "@/components/ui/ThemeToggle";
import { createClient } from "@/lib/supabase/client";

const navLinks: { href: string; label: string; beta?: boolean }[] = [
  { href: "/", label: "OG Hoodlrz" },
  { href: "/kids", label: "Gen Kids" },
  { href: "/genesis", label: "Vinyl" },
  { href: "/city", label: "City", beta: true },
  { href: "/about", label: "About" },
  { href: "/my-collection", label: "My Collection" },
];

export default function Header() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [authLabel, setAuthLabel] = useState("");

  useEffect(() => {
    const supabase = createClient();

    function handleUser(user: { email?: string | null } | null) {
      if (user) {
        setIsLoggedIn(true);
        const email = user.email || "";
        if (email.endsWith("@wallet.hoodlrz.com")) {
          const addr = email.replace("@wallet.hoodlrz.com", "");
          setAuthLabel(`${addr.slice(0, 6)}...${addr.slice(-4)}`);
        } else if (email) {
          setAuthLabel(email);
        }
      } else {
        setIsLoggedIn(false);
        setAuthLabel("");
      }
    }

    // Check current session
    supabase.auth.getSession().then(({ data }) => {
      handleUser(data.session?.user ?? null);
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      handleUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    setIsLoggedIn(false);
    setAuthLabel("");
    window.location.href = "/";
  };

  return (
    <>
      <header className="sticky top-0 z-50 border-b border-[var(--border)] bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:h-16 sm:px-6">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2 shrink-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/logo-hoodlrz.svg"
              alt="Hoodlrz"
              className="h-8 w-8 sm:h-9 sm:w-9"
            />
            <div className="flex flex-col leading-none">
              <span className="font-hoodlrz text-xl font-bold tracking-wider text-foreground sm:text-2xl">
                hOodlrz
              </span>
              <span className="text-[8px] uppercase tracking-[0.2em] text-muted">
                by Xerak
              </span>
            </div>
          </Link>

          {/* Right side */}
          <div className="flex items-center gap-1 sm:gap-4">
            {/* Desktop nav links */}
            <nav className="hidden items-center gap-1 md:flex">
              {navLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-muted transition-colors hover:text-foreground"
                >
                  {link.label}
                  {link.beta && (
                    <span className="border border-[#ff2db5]/60 text-[#ff2db5] text-[8px] font-bold uppercase tracking-widest px-1 py-px leading-none">
                      Beta
                    </span>
                  )}
                </Link>
              ))}
            </nav>

            <a
              href="https://x.com/hoodlrz"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Hoodlrz on X"
              className="flex items-center justify-center p-1.5 text-muted hover:text-foreground transition-colors"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
              </svg>
            </a>

            <ThemeToggle />

            {isLoggedIn ? (
              <div className="flex items-center gap-2">
                {authLabel && (
                  <span className="hidden sm:inline text-[10px] text-muted font-mono truncate max-w-[120px]">
                    {authLabel}
                  </span>
                )}
                <button
                  onClick={handleLogout}
                  className="flex items-center gap-1.5 px-2 py-1.5 text-xs font-medium text-muted hover:text-foreground transition-colors"
                  title="Log out"
                >
                  <LogOut size={14} />
                  <span className="hidden sm:inline">Log out</span>
                </button>
              </div>
            ) : (
              <Link
                href="/access"
                className="px-3 py-1.5 text-xs font-bold uppercase tracking-widest text-foreground border border-[var(--border)] hover:bg-[var(--surface)] transition-colors"
              >
                Access
              </Link>
            )}
          </div>
        </div>
      </header>
    </>
  );
}
