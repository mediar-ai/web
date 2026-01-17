import * as React from "react";
import { cn } from "@/lib/utils";

export interface AutoExpandTextareaProps extends Omit<React.ComponentProps<"textarea">, "onChange" | "rows"> {
  onChange?: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onSubmit?: () => void;
  onPasteImage?: (images: Array<{ data: string; mimeType: string }>) => void;
  maxHeight?: number;
  rows?: number;
}

const AutoExpandTextarea = React.forwardRef<HTMLTextAreaElement, AutoExpandTextareaProps>(
  ({ className, onChange, onSubmit, onPasteImage, maxHeight = 200, rows = 1, ...props }, ref) => {
    const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);

    // Combine refs
    React.useImperativeHandle(ref, () => textareaRef.current as HTMLTextAreaElement);

    const adjustHeight = React.useCallback(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;

      // Reset height to auto to get accurate scrollHeight
      textarea.style.height = "auto";

      // Calculate new height (capped at maxHeight)
      const newHeight = Math.min(textarea.scrollHeight, maxHeight);
      textarea.style.height = `${newHeight}px`;

      // Show scrollbar if content exceeds maxHeight
      textarea.style.overflowY = textarea.scrollHeight > maxHeight ? "auto" : "hidden";
    }, [maxHeight]);

    const handleChange = React.useCallback(
      (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        onChange?.(e);
        adjustHeight();
      },
      [onChange, adjustHeight]
    );

    const handleKeyDown = React.useCallback(
      (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        // Enter to submit, Shift+Enter for newline
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          onSubmit?.();
        }
      },
      [onSubmit]
    );

    const handlePaste = React.useCallback(
      (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
        const items = e.clipboardData?.items;
        if (!items || !onPasteImage) return;

        const imageFiles: File[] = [];

        for (const item of Array.from(items)) {
          if (item.type.startsWith("image/")) {
            const file = item.getAsFile();
            if (file) {
              imageFiles.push(file);
            }
          }
        }

        if (imageFiles.length === 0) return;

        // Process all image files
        const images: Array<{ data: string; mimeType: string }> = [];
        let processed = 0;

        for (const file of imageFiles) {
          const reader = new FileReader();
          reader.onload = event => {
            const dataUrl = event.target?.result as string;
            // Extract base64 data (remove data:image/png;base64, prefix)
            const base64 = dataUrl.split(",")[1];
            images.push({ data: base64, mimeType: file.type });
            processed++;
            if (processed === imageFiles.length) {
              onPasteImage(images);
            }
          };
          reader.readAsDataURL(file);
        }
      },
      [onPasteImage]
    );

    // Adjust height on mount and when value changes externally
    React.useEffect(() => {
      adjustHeight();
    }, [props.value, adjustHeight]);

    // Calculate minHeight based on rows (approximately 24px per line + padding)
    const lineHeight = 24;
    const padding = 16; // py-2 = 8px top + 8px bottom
    const calculatedMinHeight = rows * lineHeight + padding;

    return (
      <textarea
        ref={textareaRef}
        data-slot="textarea"
        rows={rows}
        className={cn(
          "placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground dark:bg-input/30 border-input flex w-full min-w-0 rounded-md border bg-transparent px-3 py-2 text-base shadow-xs transition-[color,box-shadow] outline-none resize-none disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
          "aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
          className
        )}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        style={{
          minHeight: `${calculatedMinHeight}px`,
          maxHeight: `${maxHeight}px`,
          ...props.style,
        }}
        {...props}
      />
    );
  }
);
AutoExpandTextarea.displayName = "AutoExpandTextarea";

export { AutoExpandTextarea };
