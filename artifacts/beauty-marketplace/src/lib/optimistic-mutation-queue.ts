import { useSyncExternalStore } from "react";

export type MutationQueue = {
  acquire: () => Promise<() => void>;
  isBusy: () => boolean;
  subscribe: (listener: () => void) => () => void;
};

export function createMutationQueue(): MutationQueue {
  let tail = Promise.resolve();
  let pending = 0;
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((listener) => listener());

  return {
    async acquire() {
      pending += 1;
      emit();
      let releaseTicket!: () => void;
      const ticket = new Promise<void>((resolve) => {
        releaseTicket = resolve;
      });
      const turn = tail;
      tail = tail.then(() => ticket);
      await turn;

      let released = false;
      return () => {
        if (released) return;
        released = true;
        pending = Math.max(0, pending - 1);
        releaseTicket();
        emit();
      };
    },
    isBusy: () => pending > 0,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export function useMutationQueueBusy(queue: MutationQueue): boolean {
  return useSyncExternalStore(queue.subscribe, queue.isBusy, queue.isBusy);
}

export const SHOP_CART_MUTATION_KEY = ["shop-cart-mutation"] as const;
export const FAVORITE_MUTATION_KEY = ["favorite-mutation"] as const;
export const OWNER_NOTIFICATION_MUTATION_KEY = ["owner-notification-read-mutation"] as const;
export const EDUCATION_NOTIFICATION_MUTATION_KEY = ["education-notification-read-mutation"] as const;

export const shopCartMutationQueue = createMutationQueue();
export const favoriteMutationQueue = createMutationQueue();
export const ownerNotificationMutationQueue = createMutationQueue();
export const educationNotificationMutationQueue = createMutationQueue();