import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

export type Locale = 'zh' | 'en'

const messages = {
  zh: {
    'common.platformName': '教育大模型服务平台',
    'common.platformTagline': '一站式 AI 教育服务入口',
    'common.loadingEyebrow': '初始化中',
    'common.loading': '加载中...',
    'common.language.zh': '中文',
    'common.language.en': 'EN',
    'common.language.toggleLabel': '切换语言',
    'common.user': '用户',
    'common.logout': '退出',
    'common.comingSoon': '即将上线',
    'common.operationFailed': '操作失败，请稍后重试',
    'landing.logoAlt': '平台',
    'landing.title': '欢迎使用教育大模型平台',
    'landing.description': '登录或注册以访问 EduClaw、Edunex、PPTX Studio、SynapAI 等教育大模型服务。',
    'landing.login': '登录',
    'landing.register': '注册',
    'landing.featureOne': '包含 EduClaw 智能体平台、Edunex 自适应学习、PPTX Studio 演示生成、SynapAI 知识推理等服务。',
    'landing.featureTwo': '统一账号登录，一次注册即可使用全部教育大模型服务。',
    'auth.loginTitle': '登录',
    'auth.registerTitle': '注册账号',
    'auth.passwordLogin': '密码登录',
    'auth.smsLogin': '短信登录',
    'auth.passwordRegister': '密码注册',
    'auth.phoneRegister': '手机注册',
    'auth.accountOrEmail': '用户名/邮箱',
    'auth.username': '用户名',
    'auth.email': '邮箱',
    'auth.password': '密码',
    'auth.confirmPassword': '确认密码',
    'auth.phone': '请输入手机号',
    'auth.phoneShort': '手机号码',
    'auth.smsCode': '验证码',
    'auth.sendCode': '发送验证',
    'auth.hidePassword': '隐藏密码',
    'auth.showPassword': '显示密码',
    'auth.haveAccount': '已有账号？',
    'auth.loginNow': '立即登录',
    'auth.noAccount': '还没有账号？',
    'auth.registerNow': '立即注册',
    'auth.registering': '注册中',
    'auth.register': '注册',
    'auth.loggingIn': '登录中',
    'auth.login': '登录',
    'auth.validation.required': '请完善必填信息',
    'auth.validation.phoneRequired': '请输入手机号码',
    'auth.validation.sendCodeFailed': '验证码发送失败，请稍后重试',
    'auth.validation.accountRequired': '请输入用户名/邮箱',
    'auth.validation.passwordRequired': '请输入密码',
    'auth.validation.smsCodeRequired': '请输入验证码',
    'auth.validation.sendCodeFirst': '请先发送验证码',
    'auth.validation.loginFailed': '登录失败，请稍后重试',
    'auth.validation.accountPasswordRequired': '请输入用户名和密码',
    'auth.validation.badCredentials': '用户名或密码错误，请重新输入',
    'auth.validation.usernameRequired': '请输入用户名',
    'auth.validation.usernameRegistered': '该用户名已存在',
    'auth.validation.emailRequired': '请输入邮箱',
    'auth.validation.confirmPasswordRequired': '请再次输入密码',
    'auth.validation.passwordComplexity': '密码不满足复杂度要求',
    'auth.validation.passwordMismatch': '两次输入的密码不一致',
    'auth.validation.emailInvalid': '请输入正确的邮箱地址',
    'auth.validation.registerFailed': '注册失败，请稍后重试',
    'auth.validation.codeInvalid': '验证码错误',
    'auth.validation.accountRegistered': '该账号已被注册',
    'auth.validation.phoneNotRegistered': '该手机号未注册',
    'auth.password.minLength': '最小 8 个字符',
    'auth.password.lowercase': '包含小写字母',
    'auth.password.uppercase': '包含大写字母',
    'auth.password.number': '包含数字',
    'auth.password.symbol': '包含符号',
    'auth.password.match': '密码一致',
    'nav.products': '产品介绍',
    'nav.community': '课程社区',
    'nav.about': '关于我们',
    'nav.search': '搜索应用',
    'nav.bannerAlt': '启创 InnoSpark 有温度的教育大模型',
    'nav.userLoadFailed': '用户信息加载失败，请重新登录。',
    'nav.noResults': '没有找到匹配的应用',
    'nav.noAccessibleApps': '暂无可访问的应用，请联系管理员开通权限',
    'nav.noPermission': '没有访问权限，请联系管理员开通权限',
    'common.noAccess': '无权限',
    'nav.service.educlaw': 'AI 教育智能体平台，支持多智能体协作与个性化学习',
    'nav.service.edunex': '智能教育评测与自适应学习引擎',
    'nav.service.pptxStudio': 'AI 驱动的智能演示文稿生成与编辑工具',
    'nav.service.synapAi': '知识图谱与认知推理智能引擎',
    'country.CN': '中国',
    'country.US': '美国',
    'country.CA': '加拿大',
    'country.GB': '英国',
    'country.JP': '日本',
    'country.KR': '韩国',
    'country.HK': '中国香港',
    'country.TW': '中国台湾',
    'country.SG': '新加坡',
    'country.MY': '马来西亚',
    'country.AU': '澳大利亚',
    'country.DE': '德国',
    'country.FR': '法国',
    'country.RU': '俄罗斯',
    'country.IN': '印度',
  },
  en: {
    'common.platformName': 'Education LLM Service Platform',
    'common.platformTagline': 'One-stop AI education service portal',
    'common.loadingEyebrow': 'Initializing',
    'common.loading': 'Loading...',
    'common.language.zh': '中文',
    'common.language.en': 'EN',
    'common.language.toggleLabel': 'Switch language',
    'common.user': 'User',
    'common.logout': 'Sign out',
    'common.comingSoon': 'Coming soon',
    'common.operationFailed': 'Something went wrong. Please try again later.',
    'landing.logoAlt': 'Platform',
    'landing.title': 'Welcome to the Education LLM Platform',
    'landing.description': 'Log in or create an account to access EduClaw, Edunex, PPTX Studio, SynapAI, and more AI education services.',
    'landing.login': 'Log in',
    'landing.register': 'Register',
    'landing.featureOne': 'Includes EduClaw agent platform, Edunex adaptive learning, PPTX Studio presentation generation, SynapAI knowledge reasoning, and more.',
    'landing.featureTwo': 'Use one account to access every education LLM service after registration.',
    'auth.loginTitle': 'Log In',
    'auth.registerTitle': 'Create Account',
    'auth.passwordLogin': 'Password',
    'auth.smsLogin': 'SMS',
    'auth.passwordRegister': 'Email Sign-up',
    'auth.phoneRegister': 'Phone Sign-up',
    'auth.accountOrEmail': 'Account / Email',
    'auth.username': 'Username',
    'auth.email': 'Email',
    'auth.password': 'Password',
    'auth.confirmPassword': 'Confirm password',
    'auth.phone': 'Phone number',
    'auth.phoneShort': 'Phone number',
    'auth.smsCode': 'Verification code',
    'auth.sendCode': 'Send code',
    'auth.hidePassword': 'Hide password',
    'auth.showPassword': 'Show password',
    'auth.haveAccount': 'Already have an account?',
    'auth.loginNow': 'Log in',
    'auth.noAccount': "Don't have an account?",
    'auth.registerNow': 'Register',
    'auth.registering': 'Registering',
    'auth.register': 'Register',
    'auth.loggingIn': 'Logging in',
    'auth.login': 'Log in',
    'auth.validation.required': 'Please complete the required fields.',
    'auth.validation.phoneRequired': 'Please enter your phone number.',
    'auth.validation.sendCodeFailed': 'Could not send the verification code. Please try again later.',
    'auth.validation.accountRequired': 'Please enter your username or email.',
    'auth.validation.passwordRequired': 'Please enter your password.',
    'auth.validation.smsCodeRequired': 'Please enter the verification code.',
    'auth.validation.sendCodeFirst': 'Please send the verification code first.',
    'auth.validation.loginFailed': 'Login failed. Please try again later.',
    'auth.validation.accountPasswordRequired': 'Please enter your username and password.',
    'auth.validation.badCredentials': 'Incorrect username or password. Please try again.',
    'auth.validation.usernameRequired': 'Please enter a username.',
    'auth.validation.usernameRegistered': 'This username is already taken.',
    'auth.validation.emailRequired': 'Please enter your email.',
    'auth.validation.confirmPasswordRequired': 'Please confirm your password.',
    'auth.validation.passwordComplexity': 'Password does not meet the complexity requirements.',
    'auth.validation.passwordMismatch': 'The two passwords do not match.',
    'auth.validation.emailInvalid': 'Please enter a valid email address.',
    'auth.validation.registerFailed': 'Registration failed. Please try again later.',
    'auth.validation.codeInvalid': 'Incorrect verification code.',
    'auth.validation.accountRegistered': 'This account is already registered.',
    'auth.validation.phoneNotRegistered': 'This phone number is not registered.',
    'auth.password.minLength': 'At least 8 characters',
    'auth.password.lowercase': 'Contains lowercase letters',
    'auth.password.uppercase': 'Contains uppercase letters',
    'auth.password.number': 'Contains numbers',
    'auth.password.symbol': 'Contains symbols',
    'auth.password.match': 'Passwords match',
    'nav.products': 'Products',
    'nav.community': 'Courses',
    'nav.about': 'About Us',
    'nav.search': 'Search apps',
    'nav.bannerAlt': 'InnoSpark, an education LLM with warmth',
    'nav.userLoadFailed': 'Could not load user information. Please log in again.',
    'nav.noResults': 'No matching apps found',
    'nav.noAccessibleApps': 'No accessible apps. Please contact the administrator.',
    'nav.noPermission': 'No access permission. Please contact the administrator.',
    'common.noAccess': 'No access',
    'nav.service.educlaw': 'AI education agent platform for multi-agent collaboration and personalized learning',
    'nav.service.edunex': 'Intelligent education assessment and adaptive learning engine',
    'nav.service.pptxStudio': 'AI-powered presentation generation and editing tool',
    'nav.service.synapAi': 'Knowledge graph and cognitive reasoning engine',
    'country.CN': 'China',
    'country.US': 'United States',
    'country.CA': 'Canada',
    'country.GB': 'United Kingdom',
    'country.JP': 'Japan',
    'country.KR': 'South Korea',
    'country.HK': 'Hong Kong, China',
    'country.TW': 'Taiwan, China',
    'country.SG': 'Singapore',
    'country.MY': 'Malaysia',
    'country.AU': 'Australia',
    'country.DE': 'Germany',
    'country.FR': 'France',
    'country.RU': 'Russia',
    'country.IN': 'India',
  },
} as const

