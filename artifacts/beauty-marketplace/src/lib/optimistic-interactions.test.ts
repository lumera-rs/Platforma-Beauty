import assert from "node:assert/strict";
import test from "node:test";
import { QueryClient } from "@tanstack/react-query";
import type { Product, ShopCart } from "@workspace/api-client-react";
import {
  addOptimisticCartItem,
  removeOptimisticCartItem,
  updateOptimisticCartQuantity,
} from "./optimistic-cart";
import { rollbackQueries, updateQueryOptimistically } from "./optimistic-query";
import { createMutationQueue } from "./optimistic-mutation-queue";
import { updateOptimisticFavorites } from "./optimistic-favorite";
import type { SalonCard } from "@workspace/api-client-react";

const product: Product = {
  id: "product-1",
  name: "Serum",
  category: "Nega",
  subcategory: null,
  brand: "LUMERA",
  description: "Profesionalni serum",
  imageUrl: "/serum.jpg",
  price: 1_200,
  discountPrice: 1_000,
  discountPercent: null,
  stock: 8,
  sku: "SER-1",
  unit: "kom",
  isNew: false,
  isBestseller: false,
  weightGrams: 100,
  shortDescription: null,
  images: [],
  variants: null,
  variantType: null,
  averageRating: null,
  reviewCount: 0,
};

test("optimistic cart add, quantity update and removal keep totals synchronized", () => {
  const added = addOptimisticCartItem(undefined, product);
  assert.equal(added.items.length, 1);
  assert.equal(added.itemCount, 1);
  assert.equal(added.subtotal, 1_000);
  assert.equal(added.totalWeightGrams, 100);

  const doubled = addOptimisticCartItem(added, product);
  assert.equal(doubled.items[0]?.quantity, 2);
  assert.equal(doubled.itemCount, 2);
  assert.equal(doubled.subtotal, 2_000);
  assert.equal(doubled.totalWeightGrams, 200);

  const updated = updateOptimisticCartQuantity(doubled, doubled.items[0]!.id, 4)!;
  assert.equal(updated.itemCount, 4);
  assert.equal(updated.subtotal, 4_000);
  assert.equal(updated.totalWeightGrams, 400);

  const removed = removeOptimisticCartItem(updated, updated.items[0]!.id)!;
  assert.deepEqual(removed.items, []);
  assert.equal(removed.itemCount, 0);
  assert.equal(removed.subtotal, 0);
  assert.equal(removed.totalWeightGrams, 0);
});

test("query snapshot restores the exact cart after a failed mutation", async () => {
  const queryClient = new QueryClient();
  const queryKey = ["/api/shop/cart"] as const;
  const original = addOptimisticCartItem(undefined, product);
  queryClient.setQueryData<ShopCart>(queryKey, original);

  const snapshot = await updateQueryOptimistically<ShopCart>(
    queryClient,
    queryKey,
    (current) => updateOptimisticCartQuantity(current, original.items[0]!.id, 5),
  );
  assert.equal(queryClient.getQueryData<ShopCart>(queryKey)?.itemCount, 5);

  rollbackQueries(queryClient, [snapshot]);
  assert.deepEqual(queryClient.getQueryData<ShopCart>(queryKey), original);
});

test("mutation queue serializes rapid cart operations in FIFO order", async () => {
  const queue = createMutationQueue();
  assert.equal(queue.isBusy(), false);
  const firstRelease = await queue.acquire();
  assert.equal(queue.isBusy(), true);
  const order = ["first"];
  const second = queue.acquire().then((release) => {
    order.push("second");
    return release;
  });
  const third = queue.acquire().then((release) => {
    order.push("third");
    return release;
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(order, ["first"]);
  firstRelease();
  const secondRelease = await second;
  assert.deepEqual(order, ["first", "second"]);
  secondRelease();
  const thirdRelease = await third;
  assert.deepEqual(order, ["first", "second", "third"]);
  thirdRelease();
  assert.equal(queue.isBusy(), false);
});

test("queued failure rolls back before the next optimistic cart operation starts", async () => {
  const queue = createMutationQueue();
  const queryClient = new QueryClient();
  const queryKey = ["/api/shop/cart"] as const;
  const original = addOptimisticCartItem(undefined, product);
  queryClient.setQueryData<ShopCart>(queryKey, original);

  let failFirst!: () => void;
  const firstGate = new Promise<void>((resolve) => { failFirst = resolve; });
  const first = (async () => {
    const release = await queue.acquire();
    const snapshot = await updateQueryOptimistically<ShopCart>(
      queryClient,
      queryKey,
      (current) => updateOptimisticCartQuantity(current, original.items[0]!.id, 5),
    );
    await firstGate;
    rollbackQueries(queryClient, [snapshot]);
    release();
  })();

  let secondStarted = false;
  const second = (async () => {
    const release = await queue.acquire();
    secondStarted = true;
    const snapshot = await updateQueryOptimistically<ShopCart>(
      queryClient,
      queryKey,
      (current) => removeOptimisticCartItem(current, original.items[0]!.id),
    );
    assert.equal(queryClient.getQueryData<ShopCart>(queryKey)?.itemCount, 0);
    rollbackQueries(queryClient, [snapshot]);
    release();
  })();

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(queryClient.getQueryData<ShopCart>(queryKey)?.itemCount, 5);
  assert.equal(secondStarted, false);
  failFirst();
  await first;
  await second;
  assert.deepEqual(queryClient.getQueryData<ShopCart>(queryKey), original);
});

const salon: SalonCard = {
  id: "salon-1",
  slug: "salon-1",
  name: "Salon 1",
  city: "Beograd",
  municipality: "Vračar",
  imageUrl: "/salon.jpg",
  rating: 5,
  reviewCount: 1,
  shortDescription: "Test",
  popularServices: [],
  startingPrice: 1_000,
  earliestSlot: null,
  homeService: false,
  featured: false,
  topSalon: false,
  acceptsCards: true,
  instantBooking: false,
  servesMen: false,
  isVerified: true,
  hasDiscount: false,
  openSunday: false,
  lastBookedAt: null,
  createdAt: new Date(0).toISOString(),
};

test("favorite cache adds immediately without duplicates and restores exactly on failure", async () => {
  const queryClient = new QueryClient();
  const queryKey = ["/api/customer/favorites"] as const;
  queryClient.setQueryData<SalonCard[]>(queryKey, []);

  const snapshot = await updateQueryOptimistically<SalonCard[]>(
    queryClient,
    queryKey,
    (current) => updateOptimisticFavorites(current, salon, true),
  );
  assert.deepEqual(queryClient.getQueryData(queryKey), [salon]);
  assert.deepEqual(updateOptimisticFavorites([salon], salon, true), [salon]);

  rollbackQueries(queryClient, [snapshot]);
  assert.deepEqual(queryClient.getQueryData(queryKey), []);
});