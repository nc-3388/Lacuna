// Folder tree utilities for arbitrary-depth nesting.
//
// These pure helpers turn the flat folder list (with parentId pointers) into a
// renderable tree, compute full breadcrumb paths, and support drag-and-drop
// operations without adding external dependencies.

import type { Folder, Deck } from './types';

/** A folder node in the render tree, with children resolved recursively. */
export interface FolderNode {
  folder: Folder;
  children: FolderNode[];
  depth: number;
}

/** Build a tree of folders from the flat list. */
export function buildFolderTree(folders: Folder[]): FolderNode[] {
  const byParent = new Map<string | null, Folder[]>();
  for (const f of folders) {
    const key = f.parentId ?? null;
    const list = byParent.get(key) ?? [];
    list.push(f);
    byParent.set(key, list);
  }

  function build(parentId: string | null, depth: number): FolderNode[] {
    if (depth > 20) return []; // Safety limit against corrupted cyclic data.
    const children = byParent.get(parentId) ?? [];
    return children.map((folder) => ({
      folder,
      children: build(folder.id, depth + 1),
      depth,
    }));
  }

  return build(null, 0);
}

/** Build a map from folder id to its full path string, e.g. "Biology > Cell Structure". */
export function buildFolderPathMap(folders: Folder[]): Map<string, string> {
  const map = new Map<string, string>();
  const byId = new Map(folders.map((f) => [f.id, f]));

  for (const folder of folders) {
    const parts: string[] = [];
    let current: Folder | undefined = folder;
    while (current) {
      parts.unshift(current.name);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    map.set(folder.id, parts.join(' / '));
  }

  return map;
}

/** Get the full path of a folder as an array of folder names (root first). */
export function getFolderPath(folderId: string, folders: Folder[]): string[] {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const parts: string[] = [];
  let current: Folder | undefined = byId.get(folderId);
  while (current) {
    parts.unshift(current.name);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return parts;
}

/** Get the breadcrumb path for a deck (e.g. "Biology / Cell Structure"). */
export function getDeckFolderPath(
  deck: Deck,
  folders: Folder[],
): string | null {
  if (!deck.folderId) return null;
  const parts = getFolderPath(deck.folderId, folders);
  return parts.length > 0 ? parts.join(' / ') : null;
}

/** Check whether dropping a folder into another folder would create a cycle. */
export function wouldCreateCycle(
  draggedFolderId: string,
  targetFolderId: string,
  folders: Folder[],
): boolean {
  if (draggedFolderId === targetFolderId) return true;
  const byId = new Map(folders.map((f) => [f.id, f]));
  let current: Folder | undefined = byId.get(targetFolderId);
  while (current) {
    if (current.parentId === draggedFolderId) return true;
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return false;
}

/** Check whether a folder is an ancestor of another folder. */
export function isAncestor(
  ancestorId: string,
  descendantId: string,
  folders: Folder[],
): boolean {
  const byId = new Map(folders.map((f) => [f.id, f]));
  let current: Folder | undefined = byId.get(descendantId);
  while (current?.parentId) {
    if (current.parentId === ancestorId) return true;
    current = byId.get(current.parentId);
  }
  return false;
}

/** Get every descendant folder id (including the folder itself). */
export function getDescendantIds(folderId: string, folders: Folder[]): string[] {
  const byParent = new Map<string, string[]>();
  for (const f of folders) {
    if (f.parentId) {
      const list = byParent.get(f.parentId) ?? [];
      list.push(f.id);
      byParent.set(f.parentId, list);
    }
  }

  const result: string[] = [folderId];
  let queue = [folderId];
  while (queue.length > 0) {
    const next = queue.shift()!;
    const children = byParent.get(next) ?? [];
    result.push(...children);
    queue.push(...children);
  }
  return result;
}

/** Flatten a tree into a depth-sorted list for rendering. */
export function flattenFolderTree(nodes: FolderNode[]): (FolderNode & { index: number })[] {
  const result: (FolderNode & { index: number })[] = [];
  let index = 0;
  function walk(nodeList: FolderNode[]) {
    for (const node of nodeList) {
      result.push({ ...node, index: index++ });
      walk(node.children);
    }
  }
  walk(nodes);
  return result;
}
