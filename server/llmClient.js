import dotenv from "dotenv";

dotenv.config();

const DEFAULT_MODEL = "gpt-4o-mini";

export function getLlmConfig() {
  const baseUrl = (process.env.LLM_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  const model = process.env.LLM_MODEL || DEFAULT_MODEL;
  return {
    baseUrl,
    model,
    configured: Boolean(process.env.LLM_API_KEY),
  };
}

export async function chatCompletion(messages, options = {}) {
  const apiKey = process.env.LLM_API_KEY;
  if (!apiKey) {
    const error = new Error("LLM_API_KEY is not configured");
    error.status = 503;
    throw error;
  }

  const { baseUrl, model } = getLlmConfig();
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: options.temperature ?? 0.2,
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload?.error?.message || `LLM request failed with ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }

  const content = payload?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("LLM response did not include message content");
  }
  return content.trim();
}

export function questionContext(question) {
  const options = question.options.length
    ? `\n选项：\n${question.options.map((option) => `${option.key}. ${option.text}`).join("\n")}`
    : "";
  return `题型：${question.rawType}\n题干：${question.prompt}${options}\n标准答案：${question.answer}`;
}

export async function generateExplanation(question) {
  return chatCompletion(
    [
      {
        role: "system",
        content:
          "你是一个严谨的中文刷题辅导老师。请基于题干、选项和标准答案生成解析，避免编造出处；如果题目本身信息不足，只解释解题思路。",
      },
      {
        role: "user",
        content: `${questionContext(question)}\n\n请输出：1. 正确答案；2. 关键依据；3. 易错点。`,
      },
    ],
    { temperature: 0.1 },
  );
}

export async function answerQuestion(question, userQuestion, previousMessages = []) {
  const history = previousMessages
    .filter((message) => ["user", "assistant"].includes(message.role) && message.content)
    .slice(-8);
  return chatCompletion(
    [
      {
        role: "system",
        content:
          "你是一个中文题目答疑助手。回答必须围绕当前题目，不确定时说明不确定，不要把无关内容当成事实。",
      },
      {
        role: "user",
        content: `${questionContext(question)}\n\n这是当前题目的固定背景。后续请只回答与该题相关的问题。`,
      },
      ...history,
      { role: "user", content: userQuestion },
    ],
    { temperature: 0.3 },
  );
}

export async function gradeShortAnswer(question, userAnswer) {
  const content = await chatCompletion(
    [
      {
        role: "system",
        content:
          "你是简答题阅卷助手。只返回 JSON，不要使用 Markdown。字段为 score(0-100整数)、passed(boolean)、feedback(string)、missing_points(string[])。",
      },
      {
        role: "user",
        content: `${questionContext(question)}\n\n考生答案：${userAnswer}\n\n请按标准答案快速打分。`,
      },
    ],
    { temperature: 0 },
  );

  try {
    return JSON.parse(stripJsonFence(content));
  } catch {
    return {
      score: 0,
      passed: false,
      feedback: content,
      missing_points: [],
    };
  }
}

function stripJsonFence(text) {
  return text.replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
}
