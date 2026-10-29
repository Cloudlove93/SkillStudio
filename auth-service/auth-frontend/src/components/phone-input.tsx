import * as React from "react"
import { cn } from "@/lib/utils"
import { Select, SelectTrigger, SelectContent, SelectItem } from "@/components/ui/select"
import { useAuthI18n, type MessageKey } from "@/i18n/auth-i18n"
import { countryCodes, DEFAULT_COUNTRY, type CountryCode } from "@/data/country-codes"

interface PhoneInputProps {
  value: string
  onChange: (value: string) => void
  className?: string
  disabled?: boolean
  placeholder?: string
  variant?: "default" | "pill"
  inputRef?: React.Ref<HTMLInputElement>
  onFocus?: React.FocusEventHandler<HTMLInputElement>
}

export function PhoneInput({
  value,
  onChange,
  className,
  disabled,
  placeholder,
  variant = "default",
  inputRef,
  onFocus,
}: PhoneInputProps) {
  const { t } = useAuthI18n()
  const [country, setCountry] = React.useState<CountryCode>(DEFAULT_COUNTRY)
  const [localNumber, setLocalNumber] = React.useState("")
  const lastEmittedRef = React.useRef("")
  const inputPlaceholder = placeholder ?? t('auth.phoneShort')

  React.useEffect(() => {
    if (value === lastEmittedRef.current) {
      return
    }
    if (!value) {
      setLocalNumber("")
      setCountry(DEFAULT_COUNTRY)
      return
    }
    const match = countryCodes.find((c) => value.startsWith(c.code))
    if (match) {
      setCountry(match)
      setLocalNumber(value.slice(match.code.length))
    } else {
      setLocalNumber(value)
    }
  }, [value])

  const emitChange = React.useCallback(
    (nextCountry: CountryCode, nextLocal: string) => {
      const full = nextLocal ? `${nextCountry.code}${nextLocal}` : ""
      lastEmittedRef.current = full
      onChange(full)
    },
    [onChange]
  )

  const handleCountryChange = React.useCallback((iso: string) => {
    const next = countryCodes.find((c) => c.iso === iso) ?? DEFAULT_COUNTRY
    setCountry(next)
    emitChange(next, localNumber)
  }, [localNumber, emitChange])

  const handleLocalChange = React.useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const digits = e.target.value.replace(/\D/g, "")
    setLocalNumber(digits)
    emitChange(country, digits)
  }, [country, emitChange])

  if (variant === "pill") {
    return (
      <div className={cn("flex h-[58px] items-center rounded-full border border-transparent bg-[#f4f4f4] px-6 transition-[border-color,background-color,box-shadow] sm:h-[66px]", className)}>
        <Select value={country.iso} onValueChange={handleCountryChange} disabled={disabled}>
          <SelectTrigger className="h-full w-[76px] shrink-0 border-0 bg-transparent px-0 py-0 text-[17px] font-medium text-[#0a0a28] shadow-none focus-visible:border-0 focus-visible:ring-0 disabled:opacity-50 dark:bg-transparent sm:text-[20px]">
            <span>{country.code}</span>
          </SelectTrigger>
          <SelectContent className="w-[190px]">
            {countryCodes.map((c) => (
              <SelectItem key={`${c.iso}-${c.code}`} value={c.iso}>
                <span className="flex w-full items-center gap-3 text-[15px] font-medium text-[#0a0a28]">
                  <span className="whitespace-nowrap">{t(`country.${c.iso}` as MessageKey)}</span>
                  <span className="ml-auto text-[14px] font-medium text-[#77788a]">{c.code}</span>
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <input
          ref={inputRef}
          type="tel"
          inputMode="numeric"
          autoComplete="tel-national"
          placeholder={inputPlaceholder}
          disabled={disabled}
          value={localNumber}
          onChange={handleLocalChange}
          onFocus={onFocus}
          className="h-full min-w-0 flex-1 bg-transparent text-[17px] font-medium text-[#0a0a28] outline-none placeholder:text-[#a7a7ad] disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 sm:text-[20px]"
        />
      </div>
    )
  }

  return (
    <div className={cn("flex gap-2", className)}>
      <Select value={country.iso} onValueChange={handleCountryChange} disabled={disabled}>
        <SelectTrigger className="w-[110px] shrink-0 text-sm font-medium">
          <span className="flex items-center">
            <span className="text-muted-foreground">{country.code}</span>
          </span>
        </SelectTrigger>
        <SelectContent className="w-[190px]">
          {countryCodes.map((c) => (
            <SelectItem key={`${c.iso}-${c.code}`} value={c.iso}>
              <span className="flex w-full items-center gap-3 font-medium">
                <span className="whitespace-nowrap">{t(`country.${c.iso}` as MessageKey)}</span>
                <span className="ml-auto text-muted-foreground">{c.code}</span>
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <input
        ref={inputRef}
        type="tel"
        inputMode="numeric"
        autoComplete="tel-national"
        placeholder={inputPlaceholder}
        disabled={disabled}
        value={localNumber}
        onChange={handleLocalChange}
        onFocus={onFocus}
        className={cn(
          "h-11 w-full min-w-0 rounded-xl border border-input bg-transparent px-4 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none selection:bg-primary selection:text-primary-foreground placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30",
          "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        )}
      />
    </div>
  )
}
