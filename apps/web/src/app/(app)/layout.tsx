import { redirect } from "next/navigation";
import { currentUser } from "@/lib/api-server";

/**
 * Everything under (app) requires a fully verified session; the API is the source of truth.
 *
 * Only the session check lives here. The chrome belongs to the groups below — (shell) draws the
 * sidebar the vault is normally used through, and (settings) replaces the window entirely — so
 * Settings can take the whole screen without unmounting and remounting the shell around it.
 */
export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await currentUser();
  if (!user) redirect("/sign-in");
  return <>{children}</>;
}
