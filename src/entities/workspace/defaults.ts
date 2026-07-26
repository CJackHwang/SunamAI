export interface WorkspaceCreationDefaults {
  sessionTitle: string;
  containerName: string;
}

export const DEFAULT_WORKSPACE_CREATION_DEFAULTS: WorkspaceCreationDefaults = {
  sessionTitle: '新对话',
  containerName: '新容器',
};

const LEGACY_DEFAULT_SESSION_TITLES = new Set([
  '新对话',
  '新建对话',
  'New conversation',
  'New chat',
  '新しい会話',
  '新規会話',
]);

export function isDefaultSessionTitle(title: string): boolean {
  return LEGACY_DEFAULT_SESSION_TITLES.has(title.trim());
}
