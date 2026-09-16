import type { Metadata } from "next";
import "./globals.css";
import "./product-states.css";

export const metadata: Metadata = { title: { default: "LearningOS — Learn what matters", template: "%s · LearningOS" }, description: "A personal learning operating system that helps you know what to learn next." };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body>{children}</body></html>; }
