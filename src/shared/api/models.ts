export async function listModels(apiKey: string, baseUrl: string, signal?: AbortSignal): Promise<string[]> {
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal,
  });
  if (!response.ok) throw new Error(`Model API Error (${response.status})`);
  const data = await response.json() as { data?: Array<{ id?: unknown }> };
  return (data.data ?? []).flatMap((model) => typeof model.id === 'string' ? [model.id] : []);
}
