export interface CountryCode {
  code: string
  name: string
  iso: string
  flag: string
}

export const countryCodes: CountryCode[] = [
  { code: '+86', name: '中国', iso: 'CN', flag: '🇨🇳' },
  { code: '+1', name: '美国', iso: 'US', flag: '🇺🇸' },
  { code: '+1', name: '加拿大', iso: 'CA', flag: '🇨🇦' },
  { code: '+44', name: '英国', iso: 'GB', flag: '🇬🇧' },
  { code: '+81', name: '日本', iso: 'JP', flag: '🇯🇵' },
  { code: '+82', name: '韩国', iso: 'KR', flag: '🇰🇷' },
  { code: '+852', name: '中国香港', iso: 'HK', flag: '🇭🇰' },
  { code: '+886', name: '中国台湾', iso: 'TW', flag: '台' },
  { code: '+65', name: '新加坡', iso: 'SG', flag: '🇸🇬' },
  { code: '+60', name: '马来西亚', iso: 'MY', flag: '🇲🇾' },
  { code: '+61', name: '澳大利亚', iso: 'AU', flag: '🇦🇺' },
  { code: '+49', name: '德国', iso: 'DE', flag: '🇩🇪' },
  { code: '+33', name: '法国', iso: 'FR', flag: '🇫🇷' },
  { code: '+7', name: '俄罗斯', iso: 'RU', flag: '🇷🇺' },
  { code: '+91', name: '印度', iso: 'IN', flag: '🇮🇳' },
]

export const DEFAULT_COUNTRY = countryCodes[0]
