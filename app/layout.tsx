import type { Metadata } from "next";
import { AppChrome } from "@/components/AppChrome";
import "./globals.css";

export const metadata: Metadata = {
  title: "Stamp Value App",
  description: "Erfassung und grobe Bewertung grosser Briefmarkensammlungen",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="de">
      <body>
        <AppChrome />
        <main className="app-shell">{children}</main>
      </body>
    </html>
  );
}
