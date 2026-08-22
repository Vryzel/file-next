import { FileExplorerDemo } from "./FileExplorerDemo";

export const dynamic = "force-dynamic";

export default function HomePage() {
  return (
    <main className="container mx-auto flex min-h-screen flex-col gap-6 py-12">
      <header className="space-y-2">
        <h1 className="text-4xl font-bold tracking-tight">file-next</h1>
        <p className="text-muted-foreground">
          Explorer demo. Metadata in SQLite. Bytes go to R2/S3 when
          FILE_NEXT_* is set, otherwise the in-memory adapter.
        </p>
      </header>
      <FileExplorerDemo />
    </main>
  );
}
