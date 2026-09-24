/**
 * Drag-and-drop room photo uploader.  Yields a File object via onChange,
 * plus a local object-URL preview so the user can see what they uploaded
 * before kicking off the AI request.
 *
 * Validation: caps at 10 MB and only accepts image/* — anything else gets
 * rejected with a one-line error shown inline.  Wizart's docs don't
 * specify a max upload size; 10 MB is a sane ceiling that keeps
 * round-trips fast on broadband and avoids surprise costs.
 */
import { useCallback, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Upload, X } from "lucide-react";

const MAX_BYTES = 10 * 1024 * 1024;

export default function PhotoUpload({ file, onChange }) {
  const inputRef = useRef(null);
  const [error, setError] = useState(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const acceptFile = useCallback(
    (f) => {
      setError(null);
      if (!f) return;
      if (!f.type.startsWith("image/")) {
        setError("Please pick an image file (jpg, png, webp).");
        return;
      }
      if (f.size > MAX_BYTES) {
        setError(`Image is ${(f.size / 1024 / 1024).toFixed(1)} MB — keep it under 10 MB.`);
        return;
      }
      onChange(f);
    },
    [onChange]
  );

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragOver(false);
    acceptFile(e.dataTransfer.files?.[0]);
  };

  const previewUrl = file ? URL.createObjectURL(file) : null;

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-[hsl(215,25%,27%)]">
        2. Upload a photo of your room
      </h3>

      {!file ? (
        <div
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={handleDrop}
          className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
            isDragOver
              ? "border-[hsl(var(--accent))] bg-[hsl(var(--accent)/0.05)]"
              : "border-[hsl(var(--border))] hover:border-[hsl(215,16%,47%)] bg-[hsl(var(--secondary))]"
          }`}
          data-testid="photo-dropzone"
        >
          <Upload className="h-8 w-8 mx-auto text-[hsl(215,16%,47%)] mb-2" />
          <p className="text-sm font-medium text-[hsl(215,25%,27%)]">
            Drag a photo here, or click to choose
          </p>
          <p className="text-xs text-[hsl(215,16%,47%)] mt-1">
            JPG, PNG or WEBP · up to 10 MB
          </p>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => acceptFile(e.target.files?.[0])}
            data-testid="photo-input"
          />
        </div>
      ) : (
        <div className="relative rounded-xl overflow-hidden border border-[hsl(var(--border))]">
          <img
            src={previewUrl}
            alt="Room"
            className="w-full max-h-[420px] object-contain bg-[hsl(var(--secondary))]"
          />
          <Button
            type="button"
            size="icon"
            variant="outline"
            onClick={() => onChange(null)}
            className="absolute top-2 right-2 h-8 w-8 bg-white/90 backdrop-blur-sm"
            data-testid="photo-clear"
            aria-label="Remove photo"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}

      {error && (
        <p className="text-xs text-red-600" role="alert">{error}</p>
      )}
    </div>
  );
}
