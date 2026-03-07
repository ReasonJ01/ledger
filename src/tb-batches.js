import { createTransferBatchFromGroups } from "./transfers.js";

const DEFAULT_BATCH_SIZE = 512;

export function chunkArray(items, batchSize = DEFAULT_BATCH_SIZE) {
  if (!Array.isArray(items)) throw new Error("items must be an array");
  if (!Number.isInteger(batchSize) || batchSize <= 0) {
    throw new Error("batchSize must be a positive integer");
  }

  const chunks = [];
  for (let index = 0; index < items.length; index += batchSize) {
    chunks.push(items.slice(index, index + batchSize));
  }
  return chunks;
}

export async function lookupAccountsBatched(client, accountIds, batchSize = DEFAULT_BATCH_SIZE) {
  const accounts = [];
  for (const ids of chunkArray(accountIds, batchSize)) {
    const batchAccounts = await client.lookupAccounts(ids);
    accounts.push(...batchAccounts);
  }
  return accounts;
}

export function chunkGroupsByItemCount(groups, getItemCount, maxItems = DEFAULT_BATCH_SIZE) {
  if (!Array.isArray(groups)) throw new Error("groups must be an array");
  if (typeof getItemCount !== "function") throw new Error("getItemCount must be a function");
  if (!Number.isInteger(maxItems) || maxItems <= 0) {
    throw new Error("maxItems must be a positive integer");
  }

  const batches = [];
  let currentBatch = [];
  let currentItemCount = 0;

  for (const group of groups) {
    const itemCount = getItemCount(group);
    if (!Number.isInteger(itemCount) || itemCount <= 0) {
      throw new Error("Each group must contain at least one item");
    }

    if (currentItemCount > 0 && currentItemCount + itemCount > maxItems) {
      batches.push(currentBatch);
      currentBatch = [];
      currentItemCount = 0;
    }

    currentBatch.push(group);
    currentItemCount += itemCount;

    if (currentItemCount >= maxItems) {
      batches.push(currentBatch);
      currentBatch = [];
      currentItemCount = 0;
    }
  }

  if (currentBatch.length > 0) {
    batches.push(currentBatch);
  }

  return batches;
}

function isOversizedBatchError(error) {
  return String(error?.message ?? error).includes("Too much data provided on this batch");
}

async function submitTransferGroupsRecursive(client, groups, hooks = {}) {
  const transfers = createTransferBatchFromGroups(groups.map((group) => group.transfers));
  hooks.onBatch?.({ groups, transfers });

  try {
    const errors = await client.createTransfers(transfers);
    return [{ groups, transfers, errors }];
  } catch (error) {
    if (groups.length > 1 && isOversizedBatchError(error)) {
      hooks.onOversizedSplit?.({ groups, transfers, error });
      const midpoint = Math.floor(groups.length / 2);
      const left = await submitTransferGroupsRecursive(client, groups.slice(0, midpoint), hooks);
      const right = await submitTransferGroupsRecursive(client, groups.slice(midpoint), hooks);
      return [...left, ...right];
    }
    throw error;
  }
}

export async function createTransfersForGroupsAdaptive(
  client,
  groups,
  { maxItems = DEFAULT_BATCH_SIZE, onBatch, onOversizedSplit } = {}
) {
  const initialBatches = chunkGroupsByItemCount(groups, (group) => group.transfers.length, maxItems);
  const results = [];

  for (const batch of initialBatches) {
    results.push(...await submitTransferGroupsRecursive(client, batch, { onBatch, onOversizedSplit }));
  }

  return results;
}
