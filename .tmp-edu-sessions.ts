import { db, usersTable } from './lib/db/src/index.ts';
import { createSession } from './artifacts/api-server/src/lib/auth.ts';
import { eq } from 'drizzle-orm';
(async () => {
  const marker='edu-grace-978a20b2-a09f-41b1-a8ba-2e78ef72e27f';
  const owner = await db.select({id: usersTable.id}).from(usersTable).where(eq(usersTable.email, `${marker}@example.invalid`)).limit(1);
  const admin = await db.select({id: usersTable.id}).from(usersTable).where(eq(usersTable.email, `${marker}-admin@example.invalid`)).limit(1);
  if (!owner[0] || !admin[0]) throw new Error('marker users missing');
  const ownerToken = await createSession(owner[0].id);
  const adminToken = await createSession(admin[0].id);
  console.log(JSON.stringify({ ownerId: owner[0].id, adminId: admin[0].id, ownerToken, adminToken }, null, 2));
})().catch((err)=>{ console.error(err); process.exit(1); });
