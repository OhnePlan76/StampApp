"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

function StampIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="chrome-icon">
      <path d="M7 3h10a2 2 0 0 1 2 2v3a2 2 0 0 0 0 4v3a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-3a2 2 0 0 0 0-4V5a2 2 0 0 1 2-2Zm2 4v3h6V7H9Zm0 6v2h6v-2H9Z" />
    </svg>
  );
}

function HomeIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="nav-icon">
      <path d="M3 10.8 12 3l9 7.8v8.7a1.5 1.5 0 0 1-1.5 1.5H15v-6H9v6H4.5A1.5 1.5 0 0 1 3 19.5v-8.7Z" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="nav-icon">
      <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H10l2 2h6.5A2.5 2.5 0 0 1 21 9.5v7A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5v-9Z" />
    </svg>
  );
}

function CameraIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="nav-icon">
      <path d="M8.5 5 10 3h4l1.5 2H19a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3h3.5ZM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="chrome-icon">
      <path d="M11 4a1 1 0 1 1 2 0v8.6l2.3-2.3a1 1 0 0 1 1.4 1.4l-4 4a1 1 0 0 1-1.4 0l-4-4a1 1 0 1 1 1.4-1.4l2.3 2.3V4Z" />
      <path d="M5 18a1 1 0 0 1 1-1h12a1 1 0 1 1 0 2H6a1 1 0 0 1-1-1Z" />
    </svg>
  );
}

export function AppChrome() {
  const pathname = usePathname();
  const inAlbum = pathname?.startsWith("/albums") || pathname?.startsWith("/alben");
  const inCapture = pathname === "/erfassen" || pathname?.endsWith("/scannen");
  const inCollection = pathname === "/sammlung" || (inAlbum && !inCapture);
  const inHome = pathname === "/" || pathname === "/aktivitaet";

  return (
    <>
      <header className="app-topbar">
        <Link className="brand-mark" href="/" aria-label="StampCollector AI">
          <span className="brand-icon">
            <StampIcon />
          </span>
          <span>
            StampCollector <b>AI</b>
          </span>
        </Link>
        <div className="chrome-actions">
          <a
            className="chrome-button"
            href="/api/stamps/export"
            title="CSV exportieren"
            aria-label="CSV exportieren"
          >
            <DownloadIcon />
          </a>
          <span className="avatar-dot" aria-hidden="true">
            SC
          </span>
        </div>
      </header>

      <nav className="bottom-nav" aria-label="Hauptnavigation">
        <Link className={inHome ? "active" : ""} href="/">
          <HomeIcon />
          <span>Home</span>
        </Link>
        <Link className={inCollection ? "active" : ""} href="/sammlung">
          <FolderIcon />
          <span>Sammlung</span>
        </Link>
        <Link className={inCapture ? "active" : ""} href="/erfassen">
          <CameraIcon />
          <span>Scannen</span>
        </Link>
      </nav>
    </>
  );
}
