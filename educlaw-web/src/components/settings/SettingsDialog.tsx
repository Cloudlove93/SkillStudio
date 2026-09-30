import { Settings, Globe } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { useSettingsStore } from '../../stores/settings';
import { useT, type Locale } from '../../i18n';
import { DetailSurface, PremiumHeader, PremiumPill } from '@/components/ui/premium';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function SettingsDialog({ open, onOpenChange }: Props) {
  const t = useT();
  const language = useSettingsStore((s) => s.language);
  const setLanguage = useSettingsStore((s) => s.setLanguage);
  const zhLabel = String.fromCharCode(0x4e2d, 0x6587);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden p-0 sm:max-w-lg">
        <DialogHeader className="sr-only">
          <DialogTitle>{t('settings.title')}</DialogTitle>
          <DialogDescription>{t('settings.description')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 p-4 sm:p-5">
          <PremiumHeader
            accent="blue"
            icon={Settings}
            eyebrow={t('settings.preferencesEyebrow')}
            title={t('settings.title')}
            description={t('settings.description')}
            actions={<PremiumPill accent="slate">{language === 'zh' ? zhLabel : 'English'}</PremiumPill>}
          />

          <DetailSurface className="p-4 sm:p-5">
            <div className="space-y-3">
              <div className="space-y-0.5">
                <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <div className="flex size-8 items-center justify-center rounded-[10px] bg-[rgba(55,130,255,0.10)] text-[color:var(--info)]">
                    <Globe className="size-4" />
                  </div>
                  {t('settings.language')}
                </div>
                <div className="pl-10 text-xs text-muted-foreground">{t('settings.languageDesc')}</div>
              </div>
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value as Locale)}
                className="w-full rounded-[12px] border border-border bg-card px-4 py-3 text-sm text-foreground outline-none transition focus:border-primary/35 focus:ring-4 focus:ring-ring"
              >
                <option value="zh">{zhLabel}</option>
                <option value="en">English</option>
              </select>
            </div>
          </DetailSurface>
        </div>
      </DialogContent>
    </Dialog>
  );
}
