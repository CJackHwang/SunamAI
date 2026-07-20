import type { Container, Session } from '@/entities/workspace/types';

export type SidebarResourceKind = 'session' | 'container';
export type SidebarResource = Session | Container;
export type SidebarContextMenuState = { type: SidebarResourceKind; id: string; x: number; y: number };
export type SidebarEditingState = { type: SidebarResourceKind; id: string; text: string };

export function findSidebarResource(type: SidebarResourceKind, id: string, sessions: Session[], containers: Container[]): SidebarResource | undefined {
  return type === 'session' ? sessions.find((session) => session.id === id) : containers.find((container) => container.id === id);
}

export function sidebarResourceLabel(resource: SidebarResource): string {
  return 'title' in resource ? resource.title : resource.name;
}
