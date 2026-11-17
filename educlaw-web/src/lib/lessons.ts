export interface LessonIndexItem {
  id: string;
  name: string;
  description: string;
  updatedAt: string;
  ready: boolean;
  subject: string;
  stage: string;
  grade: string;
  textbook: string;
  unit: string;
  lessonType: string;
  charCount: number;
  quality: 'A' | 'B';
  file: string;
}

export interface LessonDetail extends LessonIndexItem {
  stage: string;
  term: string;
  sourceTitle: string;
  notice: string;
  text: string;
}

function lessonUrl(path: string) {
  return `${import.meta.env.BASE_URL}lessons/${path}`;
}

let indexPromise: Promise<LessonIndexItem[]> | null = null;

export function listLessons() {
  if (!indexPromise) {
    indexPromise = fetch(lessonUrl('index.json'))
      .then((response) => {
        if (!response.ok) throw new Error('课例索引加载失败');
        return response.json() as Promise<LessonIndexItem[]>;
      })
      .catch((error) => {
        indexPromise = null;
        throw error;
      });
  }
  return indexPromise;
}

export async function getLesson(id: string) {
  const response = await fetch(lessonUrl(`${id}.json`));
  if (!response.ok) throw new Error('课例加载失败');
  return (await response.json()) as LessonDetail;
}
