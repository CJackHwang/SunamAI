import { useRef, useState, useEffect } from 'react';
import { generateAutoTitle } from '@/entities/workspace/titleService';
import type { TranslationKey } from '@/shared/i18n';
import { resolveChatSettings } from '@/shared/config/settingsStore';
import type { SidebarContextMenuState, SidebarEditingState, SidebarResourceKind } from './sidebarResources';
import { sidebarResourceLabel, findSidebarResource } from './sidebarResources';
import type { Container, Session } from '@/entities/workspace/store';

export function useSidebarActions(
  sessions: Session[],
  containers: Container[],
  renameSession: (id: string, title: string) => void,
  renameContainer: (id: string, title: string) => void,
  deleteSession: (id: string) => Promise<void>,
  deleteContainer: (id: string) => Promise<void>,
  togglePinSession: (id: string) => void,
  togglePinContainer: (id: string) => void,
  t: (key: TranslationKey) => string
) {
  const [contextMenu, setContextMenu] = useState<SidebarContextMenuState | null>(null);
  const [editing, setEditing] = useState<SidebarEditingState | null>(null);
  const [generatingTitleId, setGeneratingTitleId] = useState<string | null>(null);
  
  const editInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && editInputRef.current) {
      editInputRef.current.focus();
    }
  }, [editing]);

  const contextResource = contextMenu ? findSidebarResource(contextMenu.type, contextMenu.id, sessions, containers) : undefined;

  const handleContextMenu = (e: React.MouseEvent, type: SidebarResourceKind, id: string) => {
    e.preventDefault();
    setContextMenu({ type, id, x: e.clientX, y: e.clientY });
  };

  const closeContextMenu = () => setContextMenu(null);

  const handleRenameSubmit = () => {
    if (!editing || !editing.text.trim()) {
      setEditing(null);
      return;
    }
    if (editing.type === 'session') {
      renameSession(editing.id, editing.text.trim());
    } else {
      renameContainer(editing.id, editing.text.trim());
    }
    setEditing(null);
  };

  const handleGenerateTitle = async (type: SidebarResourceKind, id: string) => {
    closeContextMenu();
    const resolved = resolveChatSettings();
    const apiKey = resolved?.providerApiKey ?? '';

    if (!apiKey) {
      alert(t('sidebar.apiKeyRequired'));
      return;
    }
    const baseUrl = resolved?.providerBaseUrl ?? '';
    const apiModel = resolved?.apiModel ?? '';
    setGeneratingTitleId(id);

    try {
      let input: string;
      if (type === 'session') {
        const [{ AgentEventStore }, { projectMessages }] = await Promise.all([
          import('@/features/agent-core/eventStore'),
          import('@/features/agent-core/projector'),
        ]);
        const events = await new AgentEventStore().loadSessionEvents(id);
        input = projectMessages(events).find((message) => message.role === 'user')?.content || '无有效对话记录，请随意发挥。';
      } else {
        input = '这是一个容器的自动重命名，请随意起名。';
      }
      const title = await generateAutoTitle(input, { apiKey, baseUrl, model: apiModel });
      if (title) {
        if (type === 'session') renameSession(id, title);
        else renameContainer(id, title);
      }
    } catch {
      alert(t('sidebar.renameFailed'));
    } finally {
      setGeneratingTitleId(null);
    }
  };

  const onRename = () => {
    if (contextMenu && contextResource) {
      setEditing({ type: contextMenu.type, id: contextMenu.id, text: sidebarResourceLabel(contextResource) });
    }
    closeContextMenu();
  };

  const onGenerateTitle = () => {
    if (contextMenu) void handleGenerateTitle(contextMenu.type, contextMenu.id);
  };

  const onTogglePin = () => {
    if (!contextMenu) return;
    if (contextMenu.type === 'session') togglePinSession(contextMenu.id);
    else togglePinContainer(contextMenu.id);
    closeContextMenu();
  };

  const onDelete = async () => {
    if (!contextMenu) return;
    const session = contextMenu.type === 'session';
    if (!session && !window.confirm(t('sidebar.confirmDeleteContainer'))) {
      closeContextMenu();
      return;
    }
    if (session) await deleteSession(contextMenu.id);
    else await deleteContainer(contextMenu.id);
    closeContextMenu();
  };

  return {
    contextMenu,
    contextResource,
    editing,
    setEditing,
    generatingTitleId,
    editInputRef,
    handleContextMenu,
    closeContextMenu,
    handleRenameSubmit,
    onRename,
    onGenerateTitle,
    onTogglePin,
    onDelete,
  };
}
