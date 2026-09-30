import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Check, Copy, ExternalLink, Loader2 } from 'lucide-react';
import { useT } from '../../i18n';
import { copyToClipboard } from '../../lib/utils';

export interface ShareDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shareUrl?: string;
  isPublishing: boolean;
  isUnpublishing: boolean;
  onPublish: () => void;
  onUnpublish: () => void;
}

export default function ShareDialog({
  open,
  onOpenChange,
  shareUrl,
  isPublishing,
  isUnpublishing,
  onPublish,
  onUnpublish,
}: ShareDialogProps) {
  const t = useT();
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    if (!shareUrl) return;
    copyToClipboard(shareUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    }).catch(() => {});
  }

  function handleView() {
    if (!shareUrl) return;
    window.open(shareUrl, '_blank', 'noopener,noreferrer');
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('session.share.title')}</DialogTitle>
          <DialogDescription>
            {shareUrl ? t('session.share.descShared') : t('session.share.descUnshared')}
          </DialogDescription>
        </DialogHeader>

        {shareUrl ? (
          <div className="flex flex-col gap-3">
            {/* URL display with copy */}
            <div className="flex items-center gap-2">
              <Input
                readOnly
                value={shareUrl}
                className="flex-1 text-xs font-mono bg-muted/50"
                onClick={(e) => (e.target as HTMLInputElement).select()}
              />
              <Button
                variant="outline"
                size="icon"
                className="shrink-0"
                onClick={handleCopy}
              >
                {copied ? <Check className="size-4 text-green-500" /> : <Copy className="size-4" />}
              </Button>
            </div>

            {/* Action buttons */}
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="outline"
                onClick={onUnpublish}
                disabled={isUnpublishing}
              >
                {isUnpublishing && <Loader2 className="mr-1.5 size-3.5 animate-spin" />}
                {isUnpublishing ? t('session.share.unpublishing') : t('session.share.unpublish')}
              </Button>
              <Button onClick={handleView} disabled={isUnpublishing}>
                <ExternalLink className="mr-1.5 size-3.5" />
                {t('session.share.view')}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex justify-center">
            <Button
              onClick={onPublish}
              disabled={isPublishing}
              className="w-full"
            >
              {isPublishing && <Loader2 className="mr-1.5 size-3.5 animate-spin" />}
              {isPublishing ? t('session.share.publishing') : t('session.share.publish')}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
