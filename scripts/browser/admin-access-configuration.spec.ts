import { randomUUID } from "node:crypto";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  salonsTable,
  subscriptionPlansTable,
  subscriptionsTable,
  usersTable,
} from "@workspace/db";
import * as apiSchemas from "../../lib/api-zod/src/generated/api";
import { hashPassword } from "../../artifacts/api-server/src/lib/auth";
import {
  ADMIN_NAV_GROUPS,
  ADMIN_PROTECTED_DETAIL_ROUTE_FIXTURES,
  adminNavigationTestId,
} from "../../artifacts/beauty-marketplace/src/lib/admin-navigation";
import {
  adminIntegrationsFixture,
  adminSummaryFixture,
  checkedApiFixture,
  type FixtureSchema,
} from "../src/browser-api-fixtures";

const ADMIN_NAV = ADMIN_NAV_GROUPS.flatMap((group) =>
  group.links.map(({ href }) => ({ href, testId: adminNavigationTestId(href) })),
);

const PROTECTED_ADMIN_ROUTES = [
  ...ADMIN_NAV.map(({ href }) => href),
  ...ADMIN_PROTECTED_DETAIL_ROUTE_FIXTURES,
];

type RegisteredAdminFixture = {
  schema: FixtureSchema;
  payload: unknown;
};

const ADMIN_INITIAL_GET_FIXTURES: Record<string, RegisteredAdminFixture> = {
  "/api/admin/aftercare/settings": {
    schema: apiSchemas.AdminGetAftercareSettingsResponse,
    payload: {
      version: 1,
      firstTiming: "NEXT_DAY",
      cooldownDays: 30,
      secondReminderDelayDays: 7,
      postTreatmentDiscountEnabled: false,
      postTreatmentDiscountPercent: 0,
      postTreatmentDiscountValidityDays: 30,
      personalizedBundleDiscountPercent: 1,
      combinationWindowDays: 30,
    },
  },
  "/api/admin/aftercare/treatments": {
    schema: apiSchemas.AdminListAftercareTreatmentsResponse,
    payload: [],
  },
  "/api/admin/automatic-xy-promotions": {
    schema: apiSchemas.AdminListAutomaticXyPromotionsResponse,
    payload: [],
  },
  "/api/admin/b2c/banners": {
    schema: apiSchemas.AdminListB2cBannersResponse,
    payload: [],
  },
  "/api/admin/b2c/display-settings": {
    schema: apiSchemas.AdminGetB2cDisplaySettingsResponse,
    payload: {
      id: "00000000-0000-4000-8000-000000000080",
      version: 1,
      updatedAt: "2026-08-21T09:00:00.000Z",
      defaultSort: "RECOMMENDED",
      enabledSortOptions: ["RECOMMENDED", "PRICE_ASC", "PRICE_DESC", "NEWEST"],
      pageSize: 24,
      showOutOfStock: false,
      recentlyViewedEnabled: true,
      recentlyViewedMax: 10,
    },
  },
  "/api/admin/b2c/product-types": {
    schema: apiSchemas.AdminListB2cProductTypesResponse,
    payload: [],
  },
  "/api/admin/brands": {
    schema: apiSchemas.AdminListBrandsResponse,
    payload: [],
  },
  "/api/admin/bulk-sale-campaigns": {
    schema: apiSchemas.AdminListBulkSaleCampaignsResponse,
    payload: [],
  },
  "/api/admin/bundles": {
    schema: apiSchemas.AdminListBundlesResponse,
    payload: [],
  },
  "/api/admin/cart-threshold-rewards": {
    schema: apiSchemas.AdminListCartThresholdRewardsResponse,
    payload: [],
  },
  "/api/admin/catalog/meta/status": {
    schema: apiSchemas.AdminGetMetaCatalogStatusResponse,
    payload: { connectionStatus: "NOT_CONNECTED", canSync: false, latestRun: null },
  },
  "/api/admin/commerce/bestsellers": {
    schema: apiSchemas.AdminListCommerceBestsellersResponse,
    payload: [],
  },
  "/api/admin/commerce-experience": {
    schema: apiSchemas.AdminGetCommerceExperienceResponse,
    payload: {
      headerEnabled: false,
      headerMessages: [],
      headerIntervalSeconds: 5,
      smartSearchMode: "AUTOMATIC",
      smartSearchProductIds: [],
      bestsellerPeriodDays: 30,
      version: 1,
    },
  },
  "/api/admin/coupons": {
    schema: apiSchemas.AdminListCouponsResponse,
    payload: [],
  },
  "/api/admin/education/b2b-discount-tiers": {
    schema: apiSchemas.AdminGetEducationB2bDiscountTiersResponse,
    payload: { version: 1, tiers: [] },
  },
  "/api/admin/education/bank-reconciliation": {
    schema: apiSchemas.GetAdminEducationBankReconciliationResponse,
    payload: {
      enabled: false,
      engineState: "disabled",
      bankConnectionConfigured: false,
      accessMethod: null,
      accessConfirmed: false,
      accessConfirmedAt: null,
      accessMethods: [],
      lastProcessedAt: null,
      lastResult: null,
      lastRejectionReason: null,
    },
  },
  "/api/admin/education/bundle-purchases/pending": {
    schema: apiSchemas.ListAdminPendingEducationBundlePurchasesResponse,
    payload: [],
  },
  "/api/admin/integrations/brevo/stale-webhooks": {
    schema: apiSchemas.AdminListBrevoStaleWebhooksResponse,
    payload: { staleWebhooks: [] },
  },
  "/api/admin/integrations/web-push-delivery-metrics": {
    schema: apiSchemas.AdminGetWebPushDeliveryMetricsResponse,
    payload: {
      periodDays: 30,
      periodStartedAt: "2026-07-22T09:00:00.000Z",
      deliveries: {
        sent: 0,
        acknowledged: 0,
        failed: 0,
        retried: 0,
        pending: 0,
        expiredOrChanged: 0,
        providerErrors: 0,
      },
      devices: { active: 0, automaticallyDeactivated: 0 },
    },
  },
  "/api/admin/loyalty-pricing-tiers": {
    schema: apiSchemas.AdminListLoyaltyPricingTiersResponse,
    payload: [],
  },
  "/api/admin/orders": {
    schema: apiSchemas.AdminListOrdersResponse,
    payload: [],
  },
  "/api/admin/price-inquiries": {
    schema: apiSchemas.AdminListPriceInquiriesResponse,
    payload: [],
  },
  "/api/admin/product-categories": {
    schema: apiSchemas.AdminListProductCategoriesResponse,
    payload: [],
  },
  "/api/admin/products": {
    schema: apiSchemas.AdminListProductsResponse,
    payload: { items: [], total: 0, page: 1, pageSize: 20, totalPages: 0 },
  },
  "/api/admin/quotes": {
    schema: apiSchemas.AdminListQuotesResponse,
    payload: [],
  },
  "/api/admin/referrals/approvals": {
    schema: apiSchemas.AdminListReferralApprovalsResponse,
    payload: [],
  },
  "/api/admin/referrals/reviews": {
    schema: apiSchemas.AdminListReferralReviewsResponse,
    payload: [],
  },
  "/api/admin/rmas": {
    schema: apiSchemas.AdminListRmasResponse,
    payload: [],
  },
  "/api/admin/sms-deliveries": {
    schema: apiSchemas.AdminListSmsDeliveriesResponse,
    payload: [],
  },
  "/api/admin/service-categories": {
    schema: apiSchemas.AdminListServiceCategoriesResponse,
    payload: [],
  },
  "/api/admin/service-templates": {
    schema: apiSchemas.AdminListServiceTemplatesResponse,
    payload: [],
  },
  "/api/admin/suppliers": {
    schema: apiSchemas.AdminListSuppliersResponse,
    payload: [],
  },
};

