import type { IconType } from 'react-icons';
import {
  PiMathOperationsBold,
  PiBookOpenTextBold,
  PiGlobeHemisphereWestBold,
  PiFlaskBold,
  PiAtomBold,
  PiDnaBold,
  PiScrollBold,
  PiScalesBold,
  PiMusicNoteBold,
  PiPaletteBold,
  PiSoccerBallBold,
  PiDesktopBold,
  PiLightbulbBold,
  PiChatsCircleBold,
  PiGavelBold,
  PiHeartBold,
  PiTranslateBold,
  PiFolderBold,
  PiStarBold,
  PiBookmarkSimpleBold,
  PiRocketBold,
  PiGraduationCapBold,
  PiTargetBold,
  PiCrownBold,
  PiFireBold,
} from 'react-icons/pi';

export const iconMap: Record<string, IconType> = {
  Folder: PiFolderBold,
  Star: PiStarBold,
  Bookmark: PiBookmarkSimpleBold,
  Rocket: PiRocketBold,
  GraduationCap: PiGraduationCapBold,
  Target: PiTargetBold,
  Crown: PiCrownBold,
  Fire: PiFireBold,
  Math: PiMathOperationsBold,
  Book: PiBookOpenTextBold,
  Globe: PiGlobeHemisphereWestBold,
  Flask: PiFlaskBold,
  Atom: PiAtomBold,
  Dna: PiDnaBold,
  Scroll: PiScrollBold,
  Scales: PiScalesBold,
  Music: PiMusicNoteBold,
  Palette: PiPaletteBold,
  Soccer: PiSoccerBallBold,
  Desktop: PiDesktopBold,
  Lightbulb: PiLightbulbBold,
  Chat: PiChatsCircleBold,
  Gavel: PiGavelBold,
  Heart: PiHeartBold,
  Translate: PiTranslateBold,
};

export const iconNames = Object.keys(iconMap);

export function getGroupIcon(name: string): IconType {
  return iconMap[name] ?? PiFolderBold;
}

interface IconPickerProps {
  value: string;
  onChange: (icon: string) => void;
}

export default function IconPicker({ value, onChange }: IconPickerProps) {
  return (
    <div className="grid grid-cols-8 gap-1.5">
      {iconNames.map((name) => {
        const Icon = iconMap[name];
        const selected = name === value;
        return (
          <button
            key={name}
            type="button"
            onClick={() => onChange(name)}
            className={`flex items-center justify-center size-8 rounded-lg transition-all ${
              selected
                ? 'bg-primary/15 ring-2 ring-primary text-primary'
                : 'bg-muted/40 text-muted-foreground hover:bg-muted/80 hover:text-foreground'
            }`}
            title={name}
          >
            <Icon className="size-4" />
          </button>
        );
      })}
    </div>
  );
}
