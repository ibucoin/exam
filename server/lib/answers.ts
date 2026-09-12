export function parseStringArray(value: string) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export function isAnswerCorrect(answer: string[], correctAnswers: string[]) {
  const normalize = (items: string[]) => [...new Set(items)].sort();
  const submitted = normalize(answer);
  const expected = normalize(correctAnswers);
  return (
    submitted.length === expected.length &&
    submitted.every((item, index) => item === expected[index])
  );
}