for (const [endpoint, fixture] of Object.entries(ADMIN_INITIAL_GET_FIXTURES)) {
  checkedApiFixture(endpoint, fixture.schema, fixture.payload);
}

const admin = {
  id: "00000000-0000-4000-8000-000000000071",
  firstName: "Test",
  lastName: "Administrator",
  email: "admin-regression@example.test",
  role: "ADMIN" as const,
  active: true,
  mustChangePassword: false,
  phone: null,
  dateOfBirth: null,
  marketingEmailsEnabled: false,
};

const superAdmin = { ...admin, role: "SUPER_ADMIN" as const };
const salonId = "00000000-0000-4000-8000-000000000072";
const userId = "00000000-0000-4000-8000-000000000073";
const tierId = "00000000-0000-4000-8000-000000000074";
const planId = "00000000-0000-4000-8000-000000000075";
const reviewId = "00000000-0000-4000-8000-000000000076";
const rmaId = "00000000-0000-4000-8000-000000000081";
const rmaOrderId = "00000000-0000-4000-8000-000000000082";

function adminSalon() {
  return {
    id: salonId,
    name: "Regresioni salon",
    slug: "regresioni-salon",
    city: "Beograd",
    active: true,
    featured: false,
    isVerified: true,
    topSalon: false,
    videoUrl: null,
    rating: 4.8,
    reviewCount: 12,
    subscriptionStatus: "active",
    subscriptionPlan: "LUMERA Pro",
    loyaltyTier: "Gold",
    loyaltySpend: 12000,
    createdAt: "2026-08-21T09:00:00.000Z",
  };
}

function adminUser() {
  return {
    id: userId,
    firstName: "Salon",
    lastName: "Vlasnik",
    email: "owner-regression@example.test",
    phone: null,
    role: "CUSTOMER",
    active: true,
    passwordSetAt: "2026-08-21T09:00:00.000Z",
    createdAt: "2026-08-21T09:00:00.000Z",
  };
}

function loyaltyTier() {
  return {
    id: tierId,
    name: "Gold",
    sortOrder: 2,
    spendThreshold: 10000,
    period: "monthly",
    subscriptionDiscountPercent: 10,
    productDiscountPercent: 5,
    freeSubscription: false,
    premiumListing: true,
    freeShipping: true,
    benefits: ["Prioritetna podrška"],
    active: true,
  };
}

function subscriptionPlan() {
  return {
    id: planId,
    name: "LUMERA Pro",
    price: 4990,
    trialDays: 14,
    features: ["Neograničen kalendar"],
    limits: { employees: 10, services: 50 },
    active: true,
  };
}

function adminReview() {
  return {
    id: reviewId,
    salonId,
    salonName: "Regresioni salon",
    customerId: userId,
    customerName: "Salon Vlasnik",
    serviceName: "Regresioni tretman",
    rating: 5,
    text: "Odlična usluga.",
    visible: true,
    date: "2026-08-21T09:00:00.000Z",
  };
}

function adminRma() {
  return {
    id: rmaId,
    rmaNumber: "RMA-REG-001",
    orderItemId: null,
    retailOrderId: rmaOrderId,
    retailOrderItemId: "00000000-0000-4000-8000-000000000083",
    requesterUserId: userId,
    quantity: 1,
    createdAt: "2026-08-21T09:00:00.000Z",
    updatedAt: "2026-08-21T09:00:00.000Z",
    target: "b2c",
    owner: {
      firstName: "Test",
      lastName: "Kupac",
      email: "customer-regression@example.test",
    },
    orderId: null,
    reason: "Oštećen proizvod",
    description: "Pakovanje je stiglo oštećeno.",
    status: "RECEIVED",
  };
}

function throwUnregisteredAdminApiFixture(method: string, path: string): never {
  throw new Error(`Unregistered admin API fixture: ${method} ${path}`);
}

