"use client";

/**
 * /app/pipeline — Upload sales assets for AI processing.
 *
 * The drag/drop zone below only ever staged file NAMES in local React state
 * — there was never a fetch() call anywhere on this page, so dropping a real
 * file did nothing beyond showing its name in a chip. Below that, "Recently
 * Uploaded Assets" showed three permanently-fixed fake rows (a PDF catalog,
 * a CSV, an image, with fabricated timestamps like "2 hours ago") from
 * frontend/src/lib/mock-data.ts, regardless of what — if anything — a real
 * user had ever dropped here. Found live 2026-08-25 QA pass, same
 * fabricated-data pattern as /app/analytics (fixed same day).
 *
 * There's no backend endpoint for asset upload/processing to wire this to —
 * building that pipeline is a scoped feature, not a QA fix — so this now
 * says plainly that upload isn't wired up yet instead of pretending files
 * get processed, and shows an honest empty state instead of invented history.
 */

import { useCallback, useState } from "react";
import { FolderOpen, Upload, X } from "lucide-react";
import { Header } from "@/components/layout/header";
import { cn } from "@/lib/utils";

const acceptedTypes = [
  "image/*",
  "text/csv",
  "application/pdf",
  ".csv",
  ".pdf",
];

export default function PipelinePage() {
  const [isDragging, setIsDragging] = useState(false);
  const [stagedFiles, setStagedFiles] = useState<string[]>([]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const names = Array.from(e.dataTransfer.files).map((f) => f.name);
    if (names.length) setStagedFiles((prev) => [...prev, ...names]);
  }, []);

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const names = Array.from(e.target.files ?? []).map((f) => f.name);
      if (names.length) setStagedFiles((prev) => [...prev, ...names]);
    },
    []
  );

  return (
    <>
      <Header
        title="Pipeline"
        description="Upload and manage sales assets for AI processing"
      />
      <main className="flex-1 overflow-y-auto p-8">
        <div className="mx-auto max-w-5xl space-y-8">
          {/* Not-yet-functional notice */}
          <div className="rounded-lg border border-amber-300/60 bg-amber-50 px-4 py-2.5 text-xs text-amber-800 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-300">
            File upload isn&apos;t connected to processing yet — dropped files are listed below but nothing is sent or stored.
          </div>

          {/* Drop zone */}
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={cn(
              "relative flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-8 py-16 transition-colors",
              isDragging
                ? "border-foreground/30 bg-foreground/[0.04]"
                : "border-border/70 bg-foreground/[0.01] hover:border-border hover:bg-foreground/[0.02]"
            )}
          >
            <input
              type="file"
              multiple
              accept={acceptedTypes.join(",")}
              onChange={handleFileInput}
              className="absolute inset-0 cursor-pointer opacity-0"
            />
            <div className="flex size-12 items-center justify-center rounded-full border border-border/60 bg-background">
              <Upload
                className="size-5 text-muted-foreground"
                strokeWidth={1.5}
              />
            </div>
            <p className="mt-4 text-sm font-medium text-foreground">
              Drop files here or click to browse
            </p>
            <p className="mt-1.5 text-xs text-muted-foreground">
              Supports media, CSVs, and PDF catalogs
            </p>
            <div className="mt-4 flex gap-2">
              {["Images", "CSV", "PDF"].map((type) => (
                <span
                  key={type}
                  className="rounded-md border border-border/50 px-2.5 py-1 text-[10px] uppercase tracking-[0.1em] text-muted-foreground"
                >
                  {type}
                </span>
              ))}
            </div>
          </div>

          {/* Staged files */}
          {stagedFiles.length > 0 && (
            <div className="rounded-xl border border-border/60 bg-card/50 p-4 ring-1 ring-border/40">
              <p className="mb-3 text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                Staged for upload ({stagedFiles.length})
              </p>
              <div className="flex flex-wrap gap-2">
                {stagedFiles.map((name) => (
                  <span
                    key={name}
                    className="inline-flex items-center gap-1.5 rounded-md border border-border/50 bg-background px-2.5 py-1 text-xs"
                  >
                    {name}
                    <button
                      type="button"
                      onClick={() =>
                        setStagedFiles((prev) =>
                          prev.filter((f) => f !== name)
                        )
                      }
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <X className="size-3" />
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Recently uploaded assets */}
          <div className="rounded-xl border border-border/60 bg-card/50 ring-1 ring-border/40">
            <div className="border-b border-border/50 px-6 py-4">
              <h2 className="text-sm font-medium tracking-tight">
                Recently Uploaded Assets
              </h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Pipeline ingestion history
              </p>
            </div>
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
              <FolderOpen className="size-6 text-muted-foreground/40" strokeWidth={1.5} />
              <p className="text-xs text-muted-foreground max-w-xs">
                No upload history yet — this feature isn&apos;t wired up to a backend pipeline.
              </p>
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
