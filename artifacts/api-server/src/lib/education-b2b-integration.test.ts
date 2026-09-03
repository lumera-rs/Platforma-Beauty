import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { eq, inArray } from "drizzle-orm";
import app from "../app";
import { createSession, hashPassword, sessionCookieName } from "./auth";
import {
  coursesTable, db, educationB2bDiscountAuditsTable, educationB2bDiscountSettingsTable,
  educationB2bDiscountTiersTable, educationB2bOrderItemsTable, educationB2bOrdersTable,
  educationCentersTable, educationFinancialAuditLogTable,
  productsTable, usersTable,
} from "@workspace/db";
import { previousBelgradeCalendarMonth } from "../routes/education-b2b-discounts";
import { buildValidOnlineEducationCourse } from "./education-test-fixtures";

const marker = `edu-b2b-it-${randomUUID()}`;
const oldSettings = await db.select().from(educationB2bDiscountSettingsTable);
const oldTiers = await db.select().from(educationB2bDiscountTiersTable);
const passwordHash = await hashPassword(marker);
const server = app.listen(0, "127.0.0.1"); await once(server, "listening");
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
const call = async (cookie: string, path: string, method = "GET", body?: unknown, headers: Record<string, string> = {}) => {
  const response = await fetch(base + path, { method, headers: { cookie, ...headers, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: response.status, body: response.status === 204 ? null : await response.json() as any };
};
let userIds: string[] = []; let centerId: string | undefined; let courseId: string | undefined; let productId: string | undefined;
try {
  const [admin, owner, salon] = await db.insert(usersTable).values([
    { firstName:"Admin",lastName:marker,email:`a-${marker}@x.test`,passwordHash,passwordSetAt:new Date(),role:"SUPER_ADMIN" },
    { firstName:"Center",lastName:marker,email:`e-${marker}@x.test`,passwordHash,passwordSetAt:new Date(),role:"EDUKATIVNI_CENTAR" },
    { firstName:"Salon",lastName:marker,email:`s-${marker}@x.test`,passwordHash,passwordSetAt:new Date(),role:"SALON_OWNER" },
  ]).returning(); userIds=[admin!.id,owner!.id,salon!.id];
  const [center]=await db.insert(educationCentersTable).values({ownerId:owner!.id,name:marker,city:"Beograd",description:marker,imageUrl:"/test.jpg"}).returning(); centerId=center!.id;
  const [course]=await db.insert(coursesTable).values(buildValidOnlineEducationCourse({centerId,title:marker,category:"Test",format:"online",price:1000,duration:"1h",imageUrl:"/test.jpg"})).returning(); courseId=course!.id;
  const [product]=await db.insert(productsTable).values({categoryName:"Test",name:marker,description:marker,imageUrl:"/test.jpg",price:1000,publicPrice:777,retailEnabled:true,stock:10,sku:marker,unit:"kom",professionalEnabled:true}).returning(); productId=product!.id;
  const period=previousBelgradeCalendarMonth(new Date());
  await db.insert(educationB2bOrdersTable).values({
    centerId, purchaserUserId:owner!.id, linesSnapshot:[], subtotalRsd:1500, discountRsd:0,
    totalRsd:1500, benefitSnapshot:{}, paymentStatus:"paid", fulfillmentStatus:"COMPLETED",
    completedAt:new Date((period.start.getTime()+period.end.getTime())/2),
  });
  const adminCookie=`${sessionCookieName}=${await createSession(admin!.id)}`, ownerCookie=`${sessionCookieName}=${await createSession(owner!.id)}`, salonCookie=`${sessionCookieName}=${await createSession(salon!.id)}`;
  const version=oldSettings[0]?.version??1;
  const replaced=await call(adminCookie,"/admin/education/b2b-discount-tiers","PUT",{expectedVersion:version,tiers:[
    {name:"Start",minSpendRsd:0,maxSpendRsd:999,discountPercent:0,sortOrder:0},
    {name:"Plus",minSpendRsd:1000,maxSpendRsd:1999,discountPercent:10,sortOrder:1},
    {name:"Pro",minSpendRsd:2000,maxSpendRsd:null,discountPercent:20,sortOrder:2},
  ]}); assert.equal(replaced.status,200); assert.equal(replaced.body.tiers.length,3);
  const benefit=await call(ownerCookie,"/education/b2b/benefit"); assert.equal(benefit.status,200); assert.equal(benefit.body.priorMonthSpendRsd,1500); assert.equal(benefit.body.discountPercent,10);
  const catalog=await call(ownerCookie,"/education/b2b/products"); assert.equal(catalog.status,200); assert.ok(catalog.body.products.some((p:any)=>p.id===productId));
  const quote=await call(ownerCookie,"/education/b2b/quote","POST",{lines:[{productId,quantity:2}]}); assert.equal(quote.status,200); assert.equal(quote.body.payableTotalRsd,1800);
  const conflictSettings=await call(adminCookie,"/admin/education/b2b-discount-tiers","PUT",{expectedVersion:replaced.body.version,tiers:[
    {name:"Start",minSpendRsd:0,maxSpendRsd:999,discountPercent:0,sortOrder:0},
    {name:"Plus",minSpendRsd:1000,maxSpendRsd:1999,discountPercent:5,sortOrder:1},
    {name:"Pro",minSpendRsd:2000,maxSpendRsd:null,discountPercent:20,sortOrder:2},
  ]}); assert.equal(conflictSettings.status,200);
  assert.equal((await call(ownerCookie,"/education/b2b/checkout","POST",{lines:[{productId,quantity:2}],expectedTotalRsd:1800},{"idempotency-key":randomUUID()})).status,409);
  const quote2=await call(ownerCookie,"/education/b2b/quote","POST",{lines:[{productId,quantity:2}]});
  const checkout=await call(ownerCookie,"/education/b2b/checkout","POST",{lines:[{productId,quantity:2}],expectedTotalRsd:quote2.body.payableTotalRsd},{"idempotency-key":randomUUID()}); assert.equal(checkout.status,201);
  assert.equal((await call(adminCookie,`/admin/education/b2b-orders/${checkout.body.id}/settle`,"POST",{confirmedAmountRsd:quote2.body.payableTotalRsd-1,reason:"Pogrešan iznos"})).status,409);
  assert.equal((await call(adminCookie,`/admin/education/b2b-orders/${checkout.body.id}/settle`,"POST",{confirmedAmountRsd:quote2.body.payableTotalRsd,reason:"Uplata potvrđena"})).status,200);
  assert.equal((await call(adminCookie,`/admin/education/b2b-orders/${checkout.body.id}/settle`,"POST",{confirmedAmountRsd:quote2.body.payableTotalRsd,reason:"Dupli pokušaj"})).status,409);
  assert.equal((await call(adminCookie,`/admin/education/b2b-orders/${checkout.body.id}/refund`,"POST",{confirmedAmountRsd:quote2.body.payableTotalRsd+1,reason:"Prevelika refundacija"})).status,409);
  const refund=await call(adminCookie,`/admin/education/b2b-orders/${checkout.body.id}/refund`,"POST",{confirmedAmountRsd:quote2.body.payableTotalRsd,reason:"Puna refundacija"});
  assert.equal(refund.status,200); assert.equal(refund.body.paymentStatus,"refunded");
  assert.equal((await db.select().from(productsTable).where(eq(productsTable.id,productId))).at(0)?.stock,8);
  const [order]=await db.select().from(educationB2bOrdersTable).where(eq(educationB2bOrdersTable.id,checkout.body.id)); assert.equal(order?.centerId,centerId); assert.equal((order?.benefitSnapshot as any).discountPercent,5);
  assert.equal((await db.select().from(educationB2bOrderItemsTable).where(eq(educationB2bOrderItemsTable.orderId,checkout.body.id))).length,1);
  assert.equal((await call(salonCookie,"/education/b2b/products")).status,403);
  assert.equal((await db.select({publicPrice:productsTable.publicPrice}).from(productsTable).where(eq(productsTable.id,productId))).at(0)?.publicPrice,777);
  console.log("education B2B integration tests passed");
} finally {
  server.close(); await once(server,"close");
  if(centerId) {
    const orders=await db.select({id:educationB2bOrdersTable.id}).from(educationB2bOrdersTable).where(eq(educationB2bOrdersTable.centerId,centerId));
    if(orders.length)await db.delete(educationB2bOrderItemsTable).where(inArray(educationB2bOrderItemsTable.orderId,orders.map(row=>row.id)));
    await db.delete(educationB2bOrdersTable).where(eq(educationB2bOrdersTable.centerId,centerId));
  }
  if(centerId) await db.delete(educationCentersTable).where(eq(educationCentersTable.id,centerId));
  if(productId) await db.delete(productsTable).where(eq(productsTable.id,productId));
  await db.delete(educationB2bDiscountAuditsTable).where(inArray(educationB2bDiscountAuditsTable.actorUserId,userIds));
  await db.delete(educationB2bDiscountTiersTable); if(oldTiers.length)await db.insert(educationB2bDiscountTiersTable).values(oldTiers);
  if(oldSettings[0])await db.update(educationB2bDiscountSettingsTable).set(oldSettings[0]).where(eq(educationB2bDiscountSettingsTable.id,true));
  if(userIds.length)await db.delete(educationFinancialAuditLogTable).where(inArray(educationFinancialAuditLogTable.actorUserId,userIds));
  if(userIds.length)await db.delete(usersTable).where(inArray(usersTable.id,userIds));
}