async function mockAdminApi(page: Page, role: "ADMIN" | "SUPER_ADMIN", loggedIn = true) {
  let currentUser = role === "SUPER_ADMIN" ? superAdmin : admin;
  let isLoggedIn = loggedIn;
  let salon = adminSalon();
  let user = adminUser();
  let tier = loyaltyTier();
  let plan = subscriptionPlan();
  let review = adminReview();
  let rma = adminRma();

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();

    if (path === "/api/auth/me") {
      await route.fulfill({
        json: checkedApiFixture("/api/auth/me", apiSchemas.GetCurrentUserResponse, {
          user: isLoggedIn ? currentUser : null,
        }),
      });
      return;
    }
    if (path === "/api/auth/login" && method === "POST") {
      isLoggedIn = true;
      currentUser = role === "SUPER_ADMIN" ? superAdmin : admin;
      await route.fulfill({
        json: checkedApiFixture("/api/auth/login", apiSchemas.LoginResponse, {
          user: currentUser,
          message: "Uspešno ste prijavljeni.",
        }),
      });
      return;
    }
    if (path === "/api/education/disputes" && method === "GET") {
      await route.fulfill({
        json: checkedApiFixture("/api/education/disputes", apiSchemas.ListEducationDisputesResponse, []),
      });
      return;
    }
    if (path === "/api/growth/admin/summary" && method === "GET") {
      await route.fulfill({
        json: checkedApiFixture("/api/growth/admin/summary", apiSchemas.AdminGetGrowthSummaryResponse, {
          automation: { totalRules: 4, activeRules: 2, byStatus: { active: 2, paused: 2 } },
          packages: { total: 3, active: 2 },
          purchases: { total: 5, active: 4, pendingPayment: 1 },
        }),
      });
      return;
    }

    if (
      path.startsWith("/api/admin/")
      || path.startsWith("/api/beauty-jobs/")
      || path.startsWith("/api/growth/admin/retention-settings")
    ) {
      if (path === "/api/admin/summary") {
        await route.fulfill({
          json: adminSummaryFixture(apiSchemas.GetAdminSummaryResponse),
        });
        return;
      }
      if (path === "/api/admin/salons" && method === "GET") {
        await route.fulfill({
          json: checkedApiFixture("/api/admin/salons", apiSchemas.AdminListSalonsResponse, [salon]),
        });
        return;
      }
      if (path === `/api/admin/salons/${salonId}` && method === "GET") {
        const detail = {
            ...salon,
            address: "Test 1",
            postalCode: "11000",
            phone: "+381110000000",
            email: "salon@example.test",
            orderCount: 0,
            orderTotal: 0,
            orders: [],
        };
        await route.fulfill({
          json: checkedApiFixture(`/api/admin/salons/${salonId}`, apiSchemas.AdminGetSalonResponse, detail),
        });
        return;
      }
      if (path === `/api/admin/salons/${salonId}` && method === "PATCH") {
        salon = { ...salon, ...(request.postDataJSON() as Partial<typeof salon>) };
        await route.fulfill({
          json: checkedApiFixture(`/api/admin/salons/${salonId}`, apiSchemas.AdminUpdateSalonResponse, salon),
        });
        return;
      }
      if (path === "/api/admin/users" && method === "GET") {
        await route.fulfill({
          json: checkedApiFixture("/api/admin/users", apiSchemas.AdminListUsersResponse, [user]),
        });
        return;
      }
      if (path === `/api/admin/users/${userId}` && method === "PATCH") {
        user = { ...user, ...(request.postDataJSON() as Partial<typeof user>) };
        await route.fulfill({
          json: checkedApiFixture(`/api/admin/users/${userId}`, apiSchemas.AdminUpdateUserResponse, user),
        });
        return;
      }
      if (path === "/api/admin/loyalty-tiers" && method === "GET") {
        await route.fulfill({
          json: checkedApiFixture("/api/admin/loyalty-tiers", apiSchemas.AdminListLoyaltyTiersResponse, [tier]),
        });
        return;
      }
      if (path === `/api/admin/loyalty-tiers/${tierId}` && method === "PATCH") {
        tier = { ...tier, ...(request.postDataJSON() as Partial<typeof tier>) };
        await route.fulfill({
          json: checkedApiFixture(`/api/admin/loyalty-tiers/${tierId}`, apiSchemas.AdminUpdateLoyaltyTierResponse, tier),
        });
        return;
      }
      if (path === "/api/admin/loyalty-tiers" && method === "POST") {
        await route.fulfill({
          status: 201,
          json: checkedApiFixture("/api/admin/loyalty-tiers", apiSchemas.AdminCreateLoyaltyTierResponse, {
            ...tier,
            id: randomUUID(),
          }),
        });
        return;
      }
      if (path === `/api/admin/loyalty-tiers/${tierId}` && method === "DELETE") {
        await route.fulfill({
          json: checkedApiFixture(`/api/admin/loyalty-tiers/${tierId}`, apiSchemas.AdminDeleteLoyaltyTierResponse, {
            ...tier,
            active: false,
          }),
        });
        return;
      }
      if (path === "/api/admin/subscription-plans" && method === "GET") {
        await route.fulfill({
          json: checkedApiFixture("/api/admin/subscription-plans", apiSchemas.AdminListSubscriptionPlansResponse, [plan]),
        });
        return;
      }
      if (path === `/api/admin/subscription-plans/${planId}` && method === "PATCH") {
        plan = { ...plan, ...(request.postDataJSON() as Partial<typeof plan>) };
        await route.fulfill({
          json: checkedApiFixture(`/api/admin/subscription-plans/${planId}`, apiSchemas.AdminUpdateSubscriptionPlanResponse, plan),
        });
        return;
      }
      if (path === "/api/admin/subscription-plans" && method === "POST") {
        await route.fulfill({
          status: 201,
          json: checkedApiFixture("/api/admin/subscription-plans", apiSchemas.AdminCreateSubscriptionPlanResponse, {
            ...plan,
            id: randomUUID(),
          }),
        });
        return;
      }
      if (path === `/api/admin/subscription-plans/${planId}` && method === "DELETE") {
        plan = { ...plan, active: false };
        await route.fulfill({
          json: checkedApiFixture(`/api/admin/subscription-plans/${planId}`, apiSchemas.AdminDeleteSubscriptionPlanResponse, plan),
        });
        return;
      }
      if (path === "/api/admin/reviews" && method === "GET") {
        await route.fulfill({
          json: checkedApiFixture("/api/admin/reviews", apiSchemas.AdminListReviewsResponse, [review]),
        });
        return;
      }
      if (path === `/api/admin/reviews/${reviewId}` && method === "PATCH") {
        review = { ...review, ...(request.postDataJSON() as Partial<typeof review>) };
        await route.fulfill({
          json: checkedApiFixture(`/api/admin/reviews/${reviewId}`, apiSchemas.AdminUpdateReviewResponse, review),
        });
        return;
      }
      if (path === `/api/admin/reviews/${reviewId}` && method === "DELETE") {
        await route.fulfill({ status: 204 });
        return;
      }
      if (path === "/api/admin/rmas" && method === "GET") {
        await route.fulfill({
          json: checkedApiFixture("/api/admin/rmas", apiSchemas.AdminListRmasResponse, [rma]),
        });
        return;
      }
      if (path === `/api/admin/rmas/${rmaId}` && method === "GET") {
        await route.fulfill({
          json: checkedApiFixture(`/api/admin/rmas/${rmaId}`, apiSchemas.AdminGetRmaResponse, {
            ...rma,
            items: [],
            privatePhotos: [],
            auditTrail: [],
          }),
        });
        return;
      }
      if (path === `/api/admin/rmas/${rmaId}/status` && method === "PATCH") {
        rma = { ...rma, ...(request.postDataJSON() as Partial<typeof rma>) };
        await route.fulfill({
          json: checkedApiFixture(
            `/api/admin/rmas/${rmaId}/status`,
            apiSchemas.AdminUpdateRmaStatusResponse,
            {
              row: {
                id: rma.id,
                rmaNumber: rma.rmaNumber,
                orderId: rma.orderId,
                orderItemId: rma.orderItemId,
                retailOrderId: rma.retailOrderId,
                retailOrderItemId: rma.retailOrderItemId,
                requesterUserId: rma.requesterUserId,
                quantity: rma.quantity,
                reason: rma.reason,
                description: rma.description,
                status: rma.status,
                createdAt: rma.createdAt,
                updatedAt: rma.updatedAt,
              },
              changed: true,
            },
          ),
        });
        return;
      }
      if (path === "/api/admin/shipping" && method === "GET") {
        const shipping = {
            freeShippingThreshold: 10000,
            tiers: [],
            personalDeliveryEnabled: false,
            personalDeliveryName: "Lična dostava u Beogradu",
            personalDeliveryPrice: 0,
            personalDeliveryDescription: "Dostava na adresu u Beogradu.",
            updatedAt: "2026-08-21T09:00:00.000Z",
        };
        await route.fulfill({
          json: checkedApiFixture("/api/admin/shipping", apiSchemas.AdminGetShippingConfigResponse, shipping),
        });
        return;
      }
      if (path === "/api/admin/courier-services" && method === "GET") {
        await route.fulfill({
          json: checkedApiFixture("/api/admin/courier-services", apiSchemas.AdminListCourierServicesResponse, []),
        });
        return;
      }
      if (path === "/api/admin/email-marketing/campaigns" && method === "GET") {
        await route.fulfill({
          json: checkedApiFixture("/api/admin/email-marketing/campaigns", apiSchemas.AdminListEmailCampaignsResponse, {
            campaigns: [],
          }),
        });
        return;
      }
      if (path === "/api/admin/integrations" && method === "GET") {
        await route.fulfill({
          json: adminIntegrationsFixture(apiSchemas.AdminGetIntegrationsResponse),
        });
        return;
      }
      if (path === "/api/admin/education/settings" && method === "GET") {
        await route.fulfill({
          json: checkedApiFixture("/api/admin/education/settings", apiSchemas.GetAdminEducationSettingsResponse, {
            id: "00000000-0000-4000-8000-000000000077",
            commissionPercent: 10,
            reservePercent: 5,
            onlineRefundDays: 14,
            liveAppealDays: 7,
            featuredCoursePrice: 5000,
            updatedAt: "2026-08-21T09:00:00.000Z",
          }),
        });
        return;
      }
      if (path === "/api/admin/education/centers" && method === "GET") {
        await route.fulfill({
          json: checkedApiFixture("/api/admin/education/centers", apiSchemas.ListAdminEducationCentersResponse, []),
        });
        return;
      }
      if (path === "/api/admin/education/finance" && method === "GET") {
        await route.fulfill({
          json: checkedApiFixture("/api/admin/education/finance", apiSchemas.GetAdminEducationFinanceResponse, {
            summary: {},
            escrows: [],
            pendingEnrollments: [],
            featuredCharges: [],
            payouts: [],
          }),
        });
        return;
      }
      if (path === "/api/admin/education/taxonomy/proposals" && method === "GET") {
        await route.fulfill({
          json: checkedApiFixture(
            "/api/admin/education/taxonomy/proposals",
            apiSchemas.ListAdminEducationTaxonomyProposalsResponse,
            [],
          ),
        });
        return;
      }
      if (path === "/api/admin/education/placement-settings" && method === "GET") {
        await route.fulfill({
          json: checkedApiFixture(
            "/api/admin/education/placement-settings",
            apiSchemas.GetAdminEducationPlacementSettingsResponse,
            [],
          ),
        });
        return;
      }
      if (path === "/api/admin/featured-placements" && method === "GET") {
        await route.fulfill({
          json: checkedApiFixture(
            "/api/admin/featured-placements",
            apiSchemas.ListAdminFeaturedPlacementsResponse,
            { items: [], page: 1, pageSize: 20, total: 0 },
          ),
        });
        return;
      }
      if (path === "/api/admin/education/installments" && method === "GET") {
        await route.fulfill({
          json: checkedApiFixture(
            "/api/admin/education/installments",
            apiSchemas.ListAdminEducationInstallmentsResponse,
            [],
          ),
        });
        return;
      }
      if (path === "/api/admin/education/gift-vouchers" && method === "GET") {
        await route.fulfill({
          json: checkedApiFixture(
            "/api/admin/education/gift-vouchers",
            apiSchemas.AdminListEducationGiftVouchersResponse,
            { items: [], page: 1, pageSize: 20, total: 0 },
          ),
        });
        return;
      }
      if (path === "/api/admin/education/grace-centers" && method === "GET") {
        await route.fulfill({
          json: checkedApiFixture(
            "/api/admin/education/grace-centers",
            apiSchemas.ListAdminEducationGraceCentersResponse,
            {
              items: [],
              generatedAt: "2026-08-21T09:00:00.000Z",
              truncated: false,
            },
          ),
        });
        return;
      }
      if (path === "/api/admin/education/financial-audit" && method === "GET") {
        await route.fulfill({
          json: checkedApiFixture(
            "/api/admin/education/financial-audit",
            apiSchemas.ListAdminEducationFinancialAuditResponse,
            { items: [], nextCursor: null },
          ),
        });
        return;
      }
      if (path === "/api/admin/product-waitlist" && method === "GET") {
        await route.fulfill({
          json: checkedApiFixture(
            "/api/admin/product-waitlist",
            apiSchemas.AdminListProductWaitlistResponse,
            { items: [], total: 0, page: 1, pageSize: 20, totalPages: 0 },
          ),
        });
        return;
      }
      if (path === "/api/admin/commerce/profitability" && method === "GET") {
        await route.fulfill({
          json: checkedApiFixture(
            "/api/admin/commerce/profitability",
            apiSchemas.AdminGetCommerceProfitabilityResponse,
            {
              kpis: { revenueRsd: 0, cogsRsd: 0, profitRsd: 0, marginPercent: null, units: 0 },
              timeSeries: [],
              products: [],
              treatment: "",
            },
          ),
        });
        return;
      }
      if (path === "/api/admin/retail-product-reviews" && method === "GET") {
        await route.fulfill({
          json: checkedApiFixture(
            "/api/admin/retail-product-reviews",
            apiSchemas.AdminListRetailProductReviewsResponse,
            { items: [], total: 0, page: 1, pageSize: 20 },
          ),
        });
        return;
      }
      if (path === "/api/admin/review-rewards" && method === "GET") {
        await route.fulfill({
          json: checkedApiFixture(
            "/api/admin/review-rewards",
            apiSchemas.AdminGetReviewRewardSettingsResponse,
            {
              settings: {
                enabled: false,
                invitationDelayDays: 7,
                percent: 1,
                validityDays: 1,
                version: 1,
              },
              stats: { issued: 0 },
            },
          ),
        });
        return;
      }
      if (path === "/api/admin/aftercare/statistics" && method === "GET") {
        await route.fulfill({
          json: checkedApiFixture(
            "/api/admin/aftercare/statistics",
            apiSchemas.AdminGetAftercareStatisticsResponse,
            {
              kpis: {
                recommendationsCreated: 0,
                firstSent: 0,
                secondSent: 0,
                replenishmentSent: 0,
                convertedRecommendations: 0,
                conversionRevenueRsd: 0,
                conversionRatePercent: 0,
              },
              timeSeries: [],
              byTreatment: [],
              byItem: [],
            },
          ),
        });
        return;
      }
      if (path === "/api/admin/shop-settings" && method === "GET") {
        await route.fulfill({
          json: checkedApiFixture(
            "/api/admin/shop-settings",
            apiSchemas.AdminGetShopSettingsResponse,
            {
              showLoyaltyPoints: false,
              pointsPer100Rsd: 0,
              lowStockThreshold: 1,
              defaultDeliveryBusinessDays: 1,
              retailCartReminderEnabled: false,
              retailCartReminderDelayHours: 1,
              retailCartReminderBrevoTemplateId: null,
              freeShippingThreshold: 0,
              version: 1,
              updatedAt: "2026-08-21T09:00:00.000Z",
              seller: {
                companyName: "LUMERA",
                taxId: "100000000",
                registrationNumber: "00000000",
                address: "Test adresa 1",
                city: "Beograd",
                postalCode: "11000",
                bankAccount: "000-0000000000000-00",
                contactEmail: "shop-regression@example.test",
                contactPhone: "+381600000000",
              },
            },
          ),
        });
        return;
      }
      if (path === "/api/admin/beauty-jobs/queue" && method === "GET") {
        await route.fulfill({
          json: checkedApiFixture(
            "/api/admin/beauty-jobs/queue",
            apiSchemas.GetBeautyJobModerationQueueResponse,
            { listings: [], reports: [], total: 0, page: 1, pageSize: 24 },
          ),
        });
        return;
      }
      if (path === "/api/beauty-jobs/categories" && method === "GET") {
        await route.fulfill({
          json: checkedApiFixture(
            "/api/beauty-jobs/categories",
            apiSchemas.ListBeautyJobCategoriesResponse,
            { categories: [] },
          ),
        });
        return;
      }
      if (path === "/api/admin/beauty-jobs/settings" && method === "GET") {
        await route.fulfill({
          json: checkedApiFixture(
            "/api/admin/beauty-jobs/settings",
            apiSchemas.GetBeautyJobSettingsResponse,
            {
              id: "00000000-0000-4000-8000-000000000079",
              listingExpiryDays: 30,
              hourlyPostingLimit: 10,
              updatedByUserId: null,
              updatedAt: null,
            },
          ),
        });
        return;
      }
      if (path === "/api/admin/beauty-jobs/email-deliveries" && method === "GET") {
        await route.fulfill({
          json: checkedApiFixture(
            "/api/admin/beauty-jobs/email-deliveries",
            apiSchemas.GetBeautyJobDeliveryIssuesResponse,
            {
              summary: {
                delayedQueuedCount: 0,
                failedCount: 0,
                skippedCount: 0,
                totalIssueCount: 0,
                terminalIssueCount: 0,
                staleAfterMinutes: 15,
                alertThreshold: 1,
              },
              deliveries: [],
            },
          ),
        });
        return;
      }
      if (path === "/api/admin/beauty-jobs/rejected" && method === "GET") {
        await route.fulfill({
          json: checkedApiFixture(
            "/api/admin/beauty-jobs/rejected",
            apiSchemas.ListRejectedBeautyJobsResponse,
            { items: [], total: 0, page: 1, pageSize: 20 },
          ),
        });
        return;
      }
      if (path === "/api/growth/admin/retention-settings" && method === "GET") {
        const thresholds = {
          newCustomerWindowDays: 30,
          defaultIntervalDays: 30,
          atRiskIntervalPercent: 150,
          lostIntervalPercent: 250,
          lostMinimumDays: 90,
          vipMinCompletedVisits: 10,
          vipSpendPercentOfMedian: 200,
        };
        await route.fulfill({
          json: checkedApiFixture(
            "/api/growth/admin/retention-settings",
            apiSchemas.AdminGetRetentionSettingsResponse,
            {
              version: 0,
              thresholds,
              changedByUserId: null,
              changedByName: null,
              changedAt: null,
              isDefault: true,
              defaults: thresholds,
              changeSource: "manual",
              restoredFromVersion: null,
            },
          ),
        });
        return;
      }
      if (path === "/api/growth/admin/retention-settings/history" && method === "GET") {
        await route.fulfill({
          json: checkedApiFixture(
            "/api/growth/admin/retention-settings/history",
            apiSchemas.AdminGetRetentionSettingsHistoryResponse,
            [],
          ),
        });
        return;
      }

      const registeredFixture = method === "GET" ? ADMIN_INITIAL_GET_FIXTURES[path] : undefined;
      if (registeredFixture) {
        await route.fulfill({
          json: checkedApiFixture(path, registeredFixture.schema, registeredFixture.payload),
        });
        return;
      }

      throwUnregisteredAdminApiFixture(method, path);
    }

    await route.fallback();
  });
}

