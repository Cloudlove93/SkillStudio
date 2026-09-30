import { useCallback, useEffect, useState } from 'react';
import { X, ImageIcon } from 'lucide-react';
import type { ImageAttachment } from '../PromptInput';

const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

export { ACCEPTED_IMAGE_TYPES };

export function useImageAttachments() {
  const [images, setImages] = useState<ImageAttachment[]>([]);
  const [dragging, setDragging] = useState(false);

  const addImage = useCallback((file: File) => {
    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) return;
    const reader = new FileReader();
    reader.onload = () => {
      const attachment: ImageAttachment = {
        id: `img-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        filename: file.name,
        mime: file.type,
        dataUrl: reader.result as string,
      };
      setImages((prev) => [...prev, attachment]);
    };
    reader.readAsDataURL(file);
  }, []);

  const removeImage = useCallback((id: string) => {
    setImages((prev) => prev.filter((img) => img.id !== id));
  }, []);

  const clearImages = useCallback(() => setImages([]), []);

  // Global drag and drop
  useEffect(() => {
    const handleDragOver = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) {
        e.preventDefault();
        setDragging(true);
      }
    };
    const handleDragLeave = (e: DragEvent) => {
      if (!e.relatedTarget) setDragging(false);
    };
    const handleDrop = (e: DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const files = e.dataTransfer?.files;
      if (!files) return;
      for (const file of Array.from(files)) {
        if (ACCEPTED_IMAGE_TYPES.includes(file.type)) addImage(file);
      }
    };
    document.addEventListener('dragover', handleDragOver);
    document.addEventListener('dragleave', handleDragLeave);
    document.addEventListener('drop', handleDrop);
    return () => {
      document.removeEventListener('dragover', handleDragOver);
      document.removeEventListener('dragleave', handleDragLeave);
      document.removeEventListener('drop', handleDrop);
    };
  }, [addImage]);

  return { images, dragging, addImage, removeImage, clearImages };
}

import { useT } from '../../../i18n';

export function ImageDragOverlay() {
  const t = useT();
  return (
    <div className="mb-2 flex items-center justify-center gap-2 rounded-xl border-2 border-dashed border-primary/40 bg-primary/5 py-6 text-sm text-primary/60">
      <ImageIcon className="size-5" />
      {t('prompt.dropImage')}
    </div>
  );
}

export function ImagePreviewStrip({
  images,
  onRemove,
}: {
  images: ImageAttachment[];
  onRemove: (id: string) => void;
}) {
  if (images.length === 0) return null;
  return (
    <div className="mb-2 flex flex-wrap gap-2">
      {images.map((img) => (
        <div key={img.id} className="group relative">
          <img
            src={img.dataUrl}
            alt={img.filename}
            className="h-16 w-16 rounded-lg border border-border object-cover shadow-sm"
          />
          <button
            onClick={() => onRemove(img.id)}
            className="absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full bg-destructive text-white opacity-0 group-hover:opacity-100 transition-opacity shadow-sm"
          >
            <X className="size-3" />
          </button>
          <div className="absolute bottom-0 left-0 right-0 rounded-b-lg bg-black/50 px-1 py-0.5 text-[8px] text-white truncate">
            {img.filename}
          </div>
        </div>
      ))}
    </div>
  );
}
