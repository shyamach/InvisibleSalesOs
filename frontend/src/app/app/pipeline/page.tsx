"use client";

import { useCallback, useState } from "react";
import {
  FileSpreadsheet,
  FileText,
  ImageIcon,
  Upload,
  X,
} from "lucide-react";
import { Header } from "@/components/layout/header";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { recentAssets } from "@/lib/mock-data";
import { cn } from "@/lib/utils";

const acceptedTypes = [
  "image/*",
  "text/csv",
  "application/pdf",
  ".csv",
  ".pdf",
];

function getFileIcon(type: string) {
  if (type === "CSV") return FileSpreadsheet;
  if (type === "PDF") return FileText;
  return ImageIcon;
}

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
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="text-[10px] uppercase tracking-[0.12em]">
                    File
                  </TableHead>
                  <TableHead className="text-[10px] uppercase tracking-[0.12em]">
                    Type
                  </TableHead>
                  <TableHead className="text-[10px] uppercase tracking-[0.12em]">
                    Size
                  </TableHead>
                  <TableHead className="text-[10px] uppercase tracking-[0.12em]">
                    Uploaded
                  </TableHead>
                  <TableHead className="text-[10px] uppercase tracking-[0.12em]">
                    Status
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentAssets.map((asset) => {
                  const Icon = getFileIcon(asset.type);
                  return (
                    <TableRow key={asset.id}>
                      <TableCell>
                        <div className="flex items-center gap-2.5">
                          <Icon
                            className="size-4 text-muted-foreground"
                            strokeWidth={1.5}
                          />
                          <span className="text-sm font-medium">
                            {asset.name}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {asset.type}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {asset.size}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {asset.uploadedAt}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="secondary"
                          className={
                            asset.status === "Processed"
                              ? "bg-foreground/[0.06] text-foreground/70"
                              : "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                          }
                        >
                          {asset.status}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </div>
      </main>
    </>
  );
}