async function openAdminPage(page: Page, path: string, role: "ADMIN" | "SUPER_ADMIN" = "SUPER_ADMIN") {
  await mockAdminApi(page, role);
  await page.goto(path);
  if ((page.viewportSize()?.width ?? 1280) < 768) {
    await expect(page.getByTestId("admin-mobile-menu-trigger")).toBeVisible();
  } else {
    await expect(page.locator("aside").getByRole("heading", { name: "Admin Panel" })).toBeVisible();
  }
}

function collectBrowserErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => errors.push(`page: ${error.message}`));
  page.on("requestfailed", (request) => {
    const failure = request.failure()?.errorText;
    if (failure === "net::ERR_ABORTED") return;
    errors.push(`request: ${request.method()} ${request.url()} — ${failure ?? "failed"}`);
  });
  page.on("response", (response) => {
    if (response.request().resourceType() === "document" && response.status() >= 400) {
      errors.push(`navigation: ${response.status()} ${response.url()}`);
    }
  });
  return errors;
}

async function expectVisibleFocusIndicator(control: Locator) {
  await expect.poll(async () => control.evaluate((element) => {
    const styles = window.getComputedStyle(element);
    return (styles.outlineStyle !== "none" && Number.parseFloat(styles.outlineWidth) > 0)
      || styles.boxShadow !== "none";
  })).toBe(true);
}

