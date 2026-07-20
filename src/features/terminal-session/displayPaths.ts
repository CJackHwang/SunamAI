// Consume the complete implementation prefix, including WebContainer prompts
// such as `~/sunam/.sunam/...`; replacing only the final `.sunam` segment
// would leave `~/sunam//containers/...` in user-visible output.
const INTERNAL_WORKSPACE_PATH = /(?:(?:~|\/home\/[^/\s]+)(?:\/[^/\s]+)*\/)?\.sunam\/workspaces\/c-[a-z0-9_-]+/gi;

export function safeContainerLabel(containerName: string): string {
  return Array.from(containerName, (character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127 || character === '/' || character === '\\' ? '-' : character;
  }).join('').trim() || 'unnamed';
}

export function toDisplayWorkspacePath(value: string, containerName: string): string {
  return value.replace(INTERNAL_WORKSPACE_PATH, `/containers/${safeContainerLabel(containerName)}`);
}
