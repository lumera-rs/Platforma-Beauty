import { asc, eq } from "drizzle-orm";
import {
  appointmentsTable,
  courseCategoriesTable,
  courseEnrollmentsTable,
  courseLessonsTable,
  courseModulesTable,
  courseSessionsTable,
  coursesTable,
  db,
  educationCentersTable,
  employeesTable,
  lessonProgressTable,
  loyaltyTiersTable,
  orderItemsTable,
  ordersTable,
  productCategoriesTable,
  productsTable,
  salonHoursTable,
  salonLoyaltyStatusesTable,
  salonsTable,
  serviceCategoriesTable,
  servicesTable,
  subscriptionPlansTable,
  subscriptionsTable,
  usersTable,
} from "@workspace/db";
import { hashPassword } from "./auth";

let seedPromise: Promise<void> | undefined;

const salonNames = [
  ["Atelier Mimoza", "atelier-mimoza", "Beograd", "Vračar"],
  ["Sfera Wellness", "sfera-wellness", "Novi Sad", "Stari grad"],
  ["Masažni Studio Niva", "masazni-studio-niva", "Niš", "Medijana"],
  ["Lotos Rituals", "lotos-rituals", "Beograd", "Zemun"],
  ["Oaza Telo & Um", "oaza-telo-um", "Kragujevac", "Aerodrom"],
  ["Studio Lumen", "studio-lumen", "Novi Sad", "Liman"],
  ["Bela Kuća Spa", "bela-kuca-spa", "Subotica", "Centar"],
  ["Kinetika", "kinetika", "Beograd", "Novi Beograd"],
  ["Studio Svilena", "studio-svilena", "Čačak", "Centar"],
  ["Vreme za Sebe", "vreme-za-sebe", "Pančevo", "Tesla"],
] as const;

const categories = [
  ["Masaža", "masaza"],
  ["Maderoterapija", "maderoterapija"],
  ["Lice", "lice"],
  ["Telo", "telo"],
  ["Depilacija", "depilacija"],
  ["Nokti", "nokti"],
  ["Kosa", "kosa"],
  ["Spa", "spa"],
  ["Wellness", "wellness"],
  ["Obrve i trepavice", "obrve-trepavice"],
] as const;

export async function ensureDemoData(): Promise<void> {
  if (!seedPromise) seedPromise = seed();
  return seedPromise;
}

