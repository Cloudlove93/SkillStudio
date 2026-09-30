import { apiFetchJson, apiPut } from './client';

export function fetchDiary(date: string): Promise<{ date: string; content: string }> {
  return apiFetchJson(`/api/diary/${date}`);
}

export function saveDiary(date: string, content: string): Promise<{ date: string; content: string }> {
  return apiPut(`/api/diary/${date}`, { content });
}

export function fetchDiaryDates(year: number, month: number): Promise<{ dates: string[] }> {
  return apiFetchJson(`/api/diary/dates/${year}/${month}`);
}
