import { createCustomerRetailProductReview } from "./lib/api-client-react/src/generated/api";

createCustomerRetailProductReview("id", {
  body: JSON.stringify({ rating: 5, comment: "Test" }),
  headers: { "Content-Type": "application/json" }
});
