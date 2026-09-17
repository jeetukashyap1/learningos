import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./product-states.css";

export const metadata: Metadata = { title: { default: "LearningOS — Learn what matters", template: "%s · LearningOS" }, description: "A personal learning operating system that helps you know what to learn next." };

/* viewportFit: "cover" enables env(safe-area-inset-*) so the fixed mobile
   navigation clears the home indicator on notched devices.
   interactiveWidget keeps the layout complete when the on-screen keyboard opens. */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f8f4" },
    { media: "(prefers-color-scheme: dark)", color: "#0f1115" },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body>{children}</body></html>; }