async function seed(): Promise<void> {
  const [existing] = await db.select({ id: usersTable.id }).from(usersTable).limit(1);
  if (existing) {
    await seedEducationContent();
    return;
  }

  const passwordHash = await hashPassword("LumeraDemo2026!");
  const demoUsers = await db.insert(usersTable).values([
    { firstName: "Milica", lastName: "Jovanović", email: "admin@lumera.local", passwordHash, role: "SUPER_ADMIN" },
    { firstName: "Ana", lastName: "Petrović", email: "salon@lumera.local", passwordHash, role: "SALON_OWNER" },
    { firstName: "Jelena", lastName: "Marković", email: "edukacija@lumera.local", passwordHash, role: "EDUCATION_CENTER_OWNER" },
    { firstName: "Teodora", lastName: "Nikolić", email: "kupac@lumera.local", passwordHash, role: "CUSTOMER" },
    { firstName: "Maja", lastName: "Milošević", email: "zaposleni@lumera.local", passwordHash, role: "SALON_EMPLOYEE" },
    ...Array.from({ length: 30 }, (_, i) => ({
      firstName: ["Katarina", "Marija", "Sofija", "Lana", "Una"][i % 5]!,
      lastName: ["Ilić", "Kovačević", "Simić", "Pavlović", "Đorđević"][i % 5]!,
      email: `kupac${i + 1}@lumera.local`,
      passwordHash,
      role: "CUSTOMER" as const,
    })),
  ]).returning();

  const owner = demoUsers[1]!;
  const customer = demoUsers[3]!;
  const employeeLearner = demoUsers[4]!;
  const categoryRows = await db.insert(serviceCategoriesTable).values(
    categories.map(([name, slug]) => ({ name, slug, description: `Pažljivo izabrane ${name.toLowerCase()} usluge za svakodnevnu negu.` })),
  ).returning();

  const salons = await db.insert(salonsTable).values(
    salonNames.map(([name, slug, city, municipality], index) => ({
      ownerId: owner.id,
      name,
      slug,
      city,
      municipality,
      address: `${["Njegoševa 18", "Bulevar oslobođenja 82", "Generala Milojka Lešjanina 14", "Glavna 31"][index % 4]}, ${city}`,
      phone: `+381 6${index} 245 ${100 + index}`,
      email: `kontakt${index + 1}@lumera.local`,
      shortDescription: `Mesto za mirnu, stručnu negu i rituale koji vraćaju energiju.`,
      description: `${name} je pažljivo osmišljen studio u kom se stručnost, negovan ambijent i individualni pristup sreću u svakom terminu.`,
      imageUrl: `/lumera-media/salon-${(index % 4) + 1}.jpg`,
      gallery: [`/lumera-media/salon-${(index % 4) + 1}.jpg`],
      rating: 46 + (index % 5),
      reviewCount: 18 + index * 7,
      homeService: index % 3 === 0,
      featured: index < 4,
    })),
  ).returning();

  const employeeRows = await db.insert(employeesTable).values(
    salons.flatMap((salon, salonIndex) =>
      Array.from({ length: salonIndex < 5 ? 3 : 2 }, (_, employeeIndex) => ({
        salonId: salon.id,
        name: `${["Maja", "Tamara", "Ivana", "Ksenija", "Nina"][employeeIndex]!} ${["Milošević", "Vasić", "Radović", "Stojanović", "Popović"][salonIndex % 5]!}`,
        role: employeeIndex === 0 ? "Senior terapeut" : "Beauty terapeut",
        bio: "Posvećena detaljima, udobnosti i rezultatima koji se vide i osećaju.",
        avatarUrl: "/lumera-media/therapist-1.jpg",
        specialties: [categories[(salonIndex + employeeIndex) % categories.length]![0], "Relaksacija"],
      })),
    ),
  ).returning();
  await db.update(employeesTable).set({ userId: employeeLearner.id }).where(eq(employeesTable.id, employeeRows[0]!.id));

  const serviceRows = await db.insert(servicesTable).values(
    salons.flatMap((salon, salonIndex) =>
      Array.from({ length: 4 }, (_, serviceIndex) => {
        const category = categoryRows[(salonIndex + serviceIndex) % categoryRows.length]!;
        const serviceName = [
          "Aroma ritual",
          "Dubinska masaža",
          "Maderoterapija paketi",
          "Glow tretman lica",
        ][serviceIndex]!;
        return {
          salonId: salon.id,
          categoryId: category.id,
          categoryName: category.name,
          name: `${serviceName} ${salonIndex + 1}`,
          description: "Profesionalno prilagođen tretman sa jasnim koracima i prijatnim rezultatom.",
          durationMinutes: 45 + serviceIndex * 15,
          price: 2400 + salonIndex * 180 + serviceIndex * 600,
          promoPrice: serviceIndex === 0 ? 2200 + salonIndex * 180 : null,
          imageUrl: "/lumera-media/product-1.jpg",
          active: true,
        };
      }),
    ),
  ).returning();

  await db.insert(salonHoursTable).values(salons.flatMap((salon) =>
    Array.from({ length: 6 }, (_, weekday) => ({
      salonId: salon.id,
      weekday: weekday + 1,
      openTime: "09:00",
      closeTime: "20:00",
      closed: false,
    })),
  ));

  await db.insert(appointmentsTable).values(
    Array.from({ length: 20 }, (_, index) => {
      const salon = salons[index % salons.length]!;
      const service = serviceRows.find((item) => item.salonId === salon.id)!;
      const employee = employeeRows.find((item) => item.salonId === salon.id)!;
      const day = String(10 + (index % 15)).padStart(2, "0");
      return {
        salonId: salon.id,
        customerId: demoUsers[4 + (index % 20)]!.id,
        employeeId: employee.id,
        serviceId: service.id,
        date: `2026-08-${day}`,
        startTime: `${String(9 + (index % 8)).padStart(2, "0")}:00`,
        endTime: `${String(10 + (index % 8)).padStart(2, "0")}:00`,
        durationMinutes: service.durationMinutes,
        price: service.promoPrice ?? service.price,
        status: index % 5 === 0 ? "completed" as const : "confirmed" as const,
        notes: index % 4 === 0 ? "Želi tišu sobu ako je dostupna." : null,
      };
    }),
  );

  const productCategoryRows = await db.insert(productCategoriesTable).values([
    { name: "Masažna ulja", slug: "masazna-ulja" },
    { name: "Oprema", slug: "oprema" },
    { name: "Potrošni materijal", slug: "potrosni-materijal" },
    { name: "Kozmetika", slug: "kozmetika" },
  ]).returning();
  const products = await db.insert(productsTable).values(
    Array.from({ length: 12 }, (_, index) => ({
      categoryId: productCategoryRows[index % productCategoryRows.length]!.id,
      categoryName: productCategoryRows[index % productCategoryRows.length]!.name,
      name: ["Arnika masažno ulje", "Set drvenih rolera", "Profesionalni čaršav", "Vitamin C serum"][index % 4]! + ` ${index + 1}`,
      description: "Profesionalna formula i pouzdan kvalitet za svakodnevni rad u salonu.",
      imageUrl: "/lumera-media/product-1.jpg",
      price: 890 + index * 360,
      discountPrice: index % 3 === 0 ? 790 + index * 300 : null,
      stock: 12 + index * 3,
      sku: `LUM-${String(index + 1).padStart(4, "0")}`,
      unit: index % 2 === 0 ? "kom" : "500 ml",
    })),
  ).returning();

  const tiers = await db.insert(loyaltyTiersTable).values([
    { name: "START", sortOrder: 1, spendThreshold: 0, subscriptionDiscountPercent: 0, productDiscountPercent: 0, benefits: ["Osnovna podrška", "Pristup B2B shopu"] },
    { name: "PRO", sortOrder: 2, spendThreshold: 25000, subscriptionDiscountPercent: 30, productDiscountPercent: 5, benefits: ["5% popusta na proizvode", "30% niža pretplata"] },
    { name: "PREMIUM", sortOrder: 3, spendThreshold: 50000, subscriptionDiscountPercent: 100, productDiscountPercent: 10, freeSubscription: true, premiumListing: true, benefits: ["Besplatna pretplata", "Premium pozicija", "10% popusta"] },
    { name: "ELITE", sortOrder: 4, spendThreshold: 100000, subscriptionDiscountPercent: 100, productDiscountPercent: 15, freeSubscription: true, premiumListing: true, freeShipping: true, benefits: ["Besplatna pretplata", "Besplatna dostava", "15% popusta", "Prioritetna podrška"] },
  ]).returning();
  await db.insert(salonLoyaltyStatusesTable).values(salons.map((salon, index) => ({
    salonId: salon.id,
    tierId: tiers[index % tiers.length]!.id,
    currentPeriodSpend: 12500 + index * 5500,
  })));
  const [plan] = await db.insert(subscriptionPlansTable).values({
    name: "PRO",
    price: 2490,
    trialDays: 14,
    features: ["Neograničeni termini", "CRM kupaca", "B2B shop"],
    limits: { employees: 10 },
  }).returning();
  await db.insert(subscriptionsTable).values(salons.map((salon) => ({
    salonId: salon.id,
    planId: plan!.id,
    status: "active" as const,
    dueAmount: 2490,
    paymentMethod: "BANK_TRANSFER" as const,
  })));
  const [firstOrder] = await db.insert(ordersTable).values({
    salonId: salons[0]!.id,
    status: "delivered",
    total: 42500,
    shippingName: salons[0]!.name,
    shippingAddress: salons[0]!.address,
    paymentMethod: "BANK_TRANSFER",
  }).returning();
  await db.insert(orderItemsTable).values(products.slice(0, 3).map((product, index) => ({
    orderId: firstOrder!.id,
    productId: product.id,
    productName: product.name,
    quantity: index + 1,
    price: product.discountPrice ?? product.price,
  })));

  const [courseCategory] = await db.insert(courseCategoriesTable).values({ name: "Stručne tehnike", slug: "strucne-tehnike" }).returning();
  const centers = await db.insert(educationCentersTable).values([
    { ownerId: demoUsers[2]!.id, name: "Akademija Ritual", city: "Beograd", description: "Edukacije za savremene wellness profesionalce.", imageUrl: "/lumera-media/course-1.jpg" },
    { ownerId: demoUsers[2]!.id, name: "Studio Forma Edu", city: "Novi Sad", description: "Znanje kroz praksu i mentorske radionice.", imageUrl: "/lumera-media/course-1.jpg" },
    { ownerId: demoUsers[2]!.id, name: "Wellbeing Institut", city: "Niš", description: "Usavršavanje za terapeute nove generacije.", imageUrl: "/lumera-media/course-1.jpg" },
  ]).returning();
  const educationCourses = await db.insert(coursesTable).values(Array.from({ length: 8 }, (_, index) => ({
    centerId: centers[index % centers.length]!.id,
    categoryId: courseCategory!.id,
    title: ["Maderoterapija od osnova do prakse", "Manualna limfna drenaža", "Rituali nege lica", "Biznis za beauty studio"][index % 4]!,
    category: "Stručne tehnike",
    format: index % 3 === 0 ? "online" as const : "in-person" as const,
    city: index % 3 === 0 ? null : centers[index % centers.length]!.city,
    price: 6900 + index * 1700,
    duration: `${4 + index} nedelja`,
    rating: 45 + (index % 5),
    certification: true,
    imageUrl: "/lumera-media/course-1.jpg",
    description: "Praktičan program za beauty profesionalce, uz jasno strukturisane lekcije i mentorsku podršku.",
    startDate: `2026-09-${String(4 + index).padStart(2, "0")}`,
  }))).returning();
  const [salonCourse] = await db.insert(coursesTable).values({
    salonId: salons[0]!.id,
    categoryId: courseCategory!.id,
    title: "Napredni spa rituali za salon timove",
    description: "Kombinacija praktičnih protokola, saveta za tim i standarda vrhunske usluge.",
    category: "Stručne tehnike",
    format: "hybrid",
    city: salons[0]!.city,
    price: 12400,
    duration: "3 nedelje",
    rating: 48,
    certification: true,
    imageUrl: "/lumera-media/course-1.jpg",
    startDate: "2026-09-18",
  }).returning();
  const [module] = await db.insert(courseModulesTable).values({
    courseId: educationCourses[0]!.id,
    title: "Osnove i bezbedan rad",
    description: "Postavite standarde tretmana pre praktičnih vežbi.",
    sortOrder: 1,
  }).returning();
  const lessons = await db.insert(courseLessonsTable).values([
    { moduleId: module!.id, title: "Uvod u protokol", description: "Ciljevi kursa i očekivani rezultati.", content: "Prođite kroz osnovni protokol i pripremu radnog prostora.", durationMinutes: 20, sortOrder: 1 },
    { moduleId: module!.id, title: "Priprema klijenta", description: "Konsultacija, kontraindikacije i komfor.", content: "Proverite zdravstveni upitnik i pripremite individualni plan tretmana.", durationMinutes: 35, sortOrder: 2 },
  ]).returning();
  const [practiceModule] = await db.insert(courseModulesTable).values({
    courseId: educationCourses[0]!.id,
    title: "Praksa i evaluacija",
    description: "Vežba uz mentorsku listu provere.",
    sortOrder: 2,
  }).returning();
  await db.insert(courseLessonsTable).values({
    moduleId: practiceModule!.id,
    title: "Završna praktična vežba",
    description: "Sprovedite kompletan tretman prema standardu.",
    content: "Zabeležite svaki korak i ocenite rezultat uz mentorsku kontrolnu listu.",
    durationMinutes: 60,
    sortOrder: 1,
  });
  await db.insert(courseSessionsTable).values([
    { courseId: educationCourses[1]!.id, startsAt: new Date("2026-09-11T09:00:00.000Z"), endsAt: new Date("2026-09-11T16:00:00.000Z"), location: "Beograd, Vračar", capacity: 12 },
    { courseId: salonCourse!.id, startsAt: new Date("2026-09-18T10:00:00.000Z"), endsAt: new Date("2026-09-18T15:00:00.000Z"), location: salons[0]!.address, capacity: 10 },
  ]);
  const [enrollment] = await db.insert(courseEnrollmentsTable).values({
    courseId: educationCourses[0]!.id,
    userId: owner.id,
    salonId: salons[0]!.id,
    employeeId: employeeRows[0]!.id,
    purchaserId: owner.id,
    status: "active",
    paymentStatus: "paid",
    progress: 33,
    nextLesson: lessons[1]!.id,
    auditData: { source: "demo-seed" },
  }).returning();
  await db.insert(lessonProgressTable).values({ enrollmentId: enrollment!.id, lessonId: lessons[0]!.id, completedByUserId: owner.id });
  await db.insert(usersTable).values({ firstName: "Podrška", lastName: "Lumera", email: "support@lumera.local", passwordHash, role: "ADMIN" });
  void customer;
}

