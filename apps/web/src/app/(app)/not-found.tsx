import Link from "next/link";

export default function AppNotFound() {
  return (
    <main className="flex max-w-[720px] flex-col gap-4 px-14 py-20">
      <h1 className="text-title font-bold tracking-snug">Not here</h1>
      <p className="text-body text-muted">
        That document or item doesn&apos;t exist. It may have been deleted — documents wait in Recently deleted before
        they go for good, so it could still be there.
      </p>
      <div className="mt-2 flex items-center gap-4 text-row font-medium text-accent">
        <Link href="/library">Browse the library</Link>
        <Link href="/library/deleted">Recently deleted</Link>
        <Link href="/home">Home</Link>
      </div>
    </main>
  );
}
