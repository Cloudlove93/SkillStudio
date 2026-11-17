#!/usr/bin/env python3
"""Generate the auditable lesson manifest and rebuild platform lesson data.

The manifest is the single source of truth for lesson classification. The build
phase never re-classifies lessons; it only reads the manifest and extracts the
ASR text from the source ZIP.

Usage:
  python scripts/generate-lessons.py --analyze   # audit sources, write manifest
  python scripts/generate-lessons.py --build     # manifest -> public lesson data
  python scripts/generate-lessons.py --all       # analyze + build

Environment variables:
  AIRCLASS_ZIP       air classroom ASR zip path
  AIRCLASS_CSV       course-index.csv path
  LESSONS_OUT        output directory (default educlaw-web/public/lessons)
  LESSON_MANIFEST    manifest path (default data/lesson-manifest.json)
  LESSON_COUNTS_TS   generated pack-count module path
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import re
import sys
import zipfile
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_ZIP = r"F:\19118\Documents\xwechat_files\wxid_3asre1bs46pg12_6fd8\msg\file\2026-11\空中课堂_ASR数据包_20261115.zip"
DEFAULT_CSV = (
    r"C:\Users\19118\AppData\Local\Temp\airclass_asr_meta"
    r"\dataprocess__processed__airclassroom-named-lessons-v5-reviewed__course-index.csv"
)
DEFAULT_LESSONS_OUT = ROOT / "educlaw-web" / "public" / "lessons"
DEFAULT_MANIFEST = ROOT / "data" / "lesson-manifest.json"
DEFAULT_COUNTS_TS = ROOT / "educlaw-web" / "src" / "lib" / "lesson-pack-counts.ts"

SUBJECTS = ["语文", "数学", "英语"]
STAGES: dict[str, list[str]] = {
    "小学": ["1年级", "2年级", "3年级", "4年级", "5年级"],
    "初中": ["6年级", "7年级", "8年级", "9年级"],
    "高中": ["高1", "高2", "高3"],
}
STAGE_ORDER = {stage: index for index, stage in enumerate(STAGES)}
GRADE_ORDER = {
    grade: index for grades in STAGES.values() for index, grade in enumerate(grades)
}
PER_PACK = 40
MIN_TEXT_CHARS = 1200
MAX_TITLE_CHARS = 64

MESSY = re.compile(
    r"聚焦|码流|小样|时长\s*\d|分钟整|电视播出|课堂实录|样片|集锦|片花|"
    r"完整版|无生|模拟|试讲|评课|说课|讲座|培训|会议|开幕式|闭幕式|修改|汇编"
)
TEXTBOOKS = re.compile(
    r"(统编版|统编人教|部编版|人教社|人教版|牛津上海版|牛津版|沪教版|沪科技|"
    r"沪科版|上教版|上音版|沪音乐|沪外教|沪少儿|华师大|新世纪|北师大版|"
    r"苏教版|外研版|译林版|科教版|教科版)"
)
GENERIC_TITLES = {"课堂实录", "完整版", "未命名", "无标题", "课例", "教学视频"}

CONFIDENCE_RANK = {"high": 0, "medium": 1, "low": 2}
QUALITY_RANK = {"A": 0, "B": 1}


def env_path(name: str, fallback: str | Path) -> Path:
    value = os.environ.get(name, "").strip()
    return Path(value) if value else Path(fallback)


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def tidy(text: str) -> str:
    text = text.replace("\u0000", "").replace("\r", "")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{2,}", "\n", text)
    return text.strip()


def normalize_grade(raw: str) -> str:
    value = re.sub(r"\s+", "", str(raw or ""))
    aliases = {
        "一年级": "1年级",
        "二年级": "2年级",
        "三年级": "3年级",
        "四年级": "4年级",
        "五年级": "5年级",
        "六年级": "6年级",
        "七年级": "7年级",
        "八年级": "8年级",
        "九年级": "9年级",
        "初一": "7年级",
        "初二": "8年级",
        "初三": "9年级",
        "高一": "高1",
        "高二": "高2",
        "高三": "高3",
    }
    if value in aliases:
        return aliases[value]
    match = re.fullmatch(r"([1-9])年级", value)
    if match:
        return f"{match.group(1)}年级"
    match = re.fullmatch(r"高([1-3])", value)
    if match:
        return f"高{match.group(1)}"
    return value


def stage_from_grade(grade: str) -> str | None:
    for stage, grades in STAGES.items():
        if grade in grades:
            return stage
    return None


def parse_title_cues(original_title: str, title: str) -> dict[str, str | None]:
    text = f"{original_title} {title}"
    stage: str | None = None
    if "小学" in text:
        stage = "小学"
    elif "初中" in text or re.search(r"初[一二三](?:年级)?", text):
        stage = "初中"
    elif "高中" in text or re.search(r"高[一二三1-3](?:年级)?", text):
        stage = "高中"

    grade: str | None = None
    match = re.search(r"高\s*([一二三123])", text)
    if match:
        grade = {"一": "高1", "二": "高2", "三": "高3", "1": "高1", "2": "高2", "3": "高3"}[
            match.group(1)
        ]
    if grade is None:
        match = re.search(r"初\s*([一二三])", text)
        if match:
            grade = {"一": "7年级", "二": "8年级", "三": "9年级"}[match.group(1)]
    if grade is None:
        match = re.search(r"([1-9])\s*年级", text)
        if match:
            grade = f"{match.group(1)}年级"
    if grade is None:
        match = re.search(r"([一二三四五六七八九])\s*年级", text)
        if match:
            grade = normalize_grade(f"{match.group(1)}年级")

    # Titles sometimes omit the stage word but carry an unambiguous grade,
    # e.g. "高二-第二学期". Infer the stage from that grade instead of
    # treating the missing stage as a conflict.
    if stage is None and grade:
        stage = stage_from_grade(grade)

    subject = next((item for item in SUBJECTS if item in text), None)
    return {"stage": stage, "grade": grade, "subject": subject}


def parse_textbook(meta: dict[str, Any], original_title: str) -> str:
    textbook = str((meta or {}).get("textbook") or "").strip()
    if not textbook:
        match = TEXTBOOKS.search(original_title)
        textbook = match.group(1) if match else "教材未知"
    if textbook == "统编人教":
        textbook = "统编版"
    return textbook


def parse_term(meta: dict[str, Any], original_title: str) -> str:
    semester = str((meta or {}).get("semester") or "").strip()
    if semester:
        return semester
    match = re.search(r"-(上|下)-", original_title)
    return match.group(1) if match else ""


CN_DIGITS = {
    "一": 1,
    "二": 2,
    "三": 3,
    "四": 4,
    "五": 5,
    "六": 6,
    "七": 7,
    "八": 8,
    "九": 9,
}


def parse_number(value: str) -> int | None:
    text = str(value or "").strip()
    if not text:
        return None
    if text.isdigit():
        return int(text)
    if text == "十":
        return 10
    if "十" in text:
        tens, _, ones = text.partition("十")
        tens_value = CN_DIGITS.get(tens, 1) if tens else 1
        ones_value = CN_DIGITS.get(ones, 0) if ones else 0
        return tens_value * 10 + ones_value
    return CN_DIGITS.get(text)


def unit_from_text(text: str) -> str:
    match = re.search(r"第\s*([一二三四五六七八九十\d]+)\s*模块", text)
    module = parse_number(match.group(1)) if match else None
    match = re.search(r"第\s*([一二三四五六七八九十\d]+)\s*单元", text)
    unit = parse_number(match.group(1)) if match else None
    if module is not None and unit is not None:
        return f"第{module}模块第{unit}单元"
    if module is not None:
        return f"第{module}模块"
    if unit is not None:
        return f"第{unit}单元"
    match = re.search(r"第\s*(\d+)\s*章", text)
    if match:
        return f"第{match.group(1)}章"
    match = re.search(r"(\d+[A-Z])\s*-\s*U(\d+)", text, re.IGNORECASE)
    if match:
        return f"{match.group(1).upper()}-U{match.group(2)}"
    match = re.search(r"(M\d+)\s*-\s*U(\d+)", text, re.IGNORECASE)
    if match:
        return f"{match.group(1).upper()}-U{match.group(2)}"
    match = re.search(r"Unit\s*(\d+)", text, re.IGNORECASE)
    if match:
        return f"Unit {match.group(1)}"
    match = re.search(r"模块\s*(\d+)", text)
    if match:
        return f"第{match.group(1)}模块"
    match = re.search(r"单元\s*(\d+)", text)
    if match:
        return f"第{match.group(1)}单元"
    match = re.search(r"必修\s*([一二三四1-4])", text)
    if match:
        number = parse_number(match.group(1))
        if number is not None:
            return f"必修{number}"
    return ""


def parse_unit(meta: dict[str, Any], original_title: str) -> str:
    curriculum = (meta or {}).get("curriculum") or []
    for item in curriculum:
        unit = unit_from_text(str(item))
        if unit:
            return unit
    return unit_from_text(original_title)


def detect_lesson_type(subject: str, title: str) -> str:
    if subject == "语文":
        if re.search(r"习作|作文", title):
            return "习作"
        if re.search(r"口语交际", title):
            return "口语交际"
        if re.search(r"语文园地", title):
            return "语文园地"
        if re.search(r"复习|练习|单元", title):
            return "复习"
        if re.search(r"古诗|文言|诗二首|绝句|词二首", title):
            return "古诗文"
        return "阅读"
    if subject == "数学":
        if re.search(r"复习|整理", title):
            return "复习"
        if re.search(r"练习", title):
            return "练习"
        if re.search(r"单元|专题", title):
            return "单元"
        return "新授"
    if re.search(r"复习|练习", title):
        return "复习"
    if re.search(r"听说|口语|对话", title):
        return "听说"
    if re.search(r"阅读|读写", title):
        return "阅读"
    if re.search(r"写作|作文|书面", title):
        return "写作"
    return "新授"


def detect_prefix(zf: zipfile.ZipFile) -> str:
    marker = "/airclassroom-named-lessons-v5-reviewed/README.md"
    for name in zf.namelist():
        if name.endswith(marker):
            return name[: -len("README.md")]
    raise RuntimeError("无法在 ZIP 中定位 airclassroom-named-lessons-v5-reviewed 目录")


def classify(
    row: dict[str, str],
    detail: dict[str, Any],
    title: str,
    original_title: str,
) -> dict[str, Any]:
    csv_stage = str(row.get("stage") or "").strip()
    csv_grade = normalize_grade(row.get("grade") or "")
    csv_subject = str(row.get("subject") or "").strip()
    cues = parse_title_cues(original_title, title)

    reasons: list[str] = []
    confidence = "high"
    issues: list[str] = []

    if csv_stage not in STAGES:
        issues.append(f"CSV 学段无效（{csv_stage or '空'}）")
    if csv_subject not in SUBJECTS:
        issues.append(f"CSV 学科无效（{csv_subject or '空'}）")
    if csv_stage in STAGES and csv_grade not in STAGES[csv_stage]:
        issues.append(f"CSV 年级与学段不匹配（{csv_stage}/{csv_grade or '空'}）")

    conflicts: list[str] = []
    if cues["stage"] and csv_stage and cues["stage"] != csv_stage:
        conflicts.append(f"学段（CSV {csv_stage} / 标题 {cues['stage']}）")
    if cues["grade"] and csv_grade and cues["grade"] != csv_grade:
        conflicts.append(f"年级（CSV {csv_grade} / 标题 {cues['grade']}）")
    if cues["subject"] and csv_subject and cues["subject"] != csv_subject:
        conflicts.append(f"学科（CSV {csv_subject} / 标题 {cues['subject']}）")

    if issues or conflicts:
        confidence = "low"
        if issues:
            reasons.append("；".join(issues))
        if conflicts:
            reasons.append("标题线索冲突：" + "、".join(conflicts) + "；以 CSV 字段为准")
    elif cues["stage"] and cues["grade"] and cues["subject"]:
        reasons.append(
            f"CSV 学段/年级/学科完整且与标题线索一致（{csv_stage}/{csv_grade}/{csv_subject}）"
        )
    else:
        confidence = "medium"
        provided = "、".join(
            name
            for name, value in (
                ("学段", cues["stage"]),
                ("年级", cues["grade"]),
                ("学科", cues["subject"]),
            )
            if value
        )
        reasons.append(
            f"CSV 学段/年级/学科完整（{csv_stage}/{csv_grade}/{csv_subject}），"
            f"标题仅提供部分核对线索（{provided or '无'}）"
        )

    meta = (detail.get("retained_version") or {}).get("metadata_context") or {}
    textbook = parse_textbook(meta, original_title)
    term = parse_term(meta, original_title)
    unit = parse_unit(meta, original_title)

    review_focus: list[str] = []
    if csv_stage == "初中" and csv_grade == "6年级":
        review_focus.append("初中6年级（五四学制）")
    if csv_stage == "高中" and csv_subject == "语文" and csv_grade in {"高2", "高3"}:
        review_focus.append("高中语文高2/高3 可用量不足")
    if csv_subject == "英语" and len(title) > 48:
        review_focus.append("英语长标题")

    return {
        "stage": csv_stage,
        "grade": csv_grade,
        "subject": csv_subject,
        "textbook": textbook,
        "term": term,
        "unit": unit,
        "lessonType": detect_lesson_type(csv_subject, title),
        "confidence": confidence,
        "classificationReason": "；".join(reasons),
        "reviewFocus": review_focus,
        "issues": issues + conflicts,
    }


def title_anomaly(title: str, original_title: str) -> str:
    if not title:
        return "标题为空"
    if len(title) > MAX_TITLE_CHARS:
        return f"标题过长（{len(title)} 字）"
    if MESSY.search(title) or MESSY.search(original_title):
        return "标题含非课例线索关键词"
    if title in GENERIC_TITLES:
        return "标题为通用占位词"
    if not re.search(r"[\u4e00-\u9fffA-Za-z0-9]", title):
        return "标题无可读内容"
    return ""


def read_zip_detail(zf: zipfile.ZipFile, prefix: str, row: dict[str, str]) -> dict[str, Any] | None:
    path = prefix + row["file"]
    try:
        return json.loads(zf.read(path))
    except (KeyError, json.JSONDecodeError, OSError):
        return None


def analyze(args: argparse.Namespace) -> dict[str, Any]:
    zip_path = env_path("AIRCLASS_ZIP", DEFAULT_ZIP)
    csv_path = env_path("AIRCLASS_CSV", DEFAULT_CSV)
    manifest_path = env_path("LESSON_MANIFEST", DEFAULT_MANIFEST)
    if not zip_path.exists():
        raise SystemExit(f"ZIP 不存在：{zip_path}\n可通过 AIRCLASS_ZIP 指定路径")
    if not csv_path.exists():
        raise SystemExit(f"CSV 不存在：{csv_path}\n可通过 AIRCLASS_CSV 指定路径")

    with csv_path.open(encoding="utf-8-sig", newline="") as handle:
        rows = list(csv.DictReader(handle))
    if not rows:
        raise SystemExit("CSV 为空")

    outside_scope = Counter()
    candidates: list[dict[str, Any]] = []
    with zipfile.ZipFile(zip_path) as zf:
        prefix = detect_prefix(zf)
        for row in rows:
            if row.get("class_type") != "complete_lesson_candidate":
                outside_scope[f"class_type={row.get('class_type') or '空'}"] += 1
                continue
            stage = str(row.get("stage") or "").strip()
            subject = str(row.get("subject") or "").strip()
            if stage not in STAGES:
                outside_scope[f"stage={stage or '空'}"] += 1
                continue
            if subject not in SUBJECTS:
                outside_scope[f"subject={subject or '空'}"] += 1
                continue

            detail = read_zip_detail(zf, prefix, row)
            if detail is None:
                record: dict[str, Any] = {
                    "id": row["course_id"],
                    "stage": stage,
                    "grade": normalize_grade(row.get("grade") or ""),
                    "subject": subject,
                    "textbook": "",
                    "term": "",
                    "unit": "",
                    "lessonType": "",
                    "title": (row.get("canonical_course_name") or "").strip(),
                    "charCount": 0,
                    "quality": "B",
                    "confidence": "low",
                    "classificationReason": "ZIP 中缺少对应课例文件或 JSON 无法解析",
                    "needsReview": True,
                    "sourceFile": row.get("file") or "",
                    "sourceTitle": row.get("original_title") or "",
                    "sourceCount": int(row.get("source_count") or 1),
                    "multiVersion": False,
                    "duplicateGroup": "",
                    "titleAnomaly": "课例文件缺失",
                    "reviewFocus": [],
                    "selected": False,
                    "selectionReason": "",
                    "excluded": True,
                    "excludeReason": "ZIP 中缺少对应课例文件或 JSON 无法解析",
                }
                candidates.append(record)
                continue

            retained = detail.get("retained_version") or {}
            title = str(
                detail.get("canonical_course_name")
                or row.get("canonical_course_name")
                or retained.get("title_display")
                or ""
            ).strip()
            original_title = str(retained.get("original_title") or row.get("original_title") or "").strip()
            text = tidy(detail.get("text_clean") or "")
            char_count = len(text)
            classification = classify(row, detail, title, original_title)
            tier = "A" if 2200 <= char_count <= 7000 else "B"
            anomaly = title_anomaly(title, original_title)
            source_count = int(row.get("source_count") or detail.get("source_count") or 1)
            multi_version = source_count > 1 or bool(detail.get("superseded_source_ids"))

            exclude_reason = ""
            if not title:
                exclude_reason = "标题为空"
            elif anomaly and ("过长" in anomaly or "非课例" in anomaly):
                exclude_reason = anomaly
            elif char_count < MIN_TEXT_CHARS:
                exclude_reason = f"清洗后文本过短（{char_count} 字）"

            record = {
                "id": row["course_id"],
                "stage": classification["stage"],
                "grade": classification["grade"],
                "subject": classification["subject"],
                "textbook": classification["textbook"],
                "term": classification["term"],
                "unit": classification["unit"],
                "lessonType": classification["lessonType"],
                "title": title,
                "charCount": char_count,
                "quality": tier,
                "confidence": classification["confidence"],
                "classificationReason": classification["classificationReason"],
                "needsReview": False,
                "sourceFile": row.get("file") or "",
                "sourceTitle": original_title,
                "sourceCount": source_count,
                "multiVersion": multi_version,
                "duplicateGroup": "",
                "titleAnomaly": anomaly,
                "reviewFocus": classification["reviewFocus"],
                "selected": False,
                "selectionReason": "",
                "excluded": bool(exclude_reason),
                "excludeReason": exclude_reason,
            }
            if multi_version:
                record["reviewFocus"].append("同课多版本")
            candidates.append(record)

    # Mark duplicate titles inside the same pack.
    grouped: dict[tuple[str, str, str], list[dict[str, Any]]] = defaultdict(list)
    for record in candidates:
        grouped[(record["stage"], record["subject"], record["grade"])].append(record)
    for records in grouped.values():
        by_title: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for record in records:
            if record["title"]:
                by_title[record["title"]].append(record)
        for title, matches in by_title.items():
            if len(matches) < 2:
                continue
            for record in matches:
                record["duplicateGroup"] = title
                if "同包重名" not in record["reviewFocus"]:
                    record["reviewFocus"].append("同包重名")

    for record in candidates:
        record["needsReview"] = bool(
            record["confidence"] == "low"
            or record["titleAnomaly"]
            or record["duplicateGroup"]
            or record["multiVersion"]
        )

    # Select up to PER_PACK lessons per pack, preferring high confidence and
    # complete text, then a stable hash so reruns stay deterministic.
    by_pack: list[dict[str, Any]] = []
    for stage, grades in STAGES.items():
        for subject in SUBJECTS:
            for grade in grades:
                records = grouped.get((stage, subject, grade), [])
                eligible = [record for record in records if not record["excluded"]]
                eligible.sort(
                    key=lambda record: (
                        CONFIDENCE_RANK[record["confidence"]],
                        QUALITY_RANK[record["quality"]],
                        hashlib.sha1(record["id"].encode()).hexdigest(),
                    )
                )
                selected = eligible[: args.per_pack]
                selected_ids = {record["id"] for record in selected}
                for record in records:
                    if record["id"] in selected_ids:
                        record["selected"] = True
                        record["selectionReason"] = (
                            f"入选：置信度 {record['confidence']}，文本质量 {record['quality']}"
                        )
                    elif record["excluded"]:
                        record["selectionReason"] = f"未入选：{record['excludeReason']}"
                    else:
                        record["selectionReason"] = (
                            f"未入选：候选池按置信度与文本质量排序后超出 {args.per_pack} 节"
                        )

                pack_records = [
                    record for record in records if record["selected"]
                ]
                pack_summary = {
                    "packId": f"lesson-pack-{subject}-{grade}",
                    "stage": stage,
                    "subject": subject,
                    "grade": grade,
                    "candidateCount": len(records),
                    "eligibleCount": len(eligible),
                    "selectedCount": len(selected),
                    "selectedCharCount": sum(record["charCount"] for record in pack_records),
                    "lowConfidence": sum(1 for record in records if record["confidence"] == "low"),
                    "missingTextbook": sum(
                        1 for record in records if record["textbook"] in {"", "教材未知"}
                    ),
                    "missingUnit": sum(1 for record in records if not record["unit"]),
                    "titleAnomalies": sum(1 for record in records if record["titleAnomaly"]),
                    "duplicates": sum(1 for record in records if record["duplicateGroup"]),
                    "multiVersion": sum(1 for record in records if record["multiVersion"]),
                    "needsReview": sum(1 for record in records if record["needsReview"]),
                    "selectedLowConfidence": sum(
                        1 for record in pack_records if record["confidence"] == "low"
                    ),
                    "selectedMissingUnit": sum(1 for record in pack_records if not record["unit"]),
                    "selectedNeedsReview": sum(
                        1 for record in pack_records if record["needsReview"]
                    ),
                }
                by_pack.append(pack_summary)

    lessons_sorted = sorted(
        candidates,
        key=lambda record: (
            STAGE_ORDER.get(record["stage"], 99),
            SUBJECTS.index(record["subject"]) if record["subject"] in SUBJECTS else 99,
            GRADE_ORDER.get(record["grade"], 99),
            record["title"],
            record["id"],
        ),
    )

    summary = {
        "candidateCount": len(candidates),
        "eligibleCount": sum(1 for record in candidates if not record["excluded"]),
        "selectedCount": sum(1 for record in candidates if record["selected"]),
        "needsReviewCount": sum(1 for record in candidates if record["needsReview"]),
        "lowConfidenceCount": sum(1 for record in candidates if record["confidence"] == "low"),
        "missingTextbookCount": sum(
            1 for record in candidates if record["textbook"] in {"", "教材未知"}
        ),
        "missingUnitCount": sum(1 for record in candidates if not record["unit"]),
        "titleAnomalyCount": sum(1 for record in candidates if record["titleAnomaly"]),
        "duplicateTitleCount": sum(1 for record in candidates if record["duplicateGroup"]),
        "multiVersionCount": sum(1 for record in candidates if record["multiVersion"]),
        "excludedCount": sum(1 for record in candidates if record["excluded"]),
        "selectedLowConfidenceCount": sum(
            1 for record in candidates if record["selected"] and record["confidence"] == "low"
        ),
        "selectedMissingUnitCount": sum(
            1 for record in candidates if record["selected"] and not record["unit"]
        ),
        "selectedNeedsReviewCount": sum(
            1 for record in candidates if record["selected"] and record["needsReview"]
        ),
        "outsideScope": dict(outside_scope.most_common()),
        "byPack": by_pack,
    }

    manifest = {
        "schemaVersion": 1,
        "generatedAt": now_iso(),
        "source": {
            "zip": zip_path.name,
            "csv": csv_path.name,
            "generator": "scripts/generate-lessons.py",
            "perPack": args.per_pack,
            "minTextChars": MIN_TEXT_CHARS,
            "maxTitleChars": MAX_TITLE_CHARS,
        },
        "summary": summary,
        "lessons": lessons_sorted,
    }

    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    print(f"manifest written: {manifest_path}")
    print(
        "candidates {candidateCount} / eligible {eligibleCount} / selected {selectedCount}".format(
            **summary
        )
    )
    print(
        "needsReview {needsReviewCount} / lowConfidence {lowConfidenceCount} / "
        "missingTextbook {missingTextbookCount} / missingUnit {missingUnitCount}".format(
            **summary
        )
    )
    print(
        "titleAnomaly {titleAnomalyCount} / duplicateTitle {duplicateTitleCount} / "
        "multiVersion {multiVersionCount} / excluded {excludedCount}".format(**summary)
    )
    print(
        "selected: lowConfidence {selectedLowConfidenceCount} / "
        "missingUnit {selectedMissingUnitCount} / needsReview {selectedNeedsReviewCount}".format(
            **summary
        )
    )
    print("outside scope (疑似非完整课等):", json.dumps(summary["outsideScope"], ensure_ascii=False))
    print("\npack overview:")
    for pack in by_pack:
        print(
            f"  {pack['stage']}{pack['subject']}{pack['grade']}: "
            f"candidates {pack['candidateCount']}, eligible {pack['eligibleCount']}, "
            f"selected {pack['selectedCount']}, low {pack['lowConfidence']}, "
            f"missingUnit {pack['missingUnit']}, needsReview {pack['needsReview']}"
        )
    return manifest


def build(args: argparse.Namespace) -> None:
    zip_path = env_path("AIRCLASS_ZIP", DEFAULT_ZIP)
    manifest_path = env_path("LESSON_MANIFEST", DEFAULT_MANIFEST)
    lessons_out = env_path("LESSONS_OUT", DEFAULT_LESSONS_OUT)
    counts_ts = env_path("LESSON_COUNTS_TS", DEFAULT_COUNTS_TS)
    if not zip_path.exists():
        raise SystemExit(f"ZIP 不存在：{zip_path}\n可通过 AIRCLASS_ZIP 指定路径")
    if not manifest_path.exists():
        raise SystemExit(f"manifest 不存在：{manifest_path}\n请先运行 --analyze")

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    lessons = manifest.get("lessons") or []
    selected = [lesson for lesson in lessons if lesson.get("selected")]
    if not selected:
        raise SystemExit("manifest 中没有入选课例，请检查 --analyze 输出")

    lessons_out.mkdir(parents=True, exist_ok=True)
    index: list[dict[str, Any]] = []
    keep_files = {f"{lesson['id']}.json" for lesson in selected}

    with zipfile.ZipFile(zip_path) as zf:
        prefix = detect_prefix(zf)
        mismatches: list[str] = []
        for lesson in selected:
            path = prefix + lesson["sourceFile"]
            try:
                detail = json.loads(zf.read(path))
            except (KeyError, json.JSONDecodeError, OSError) as error:
                raise SystemExit(f"读取课例失败：{lesson['id']} {path} ({error})") from error
            text = tidy(detail.get("text_clean") or "")
            if len(text) != lesson["charCount"]:
                mismatches.append(
                    f"{lesson['id']}: manifest {lesson['charCount']} / 源文件 {len(text)}"
                )
                continue
            tier = lesson["quality"]
            ready = tier == "A"
            description_bits = [
                lesson["stage"],
                lesson["subject"],
                lesson["grade"],
                lesson["textbook"],
            ]
            if lesson["term"]:
                description_bits.append(f"{lesson['term']}册")
            if lesson["unit"]:
                description_bits.append(lesson["unit"])
            description_bits.append(lesson["lessonType"])
            payload = {
                "id": lesson["id"],
                "title": lesson["title"],
                "name": lesson["title"],
                "description": " · ".join(description_bits),
                "subject": lesson["subject"],
                "stage": lesson["stage"],
                "grade": lesson["grade"],
                "textbook": lesson["textbook"],
                "term": lesson["term"],
                "unit": lesson["unit"],
                "lessonType": lesson["lessonType"],
                "charCount": lesson["charCount"],
                "quality": tier,
                "qualityLabel": (
                    "ASR 转写 · 未人工校对"
                    if tier == "B"
                    else "ASR 转写 · 文本较完整"
                ),
                "analysisReady": ready,
                "sourceTitle": lesson["sourceTitle"],
                "notice": (
                    "课堂 ASR 转写，未人工校对；同音字、断句可能与原课有偏差，"
                    "分析时请回看原文。"
                ),
                "text": text[:12000],
                "updatedAt": manifest["generatedAt"],
                "ready": ready,
                "file": f"{lesson['id']}.json",
            }
            (lessons_out / payload["file"]).write_text(
                json.dumps(payload, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            index.append(
                {
                    key: payload[key]
                    for key in (
                        "id",
                        "name",
                        "description",
                        "updatedAt",
                        "ready",
                        "subject",
                        "stage",
                        "grade",
                        "textbook",
                        "unit",
                        "lessonType",
                        "charCount",
                        "quality",
                        "file",
                    )
                }
            )

    if mismatches:
        raise SystemExit(
            "manifest 与源数据文本长度不一致，请重新生成 manifest：\n"
            + "\n".join(mismatches[:20])
        )

    index.sort(
        key=lambda item: (
            STAGE_ORDER.get(item["stage"], 99),
            SUBJECTS.index(item["subject"]) if item["subject"] in SUBJECTS else 99,
            GRADE_ORDER.get(item["grade"], 99),
            item["name"],
        )
    )

    for path in lessons_out.glob("*.json"):
        if path.name == "index.json" or path.name in keep_files:
            continue
        path.unlink()

    (lessons_out / "index.json").write_text(
        json.dumps(index, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    counts = {
        pack["packId"]: pack["selectedCount"]
        for pack in (manifest.get("summary") or {}).get("byPack", [])
    }
    counts_ts.parent.mkdir(parents=True, exist_ok=True)
    lines = [
        "// 此文件由 scripts/generate-lessons.py 根据 data/lesson-manifest.json 生成，请勿手动修改。",
        f"export const LESSON_TOTAL_COUNT = {len(index)};",
        "",
        "export const LESSON_PACK_COUNTS: Record<string, number> = {",
    ]
    for pack in (manifest.get("summary") or {}).get("byPack", []):
        lines.append(f"  '{pack['packId']}': {pack['selectedCount']},")
    lines.append("};")
    lines.append("")
    counts_ts.write_text("\n".join(lines), encoding="utf-8")

    print(f"lesson files written: {lessons_out}")
    print(f"index.json items: {len(index)}")
    print(f"pack counts written: {counts_ts}")
    for pack_id, count in counts.items():
        print(f"  {pack_id}: {count}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--analyze", action="store_true", help="只生成并审计 manifest")
    parser.add_argument("--build", action="store_true", help="按 manifest 重建课例数据")
    parser.add_argument("--all", action="store_true", help="先分析再重建")
    parser.add_argument(
        "--per-pack",
        type=int,
        default=PER_PACK,
        help=f"每个课例包最多选取多少节课（默认 {PER_PACK}）",
    )
    args = parser.parse_args()
    if not (args.analyze or args.build or args.all):
        args.analyze = True
    if args.all:
        analyze(args)
        build(args)
    elif args.build:
        build(args)
    else:
        analyze(args)


if __name__ == "__main__":
    sys.exit(main())
