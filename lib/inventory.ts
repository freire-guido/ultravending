import { getRedis } from "./redis";

export type InventorySlot = {
  description: string;
  amount: number;
  avg_unit_price?: number;
};

export type Inventory = Record<string, InventorySlot>;

const INVENTORY_KEY = "vending:inventory";

const DEFAULT_INVENTORY: Inventory = {
  "0": { description: "coca cola", avg_unit_price: 100, amount: 1 },
  "1": { description: "sprite", avg_unit_price: 200, amount: 2 },
  "2": { description: "fanta", avg_unit_price: 300, amount: 5 },
  "3": { description: "7up", avg_unit_price: 100, amount: 0 },
  "4": { description: "agua", amount: 0 },
  "5": { description: "agua con gas", avg_unit_price: 200, amount: 0 },
  "6": { description: "lays", avg_unit_price: 500, amount: 2 },
  "7": { description: "agua con gas", avg_unit_price: 100, amount: 1 },
  "8": { description: "agua con gas", avg_unit_price: 100, amount: 0 },
  "9": { description: "agua con gas", avg_unit_price: 100, amount: 0 },
};

export async function readInventory(): Promise<Inventory> {
  const redis = getRedis();
  const raw = await redis.get<Inventory>(INVENTORY_KEY);
  if (!raw) {
    await redis.set(INVENTORY_KEY, DEFAULT_INVENTORY);
    return DEFAULT_INVENTORY;
  }
  return raw;
}

export async function writeInventory(inventory: Inventory): Promise<void> {
  const redis = getRedis();
  await redis.set(INVENTORY_KEY, inventory);
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
