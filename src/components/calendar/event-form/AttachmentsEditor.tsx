import * as React from "react";
import { Paperclip, Trash2, Link as LinkIcon, FileUp } from "lucide-react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Button } from "@/components/ui/Button";
import type { CalendarAttachment } from "@/data/types";

interface Props {
  value: CalendarAttachment[];
  onChange: (xs: CalendarAttachment[]) => void;
}

function basename(path: string): string {
  const trimmed = path.replace(/[/\\]+$/, "");
  const sep = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return sep >= 0 ? trimmed.slice(sep + 1) : trimmed;
}

function guessMimeType(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    pdf: "application/pdf",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    svg: "image/svg+xml",
    mp4: "video/mp4",
    mov: "video/quicktime",
    mp3: "audio/mpeg",
    wav: "audio/wav",
    txt: "text/plain",
    md: "text/markdown",
    csv: "text/csv",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  };
  return map[ext] ?? "application/octet-stream";
}

export function AttachmentsEditor({ value, onChange }: Props) {
  const [linkOpen, setLinkOpen] = React.useState(false);
  const [linkTitle, setLinkTitle] = React.useState("");
  const [linkUrl, setLinkUrl] = React.useState("");

  function remove(i: number) {
    onChange(value.filter((_, idx) => idx !== i));
  }

  function addLink() {
    const url = linkUrl.trim();
    const title = linkTitle.trim() || url;
    if (!url) return;
    onChange([...value, { fileUrl: url, title, mimeType: "text/uri-list" }]);
    setLinkTitle("");
    setLinkUrl("");
    setLinkOpen(false);
  }

  async function pickFile() {
    try {
      const selected = await openDialog({ multiple: false });
      if (typeof selected !== "string" || !selected) return;
      const name = basename(selected);
      onChange([
        ...value,
        {
          // Tauri returns an absolute path; we store it as a file:// URL so the
          // anchor in the popover can be clicked to reveal/open it.
          fileUrl: selected.startsWith("file://") ? selected : `file://${selected}`,
          title: name,
          mimeType: guessMimeType(name),
        },
      ]);
    } catch (err) {
      console.warn("Attachment picker cancelled or failed:", err);
    }
  }

  return (
    <div>
      <div className="mb-1 flex items-center gap-1.5 text-small text-text-secondary">
        <Paperclip size={12} className="text-text-tertiary" />
        <span>Attachments</span>
      </div>
      {value.length > 0 && (
        <ul className="mb-2 space-y-1">
          {value.map((att, i) => (
            <li
              key={att.fileId ?? att.fileUrl ?? i}
              className="flex items-center justify-between gap-2 rounded-xs bg-surface-1 px-2 py-1"
            >
              <span className="truncate text-small text-text-secondary" title={att.fileUrl}>
                {att.title || att.fileUrl}
              </span>
              <button
                type="button"
                onClick={() => remove(i)}
                className="text-text-muted hover:text-danger transition-colors"
                aria-label="Remove attachment"
              >
                <Trash2 size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={() => setLinkOpen((v) => !v)}>
          <LinkIcon size={12} />
          Add link
        </Button>
        <Button type="button" variant="secondary" size="sm" onClick={pickFile}>
          <FileUp size={12} />
          Attach file
        </Button>
      </div>
      {linkOpen && (
        <div className="mt-2 flex flex-wrap gap-2">
          <input
            value={linkTitle}
            onChange={(e) => setLinkTitle(e.target.value)}
            placeholder="Title"
            className="min-w-[120px] flex-1 rounded-sm border border-border-default bg-surface-1 px-2 py-1 text-small text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
          />
          <input
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            placeholder="https://..."
            className="min-w-[180px] flex-1 rounded-sm border border-border-default bg-surface-1 px-2 py-1 text-small text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addLink(); } }}
          />
          <Button type="button" variant="primary" size="sm" onClick={addLink} disabled={!linkUrl.trim()}>
            Add
          </Button>
        </div>
      )}
    </div>
  );
}
