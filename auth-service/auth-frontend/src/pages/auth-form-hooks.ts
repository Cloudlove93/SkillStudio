import { useCallback, useRef, useState } from 'react'

export function useCountdown(seconds = 60) {
  const [countdown, setCountdown] = useState(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const startCountdown = useCallback(() => {
    setCountdown(seconds)
    timerRef.current = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          if (timerRef.current) clearInterval(timerRef.current)
          return 0
        }
        return prev - 1
      })
    }, 1000)
  }, [seconds])

  return { countdown, startCountdown }
}

export function mapFieldMessages<T extends string>(
  fields: T[],
  messages: Partial<Record<T, string>>,
  fallback = '请完善必填信息',
): Partial<Record<T, string>> {
  return Object.fromEntries(fields.map(field => [field, messages[field] ?? fallback])) as Partial<
    Record<T, string>
  >
}