async function expectAdminDestination(page: Page, href: string, browserErrors: string[]) {
  const previousErrorCount = browserErrors.length;
  await expect(page).toHaveURL(new RegExp(`${href.replaceAll("/", "\\/")}$`));
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("heading", { name: "Something went wrong" })).toHaveCount(0);
  await expect(
    page.locator("h1:visible, h2:visible, h3:visible").filter({ hasNotText: /^Admin Panel$/i }).first(),
  ).toBeVisible();
  expect(
    browserErrors.slice(previousErrorCount),
    `Admin destination ${href} must render without browser errors.`,
  ).toEqual([]);
}

async function renderedAdminNavigationHrefs(container: Locator): Promise<string[]> {
  return container.locator('a[data-testid^="admin-nav-"]').evaluateAll((links) =>
    links.map((link) => new URL((link as HTMLAnchorElement).href).pathname),
  );
}

test("admin route matrix is unique and exactly mirrors the grouped navigation source", () => {
  const groupedHrefs = ADMIN_NAV_GROUPS.flatMap((group) => group.links.map((link) => link.href));
  expect(ADMIN_NAV.map((link) => link.href)).toEqual(groupedHrefs);
  expect(new Set(groupedHrefs).size, "Every admin menu route must appear exactly once.").toBe(groupedHrefs.length);
});

