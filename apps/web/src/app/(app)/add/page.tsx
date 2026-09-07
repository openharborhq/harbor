import type { Metadata } from "next";
import { UploadQueue } from "@/components/UploadQueue";
import { TopBar } from "@/components/shell/TopBar";

export const metadata: Metadata = { title: "Add documents" };

export default function AddPage() {
  return (
    <>
      <TopBar />
      <main className="flex max-w-[1192px] flex-col gap-10 px-14 py-14">
        <div>
          <h1 className="text-title font-bold tracking-snug">Add documents</h1>
          <p className="mt-1.5 text-body text-muted">Bills, scans, photos of paperwork — drop them all at once. Everything lands in your Inbox to be filed.</p>
        </div>
        <UploadQueue />
      </main>
    </>
  );
}
