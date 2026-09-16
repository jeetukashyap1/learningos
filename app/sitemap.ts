import type { MetadataRoute } from "next";
export default function sitemap(): MetadataRoute.Sitemap { const base = "https://learningos.example"; return ["", "/about", "/how-it-works", "/pricing", "/contact", "/help", "/privacy", "/terms", "/cookies", "/community-guidelines", "/content-policy", "/login", "/signup"].map((path) => ({ url: `${base}${path}`, lastModified: new Date() })); }
