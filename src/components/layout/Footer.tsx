export default function Footer() {
  return (
    <footer className="hidden border-t border-[var(--border)] bg-background md:block pb-16">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-6">
        <span className="text-xs text-muted">
          &copy; {new Date().getFullYear()} HOODLRZ. All rights reserved.
        </span>

        <nav className="flex items-center gap-4">
          {/* Placeholder links */}
          <a
            href="#"
            className="text-xs text-muted transition-colors hover:text-foreground"
          >
            Terms
          </a>
          <a
            href="#"
            className="text-xs text-muted transition-colors hover:text-foreground"
          >
            Privacy
          </a>
          <a
            href="#"
            className="text-xs text-muted transition-colors hover:text-foreground"
          >
            Contact
          </a>
          <a
            href="https://x.com/hoodlrz"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Hoodlrz on X"
            className="flex items-center justify-center text-muted transition-colors hover:text-foreground"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
            </svg>
          </a>
        </nav>
      </div>
    </footer>
  );
}
