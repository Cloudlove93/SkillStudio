import { apiFetchJson, apiPut, BASE } from './client';

export function fetchDiary(date: string): Promise<{ date: string; content: string }> {
  return apiFetchJson(`${BASE}/api/diary/${date}`);
}

export function saveDiary(date: string, content: string): Promise<{ date: string; content: string }> {
  return apiPut(`${BASE}/api/diary/${date}`, { content });
}

export function fetchDiaryDates(year: number, month: number): Promise<{ dates: string[] }> {
  return apiFetchJson(`${BASE}/api/diary/dates/${year}/${month}`);
}
