import { cache } from "react";
import type { BackupStatus, InviteInfo, MailConnectionView, OwnerInfo, ReleaseNotes, SessionInfo, SuggestionSettings, VersionInfo } from "@harbor/shared";
import { apiFetch } from "@/lib/api-server";

/**
 * The reads Settings makes, cached for the render.
 *
 * The navigation shows each section's state — how many people can sign in, whether mail is being
 * read — which means the layout wants the same answers the pages want. Caching them here keeps
 * that to one request each per navigation rather than two.
 */
export const getOwners = cache(() => apiFetch<OwnerInfo[]>("/auth/owners").catch(() => [] as OwnerInfo[]));
export const getInvites = cache(() => apiFetch<InviteInfo[]>("/auth/invites").catch(() => [] as InviteInfo[]));
export const getSessions = cache(() => apiFetch<SessionInfo[]>("/auth/sessions").catch(() => [] as SessionInfo[]));
export const getConnections = cache(() => apiFetch<MailConnectionView[]>("/mail/connections").catch(() => [] as MailConnectionView[]));
export const getBackup = cache(() =>
  apiFetch<BackupStatus>("/backups").catch(
    () => ({ configured: false, repository: null, backupHour: 3, restoreTestDay: 1, lastBackup: null, lastRestoreTest: null, running: null }) satisfies BackupStatus,
  ),
);
export const getSuggestions = cache(() =>
  apiFetch<SuggestionSettings>("/settings/suggestions").catch(
    () => ({ provider: "none", model: "", baseUrl: null, apiKeySet: false, sendPeople: true, readerLanguage: "en", fromEnvironment: true }) as SuggestionSettings,
  ),
);
export const getVersion = cache(() =>
  apiFetch<VersionInfo>("/version").catch(
    () => ({ current: "unknown", commit: "unknown", latest: null, updateAvailable: false, checkEnabled: false, checkedAt: null, problem: null }) as VersionInfo,
  ),
);
export const getReleases = cache(() =>
  apiFetch<ReleaseNotes>("/version/releases").catch(() => ({ releases: [], offline: true }) satisfies ReleaseNotes),
);
