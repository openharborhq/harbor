import { test } from "node:test";
import assert from "node:assert/strict";
import { redactRepository } from "@harbor/shared";
import { lastLines, parseBackupSummary, parseLatestSnapshot } from "./restic";
import { due } from "./schedule";

const cfg = { backupHour: 3, restoreTestDay: 1 };
const at = (iso: string) => new Date(iso);
const none = { backup: null, okBackup: null, restoreTest: null };

test("a backup is due once in its hour, never twice in a night, and not at noon after a missed night", () => {
  assert.equal(due(at("2026-09-08T03:00:30"), none, cfg), "backup");
  assert.equal(due(at("2026-09-08T03:40:00"), { ...none, backup: at("2026-09-08T03:00:30") }, cfg), null);
  assert.equal(due(at("2026-09-08T12:00:00"), none, cfg), null);
  assert.equal(due(at("2026-09-09T03:00:00"), { ...none, backup: at("2026-09-08T03:00:30") }, cfg), "backup");
});

test("the restore test follows a successful backup on its day and waits a month", () => {
  const fresh = { backup: at("2026-09-01T03:00:00"), okBackup: at("2026-09-01T03:00:00"), restoreTest: null };
  assert.equal(due(at("2026-09-01T04:10:00"), fresh, cfg), "restore_test");
  // Any hour that day — a long first backup must not cost the month's test.
  assert.equal(due(at("2026-09-01T09:00:00"), fresh, cfg), "restore_test");
  assert.equal(due(at("2026-09-01T04:10:00"), { ...fresh, restoreTest: at("2026-09-01T04:00:00") }, cfg), null);
  assert.equal(due(at("2026-09-02T04:10:00"), fresh, cfg), null);
  // A backup that failed tonight is not something to test a restore of.
  assert.equal(due(at("2026-09-01T04:10:00"), { backup: at("2026-09-01T03:00:00"), okBackup: at("2026-08-31T03:00:00"), restoreTest: null }, cfg), null);
  // The nightly backup takes precedence over the test when both are due in the same minute.
  assert.equal(due(at("2026-09-01T03:00:00"), { ...none, okBackup: at("2026-09-01T02:00:00") }, cfg), "backup");
});

test("restic's streamed json: the summary line wins, progress and warnings are ignored", () => {
  const out = [
    `{"message_type":"status","percent_done":0.5}`,
    `warning: some noise`,
    `{"message_type":"summary","files_new":3,"files_changed":1,"total_bytes_processed":1234,"total_duration":4.6,"snapshot_id":"abcdef0123456789"}`,
  ].join("\n");
  assert.deepEqual(parseBackupSummary(out), { snapshotId: "abcdef0123456789", bytes: 1234, filesNew: 3, filesChanged: 1, seconds: 5 });
  assert.throws(() => parseBackupSummary(`{"message_type":"status"}`), /no summary/);
});

test("latest snapshot, or none for an empty repository", () => {
  assert.deepEqual(parseLatestSnapshot(`[{"id":"abc","short_id":"abc","time":"2026-09-08T03:00:00Z"}]`), { id: "abc", time: "2026-09-08T03:00:00Z" });
  assert.equal(parseLatestSnapshot("[]"), null);
  assert.equal(parseLatestSnapshot(""), null);
});

test("errors shown in Settings carry the tail of the output and no credential", () => {
  assert.equal(lastLines("progress\nprogress\nFatal: unable to open repository\nreason: 403\n"), "progress · Fatal: unable to open repository · reason: 403");
  assert.equal(redactRepository("sftp://user:secret@backup.example.org/srv/harbor"), "sftp://backup.example.org/srv/harbor");
  assert.equal(redactRepository("b2:family-vault:/harbor"), "b2:family-vault:/harbor");
  assert.equal(redactRepository("/backup"), "/backup");
});
