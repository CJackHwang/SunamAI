function characterWeight(character: string): number {
  return /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(character)
    || (character.codePointAt(0) ?? 0) > 0xffff ? 1 : 0.25;
}

export function estimateTextTokens(value: string): number {
  let weighted = 0;
  for (const character of value) weighted += characterWeight(character);
  return Math.max(1, Math.ceil(weighted));
}

export function clipTextToTokenBudget(value: string, maxTokens: number, marker: string): string {
  if (estimateTextTokens(value) <= maxTokens) return value;
  const contentBudget = Math.max(0, maxTokens - estimateTextTokens(marker));
  let weighted = 0;
  let content = '';
  for (const character of value) {
    const next = weighted + characterWeight(character);
    if (Math.ceil(next) > contentBudget) break;
    content += character;
    weighted = next;
  }
  return `${content}${marker}`;
}
