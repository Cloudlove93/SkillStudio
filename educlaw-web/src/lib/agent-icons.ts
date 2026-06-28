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
} from 'react-icons/pi';

interface IconRule {
  category: string;
  keywords: string[];
  icon: IconType;
  color: string; // tailwind text color
}

const rules: IconRule[] = [
  // 学科匹配 — 优先级从高到低
  {
    category: '数学',
    keywords: [
      '数学',
      '代数',
      '几何',
      '函数',
      '方程',
      '算术',
      '微积分',
      '概率',
      '统计',
    ],
    icon: PiMathOperationsBold,
    color: 'text-blue-500',
  },
  {
    category: '语文',
    keywords: [
      '语文',
      '阅读',
      '写作',
      '作文',
      '文言',
      '古诗',
      '诗词',
      '名著',
      '文学',
    ],
    icon: PiBookOpenTextBold,
    color: 'text-amber-600',
  },
  {
    category: '英语',
    keywords: ['英语', '英文', '翻译', '口语', '听力'],
    icon: PiTranslateBold,
    color: 'text-purple-500',
  },
  {
    category: '物理',
    keywords: ['物理', '力学', '电路', '光学', '电磁', '热学'],
    icon: PiAtomBold,
    color: 'text-cyan-500',
  },
  {
    category: '化学',
    keywords: ['化学', '元素', '分子', '反应', '酸碱'],
    icon: PiFlaskBold,
    color: 'text-emerald-500',
  },
  {
    category: '生物',
    keywords: ['生物', '生态', '细胞', '遗传', '进化', '植物', '动物'],
    icon: PiDnaBold,
    color: 'text-green-500',
  },
  {
    category: '地理',
    keywords: [
      '地理',
      '气候',
      '地形',
      '地貌',
      '区域',
      '板块',
      '经纬',
      '时区',
      '人口',
    ],
    icon: PiGlobeHemisphereWestBold,
    color: 'text-teal-500',
  },
  {
    category: '历史',
    keywords: ['历史', '朝代', '战争', '革命', '古代', '近代', '现代'],
    icon: PiScrollBold,
    color: 'text-orange-600',
  },
  {
    category: '政治',
    keywords: ['政治', '道法', '法治', '公民', '宪法', '法律'],
    icon: PiScalesBold,
    color: 'text-red-500',
  },
  {
    category: '德育',
    keywords: ['德育', '诚信', '品德', '道德', '偶像'],
    icon: PiGavelBold,
    color: 'text-rose-500',
  },
  {
    category: '音乐',
    keywords: ['音乐', '乐器', '节奏', '旋律', '歌唱'],
    icon: PiMusicNoteBold,
    color: 'text-pink-500',
  },
  {
    category: '美术',
    keywords: ['美术', '美育', '绘画', '色彩', '纹样', '鉴赏', '建筑'],
    icon: PiPaletteBold,
    color: 'text-violet-500',
  },
  {
    category: '体育',
    keywords: [
      '体育',
      '篮球',
      '足球',
      '排球',
      '短跑',
      '跑步',
      '运动',
      '裁判',
      '接力',
    ],
    icon: PiSoccerBallBold,
    color: 'text-lime-600',
  },
  {
    category: '信息技术',
    keywords: ['信息', '编程', '计算机', '网络', '算法', '数据'],
    icon: PiDesktopBold,
    color: 'text-sky-500',
  },
  {
    category: '心理',
    keywords: ['心理', '情绪', '压力', '自信'],
    icon: PiHeartBold,
    color: 'text-pink-400',
  },
  {
    category: '科学',
    keywords: ['科学', '实验', '探究', '科技'],
    icon: PiLightbulbBold,
    color: 'text-yellow-500',
  },
];

const defaultIcon = { icon: PiChatsCircleBold, color: 'text-indigo-500' };

/** All available categories with their icon & color. */
export const categories: { name: string; icon: IconType; color: string }[] = [
  ...rules.map((r) => ({ name: r.category, icon: r.icon, color: r.color })),
  { name: '其他', icon: defaultIcon.icon, color: defaultIcon.color },
];

/**
 * Match a profile/agent name to an icon + color by keyword scanning.
 * Returns the first matching rule.
 */
export function matchAgentIcon(name: string): {
  icon: IconType;
  color: string;
} {
  for (const rule of rules) {
    for (const kw of rule.keywords) {
      if (name.includes(kw)) return { icon: rule.icon, color: rule.color };
    }
  }
  return defaultIcon;
}

/**
 * Match a profile/agent name to a category label.
 */
export function matchAgentCategory(name: string): string {
  for (const rule of rules) {
    for (const kw of rule.keywords) {
      if (name.includes(kw)) return rule.category;
    }
  }
  return '其他';
}