export type MessageKey = keyof typeof messages.zh

interface AuthI18nContextValue {
  locale: Locale
  setLocale: (locale: Locale) => void
  t: (key: MessageKey) => string
}

const STORAGE_KEY = 'auth-service-locale'
const AuthI18nContext = createContext<AuthI18nContextValue | null>(null)

function getInitialLocale(): Locale {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored === 'zh' || stored === 'en') return stored
  return navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en'
}

export function AuthI18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>(getInitialLocale)

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, locale)
    document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en'
  }, [locale])

  const value = useMemo<AuthI18nContextValue>(() => ({
    locale,
    setLocale,
    t: (key) => messages[locale][key] ?? messages.zh[key] ?? key,
  }), [locale])

  return <AuthI18nContext.Provider value={value}>{children}</AuthI18nContext.Provider>
}

export function useAuthI18n() {
  const context = useContext(AuthI18nContext)
  if (!context) {
    throw new Error('useAuthI18n must be used within AuthI18nProvider')
  }
  return context
}

export function translateApiError(message: string, locale: Locale, fallback: string) {
  if (locale === 'zh') return message || fallback

  const normalized = message.toLowerCase()
  if (/用户名.*(已存在|已被注册)|username.*(already|exists|taken)/.test(normalized)) {
    return messages.en['auth.validation.usernameRegistered']
  }
  if (/已注册|已被注册|already/.test(normalized)) return messages.en['auth.validation.accountRegistered']
  if (/未注册/.test(message)) return messages.en['auth.validation.phoneNotRegistered']
  if (/验证码.*(不存在|过期)|验证码.*过期|expired|otp/.test(normalized)) {
    return messages.en['auth.validation.sendCodeFirst']
  }
  if (/验证码错误/.test(message)) return messages.en['auth.validation.codeInvalid']
  if (/手机号不能为空|手机号码|phone/.test(message)) return messages.en['auth.validation.phoneRequired']
  if (/邮箱|email/.test(message)) return messages.en['auth.validation.emailInvalid']
  if (/短信|验证码发送失败/.test(message)) return messages.en['auth.validation.sendCodeFailed']
  if (/登录失败|login/.test(normalized)) return messages.en['auth.validation.loginFailed']
  if (/注册失败|register/.test(normalized)) return messages.en['auth.validation.registerFailed']
  if (/必填|required|missing|empty/.test(normalized)) return messages.en['auth.validation.required']
  if (/密码|password/.test(message)) return messages.en['auth.validation.badCredentials']

  return fallback
}
