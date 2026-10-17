import { Check, Moon, Monitor, Sun } from "lucide-react";
import { useTheme } from "../../lib/theme/ThemeProvider";
import type { Theme } from "../../lib/theme/ThemeProvider";
import { useT } from "../../lib/i18n/LocalizationProvider";
import type { TranslationKey } from "../../lib/i18n/dictionary";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "../../shared/ui/dropdown-menu";

export function ThemeSwitcher() {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const { t } = useT();

  const themes: Array<{ key: Theme; labelKey: TranslationKey; defaultLabel: string; icon: typeof Sun }> = [
    { key: "light", labelKey: "theme.light", defaultLabel: "Light", icon: Sun },
    { key: "dark", labelKey: "theme.dark", defaultLabel: "Dark", icon: Moon },
    { key: "system", labelKey: "theme.system", defaultLabel: "System", icon: Monitor }
  ];

  // Active icon displayed on the button
  const ActiveIcon = theme === "system" ? Monitor : resolvedTheme === "dark" ? Moon : Sun;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="icon-button"
        aria-label={t("theme.label", "Switch theme")}
        title={t("theme.label", "Switch theme")}
      >
        <ActiveIcon size={18} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[150px]">
        {themes.map(({ key, labelKey, defaultLabel, icon: Icon }) => (
          <DropdownMenuItem
            key={key}
            className="flex items-center justify-between"
            onSelect={() => setTheme(key)}
          >
            <span className="flex items-center gap-2">
              <Icon size={16} />
              <span>{t(labelKey, defaultLabel)}</span>
            </span>
            {theme === key ? <Check size={14} className="text-[hsl(var(--primary))]" /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
