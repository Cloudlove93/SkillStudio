import { Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTheme } from '@/components/theme-provider';

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  const isDark = theme === 'dark';

  return (
    <Button
      variant="ghost"
      size="icon-xs"
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      title={isDark ? '切换到亮色模式' : '切换到暗色模式'}
    >
      {isDark ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
    </Button>
  );
}