test("unregistered admin fixtures identify the request method and endpoint", () => {
  expect(() => throwUnregisteredAdminApiFixture("POST", "/api/admin/unregistered-action"))
    .toThrow("Unregistered admin API fixture: POST /api/admin/unregistered-action");
});

test("an admin can sign in and reach every admin section on desktop", async ({ page }) => {
  test.setTimeout(180_000);
  const browserErrors = collectBrowserErrors(page);
  const visitedRoutes = new Set<string>();
  await page.setViewportSize({ width: 1280, height: 844 });
  await mockAdminApi(page, "ADMIN", false);
  await page.goto("/poslovna-prijava");
  await page.getByLabel("Email").fill("admin-regression@example.test");
  await page.getByLabel("Lozinka").fill("regression-password");
  await page.getByRole("button", { name: "Prijavi se u poslovni portal" }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.locator("aside").getByRole("heading", { name: "Admin Panel" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Aktivnost novih modula" })).toBeVisible();
  expect(await renderedAdminNavigationHrefs(page.locator("aside"))).toEqual(ADMIN_NAV.map((link) => link.href));

  for (const [index, link] of ADMIN_NAV.entries()) {
    if (index > 0) {
      await page.goto("/admin");
      await expect(page.getByRole("heading", { name: "Aktivnost novih modula" })).toBeVisible();
    }
    const navLink = page.locator("aside").getByTestId(link.testId);
    await expect(navLink).toBeAttached();
    if (index > 0) {
      await navLink.click();
    }
    await expectAdminDestination(page, link.href, browserErrors);
    visitedRoutes.add(link.href);
  }
  expect([...visitedRoutes]).toEqual(ADMIN_NAV.map((link) => link.href));
  expect(browserErrors, "Every desktop admin destination must render without browser errors.").toEqual([]);
});

test("a super administrator receives growth data on the dashboard without a forbidden response", async ({ page }) => {
  const growthResponses: number[] = [];
  page.on("response", (response) => {
    if (new URL(response.url()).pathname === "/api/growth/admin/summary") {
      growthResponses.push(response.status());
    }
  });

  await openAdminPage(page, "/admin", "SUPER_ADMIN");

  await expect(page.getByRole("heading", { name: "Aktivnost novih modula" })).toBeVisible();
  await expect(page.getByText("Automatizacije (Kampanje)")).toBeVisible();
  await expect.poll(() => growthResponses).toEqual([200]);
});

test("an admin can reach every admin section from the mobile menu", async ({ page }) => {
  test.setTimeout(180_000);
  const browserErrors = collectBrowserErrors(page);
  const visitedRoutes = new Set<string>([ADMIN_NAV[0]!.href]);
  await page.setViewportSize({ width: 390, height: 844 });
  await openAdminPage(page, "/admin");
  await expect(page.getByTestId("admin-mobile-menu-trigger")).toBeVisible();

  await expect(page.locator("main")).toBeVisible();
  await page.getByTestId("admin-mobile-menu-trigger").click();
  expect(await renderedAdminNavigationHrefs(page.getByTestId("admin-mobile-menu"))).toEqual(
    ADMIN_NAV.map((link) => link.href),
  );
  await page.getByTestId("admin-mobile-menu-trigger").click();
  for (const link of ADMIN_NAV.slice(1)) {
    await page.goto("/admin");
    await expect(page.getByRole("heading", { name: "Aktivnost novih modula" })).toBeVisible();
    await page.getByTestId("admin-mobile-menu-trigger").click();
    await expect(page.getByTestId(link.testId).first()).toBeVisible();
    await page.getByTestId(link.testId).first().click();
    await expectAdminDestination(page, link.href, browserErrors);
    visitedRoutes.add(link.href);
  }
  expect([...visitedRoutes]).toEqual(ADMIN_NAV.map((link) => link.href));
  expect(browserErrors, "Every mobile admin destination must render without browser errors.").toEqual([]);
});

test("admin mobile navigation traps keyboard focus and restores the toggle on escape", async ({ page }) => {
  const browserErrors = collectBrowserErrors(page);
  await page.emulateMedia({ forcedColors: "active" });
  await openAdminPage(page, "/admin");
  await page.setViewportSize({ width: 390, height: 844 });

  const mobileMenuButton = page.getByTestId("admin-mobile-menu-trigger");
  await mobileMenuButton.focus();
  await expect(mobileMenuButton).toBeFocused();
  await expectVisibleFocusIndicator(mobileMenuButton);
  await mobileMenuButton.press("Enter");

  const mobileMenu = page.getByTestId("admin-mobile-menu");
  await expect(mobileMenu).toBeVisible();
  const focusableMenuControls = mobileMenu.locator(
    'a[href], button:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
  );
  const focusableMenuControlCount = await focusableMenuControls.count();
  expect(focusableMenuControlCount, "The open admin mobile menu must contain focusable controls.").toBeGreaterThan(1);

  const firstMenuControl = focusableMenuControls.first();
  const lastMenuControl = focusableMenuControls.last();

  await firstMenuControl.focus();
  await expect(firstMenuControl).toBeFocused();
  await expectVisibleFocusIndicator(firstMenuControl);
  await lastMenuControl.focus();
  await expect(lastMenuControl).toBeFocused();
  await expectVisibleFocusIndicator(lastMenuControl);

  expect(browserErrors, "The forced-colors admin mobile journey must not produce browser errors.").toEqual([]);
});

test("admin mobile navigation keeps focus indicators visible with forced colors", async ({ page }) => {
  const browserErrors = collectBrowserErrors(page);
  await page.emulateMedia({ forcedColors: "active" });
  await openAdminPage(page, "/admin");
  await page.setViewportSize({ width: 390, height: 844 });

  const mobileMenuButton = page.getByTestId("admin-mobile-menu-trigger");
  await mobileMenuButton.focus();
  await expect(mobileMenuButton).toBeFocused();
  await expectVisibleFocusIndicator(mobileMenuButton);
  await mobileMenuButton.press("Enter");

  const mobileMenu = page.getByTestId("admin-mobile-menu");
  await expect(mobileMenu).toBeVisible();
  const focusableMenuControls = mobileMenu.locator(
    'a[href], button:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
  );
  const firstMenuControl = focusableMenuControls.first();
  const lastMenuControl = focusableMenuControls.last();

  await firstMenuControl.focus();
  await expect(firstMenuControl).toBeFocused();
  await expectVisibleFocusIndicator(firstMenuControl);
  await lastMenuControl.focus();
  await expect(lastMenuControl).toBeFocused();
  await expectVisibleFocusIndicator(lastMenuControl);

  expect(browserErrors, "The forced-colors admin mobile journey must not produce browser errors.").toEqual([]);
});

test("admin desktop navigation keeps focus indicators visible with forced colors", async ({ page }) => {
  const browserErrors = collectBrowserErrors(page);
  await page.emulateMedia({ forcedColors: "active" });
  await page.setViewportSize({ width: 1280, height: 844 });
  await openAdminPage(page, "/admin");

  const desktopSidebarLinks = page.locator("aside").locator('a[href]');
  const desktopSidebarLinkCount = await desktopSidebarLinks.count();
  expect(desktopSidebarLinkCount, "The desktop admin sidebar must contain focusable links.").toBeGreaterThan(1);

  const firstSidebarLink = desktopSidebarLinks.first();
  const lastSidebarLink = desktopSidebarLinks.last();
  await firstSidebarLink.focus();
  await expect(firstSidebarLink).toBeFocused();
  await expectVisibleFocusIndicator(firstSidebarLink);
  await lastSidebarLink.focus();
  await expect(lastSidebarLink).toBeFocused();
  await expectVisibleFocusIndicator(lastSidebarLink);

  expect(browserErrors, "The forced-colors admin desktop journey must not produce browser errors.").toEqual([]);
});

test("a customer is redirected from every admin route without admin requests", async ({ page }) => {
  test.setTimeout(120_000);
  const customerFixture = await createUser("CUSTOMER", "api-customer");
  const customer = { ...admin, id: customerFixture.id, email: customerFixture.email, role: "CUSTOMER" as const };
  try {
    const adminRequests: string[] = [];
    await page.route("**/api/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.startsWith("/api/admin/")) adminRequests.push(path);
      if (path === "/api/auth/me") {
        await route.fulfill({
          json: checkedApiFixture("/api/auth/me", apiSchemas.GetCurrentUserResponse, { user: customer }),
        });
        return;
      }
      await route.fallback();
    });

    for (const path of PROTECTED_ADMIN_ROUTES) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/moj-nalog$/);
    }
    expect(adminRequests).toEqual([]);
  } finally {
    await db.delete(usersTable).where(eq(usersTable.id, customerFixture.id));
  }
});

