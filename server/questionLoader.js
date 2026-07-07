import fs from "node:fs";
import path from "node:path";

const BANKS_PATH = path.join(process.cwd(), "data", "question-banks.json");
const LEGACY_QUESTIONS_PATH = path.join(process.cwd(), "data", "questions.json");

export function loadQuestionBanks() {
  if (fs.existsSync(BANKS_PATH)) {
    const payload = JSON.parse(fs.readFileSync(BANKS_PATH, "utf8"));
    const banks = payload.banks.map((bank) => ({
      ...bank,
      questions: bank.questions.map((question) => ({
        ...question,
        bankId: question.bankId || bank.id,
      })),
    }));
    return {
      defaultBankId: payload.defaultBankId || banks[0]?.id || "",
      banks,
      questions: banks.flatMap((bank) => bank.questions),
    };
  }

  const questions = JSON.parse(fs.readFileSync(LEGACY_QUESTIONS_PATH, "utf8")).map((question) => ({
    ...question,
    bankId: question.bankId || "default",
  }));
  return {
    defaultBankId: "default",
    banks: [
      {
        id: "default",
        name: "默认题库",
        label: "当前题库",
        source: LEGACY_QUESTIONS_PATH,
        isLegacy: false,
        questions,
      },
    ],
    questions,
  };
}

export function publicBankMeta(bank) {
  return {
    id: bank.id,
    name: bank.name,
    label: bank.label,
    source: bank.source,
    isLegacy: Boolean(bank.isLegacy),
    questionCount: bank.questions.length,
  };
}
