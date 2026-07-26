import { useEffect, useRef, useState, type TouchEvent } from 'react';
import type { FileEntry } from '@/entities/file/types';

interface TouchGesture {
  entry: FileEntry;
  startX: number;
  startY: number;
  x: number;
  y: number;
  armed: boolean;
  cancelled: boolean;
  dragging: boolean;
  target: string | null;
}

export function useFileManagerTouch(fs: {
  currentPath: string;
  parentPath: string | null;
  moveFile: (source: string, destination: string) => Promise<void>;
}, onContextMenu: (entry: FileEntry, x: number, y: number) => void, setDragOverFolder: (folder: string | null) => void) {
  const [touchDrag, setTouchDrag] = useState<{ entry: FileEntry; x: number; y: number } | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchGestureRef = useRef<TouchGesture | null>(null);
  const touchMoveBlockerRef = useRef<((event: globalThis.TouchEvent) => void) | null>(null);
  const isLongPressing = useRef(false);

  useEffect(() => {
    return () => {
      if (longPressTimer.current) clearTimeout(longPressTimer.current);
      if (touchMoveBlockerRef.current) document.removeEventListener('touchmove', touchMoveBlockerRef.current);
    };
  }, []);

  const clearLongPressTimer = () => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    longPressTimer.current = null;
  };

  const clearTouchMoveBlocker = () => {
    if (touchMoveBlockerRef.current) document.removeEventListener('touchmove', touchMoveBlockerRef.current);
    touchMoveBlockerRef.current = null;
  };

  const findTouchDropTarget = (x: number, y: number) => 
    document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-fm-drop-target]')?.dataset.fmDropTarget ?? null;

  const handleTouchStart = (event: TouchEvent, entry: FileEntry) => {
    if (event.touches.length !== 1) return;
    clearLongPressTimer();
    const touch = event.touches[0];
    if (!touch) return;
    const gesture: TouchGesture = { entry, startX: touch.clientX, startY: touch.clientY, x: touch.clientX, y: touch.clientY, armed: false, cancelled: false, dragging: false, target: null };
    touchGestureRef.current = gesture;
    isLongPressing.current = false;
    longPressTimer.current = setTimeout(() => {
      if (touchGestureRef.current !== gesture || gesture.cancelled) return;
      gesture.armed = true;
      isLongPressing.current = true;
      const blockTouchScroll = (moveEvent: globalThis.TouchEvent) => { if (touchGestureRef.current?.armed) moveEvent.preventDefault(); };
      touchMoveBlockerRef.current = blockTouchScroll;
      document.addEventListener('touchmove', blockTouchScroll, { passive: false });
      navigator.vibrate?.(10);
    }, 400);
  };

  const handleTouchMove = (event: TouchEvent) => {
    const gesture = touchGestureRef.current;
    const touch = event.touches[0];
    if (!gesture || !touch) return;
    gesture.x = touch.clientX;
    gesture.y = touch.clientY;
    const distance = Math.hypot(gesture.x - gesture.startX, gesture.y - gesture.startY);
    if (!gesture.armed) {
      if (distance > 8) { gesture.cancelled = true; clearLongPressTimer(); }
      return;
    }
    if (distance <= 6) return;
    gesture.dragging = true;
    gesture.target = findTouchDropTarget(gesture.x, gesture.y);
    if (gesture.target === gesture.entry.name) gesture.target = null;
    setDragOverFolder(gesture.target);
    setTouchDrag({ entry: gesture.entry, x: gesture.x, y: gesture.y });
  };

  const finishTouchGesture = () => {
    clearLongPressTimer();
    clearTouchMoveBlocker();
    touchGestureRef.current = null;
    setTouchDrag(null);
    setDragOverFolder(null);
    window.setTimeout(() => { isLongPressing.current = false; }, 0);
  };

  const handleTouchEnd = (event: TouchEvent) => {
    const gesture = touchGestureRef.current;
    if (!gesture) return;
    if (gesture.dragging) {
      if (gesture.target === '..' && fs.parentPath) void fs.moveFile(gesture.entry.name, fs.parentPath);
      else if (gesture.target) void fs.moveFile(gesture.entry.name, fs.currentPath === '/' ? `/${gesture.target}` : `${fs.currentPath}/${gesture.target}`);
    } else if (gesture.armed && !gesture.cancelled) {
      const touch = event.changedTouches[0];
      onContextMenu(gesture.entry, touch?.clientX ?? gesture.x, touch?.clientY ?? gesture.y);
    }
    finishTouchGesture();
  };

  const handleTouchCancel = () => finishTouchGesture();

  return {
    touchDrag,
    isLongPressing,
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd,
    handleTouchCancel,
  };
}