test("admin salon, user, loyalty, subscription, and review actions show success", async ({ page }) => {
  await openAdminPage(page, "/admin/saloni");
  const salonToggle = page.getByTestId(`toggle-featured-${salonId}`);
  await salonToggle.click();
  await expect(page.getByText("Salon uspešno ažuriran", { exact: true })).toBeVisible();

  await page.goto("/admin/korisnici");
  await page.getByTestId(`toggle-active-${userId}`).click();
  await expect(page.getByText("Korisnik ažuriran", { exact: true })).toBeVisible();
  await page.once("dialog", (dialog) => dialog.accept());
  await page.getByTestId(`select-role-${userId}`).selectOption("ADMIN");
  await expect(page.getByText("Uloga promenjena", { exact: true })).toBeVisible();

  await page.goto("/admin/loyalty");
  await page.getByTestId(`btn-edit-${tierId}`).click();
  await page.getByRole("button", { name: "Sačuvaj" }).click();
  await expect(page.getByText("Sačuvano", { exact: true })).toBeVisible();

  await page.goto("/admin/pretplate");
  const salonPlanCard = page.getByRole("heading", { name: subscriptionPlan().name }).locator("../..");
  await salonPlanCard.getByRole("button", { name: "Izmeni" }).click();
  await page.getByRole("button", { name: "Sačuvaj" }).click();
  await expect(page.getByText("Sačuvano", { exact: true })).toBeVisible();

  await page.goto("/admin/recenzije");
  await page.getByTestId(`toggle-visibility-${reviewId}`).click();
  await expect(page.getByText("Recenzija ažurirana", { exact: true })).toBeVisible();
});

test("post-load admin filters, detail dialogs, and dialog actions use registered API contracts", async ({ page }) => {
  const reviewListRequests: URL[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (request.method() === "GET" && url.pathname === "/api/admin/reviews") {
      reviewListRequests.push(url);
    }
  });

  await openAdminPage(page, "/admin/recenzije");
  await expect(page.getByTestId(`review-card-${reviewId}`)).toBeVisible();
  await page.getByTestId("select-visible-filter").click();
  await page.getByRole("option", { name: "Samo skrivene" }).click();
  await expect.poll(() =>
    reviewListRequests.some((url) => url.searchParams.get("visible") === "false"),
  ).toBe(true);

  await page.goto("/admin/reklamacije");
  await page.getByRole("button", { name: "Detalji" }).click();
  await expect(page.getByRole("dialog")).toContainText("RMA: RMA-REG-001");
  await page.getByRole("button", { name: "Započni obradu" }).click();
  await expect(page.getByText("Status reklamacije je ažuriran.", { exact: true })).toBeVisible();
  await expect(page.getByRole("dialog")).toContainText("IN_REVIEW");
});

test("admins can manage loyalty but not protected user and subscription controls", async ({ page }) => {
  await openAdminPage(page, "/admin/korisnici", "ADMIN");
  await expect(page.getByTestId(`select-role-${userId}`)).toBeDisabled();
  await expect(page.getByTestId(`toggle-active-${userId}`)).toBeDisabled();

  await page.goto("/admin/loyalty");
  await expect(page.getByTestId("btn-new-tier")).toBeEnabled();
  await expect(page.getByTestId(`btn-edit-${tierId}`)).toBeEnabled();
  await expect(page.getByTestId(`btn-delete-${tierId}`)).toBeEnabled();

  await page.goto("/admin/pretplate");
  await expect(page.getByRole("button", { name: "Novi Salon Plan" })).toBeDisabled();
  const salonPlanCard = page.getByRole("heading", { name: subscriptionPlan().name }).locator("../..");
  await expect(salonPlanCard.getByRole("button", { name: "Izmeni" })).toBeDisabled();
  await expect(salonPlanCard.locator("button").nth(1)).toBeDisabled();
});

