import type { MetadataRoute } from "next";

/**
 * What a phone needs to put Harbor on its home screen as an app rather than a bookmark: a name,
 * the icons, and `standalone`, which opens it without the browser around it.
 *
 * Served to signed-out requests on purpose — a browser fetches the manifest without the session
 * cookie, so proxy.ts lets `.webmanifest` through the same way it lets icons through.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Harbor",
    short_name: "Harbor",
    description: "Your family's paperwork, at home.",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#ffffff",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
