"use client";

// Local-first storage: every video, blueprint, and project lives in
// IndexedDB on the device. Nothing is uploaded to any server.
import { openDB, type IDBPDatabase } from "idb";
import type { EditBlueprint, UserClip, EditPlan } from "./types";

const DB_NAME = "viraledit";
const DB_VERSION = 1;

interface StoredVideo {
  id: string;
  blob: Blob;
  name: string;
  createdAt: number;
}

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDB() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains("videos")) db.createObjectStore("videos", { keyPath: "id" });
        if (!db.objectStoreNames.contains("blueprints")) db.createObjectStore("blueprints", { keyPath: "id" });
        if (!db.objectStoreNames.contains("clips")) db.createObjectStore("clips", { keyPath: "id" });
        if (!db.objectStoreNames.contains("plans")) db.createObjectStore("plans", { keyPath: "id" });
        if (!db.objectStoreNames.contains("settings")) db.createObjectStore("settings");
      },
    });
  }
  return dbPromise;
}

// --- videos (raw blobs: reference reel + user clips) ---
export async function saveVideo(id: string, blob: Blob, name: string) {
  const db = await getDB();
  await db.put("videos", { id, blob, name, createdAt: Date.now() } satisfies StoredVideo);
}

export async function getVideo(id: string): Promise<StoredVideo | undefined> {
  const db = await getDB();
  return db.get("videos", id);
}

export async function deleteVideo(id: string) {
  const db = await getDB();
  await db.delete("videos", id);
}

// --- blueprints (AI analysis results) ---
export async function saveBlueprint(bp: EditBlueprint) {
  const db = await getDB();
  await db.put("blueprints", bp);
}

export async function getBlueprint(id: string): Promise<EditBlueprint | undefined> {
  const db = await getDB();
  return db.get("blueprints", id);
}

export async function listBlueprints(): Promise<EditBlueprint[]> {
  const db = await getDB();
  const all: EditBlueprint[] = await db.getAll("blueprints");
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

// --- user clip metadata ---
export async function saveClipMeta(clip: UserClip) {
  const db = await getDB();
  await db.put("clips", clip);
}

export async function listClipMetas(): Promise<UserClip[]> {
  const db = await getDB();
  return db.getAll("clips");
}

export async function deleteClipMeta(id: string) {
  const db = await getDB();
  await db.delete("clips", id);
}

// --- edit plans ---
export async function savePlan(id: string, plan: EditPlan) {
  const db = await getDB();
  await db.put("plans", { ...plan, id });
}

export async function getPlan(id: string): Promise<(EditPlan & { id: string }) | undefined> {
  const db = await getDB();
  return db.get("plans", id);
}

// --- settings (API keys stay on-device) ---
export async function saveSetting(key: string, value: string) {
  const db = await getDB();
  await db.put("settings", value, key);
}

export async function getSetting(key: string): Promise<string | undefined> {
  const db = await getDB();
  return db.get("settings", key);
}
