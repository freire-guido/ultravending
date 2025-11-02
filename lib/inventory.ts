import { promises as fs } from "fs";
import path from "path";

export type InventorySlot = {
  description: string;
  amount: number;
  avg_unit_price?: number;
};

export type Inventory = Record<string, InventorySlot>;

const DATA_DIR = path.resolve(process.cwd(), "data");
const INVENTORY_PATH = path.resolve(DATA_DIR, "inventory.json");

const DEFAULT_INVENTORY: Inventory = Object.fromEntries(
  Array.from({ length: 10 }, (_v, i) => [String(i), { description: "", amount: 0 }])
);

export async function ensureInventoryFile(): Promise<void> {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
  } catch (_) {
    // ignore mkdir errors, next ops will surface issues if any
  }

  try {
    await fs.access(INVENTORY_PATH);
  } catch (_) {
    await writeInventory(DEFAULT_INVENTORY);
  }
}

export async function readInventory(): Promise<Inventory> {
  await ensureInventoryFile();
  const raw = await fs.readFile(INVENTORY_PATH, "utf8");
  try {
    const parsed = JSON.parse(raw) as Inventory;
    return parsed;
  } catch (err) {
    // If file is corrupted, reset to default to keep system operable
    await writeInventory(DEFAULT_INVENTORY);
    return DEFAULT_INVENTORY;
  }
}

export async function writeInventory(inventory: Inventory): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const tmpPath = `${INVENTORY_PATH}.tmp`;
  const data = JSON.stringify(inventory, null, 2) + "\n";
  await fs.writeFile(tmpPath, data, "utf8");
  await fs.rename(tmpPath, INVENTORY_PATH);
}

export async function decrementSlot(slot: number): Promise<Inventory> {
  if (!Number.isInteger(slot) || slot < 0 || slot > 9) {
    throw new Error("Invalid slot: must be an integer 0-9");
  }

  const inventory = await readInventory();
  const key = String(slot);
  const current = inventory[key] ?? { description: "", amount: 0 };

  if (current.amount <= 0) {
    throw new Error("Out of stock");
  }

  const updated: Inventory = { ...inventory, [key]: { ...current, amount: current.amount - 1 } };
  await writeInventory(updated);
  return updated;
}

export async function getInventoryPath(): Promise<string> {
  await ensureInventoryFile();
  return INVENTORY_PATH;
}


