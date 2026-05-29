import hashlib
import json
import pathlib
import re

import openpyxl


BANK_PATH = pathlib.Path("Question Bank/竞赛题库5.22.xlsx")
OUTPUT_PATH = pathlib.Path("data/questions.json")
OPTION_KEYS = list("ABCDEFG")
TYPE_MAP = {
    "单选题": "single",
    "多选题": "multiple",
    "判断题": "judge",
    "填空题": "fill",
    "简答题": "short",
}


def clean(value):
    return str(value or "").replace("\u200c", "").replace("\u200b", "").strip()


def answer_keys(answer, question_type):
    if question_type in ("single", "multiple"):
        return list(re.sub("[^A-Ga-g]", "", answer).upper())
    return []


def main():
    workbook = openpyxl.load_workbook(BANK_PATH, data_only=True, read_only=True)
    worksheet = workbook[workbook.sheetnames[0]]
    questions = []

    for excel_row, row in enumerate(worksheet.iter_rows(min_row=2, values_only=True), start=2):
        prompt = clean(row[0] if len(row) > 0 else "")
        raw_type = clean(row[1] if len(row) > 1 else "")
        if not prompt or not raw_type:
            continue

        question_type = TYPE_MAP.get(raw_type, "unknown")
        options = []
        for offset, key in enumerate(OPTION_KEYS, start=2):
            text = clean(row[offset] if len(row) > offset else "")
            if text:
                options.append({"key": key, "text": text})

        answer = clean(row[9] if len(row) > 9 else "") or clean(row[2] if len(row) > 2 else "")
        question_id = hashlib.sha1(f"{excel_row}:{raw_type}:{prompt}".encode()).hexdigest()[:12]
        questions.append(
            {
                "id": question_id,
                "excelRow": excel_row,
                "prompt": prompt,
                "rawType": raw_type,
                "type": question_type,
                "options": options,
                "answer": answer,
                "answerKeys": answer_keys(answer, question_type),
            }
        )

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(questions, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Imported {len(questions)} questions to {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
