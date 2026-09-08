import type { Metadata } from "next";
import { formatRelative } from "@/lib/format";
import { getReleases, getVersion } from "../data";
import { Fact, Facts, Note, PageHead, Stat, Stats } from "../ui";
import { ReleaseNotes } from "./ReleaseNotes";

export const metadata: Metadata = { title: "Version · Settings" };

export default async function VersionPage() {
  const [v, notes] = await Promise.all([getVersion(), getReleases()]);

  return (
    <>
      <PageHead title="Version">
        What this box is running, and whether anything newer exists. The check asks GitHub for the list of releases and
        sends nothing about you or your documents; a box with no route out simply says it could not ask.
      </PageHead>

      <div className="flex flex-wrap items-start gap-12">
        <div className="flex min-w-0 max-w-[620px] flex-1 flex-col gap-9">
          <Stats>
            <Stat
              label="Running"
              value={v.current}
              sub={v.current === "dev" ? "Built by hand rather than from a release" : `Commit ${v.commit.slice(0, 12)}`}
            />
            <Stat
              label={v.updateAvailable ? "Available" : "Latest release"}
              value={
                v.updateAvailable
                  ? v.latest
                  : !v.checkEnabled
                    ? "Not checked"
                    : v.problem
                      ? "Unknown"
                      : // A hand-built version has no place in the release order, so "up to date" would
                        // be a claim this box cannot make. Show what the newest release is instead.
                        v.current === "dev"
                        ? (v.latest ?? "Unknown")
                        : "Up to date"
              }
              sub={
                v.updateAvailable
                  ? "Upgrade with the command below"
                  : !v.checkEnabled
                    ? "The update check is switched off"
                    : v.problem
                      ? "Could not reach GitHub"
                      : v.current === "dev"
                        ? "This build is not a release, so there is nothing to compare it against"
                        : `Checked ${v.checkedAt ? formatRelative(v.checkedAt) : "never"}`
              }
            />
          </Stats>

          <Facts>
            <Fact k="Update check">
              {v.checkEnabled ? "On — once a day, against the published releases" : "Off"}
              {v.checkEnabled && <div className="mt-0.5 text-small text-muted">Set HARBOR_UPDATE_CHECK=false on the box to stop asking.</div>}
            </Fact>
            <Fact k="Last checked">
              {v.checkedAt ? formatRelative(v.checkedAt) : "Never"}
              {v.problem && <div className="mt-0.5 text-small text-muted">{v.problem}</div>}
            </Fact>
          </Facts>

          <Note title="Upgrading">
            Upgrading is a command on the appliance, not a button here — it stops the containers this page is being served
            from. Run <code className="font-mono">sudo harbor upgrade</code> over ssh: it takes a backup first, refuses to
            continue if that backup fails, then moves to the newest release. <code className="font-mono">harbor upgrade v0.3.0</code>{" "}
            goes to a particular one instead. Rolling back is restoring a backup — migrations only run forward.
          </Note>
        </div>

        <ReleaseNotes releases={notes.releases} offline={notes.offline} />
      </div>
    </>
  );
}