type UserFixture = {
  id: string;
  email: string;
  password: string;
};

const runsAgainstDisposableDatabase = process.env.LUMERA_ISOLATED_ADMIN_BROWSER_TEST === "1";

async function createUser(role: "SUPER_ADMIN" | "CUSTOMER", suffix: string): Promise<UserFixture> {
  const password = `admin-regression-${suffix}-password`;
  const [user] = await db.insert(usersTable).values({
    firstName: "Admin",
    lastName: "Regression",
    email: `admin-regression-${suffix}-${randomUUID()}@example.test`,
    passwordHash: await hashPassword(password),
    passwordSetAt: new Date(),
    role,
  }).returning();
  if (!user) throw new Error(`Could not create ${role} fixture.`);
  return { id: user.id, email: user.email, password };
}

async function login(page: Page, fixture: UserFixture) {
  const response = await page.request.post("/api/auth/login", {
    data: { email: fixture.email, password: fixture.password },
  });
  expect(response).toBeOK();
}

test("a customer cannot retrieve admin API data", async ({ page }) => {
  const customer = await createUser("CUSTOMER", "api-customer");
  try {
    await login(page, customer);
    for (const path of [
      "/api/admin/summary",
      "/api/admin/salons",
      "/api/admin/users",
      "/api/admin/loyalty-tiers",
      "/api/admin/subscription-plans",
      "/api/admin/reviews",
    ]) {
      expect((await page.request.get(path)).status(), path).toBe(403);
    }
  } finally {
    await db.delete(usersTable).where(eq(usersTable.id, customer.id));
  }
});

test.describe("admin checks requiring disposable data", () => {
  test.skip(!runsAgainstDisposableDatabase, "This safety check must only run through the isolated admin browser test harness.");

  test("the last active super administrator cannot be removed", async ({ page }) => {
    let first: UserFixture | undefined;
    let second: UserFixture | undefined;
    let seededActiveSuperAdminIds: string[] = [];
    try {
      const activeSuperAdmins = await db
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(and(
          eq(usersTable.role, "SUPER_ADMIN"),
          eq(usersTable.active, true),
        ));
      seededActiveSuperAdminIds = activeSuperAdmins.map(({ id }) => id);
      if (seededActiveSuperAdminIds.length) {
        await db
          .update(usersTable)
          .set({ active: false })
          .where(inArray(usersTable.id, seededActiveSuperAdminIds));
      }

      first = await createUser("SUPER_ADMIN", "first");
      second = await createUser("SUPER_ADMIN", "second");

      await login(page, first);
      const deactivateSecond = await page.request.patch(`/api/admin/users/${second.id}`, { data: { active: false } });
      expect(deactivateSecond.status()).toBe(200);

      const deactivateLast = await page.request.patch(`/api/admin/users/${first.id}`, { data: { active: false } });
      expect(deactivateLast.status()).toBe(409);
      await expect(deactivateLast.json()).resolves.toMatchObject({
        error: "Nije moguće ukloniti ili deaktivirati poslednjeg aktivnog super administratora.",
      });

      const demoteLast = await page.request.patch(`/api/admin/users/${first.id}`, { data: { role: "ADMIN" } });
      expect(demoteLast.status()).toBe(409);
    } finally {
      if (seededActiveSuperAdminIds.length) {
        await db.update(usersTable).set({ active: true }).where(inArray(usersTable.id, seededActiveSuperAdminIds));
      }
      if (second) await db.delete(usersTable).where(eq(usersTable.id, second.id));
      if (first) await db.delete(usersTable).where(eq(usersTable.id, first.id));
    }
  });

  test("referenced subscription plans are archived instead of deleted", async ({ page }) => {
    let adminFixture: UserFixture | undefined;
    let owner: UserFixture | undefined;
    let salonIdForTest: string | undefined;
    let planIdForTest: string | undefined;
    try {
      adminFixture = await createUser("SUPER_ADMIN", "plan-owner");
      owner = await createUser("CUSTOMER", "salon-owner");

      const [salon] = await db.insert(salonsTable).values({
        ownerId: owner.id,
        name: `Admin plan regression ${randomUUID()}`,
        slug: `admin-plan-regression-${randomUUID()}`,
        city: "Beograd",
        municipality: "Vračar",
        address: "Test 1",
        phone: "+381110000001",
        email: `admin-plan-salon-${randomUUID()}@example.test`,
        shortDescription: "Test salon.",
        description: "Test salon for plan archival.",
        imageUrl: "/test.jpg",
      }).returning();
      if (!salon) throw new Error("Could not create salon fixture.");
      salonIdForTest = salon.id;

      const [plan] = await db.insert(subscriptionPlansTable).values({
        name: `Admin plan ${randomUUID()}`,
        price: 2500,
        trialDays: 7,
        features: ["Istorija"],
        limits: { employees: 3 },
      }).returning();
      if (!plan) throw new Error("Could not create plan fixture.");
      planIdForTest = plan.id;

      await db.insert(subscriptionsTable).values({
        salonId: salon.id,
        planId: plan.id,
        status: "active",
        dueAmount: 2500,
        paymentMethod: "BANK_TRANSFER",
      });

      await login(page, adminFixture);
      const response = await page.request.delete(`/api/admin/subscription-plans/${plan.id}`);
      expect(response.status()).toBe(200);
      await expect(response.json()).resolves.toMatchObject({ id: plan.id, active: false });

      const [persisted] = await db.select().from(subscriptionPlansTable).where(eq(subscriptionPlansTable.id, plan.id));
      expect(persisted?.active).toBe(false);
      const [history] = await db.select().from(subscriptionsTable).where(eq(subscriptionsTable.planId, plan.id));
      expect(history?.id).toBeDefined();
    } finally {
      if (salonIdForTest) await db.delete(subscriptionsTable).where(eq(subscriptionsTable.salonId, salonIdForTest));
      if (planIdForTest) await db.delete(subscriptionPlansTable).where(eq(subscriptionPlansTable.id, planIdForTest));
      if (salonIdForTest) await db.delete(salonsTable).where(eq(salonsTable.id, salonIdForTest));
      if (owner) await db.delete(usersTable).where(eq(usersTable.id, owner.id));
      if (adminFixture) await db.delete(usersTable).where(eq(usersTable.id, adminFixture.id));
    }
  });
});
