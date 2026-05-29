import fs from "node:fs";
import path from "node:path";

const QUESTIONS_PATH = path.join(process.cwd(), "data", "questions.json");

export function loadQuestions() {
  return JSON.parse(fs.readFileSync(QUESTIONS_PATH, "utf8"));
}