async function seedEducationContent(): Promise<void> {
  const [course] = await db.select().from(coursesTable).limit(1);
  if (!course) return;
  let [module] = await db.select().from(courseModulesTable).where(eq(courseModulesTable.courseId, course.id)).limit(1);
  if (!module) {
    [module] = await db.insert(courseModulesTable).values({
      courseId: course.id,
      title: "Uvod u program",
      description: "Osnovne smernice i priprema za prvi praktični rad.",
      sortOrder: 1,
    }).returning();
    await db.insert(courseLessonsTable).values([
      { moduleId: module!.id, title: "Dobrodošli", description: "Pregled ciljeva i sadržaja.", content: "Upoznajte strukturu programa i plan napretka.", durationMinutes: 15, sortOrder: 1 },
      { moduleId: module!.id, title: "Prvi koraci", description: "Priprema pre praktične vežbe.", content: "Pripremite prostor, alat i listu provere.", durationMinutes: 30, sortOrder: 2 },
    ]);
  }
  const lessons = await db.select().from(courseLessonsTable).where(eq(courseLessonsTable.moduleId, module!.id)).orderBy(asc(courseLessonsTable.sortOrder));
  const [existingSession] = await db.select({ id: courseSessionsTable.id }).from(courseSessionsTable).where(eq(courseSessionsTable.courseId, course.id)).limit(1);
  if (course.format !== "online" && !existingSession) {
    await db.insert(courseSessionsTable).values({
      courseId: course.id,
      startsAt: new Date("2026-09-24T09:00:00.000Z"),
      endsAt: new Date("2026-09-24T15:00:00.000Z"),
      location: course.city ?? "LUMERA edukativni prostor",
      capacity: 15,
    });
  }
  const [owner] = await db.select().from(usersTable).where(eq(usersTable.role, "SALON_OWNER")).limit(1);
  if (!owner) return;
  const [salon] = await db.select().from(salonsTable).where(eq(salonsTable.ownerId, owner.id)).limit(1);
  if (!salon) return;
  let [employee] = await db.select().from(employeesTable).where(eq(employeesTable.salonId, salon.id)).limit(1);
  if (employee && !employee.userId) {
    let [learner] = await db.select().from(usersTable).where(eq(usersTable.email, "zaposleni@lumera.local")).limit(1);
    if (!learner) {
      [learner] = await db.insert(usersTable).values({
        firstName: employee.name.split(" ")[0] ?? "Zaposleni",
        lastName: employee.name.split(" ").slice(1).join(" ") || "salona",
        email: "zaposleni@lumera.local",
        passwordHash: await hashPassword("LumeraDemo2026!"),
        role: "SALON_EMPLOYEE",
      }).returning();
    }
    [employee] = await db.update(employeesTable).set({ userId: learner!.id }).where(eq(employeesTable.id, employee.id)).returning();
  }
  const [existingEnrollment] = await db.select({
    id: courseEnrollmentsTable.id,
    nextLesson: courseEnrollmentsTable.nextLesson,
  }).from(courseEnrollmentsTable).where(eq(courseEnrollmentsTable.courseId, course.id)).limit(1);
  if (existingEnrollment) {
    const normalizedNextLesson = existingEnrollment.nextLesson
      ? lessons.find((lesson) => lesson.id === existingEnrollment.nextLesson || lesson.title === existingEnrollment.nextLesson)?.id ?? null
      : null;
    if (normalizedNextLesson !== existingEnrollment.nextLesson) {
      await db.update(courseEnrollmentsTable).set({ nextLesson: normalizedNextLesson, updatedAt: new Date() }).where(eq(courseEnrollmentsTable.id, existingEnrollment.id));
    }
    return;
  }
  const [enrollment] = await db.insert(courseEnrollmentsTable).values({
    courseId: course.id,
    userId: owner.id,
    salonId: salon.id,
    employeeId: employee?.id ?? null,
    purchaserId: owner.id,
    status: "active",
    paymentStatus: "paid",
    progress: lessons.length > 1 ? 50 : 0,
    nextLesson: lessons[1]?.id ?? lessons[0]?.id ?? null,
    auditData: { source: "incremental-demo-seed" },
  }).returning();
  if (lessons[0]) {
    await db.insert(lessonProgressTable).values({ enrollmentId: enrollment!.id, lessonId: lessons[0].id, completedByUserId: owner.id });
  }
}