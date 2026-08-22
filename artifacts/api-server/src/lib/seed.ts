import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { courierServicesTable, shippingRulesTable } from "@workspace/db";
import {
  appointmentsTable,
  beautyGlossaryTable,
  courseCategoriesTable,
  courseDaysTable,
  courseEnrollmentsTable,
  courseLessonsTable,
  courseModulesTable,
  courseSessionsTable,
  coursesTable,
  db,
  educationCentersTable,
  educationCenterSubscriptionsTable,
  educationEscrowsTable,
  educationFinancialEventsTable,
  educationLedgerEntriesTable,
  educationPlatformSettingsTable,
  educationThreadsTable,
  employeeServicesTable,
  employeesTable,
  inspirationItemsTable,
  lessonProgressTable,
  loyaltyTiersTable,
  oauthIdentitiesTable,
  orderItemsTable,
  ordersTable,
  productCategoriesTable,
  productBrandsTable,
  productsTable,
  salonHoursTable,
  salonBrandsTable,
  salonCustomersTable,
  salonLoyaltyStatusesTable,
  salonsTable,
  serviceCategoriesTable,
  serviceTemplatesTable,
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

const postalCodesByCity: Record<string, string> = {
  Beograd: "11000",
  "Novi Sad": "21000",
  Niš: "18000",
  Kragujevac: "34000",
  Subotica: "24000",
  Čačak: "32000",
  Pančevo: "26000",
};

const categories = [
  ["Frizerski saloni", "frizerski-saloni"],
  ["Muški frizeri", "muski-frizeri"],
  ["Kozmetički saloni", "kozmeticki-saloni"],
  ["Depilacija", "depilacija"],
  ["Lice", "lice"],
  ["Nokti", "nokti"],
  ["Masaža", "masaza"],
  ["Telo", "telo"],
  ["Wellness", "wellness"],
  ["Lux tretmani", "lux-tretmani"],
  ["Paketi usluga", "paketi-usluga"],
  ["Ordinacije i poliklinike", "ordinacije-poliklinike"],
] as const;

const categoryFallbackImages: Record<(typeof categories)[number][0], string> = {
  "Frizerski saloni": "https://images.unsplash.com/photo-1562322140-8baeececf3df?auto=format&fit=crop&w=1200&q=85",
  "Muški frizeri": "https://images.unsplash.com/photo-1503951914875-452162b0f3f1?auto=format&fit=crop&w=1200&q=85",
  "Kozmetički saloni": "https://images.unsplash.com/photo-1487412912498-0447578fcca8?auto=format&fit=crop&w=1200&q=85",
  "Depilacija": "https://images.unsplash.com/photo-1515377905703-c4788e51af15?auto=format&fit=crop&w=1200&q=85",
  "Lice": "https://images.unsplash.com/photo-1570172619644-dfd03ed5d881?auto=format&fit=crop&w=1200&q=85",
  "Nokti": "https://images.unsplash.com/photo-1519014816548-bf5fe059798b?auto=format&fit=crop&w=1200&q=85",
  "Masaža": "https://images.unsplash.com/photo-1544161515-4ab6ce6db874?auto=format&fit=crop&w=1200&q=85",
  "Telo": "https://images.unsplash.com/photo-1512290923902-8a9f81dc236c?auto=format&fit=crop&w=1200&q=85",
  "Wellness": "https://images.unsplash.com/photo-1540555700478-4be289fbecef?auto=format&fit=crop&w=1200&q=85",
  "Lux tretmani": "https://images.unsplash.com/photo-1616394584738-fc6e612e71b9?auto=format&fit=crop&w=1200&q=85",
  "Paketi usluga": "https://images.unsplash.com/photo-1515377905703-c4788e51af15?auto=format&fit=crop&w=1200&q=85",
  "Ordinacije i poliklinike": "https://images.unsplash.com/photo-1620916566398-39f1143ab7be?auto=format&fit=crop&w=1200&q=85",
};

const massageTags = [
  "Opšta masaža", "Relax / antistres masaža", "Anticelulit masaža", "Dubinska masaža",
  "Masaža glave", "Terapeutska masaža", "Masaža biljnim jastučićima", "Refleksologija stopala",
  "Masaža za mršavljenje", "Refleksologija", "Šiacu masaža", "Masaža lica", "Thai masaža stopala",
  "Švedska masaža", "Masaža teglama", "Masaža za parove", "Holistička masaža", "Indijska masaža",
  "Ajurvedska masaža", "Masaža za trudnice", "Masaža protiv migrene", "Sportska masaža",
  "Masaža za bebe", "Dečja masaža", "Masaža šaka", "Masaža stopala", "Thai joga masaža",
  "Masaža vezivnog tkiva", "Masaža celog tela", "Masaža leđa", "Masaža ramena", "Masaža vrata",
  "Tajlandska masaža", "Reiki masaža", "Masaža vulkanskim kamenjem", "Klasična masaža",
  "Masaža u sedećem položaju", "Havajska masaža",
] as const;

type ServiceTemplateSeed = {
  name: string;
  mainCategory: string;
  subcategory: string;
  typicalDurationMinutes: number;
  priceMin: number;
  priceMax: number;
  description?: string;
};

const template = (
  name: string,
  mainCategory: string,
  subcategory: string,
  typicalDurationMinutes: number,
  priceMin: number,
  priceMax: number,
  description?: string,
): ServiceTemplateSeed => ({ name, mainCategory, subcategory, typicalDurationMinutes, priceMin, priceMax, description });

const serviceTemplateSeeds: ServiceTemplateSeed[] = [
  ...[
    ["Žensko šišanje — kratka kosa", 45, 1500, 2600], ["Žensko šišanje — srednja kosa", 50, 1800, 3200],
    ["Žensko šišanje — duga kosa", 60, 2200, 4000], ["Žensko šišanje — ekstra duga kosa", 75, 2600, 5000],
    ["Dečije šišanje — dečaci", 30, 800, 1600], ["Dečije šišanje — devojčice", 40, 1000, 2200],
    ["Feniranjem na ravno — kratka kosa", 30, 900, 1600], ["Feniranjem na ravno — srednja kosa", 40, 1000, 2000],
    ["Feniranjem na ravno — duga kosa", 50, 1200, 2500], ["Feniranjem na ravno — ekstra duga kosa", 60, 1500, 3200],
    ["Feniranjem na talase/lokne — kratka kosa", 45, 1200, 2200], ["Feniranjem na talase/lokne — srednja kosa", 55, 1500, 2800],
    ["Feniranjem na talase/lokne — duga kosa", 70, 1900, 3500], ["Feniranjem na talase/lokne — ekstra duga kosa", 85, 2400, 4500],
    ["Pranje kose", 15, 400, 900], ["Šišanje svećom (vele terapija)", 60, 2500, 5000],
    ["Svečana frizura", 75, 2500, 6000], ["Holivudski talasi", 75, 2800, 6500], ["Afro lokne", 120, 4000, 9000],
    ["Riblja kost pletenica", 35, 1200, 3000], ["Uslužno farbanje", 30, 1000, 2500],
    ["Farbanje izrastka", 90, 2800, 5500], ["Izbeljivanje/blajhanje korena", 120, 3500, 7000],
    ["Izbeljivanje cele dužine", 180, 6000, 15000], ["Preliv/toniranje", 45, 1800, 4000],
    ["Skidanje boje", 120, 4500, 12000], ["Keratinsko ispravljanje kose", 180, 7000, 18000],
    ["Botox kose", 120, 5000, 12000], ["Olaplex tretman", 60, 2000, 5000],
    ["Regeneracija oštećene kose", 45, 1600, 3500], ["Argan tretman", 45, 1600, 3500],
    ["Hidratantni tretman kose", 45, 1500, 3200], ["Nadogradnja kose — konsultacija", 30, 0, 1500],
  ].map(([name, duration, min, max]) => template(name as string, "Frizerski saloni", "Kosa i stilizovanje", duration as number, min as number, max as number)),
  ...[
    ["Feniranjem sa Kerastase negom", 60, 1800, 4000], ["Feniranjem sa Olaplex negom", 60, 2000, 4500],
    ["Farbanje cele dužine — kratka kosa", 120, 3500, 6500], ["Farbanje cele dužine — srednja kosa", 135, 4500, 8000],
    ["Farbanje cele dužine — duga kosa", 150, 5500, 10500], ["Farbanje cele dužine — ekstra duga kosa", 180, 7000, 14000],
    ["Pramenovi na foliju — srednja kosa", 150, 5500, 10000], ["Pramenovi na foliju — duga kosa", 180, 7500, 14000],
    ["Pramenovi na foliju — ekstra duga kosa", 210, 9000, 18000], ["Balayage / Ombre / Sombre", 210, 8500, 22000],
  ].map(([name, duration, min, max]) => template(name as string, "Frizerski saloni", "Boja i tehnike", duration as number, min as number, max as number)),
  template("Muško šišanje", "Muški frizeri", "Šišanje", 35, 1000, 2500),
  template("Berberin / muško brijanje", "Muški frizeri", "Brada i brijanje", 35, 1000, 2800),

  ...[
    ["Manikir", 45, 900, 1800], ["Lakiranje noktiju", 30, 600, 1200], ["Gel lak — ruke", 60, 1500, 2800],
    ["Gel lak — noge", 60, 1600, 3000], ["Nadogradnja noktiju", 120, 2800, 5500],
    ["Ojačavanje noktiju gelom", 75, 1800, 3200], ["Ojačavanje noktiju rubber bazom", 60, 1600, 2800],
    ["Ukrašavanje / dizajn noktiju", 20, 200, 1500], ["French / ombre dodatak", 20, 300, 1000],
    ["Ruski manikir", 60, 1500, 2500], ["Skidanje gela / trajnog laka", 30, 600, 1400],
    ["Estetski pedikir", 60, 1800, 3500], ["Medicinski pedikir", 75, 2500, 5000],
    ["Parafinski tretman ruku", 30, 900, 1800], ["Parafinski tretman nogu", 40, 1200, 2200],
    ["Muški manikir", 40, 1000, 2000], ["Muški pedikir", 60, 1800, 3500],
    ["Gljivice na noktima — tretman", 45, 1500, 4000],
  ].map(([name, duration, min, max]) => template(name as string, "Nokti", "Nega noktiju", duration as number, min as number, max as number)),
  ...["S", "M", "L", "XL"].flatMap((length, index) => [
    template(`Izlivanje noktiju gelom — ${length}`, "Nokti", "Gel tehnike", 90 + index * 15, 2200 + index * 500, 4000 + index * 900),
    template(`Korekcija noktiju — ${length}`, "Nokti", "Gel tehnike", 75 + index * 15, 1800 + index * 450, 3500 + index * 800),
  ]),

  ...[
    ["Higijenski / klasični tretman lica", 75, 2500, 5000], ["Hydrafacial", 60, 4500, 9000],
    ["Mikrodermoabrazija", 45, 2500, 5000], ["Ultrazvučno čišćenje lica", 60, 3000, 6000],
    ["Hemijski piling", 45, 3000, 7000], ["Mezoterapija lica bez igle", 60, 4000, 8500],
    ["Mezoterapija lica sa iglom", 60, 7000, 16000], ["Biorevitalizacija lica", 60, 9000, 20000],
    ["Hijaluronski tretman lica", 60, 8000, 18000], ["Dermapen", 60, 5000, 12000],
    ["Radiotalasni / RF lifting lica", 45, 2500, 6000], ["Tretman vitaminom C", 45, 2500, 5500],
    ["Masaža lica", 30, 1200, 3000], ["Oxi tretman kiseonikom", 60, 4000, 9000],
    ["Anti-age tretman protiv bora", 60, 3500, 8500], ["Profesionalno šminkanje — dnevno", 45, 2500, 5000],
    ["Profesionalno šminkanje — večernje", 60, 3500, 7000], ["Profesionalno šminkanje — svečano", 75, 4500, 9000],
    ["Korekcija obrva", 20, 500, 1200], ["Brow lift", 45, 1800, 3500], ["Farbanje obrva", 25, 600, 1500],
    ["Laminacija obrva", 45, 2000, 4000], ["Lash lift", 60, 2500, 5000], ["Veštačke trepavice", 120, 3500, 9000],
    ["Farbanje trepavica", 25, 700, 1800], ["Trajna šminka — konsultacija", 30, 0, 2000],
  ].map(([name, duration, min, max]) => template(name as string, "Lice", name.toString().includes("šminkanje") ? "Šminkanje" : name.toString().includes("obrva") || name.toString().includes("trepav") || name.toString().includes("Lash") ? "Obrve i trepavice" : "Nega lica", duration as number, min as number, max as number)),

  ...[
    ["Kavitacija", 45, 1800, 4000], ["Presoterapija", 45, 1800, 3500], ["RTL / radiotalasno zatezanje", 45, 2200, 5000],
    ["Anticelulit masaža", 45, 1800, 4000], ["Maderoterapija", 60, 2500, 5500], ["Rolosfera", 45, 2500, 5000],
    ["Shockwave tretman", 45, 3000, 6000], ["Termo ćebe", 45, 1600, 3000], ["Vacuslim / vakum tretman", 45, 2500, 5500],
    ["Velashape tretman", 45, 3500, 7500], ["EMS / Tesla body former", 45, 3000, 7000], ["Limfna drenaža", 60, 2500, 6000],
    ["Piling tela", 45, 1800, 4000], ["Mezoterapija tela", 60, 5000, 12000], ["Parafinsko pakovanje tela", 60, 2500, 5500],
  ].map(([name, duration, min, max]) => template(name as string, "Telo", "Oblikovanje i nega tela", duration as number, min as number, max as number)),

  ...[
    ["Brazilska depilacija", 45, 1800, 3500], ["Depilacija toplim voskom — dame: cele noge", 45, 1200, 2500],
    ["Depilacija toplim voskom — dame: prepone", 25, 700, 1600], ["Depilacija toplim voskom — dame: ruke", 25, 700, 1500],
    ["Depilacija toplim voskom — dame: pazuh", 15, 400, 900], ["Depilacija toplim voskom — dame: lice", 20, 500, 1200],
    ["Depilacija toplim voskom — muškarci: grudi i stomak", 45, 1800, 4000], ["Depilacija toplim voskom — muškarci: leđa", 45, 1800, 4000],
    ["Depilacija hladnim voskom — cele noge", 50, 1200, 2600], ["Depilacija hladnim voskom — ruke", 30, 700, 1500],
    ["Depilacija šećernom pastom — cele noge", 60, 1800, 3500], ["Depilacija šećernom pastom — prepone", 30, 1000, 2200],
    ["Depilacija šećernom pastom — pazuh", 20, 600, 1300], ["Depilacija šećernom pastom — lice", 25, 700, 1500],
  ].map(([name, duration, min, max]) => template(name as string, "Depilacija", "Vosak i šećerna pasta", duration as number, min as number, max as number)),
  ...[
    ["Laserska / IPL epilacija — dame: pazuh", 20, 1500, 3500], ["Laserska / IPL epilacija — dame: prepone", 30, 2500, 5500],
    ["Laserska / IPL epilacija — dame: cele noge", 75, 6000, 14000], ["Laserska / IPL epilacija — dame: lice", 25, 1800, 4000],
    ["Laserska / IPL epilacija — muškarci: leđa", 60, 6000, 14000], ["Laserska / IPL epilacija — muškarci: grudi i stomak", 60, 5000, 12000],
    ["Laserska / IPL epilacija — muškarci: ramena", 30, 2500, 5500],
  ].map(([name, duration, min, max]) => template(name as string, "Depilacija", "Laserska i IPL epilacija", duration as number, min as number, max as number)),

  ...massageTags.map((name) => {
    const isShort = /glave|lica|šaka|stopala|leđa|ramena|vrata|sedećem/i.test(name);
    const isLong = /parove|tajlandska|joga|celog tela|havajska|ajurvedska/i.test(name);
    return template(name, "Masaža", "Masažne tehnike", isLong ? 90 : isShort ? 30 : 60, isLong ? 3500 : isShort ? 1200 : 2200, isLong ? 8000 : isShort ? 3000 : 5500);
  }),
];

export async function ensureDemoData(): Promise<void> {
  if (!seedPromise) seedPromise = seed();
  return seedPromise;
}

async function seed(): Promise<void> {
  const [existing] = await db.select({ id: usersTable.id }).from(usersTable).limit(1);
  if (existing) {
    await db.execute(sql`
      update ${usersTable}
      set password_set_at = now()
      where ${usersTable.passwordSetAt} is null
        and not exists (
          select 1 from ${oauthIdentitiesTable}
          where ${oauthIdentitiesTable.userId} = ${usersTable.id}
        )
    `);
    for (const [city, postalCode] of Object.entries(postalCodesByCity)) {
      await db.update(salonsTable).set({ postalCode }).where(sql`${salonsTable.postalCode} is null and ${salonsTable.city} = ${city}`);
    }
    await seedEducationContent();
    await seedEducationMonetization();
    await seedMarketplaceTaxonomy();
    await synchronizeInferredServesMen();
    await seedCourierServices();
    await seedFutureBookingAvailability();
    await backfillSalonCustomers();
    await setDemoLotosActiveSalon();
    return;
  }

  const passwordHash = await hashPassword("LumeraDemo2026!");
  const passwordSetAt = new Date();
  const demoUsers = await db.insert(usersTable).values([
    { firstName: "Milica", lastName: "Jovanović", email: "admin@lumera.local", passwordHash, passwordSetAt, role: "SUPER_ADMIN" },
    { firstName: "Ana", lastName: "Petrović", email: "salon@lumera.local", passwordHash, passwordSetAt, role: "SALON_OWNER" },
    { firstName: "Jelena", lastName: "Marković", email: "edukacija@lumera.local", passwordHash, passwordSetAt, role: "EDUCATION_CENTER_OWNER" },
    { firstName: "Teodora", lastName: "Nikolić", email: "kupac@lumera.local", passwordHash, passwordSetAt, role: "CUSTOMER" },
    { firstName: "Maja", lastName: "Milošević", email: "zaposleni@lumera.local", passwordHash, passwordSetAt, role: "SALON_EMPLOYEE" },
    ...Array.from({ length: 30 }, (_, i) => ({
      firstName: ["Katarina", "Marija", "Sofija", "Lana", "Una"][i % 5]!,
      lastName: ["Ilić", "Kovačević", "Simić", "Pavlović", "Đorđević"][i % 5]!,
      email: `kupac${i + 1}@lumera.local`,
      passwordHash,
      passwordSetAt,
      role: "CUSTOMER" as const,
    })),
  ]).returning();

  const owner = demoUsers[1]!;
  const customer = demoUsers[3]!;
  const employeeLearner = demoUsers[4]!;
  const categoryRows = await db.insert(serviceCategoriesTable).values(
    categories.map(([name, slug]) => ({
      name,
      slug,
      description: `Pažljivo izabrane ${name.toLowerCase()} usluge za svakodnevnu negu.`,
      fallbackImageUrl: categoryFallbackImages[name],
    })),
  ).returning();

  const salons = await db.insert(salonsTable).values(
    salonNames.map(([name, slug, city, municipality], index) => ({
      ownerId: owner.id,
      name,
      slug,
      city,
      municipality,
      postalCode: postalCodesByCity[city]!,
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
      topSalon: index < 3,
      acceptsCards: index % 2 === 0,
      instantBooking: index % 3 !== 1,
      latitude: [44.7866, 45.2671, 43.3209, 44.8176, 44.0128, 45.2396, 46.1004, 44.8125, 43.8914, 44.8712][index]!,
      longitude: [20.4489, 19.8335, 21.8958, 20.4124, 20.9114, 19.8227, 19.6676, 20.4012, 20.3496, 20.6417][index]!,
    })),
  ).returning();
  const lotos = salons.find((salon) => salon.slug === "lotos-rituals");
  if (lotos) await db.update(usersTable).set({ activeSalonId: lotos.id }).where(eq(usersTable.id, owner.id));

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

  await seedFutureBookingAvailability();
  await backfillSalonCustomers();

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
    { ownerId: demoUsers[2]!.id, name: "Akademija Ritual", city: "Beograd", description: "Edukacije za savremene wellness profesionalce.", imageUrl: "/lumera-media/course-1.jpg", verificationStatus: "verified", verifiedAt: new Date(), verifiedByUserId: demoUsers[0]!.id },
    { ownerId: demoUsers[2]!.id, name: "Studio Forma Edu", city: "Novi Sad", description: "Znanje kroz praksu i mentorske radionice.", imageUrl: "/lumera-media/course-1.jpg", verificationStatus: "verified", verifiedAt: new Date(), verifiedByUserId: demoUsers[0]!.id },
    { ownerId: demoUsers[2]!.id, name: "Wellbeing Institut", city: "Niš", description: "Usavršavanje za terapeute nove generacije.", imageUrl: "/lumera-media/course-1.jpg", verificationStatus: "verified", verifiedAt: new Date(), verifiedByUserId: demoUsers[0]!.id },
  ]).returning();
  await db.insert(educationCenterSubscriptionsTable).values(centers.map((center) => ({
    centerId: center.id, planId: plan!.id, status: "active" as const, dueAmount: plan!.price,
    currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  })));
  await db.insert(educationPlatformSettingsTable).values({}).onConflictDoNothing();
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
  await db.insert(usersTable).values({ firstName: "Podrška", lastName: "Lumera", email: "support@lumera.local", passwordHash, passwordSetAt, role: "ADMIN" });
  await seedMarketplaceTaxonomy();
  await synchronizeInferredServesMen();
  await seedCourierServices();
  void customer;
}

async function setDemoLotosActiveSalon() {
  const [owner] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, "salon@lumera.local")).limit(1);
  const [lotos] = await db.select({ id: salonsTable.id }).from(salonsTable).where(eq(salonsTable.slug, "lotos-rituals")).limit(1);
  if (owner && lotos) await db.update(usersTable).set({ activeSalonId: lotos.id }).where(eq(usersTable.id, owner.id));
}

/**
 * Keeps the demo booking calendar useful regardless of when the workspace is opened.
 * Salon hours are recurring, while appointments intentionally move with today's date.
 */
async function seedFutureBookingAvailability(): Promise<void> {
  // Seeding is not latency-sensitive; keep its database reads single-client safe.
  const salons = await db.select().from(salonsTable);
  const employees = await db.select().from(employeesTable);
  const services = await db.select().from(servicesTable);
  const customers = await db.select().from(usersTable);
  const existingHours = await db.select().from(salonHoursTable);
  const existingAppointments = await db.select().from(appointmentsTable);
  const customerRows = customers.filter((user) => user.role === "CUSTOMER");
  if (!salons.length || !employees.length || !services.length || !customerRows.length) return;

  const hourKeys = new Set(existingHours.map((hour) => `${hour.salonId}:${hour.weekday}`));
  const missingHours: (typeof salonHoursTable.$inferInsert)[] = [];
  for (const salon of salons) {
    for (let weekday = 1; weekday <= 6; weekday += 1) {
      if (!hourKeys.has(`${salon.id}:${weekday}`)) {
        missingHours.push({ salonId: salon.id, weekday, openTime: "09:00", closeTime: "18:00", closed: false });
      }
    }
  }
  if (missingHours.length) await db.insert(salonHoursTable).values(missingHours);

  const occupiedKeys = new Set(existingAppointments
    .filter((appointment) => appointment.status !== "cancelled")
    .map((appointment) => `${appointment.employeeId}:${appointment.date}:${appointment.startTime}`));
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const busyStartHours = [9, 11, 14, 16];
  const demoAppointments: (typeof appointmentsTable.$inferInsert)[] = [];

  for (let offset = 1; offset <= 21; offset += 1) {
    const day = new Date(today);
    day.setUTCDate(today.getUTCDate() + offset);
    const weekday = day.getUTCDay();
    if (weekday === 0) continue;
    const date = day.toISOString().slice(0, 10);

    for (const salon of salons) {
      const service = services.find((item) => item.salonId === salon.id);
      if (!service) continue;
      const salonEmployees = employees.filter((employee) => employee.salonId === salon.id);
      for (const employee of salonEmployees) {
        for (const [slotIndex, startHour] of busyStartHours.entries()) {
          const startTime = `${String(startHour).padStart(2, "0")}:00`;
          const occupiedKey = `${employee.id}:${date}:${startTime}`;
          if (occupiedKeys.has(occupiedKey)) continue;
          const customer = customerRows[(offset + slotIndex + salonEmployees.indexOf(employee)) % customerRows.length]!;
          demoAppointments.push({
            salonId: salon.id,
            customerId: customer.id,
            employeeId: employee.id,
            serviceId: service.id,
            date,
            startTime,
            endTime: `${String(startHour + 1).padStart(2, "0")}:00`,
            durationMinutes: service.durationMinutes,
            price: service.promoPrice ?? service.price,
            status: "confirmed",
            notes: "[demo-availability] Zauzet demo termin za realističan kalendar.",
          });
          occupiedKeys.add(occupiedKey);
        }
      }
    }
  }
  if (demoAppointments.length) await db.insert(appointmentsTable).values(demoAppointments);
  const existingAssignments = await db.select().from(employeeServicesTable);
  const assignmentKeys = new Set(existingAssignments.map((item) => `${item.employeeId}:${item.serviceId}`));
  const assignments = existingAssignments.length ? [] : employees.flatMap((employee) => services.filter((service) => service.salonId === employee.salonId)
    .filter((service) => !assignmentKeys.has(`${employee.id}:${service.id}`))
    .map((service) => ({ employeeId: employee.id, serviceId: service.id })));
  if (assignments.length) await db.insert(employeeServicesTable).values(assignments).onConflictDoNothing();
}

/**
 * Gives each salon a CRM contact for registered customers from older online
 * appointments. The insert is intentionally additive so a salon's existing
 * contact data, especially SMS opt-out, remains authoritative.
 */
export async function backfillSalonCustomers(): Promise<void> {
  await db.execute(sql`
    INSERT INTO ${salonCustomersTable}
      (salon_id, user_id, first_name, last_name, email, phone)
    SELECT DISTINCT ON (a.salon_id, a.customer_id)
      a.salon_id, u.id, u.first_name, u.last_name, u.email, u.phone
    FROM ${appointmentsTable} a
    INNER JOIN ${usersTable} u ON u.id = a.customer_id
    WHERE a.customer_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM ${salonCustomersTable} existing_contact
        WHERE existing_contact.salon_id = a.salon_id
          AND existing_contact.user_id = a.customer_id
      )
    ORDER BY a.salon_id, a.customer_id, a.created_at
    ON CONFLICT (salon_id, user_id) DO NOTHING
  `);

  await db.execute(sql`
    UPDATE ${appointmentsTable} a
    SET salon_customer_id = contact.id
    FROM ${salonCustomersTable} contact
    WHERE a.salon_customer_id IS NULL
      AND a.customer_id IS NOT NULL
      AND contact.salon_id = a.salon_id
      AND contact.user_id = a.customer_id
  `);
}

async function seedCourierServices(): Promise<void> {
  await db.insert(courierServicesTable).values([
    { code: "bex-express", name: "Bex Express", trackingUrlTemplate: "https://www.bex.rs/pracenje-posiljke?broj={trackingNumber}" },
    { code: "post-express", name: "Post Express (Pošta Srbije)", trackingUrlTemplate: "https://www.posta.rs/OtpremaPracenje/pracenje-posiljaka?category=posiljka&tracking={trackingNumber}" },
    { code: "city-express", name: "City Express", trackingUrlTemplate: "https://www.cityexpress.rs/pracenje-posiljke/{trackingNumber}" },
    { code: "d-express", name: "D Express", trackingUrlTemplate: "https://www.dexpress.rs/rs/pratite-posiljku?bpn={trackingNumber}" },
    { code: "aks", name: "AKS", trackingUrlTemplate: "https://www.aks.rs/aksneo/pracenje-posiljke?broj={trackingNumber}" },
    { code: "posta-paket", name: "Pošta Srbije - obično pismo/paket", trackingUrlTemplate: "https://www.posta.rs/OtpremaPracenje/pracenje-posiljaka?category=posiljka&tracking={trackingNumber}" },
    { code: "personal-delivery", name: "Lična dostava", trackingUrlTemplate: null },
  ]).onConflictDoNothing();
}

async function seedB2BShopTaxonomy(): Promise<void> {
  // All product categories: [name, slug, parentSlug | null, sortOrder]
  const b2bCategories: Array<[string, string, string | null, number]> = [
    // Main categories
    ["KOSA", "kosa", null, 1],
    ["NOKTI", "nokti", null, 2],
    ["LICE & TELO", "lice-telo", null, 3],
    ["MAKEUP", "makeup", null, 4],
    ["FOR MEN", "for-men", null, 5],
    ["OPREMA ZA SALONE", "oprema-za-salone", null, 6],
    ["POKLONI", "pokloni", null, 7],
    // KOSA subcategories
    ["Farbanje kose", "farbanje-kose", "kosa", 1],
    ["Nega kose", "nega-kose", "kosa", 2],
    ["Stilizovanje kose", "stilizovanje-kose", "kosa", 3],
    ["Nadogradnja kose", "nadogradnja-kose", "kosa", 4],
    ["Makaze - Četke - Češljevi", "makaze-cetke-cesljevi", "kosa", 5],
    ["Aparati za kosu", "aparati-za-kosu", "kosa", 6],
    ["Frizerski pribor", "frizerski-pribor", "kosa", 7],
    // NOKTI subcategories
    ["Nadogradnja noktiju", "nadogradnja-noktiju", "nokti", 1],
    ["Kolor gelovi", "kolor-gelovi", "nokti", 2],
    ["Trajni lak i preparati", "trajni-lak-preparati", "nokti", 3],
    ["Pribor za manikir", "pribor-za-manikir", "nokti", 4],
    ["Nega noktiju", "nega-noktiju", "nokti", 5],
    ["Lak za nokte i preparati", "lak-za-nokte", "nokti", 6],
    ["Aparati za manikir", "aparati-za-manikir", "nokti", 7],
    ["Nail art", "nail-art", "nokti", 8],
    // LICE & TELO subcategories
    ["Nega lica", "nega-lica", "lice-telo", 1],
    ["Nega tela", "nega-tela", "lice-telo", 2],
    ["Depilacija", "depilacija-b2b", "lice-telo", 3],
    ["Masaža i SPA tretmani", "masaza-spa", "lice-telo", 4],
    ["Pedikir", "pedikir", "lice-telo", 5],
    ["Parafinski tretmani", "parafinski-tretmani", "lice-telo", 6],
    ["Papir - Rukavice - Folije - Maske", "potrosni-materijal-salone", "lice-telo", 7],
    ["Kozmetika za sunčanje", "kozmetika-suncanje", "lice-telo", 8],
    // MAKEUP subcategories
    ["Usne", "makeup-usne", "makeup", 1],
    ["Lice", "makeup-lice", "makeup", 2],
    ["Oči", "makeup-oci", "makeup", 3],
    ["Makeup palete", "makeup-palete", "makeup", 4],
    ["Obrve", "makeup-obrve", "makeup", 5],
    ["Trepavice", "makeup-trepavice", "makeup", 6],
    ["Uklanjanje šminke", "uklanjanje-sminke", "makeup", 7],
    ["Četkice za šminkanje", "cetkice-sminkanje", "makeup", 8],
    ["Pribor za šminkanje", "pribor-sminkanje", "makeup", 9],
    // FOR MEN subcategories
    ["Brada i brkovi", "brada-brkovi", "for-men", 1],
    ["Nega i stilizovanje kose za muškarce", "nega-kose-muskarci", "for-men", 2],
    ["Nega lica i tela za muškarce", "nega-lica-muskarci", "for-men", 3],
    // OPREMA ZA SALONE subcategories
    ["Oprema za kozmetičke salone", "oprema-kozmeticki", "oprema-za-salone", 1],
    ["Aparati za kozmetičke salone", "aparati-kozmeticki", "oprema-za-salone", 2],
    ["Oprema za frizerske salone", "oprema-frizerski", "oprema-za-salone", 3],
    // POKLONI subcategories
    ["E-poklon kartice", "e-poklon-kartice", "pokloni", 1],
    ["Pokloni za nju", "pokloni-za-nju", "pokloni", 2],
    ["Pokloni za njega", "pokloni-za-njega", "pokloni", 3],
  ];

  for (const [name, slug, , sortOrder] of b2bCategories.filter(([, , p]) => p === null)) {
    await db.insert(productCategoriesTable).values({ name, slug, sortOrder }).onConflictDoNothing();
  }
  const parentRows = await db.select().from(productCategoriesTable).orderBy(asc(productCategoriesTable.sortOrder));
  const parentBySlug = new Map(parentRows.map((r) => [r.slug, r]));
  for (const [name, slug, parentSlug, sortOrder] of b2bCategories.filter(([, , p]) => p !== null)) {
    const parent = parentBySlug.get(parentSlug!);
    if (!parent) continue;
    await db.insert(productCategoriesTable).values({ name, slug, parentId: parent.id, sortOrder }).onConflictDoNothing();
  }

  const allCatRows = await db.select().from(productCategoriesTable);
  const catBySlug = new Map(allCatRows.map((r) => [r.slug, r]));

  // Demo B2B products: [name, brand, categorySlug, subcategorySlug, price, discountPrice|null, unit, sku, stock, isNew, isBestseller, description, variants?, weightGrams?]
  type ProdSeed = [string, string, string, string, number, number | null, string, string, number, boolean, boolean, string, Array<{label: string; value: string; priceAdjust?: number}> | null, number?];
  const products: ProdSeed[] = [
    // KOSA — Farbanje kose  [... weightGrams as last arg]
    ["Wella Koleston Perfect 60ml", "Wella Professionals", "kosa", "farbanje-kose", 980, 820, "60 ml", "WKP-001", 48, false, true, "Permanentna oksidacijska boja sa tehnologijom ME+ za minimalnu alergijsku reakciju.", [{label:"Nijansa", value:"6/0 Tamno plava"}, {label:"Nijansa", value:"7/43 Srednje plava bakar"}], 130],
    ["Schwarzkopf Blondme Blanš 450g", "Schwarzkopf Professional", "kosa", "farbanje-kose", 2190, 1890, "450 g", "SBM-002", 30, false, true, "Visokoučinkoviti prašak za osvetljavanje do 9 nijansi sa zaštitom vlakana.", null, 560],
    ["Matrix Hidrogen 1000ml 6%", "Matrix", "kosa", "farbanje-kose", 650, null, "1000 ml", "MHD-003", 60, false, false, "Kremasti hidrogen stabilizovane koncentracije za precizno mešanje boje.", null, 1120],
    ["L'Oréal Professionnel Spray Boja", "L'Oréal Professionnel", "kosa", "farbanje-kose", 1450, 1190, "75 ml", "LPS-004", 24, true, false, "Direktna boja u spreju, privremena, bez amonijaka, u 12 nijansi.", [{label:"Boja", value:"Crvena"}, {label:"Boja", value:"Roze"}, {label:"Boja", value:"Zlatna"}], 150],
    // KOSA — Nega kose
    ["Kérastase Nutritive Masque 200ml", "Kérastase", "kosa", "nega-kose", 3490, null, "200 ml", "KNM-005", 20, false, true, "Intenzivna maska za suvu i neposlušnu kosu sa uljima shiea i makadamije.", null, 260],
    ["Olaplex No.3 Hair Perfector 100ml", "Olaplex", "kosa", "nega-kose", 3990, 3290, "100 ml", "OLP-006", 35, false, true, "Tretman za vezivanje i obnovu disulfidnih veza oštećenih vlakana kose.", null, 180],
    ["Redken All Soft Šampon 1000ml", "Redken", "kosa", "nega-kose", 2890, null, "1000 ml", "RAS-007", 18, false, false, "Profesionalni šampon za suvu i krtolomu kosu sa arganovim uljem.", null, 1080],
    ["Schwarzkopf BC Moisture Kick Ampule 12x10ml", "Schwarzkopf Professional", "kosa", "nega-kose", 1890, 1590, "set 12", "SBA-008", 15, true, false, "Serum ampule za trenutnu i dubinsku hidrataciju suve kose.", null, 180],
    // KOSA — Stilizovanje kose
    ["Wella EIMI Extra Volume Pena 300ml", "Wella Professionals", "kosa", "stilizovanje-kose", 1290, null, "300 ml", "WEP-009", 40, false, true, "Profesionalna pena za volumen i snažnu fiksaciju.", null, 380],
    ["Redken Brews Clay Pomada 100ml", "Redken", "kosa", "stilizovanje-kose", 1590, 1390, "100 ml", "RBC-010", 25, false, false, "Glinena pomada za mat završnicu sa jakim nagrizanjem.", null, 170],
    // KOSA — Aparati za kosu
    ["BaByliss Pro Titanium Express Presa", "BaByliss Pro", "kosa", "aparati-za-kosu", 12900, 10900, "kom", "BBP-011", 8, false, true, "Profesionalna presa sa titanijumskim pločama i regulacijom temperature do 235°C.", [{label:"Širina ploča", value:"25mm"}, {label:"Širina ploča", value:"38mm"}], 680],
    ["Wahl Cordless Magic Clip Mašinica", "Wahl", "kosa", "aparati-za-kosu", 9900, null, "kom", "WMC-012", 12, true, false, "Bežična mašinica za šišanje sa litijumskom baterijom i 5-zvezdicom presiznosti.", null, 510],
    ["Valera Swiss Nano 9000 Fen 2400W", "Valera", "kosa", "aparati-za-kosu", 14900, 12900, "kom", "VSN-013", 6, false, true, "Lagan DC motor fen sa ionizatorom i brzim sušenjem.", null, 590],
    // NOKTI — Nadogradnja noktiju
    ["IBD Hard Gel Clear 56g", "IBD", "nokti", "nadogradnja-noktiju", 2490, null, "56 g", "IBD-014", 22, false, true, "Tvrdi UV/LED gel za nadogradnju, gradnju i ojačavanje prirodnih noktiju.", null, 110],
    ["Akrylicni Prah Cover Pink 100g", "Acryl One", "nokti", "nadogradnja-noktiju", 1890, 1590, "100 g", "AOC-015", 30, false, false, "Akrilatni prah roze nijanse za prirodni izgled nadogradnje.", null, 160],
    ["Gelish Dipping System Starter Kit", "Gelish", "nokti", "nadogradnja-noktiju", 8900, 7500, "set", "GDS-016", 10, true, false, "Kompletan starter set za dipping powder nadogradnju.", null, 720],
    // NOKTI — Kolor gelovi
    ["CND Shellac UV Color Top Coat 7.3ml", "CND", "nokti", "kolor-gelovi", 1390, null, "7.3 ml", "CSC-017", 50, false, true, "UV/LED gel trajni lak u 100+ nijansi sa zaštitnim slojem.", [{label:"Nijansa", value:"Romantique"}, {label:"Nijansa", value:"Blush Teddy"}, {label:"Nijansa", value:"Antique Garnet"}], 65],
    ["Luxio Color Gel 15ml", "Luxio", "nokti", "kolor-gelovi", 1690, 1390, "15 ml", "LCG-018", 40, true, false, "Samopigmentisani gel lak bez lampe, 150+ nijansi.", null, 80],
    // NOKTI — Nail art
    ["Swarovski Crystal Rhinestones Mix 1440kom", "Swarovski", "nokti", "nail-art", 3900, 3200, "1440 kom", "SWR-019", 15, false, true, "Originalni Swarovski kristali različitih veličina za nail art.", null, 90],
    ["Mirror Chrome Powder Set 5 boja", "Moyra", "nokti", "nail-art", 1490, null, "set 5", "MCP-020", 28, true, false, "Set mirror hrom prahova za ogledalni efekat na gel laku.", null, 75],
    // NOKTI — Aparati za manikir
    ["Elegante UV/LED Lampa 48W", "Elegante", "nokti", "aparati-za-manikir", 4900, 3900, "kom", "EUL-021", 18, false, true, "Profesionalna UV/LED lampa sa senzorom pokreta i tajmerom.", [{label:"Boja", value:"Bela"}, {label:"Boja", value:"Roze"}], 480],
    ["Frezarka Električna Turpija 35000 rpm", "Calvetti", "nokti", "aparati-za-manikir", 7900, 6500, "kom", "CET-022", 12, false, false, "Profesionalna električna turpija sa regulacijom broja obrtaja.", null, 620],
    // LICE & TELO — Nega lica
    ["Mesoestetic Hydra Vital Factor K Krema 50ml", "Mesoestetic", "lice-telo", "nega-lica", 5900, null, "50 ml", "MVK-023", 15, false, true, "Intenzivna hidratantna krema za suvu i dehidriranu kožu sa faktorom K.", null, 120],
    ["Thalgo Collagen Aktif Serum 30ml", "Thalgo", "lice-telo", "nega-lica", 7900, 6500, "30 ml", "TCA-024", 10, false, true, "Morski kolagen serum za lifting i čvrstinu kože lica.", null, 90],
    ["Dermalogica Daily Microfoliant 74g", "Dermalogica", "lice-telo", "nega-lica", 5490, null, "74 g", "DDM-025", 20, false, true, "Rižin enzimski piling koji se aktivira kontaktom sa vodom.", null, 130],
    // LICE & TELO — Depilacija
    ["Rica Black Pearl Vosak Za Zagrevanje 400ml", "Rica", "lice-telo", "depilacija-b2b", 1290, 990, "400 ml", "RBV-026", 36, false, true, "Topli vosak sa crnim biserom za osetljive zone.", null, 480],
    ["Perron Rigot Stripless Azulene Vosak 800ml", "Perron Rigot", "lice-telo", "depilacija-b2b", 2490, null, "800 ml", "PRZ-027", 24, false, false, "Premium tvrdi vosak sa azulenom za brazilsku depilaciju.", null, 880],
    ["Wax Roll-On Za Noge 100m", "BellaWax", "lice-telo", "depilacija-b2b", 890, 750, "100 m", "BWR-028", 50, false, false, "Netkana trola za hladno depiliranje, 100m.", null, 400],
    // LICE & TELO — Masaža i SPA
    ["Decléor Aromessence Rose d'Orient Ulje 55ml", "Decléor", "lice-telo", "masaza-spa", 4900, null, "55 ml", "DAR-029", 14, false, true, "Esencijalno ulje ruže za masažu lica sa aromaterapijskim efektom.", null, 110],
    ["Vulkansko Kamenje Set 20 kom", "SpaStone Pro", "lice-telo", "masaza-spa", 3900, 3200, "set 20", "VSK-030", 8, false, false, "Bazaltno kamenje za hot stone masažu, razne veličine.", null, 4200],
    ["Relaxation Massage Oil Lavender 500ml", "Biotique", "lice-telo", "masaza-spa", 1890, 1590, "500 ml", "BML-031", 30, true, false, "Profesionalno ulje za relax masažu sa lavandinim ekstraktom.", null, 560],
    // LICE & TELO — Pedikir
    ["Gehwol Fusskraft Zelena 125ml", "Gehwol", "lice-telo", "pedikir", 1490, null, "125 ml", "GFZ-032", 25, false, true, "Krema za negu stopala i potkoža, zaštita od vlage i mirisa.", null, 190],
    ["Clou de Paris Klešta Za Pedikir", "Clou de Paris", "lice-telo", "pedikir", 3900, 3200, "kom", "CDP-033", 15, false, false, "Profesionalna klešta od nehrđajućeg čelika za urasle nokte.", null, 150],
    // LICE & TELO — Potrošni materijal
    ["Jednokratne Rukavice Nitril M 100kom", "ProMed", "lice-telo", "potrosni-materijal-salone", 890, 750, "100 kom", "JRN-034", 100, false, true, "Nitrilne rukavice bez pudera, povećane elastičnosti.", null, 900],
    ["Jednokratni Ogrtač za Tretmane 10kom", "SalonPlus", "lice-telo", "potrosni-materijal-salone", 590, null, "10 kom", "JOT-035", 80, false, false, "Polipropilinski jednokratni ogrtač za klijente.", null, 300],
    // MAKEUP
    ["MAC Lipstick Profesionalni 3g", "MAC", "makeup", "makeup-usne", 2990, null, "3 g", "MAC-036", 30, false, true, "Profesionalni ruž za usne u 200+ nijansi.", [{label:"Finish", value:"Matte"}, {label:"Finish", value:"Satin"}, {label:"Finish", value:"Amplified"}], 55],
    ["NYX Pro Setting Spray 60ml", "NYX Professional", "makeup", "makeup-lice", 1490, 1190, "60 ml", "NYX-037", 40, false, false, "Profesionalni fiksator šminke koji produžava trajnost do 16h.", null, 120],
    ["Sigma Beauty Brush Set E55 Kompletan", "Sigma Beauty", "makeup", "cetkice-sminkanje", 8900, 7500, "set 12", "SBE-038", 10, true, true, "Set od 12 profesionalnih četkica za šminkanje, veganski dlake.", null, 380],
    // FOR MEN
    ["American Crew Beard Balm 60g", "American Crew", "for-men", "brada-brkovi", 1890, null, "60 g", "ACB-039", 25, false, true, "Balzam za oblikovanje brade sa kakaovim puterom.", null, 110],
    ["Baxter of California Pomada Za Kosu 60ml", "Baxter of California", "for-men", "nega-kose-muskarci", 2490, 2090, "60 ml", "BCN-040", 20, false, false, "Srednje fiksaciona pomada visokog sjaja za mušku kosu.", null, 130],
    ["Bulldog Original Face Wash 150ml", "Bulldog", "for-men", "nega-lica-muskarci", 890, null, "150 ml", "BFW-041", 40, true, false, "Gel za čišćenje lica za muškarce sa alojom i kaolinom.", null, 200],
    // OPREMA ZA SALONE
    ["Kozmetički Krevet Električni Bela", "SalonPro", "oprema-za-salone", "oprema-kozmeticki", 89900, 79900, "kom", "SKB-042", 4, false, true, "Električni kozmetički krevet sa 3 motorisane pozicije.", [{label:"Boja", value:"Bela"}, {label:"Boja", value:"Crna"}, {label:"Boja", value:"Siva"}], 38000],
    ["Frizerska Stolica Hydraulic Classic", "BarberStyle", "oprema-za-salone", "oprema-frizerski", 24900, 21900, "kom", "FSH-043", 6, false, false, "Hidraulična frizerska stolica na točkovima, nosivost 150kg.", [{label:"Boja", value:"Crna koža"}, {label:"Boja", value:"Bela koža"}], 22000],
    ["Sterilizator UV Kabinet 9W", "MedLine", "oprema-za-salone", "aparati-kozmeticki", 4900, null, "kom", "SUV-044", 15, false, true, "UV sterilizator za dezinfekciju pribora između tretmana.", null, 1800],
    // POKLONI
    ["LUMERA E-Poklon Kartica 2000 RSD", "LUMERA", "pokloni", "e-poklon-kartice", 2000, null, "kom", "GPK-045", 999, false, false, "Digitalna poklon kartica za korišćenje u B2B shopu.", [{label:"Vrednost", value:"2000 RSD", priceAdjust:0}, {label:"Vrednost", value:"5000 RSD", priceAdjust:3000}, {label:"Vrednost", value:"10000 RSD", priceAdjust:8000}], 10],
    ["Beauty Box Za Nju - Starterski Set", "LUMERA", "pokloni", "pokloni-za-nju", 4900, 4200, "set", "GPZ-046", 20, true, false, "Izabrani set profesionalnih kozmetičkih proizvoda za salome dame.", null, 650],
    ["Gentleman Box Za Njega", "LUMERA", "pokloni", "pokloni-za-njega", 4900, null, "set", "GPN-047", 15, true, false, "Odabrani set muških preparata za negu brade, kose i lica.", null, 580],
  ];

  const existingSkus = new Set((await db.select({ sku: productsTable.sku }).from(productsTable)).map((r) => r.sku));
  const toInsert = products.filter(([, , , , , , , sku]) => !existingSkus.has(sku)).map(([name, brand, catSlug, subSlug, price, discountPrice, unit, sku, stock, isNew, isBestseller, description, variants, weightGrams]) => {
    const cat = catBySlug.get(catSlug);
    const sub = catBySlug.get(subSlug);
    const parentCat = cat ? allCatRows.find((r) => r.id === cat.id) : null;
    const parentName = parentCat?.name ?? catSlug.toUpperCase();
    return {
      categoryId: cat?.id ?? null,
      categoryName: parentName,
      subcategoryName: sub?.name ?? null,
      name,
      brand,
      description,
      imageUrl: "/lumera-media/product-1.jpg",
      price,
      discountPrice: discountPrice ?? null,
      stock,
      sku,
      unit,
      weightGrams: weightGrams ?? null,
      isNew,
      isBestseller,
      variants: variants ?? null,
      active: true,
    };
  });
  if (toInsert.length) await db.insert(productsTable).values(toInsert);

  // Older seed data stored gift-card values as labels without their price adjustments.
  // Backfill only missing adjustments so existing admin-configured prices remain authoritative.
  const [giftCard] = await db.select().from(productsTable).where(eq(productsTable.sku, "GPK-045")).limit(1);
  if (giftCard?.variants?.some((variant) => variant.label === "Vrednost" && variant.priceAdjust === undefined)) {
    const variants = giftCard.variants.map((variant) => {
      if (variant.label !== "Vrednost" || variant.priceAdjust !== undefined) return variant;
      const amount = Number.parseInt(variant.value.replace(/\D/g, ""), 10);
      return Number.isFinite(amount) ? { ...variant, priceAdjust: amount - giftCard.price } : variant;
    });
    await db.update(productsTable).set({ variants }).where(eq(productsTable.id, giftCard.id));
  }

  // Backfill weight for any existing products that were seeded before this column was added.
  // Use a deterministic heuristic so production/existing data is not left with null weights.
  await db.execute(
    sql`UPDATE products SET weight_grams = CASE
      WHEN unit ~* '^[0-9]+\\s*ml$' THEN GREATEST(50, (substring(unit from '^([0-9]+)'))::int + 80)
      WHEN unit ~* '^[0-9]+\\s*g$'  THEN GREATEST(50, (substring(unit from '^([0-9]+)'))::int + 60)
      WHEN unit ~* 'set\\s*[0-9]+' OR unit ~* '^set$' THEN 500
      WHEN unit ~* '[0-9]+\\s*kom$' THEN GREATEST(150, (substring(unit from '([0-9]+)\\s*kom'))::int * 5)
      WHEN unit ~* '^[0-9]+\\s*m$' THEN 400
      WHEN unit ~* 'kom' AND (name ~* 'krevet|stolica|frezark|fen|presa|mašinic|lampa|steriliz|aparat|kabinet') THEN 3500
      WHEN unit ~* 'kom' THEN 400
      ELSE 300
    END
    WHERE weight_grams IS NULL`
  );
  await seedShippingConfig();
}

async function seedShippingConfig(): Promise<void> {
  const [existing] = await db.select().from(shippingRulesTable).limit(1);
  if (existing) return;
  await db.insert(shippingRulesTable).values({
    freeShippingThreshold: 15000,
    tiers: [
      { maxWeightGrams: 1000, price: 390, label: "do 1 kg" },
      { maxWeightGrams: 3000, price: 490, label: "do 3 kg" },
      { maxWeightGrams: 5000, price: 690, label: "do 5 kg" },
      { maxWeightGrams: 10000, price: 990, label: "do 10 kg" },
      { maxWeightGrams: 20000, price: 1490, label: "do 20 kg" },
    ],
  });
}

async function seedMarketplaceTaxonomy(): Promise<void> {
  await seedServiceTemplateLibrary();
  const salons = await db.select().from(salonsTable);
  if (!salons.length) return;
  await seedB2BShopTaxonomy();
  for (const [name, slug] of categories) {
    await db.insert(serviceCategoriesTable).values({
      name, slug, description: `Profesionalne ${name.toLowerCase()} usluge dostupne na LUMERA marketplace-u.`,
    }).onConflictDoNothing();
    await db.execute(sql`
      update ${serviceCategoriesTable}
      set fallback_image_url = ${categoryFallbackImages[name]}
      where ${serviceCategoriesTable.name} = ${name}
        and ${serviceCategoriesTable.fallbackImageUrl} is null
    `);
  }
  const categoryRows = await db.select().from(serviceCategoriesTable);
  const categoryByName = new Map(categoryRows.map((item) => [item.name, item]));
  const serviceSeeds: Array<[string, string, number, number, string[], number | null, number | null]> = [
    ["Frizerski saloni", "Žensko šišanje i feniranje", 60, 2200, ["frizura", "feniranje"], null, null], ["Frizerski saloni", "Farbanje kose i preliv", 150, 6500, ["farbanje", "kosa"], 5500, null], ["Frizerski saloni", "Balayage i toniranje", 210, 11500, ["balayage", "kosa"], null, null],
    ["Muški frizeri", "Muško šišanje", 40, 1400, ["muškarci", "brada"], null, null], ["Muški frizeri", "Šišanje i oblikovanje brade", 60, 2200, ["muškarci", "brada"], null, null], ["Muški frizeri", "Kraljevsko brijanje", 45, 1800, ["muškarci", "brijanje"], null, null],
    ["Kozmetički saloni", "Lash lift i bojenje trepavica", 60, 3200, ["trepavice", "kozmetika"], null, null], ["Kozmetički saloni", "Laminacija obrva", 45, 2800, ["obrve", "kozmetika"], null, null], ["Kozmetički saloni", "Profesionalno šminkanje", 75, 5500, ["šminkanje", "event"], null, null],
    ["Depilacija", "Depilacija voskom - cele noge", 45, 2200, ["vosak", "depilacija"], null, null], ["Depilacija", "Brazilska depilacija", 40, 2700, ["vosak", "intimna nega"], null, null], ["Depilacija", "Laser depilacija pazuha", 30, 3500, ["laser", "depilacija"], null, null],
    ["Lice", "Hidratantni tretman lica", 60, 4200, ["nega lica", "hidratacija"], null, null], ["Lice", "Kiseonički tretman lica", 75, 5900, ["nega lica", "glow"], 4900, null], ["Lice", "Dnevna šminka", 50, 3800, ["šminkanje", "lice"], null, null],
    ["Nokti", "Manikir sa gel lakom", 75, 2400, ["manikir", "gel lak"], null, null], ["Nokti", "Spa pedikir", 75, 3200, ["pedikir", "spa"], null, null], ["Nokti", "Izlivanje noktiju", 120, 3900, ["nokti", "gel"], null, null],
    ["Telo", "Maderoterapija tela", 60, 3500, ["telo", "oblikovanje"], null, null], ["Telo", "Body wrapping tretman", 60, 4200, ["telo", "detoks"], null, null], ["Telo", "Limfna drenaža", 60, 4000, ["telo", "drenaža"], null, null],
    ["Wellness", "Spa ritual sa saunom", 120, 6500, ["spa", "sauna"], null, null], ["Wellness", "Aroma kupka i ritual", 90, 4800, ["wellness", "aroma"], null, null], ["Wellness", "Float terapija", 60, 5200, ["wellness", "relaksacija"], null, null],
    ["Lux tretmani", "Lux gold facial", 90, 8900, ["lux", "lice"], null, null], ["Lux tretmani", "Ritual vulkanskim kamenjem", 90, 7200, ["lux", "masaža"], null, null], ["Lux tretmani", "VIP bridal paket", 180, 14500, ["lux", "šminkanje"], null, null],
    ["Paketi usluga", "Anticelulit masaža - paket od 10 tretmana", 45, 25000, ["paket", "anticelulit"], 22000, 10], ["Paketi usluga", "Beauty day paket", 180, 9000, ["paket", "lice", "nokti"], null, 3], ["Paketi usluga", "Paket za mladoženju", 120, 6500, ["paket", "muškarci"], null, 3],
    ["Ordinacije i poliklinike", "Dermatološki pregled", 30, 3500, ["dermatologija", "pregled"], null, null], ["Ordinacije i poliklinike", "Mezoterapija lica", 60, 9500, ["medicina", "lice"], null, null], ["Ordinacije i poliklinike", "Konsultacija estetskog dermatologa", 30, 3000, ["medicina", "konsultacija"], null, null],
  ];
  massageTags.slice(0, 18).forEach((tag, index) => serviceSeeds.push([
    "Masaža",
    tag === "Relax / antistres masaža" ? "Relax masaža - 60 minuta" : tag === "Terapeutska masaža" ? "Terapeutska masaža - 30 minuta" : `${tag} - ${index % 2 ? 60 : 45} minuta`,
    tag === "Terapeutska masaža" ? 30 : index % 2 ? 60 : 45,
    tag === "Relax / antistres masaža" ? 3500 : tag === "Terapeutska masaža" ? 2500 : 2800 + index * 120,
    ["masaža", tag], null, null,
  ]));
  const existingNames = new Set((await db.select({ name: servicesTable.name }).from(servicesTable)).map((item) => item.name));
  const missing = serviceSeeds.filter(([, name]) => !existingNames.has(name)).map(([categoryName, name, durationMinutes, price, tags, promoPrice, packageTreatments], index) => {
    const category = categoryByName.get(categoryName)!;
    return { salonId: salons[index % salons.length]!.id, categoryId: category.id, categoryName, name, description: `Stručno izveden tretman: ${name}.`, durationMinutes, price, promoPrice, tags, packageTreatments, imageUrl: "/lumera-media/product-1.jpg", active: true };
  });
  if (missing.length) await db.insert(servicesTable).values(missing);
  const brands = [["Kérastase", "kerastase"], ["Olaplex", "olaplex"], ["CND", "cnd"], ["Mesoestetic", "mesoestetic"], ["Thalgo", "thalgo"]];
  for (const [name, slug] of brands) await db.insert(productBrandsTable).values({ name, slug, description: `${name} profesionalni proizvodi.` }).onConflictDoNothing();
  const brandRows = await db.select().from(productBrandsTable);
  const existingLinks = await db.select().from(salonBrandsTable);
  const brandLinks = salons.flatMap((salon, index) => brandRows.slice(index % 2, (index % 2) + 2).filter((brand) => !existingLinks.some((link) => link.salonId === salon.id && link.brandId === brand.id)).map((brand) => ({ salonId: salon.id, brandId: brand.id })));
  if (brandLinks.length) await db.insert(salonBrandsTable).values(brandLinks);
  const glossary = [["Balayage", "balayage", "Tehnika slobodnog osvetljavanja pramenova za prirodan prelaz boje.", "Kosa"], ["Maderoterapija", "maderoterapija", "Masažna tehnika drvenim alatima za stimulaciju mikrocirkulacije.", "Telo"], ["Gel lak", "gel-lak", "Trajniji lak koji se suši u UV/LED lampi.", "Nokti"], ["Mezoterapija", "mezoterapija", "Tretman aktivnim sastojcima koji se radi nakon stručne konsultacije.", "Lice"], ["Lash lift", "lash-lift", "Podizanje i uvijanje prirodnih trepavica.", "Kozmetika"]];
  for (const [term, slug, definition, category] of glossary) await db.insert(beautyGlossaryTable).values({ term, slug, definition, category }).onConflictDoNothing();
  const existingInspiration = await db.select({ salonId: inspirationItemsTable.salonId }).from(inspirationItemsTable);
  const services = await db.select().from(servicesTable);
  const inspiration = salons.filter((salon) => !existingInspiration.some((item) => item.salonId === salon.id)).slice(0, 8).map((salon, index) => ({ salonId: salon.id, serviceId: services.find((service) => service.salonId === salon.id)?.id ?? null, title: ["Nude gel manikir", "Balayage inspiracija", "Glow tretman lica", "Relax ritual", "Svečana šminka"][index % 5]!, tags: [["nokti"], ["frizure"], ["lice"], ["masaža"], ["šminkanje"]][index % 5]!, imageUrl: salon.imageUrl }));
  if (inspiration.length) await db.insert(inspirationItemsTable).values(inspiration);
}

async function seedServiceTemplateLibrary(): Promise<void> {
  for (const item of serviceTemplateSeeds) {
    await db.insert(serviceTemplatesTable).values(item).onConflictDoNothing({
      target: [serviceTemplatesTable.mainCategory, serviceTemplatesTable.name],
    });
  }
}

function serviceTargetsMen(service: Pick<typeof servicesTable.$inferSelect, "categoryName" | "tags">): boolean {
  return service.categoryName === "Muški frizeri"
    || service.tags.some((tag) => tag.toLowerCase().includes("muškar"));
}

async function synchronizeInferredServesMen(): Promise<void> {
  const activeServices = await db.select({
    salonId: servicesTable.salonId,
    categoryName: servicesTable.categoryName,
    tags: servicesTable.tags,
  }).from(servicesTable).where(eq(servicesTable.active, true));
  const salonIdsServingMen = [...new Set(activeServices.filter(serviceTargetsMen).map((service) => service.salonId))];

  await db.update(salonsTable)
    .set({ servesMen: false })
    .where(eq(salonsTable.servesMenManuallySet, false));
  if (salonIdsServingMen.length) {
    await db.update(salonsTable)
      .set({ servesMen: true })
      .where(and(
        eq(salonsTable.servesMenManuallySet, false),
        inArray(salonsTable.id, salonIdsServingMen),
      ));
  }
}

async function seedEducationContent(): Promise<void> {
  const [course] = await db.select().from(coursesTable).limit(1);
  if (!course) return;
  const [existingDay] = await db.select({ id: courseDaysTable.id }).from(courseDaysTable).where(eq(courseDaysTable.courseId, course.id)).limit(1);
  if (!existingDay) {
    await db.insert(courseDaysTable).values([
      { courseId: course.id, dayNumber: 1, title: "Osnove i priprema", description: "Uvod u materijal, bezbedan rad i priprema za praktičnu vežbu.", durationMinutes: 180, sortOrder: 1 },
      { courseId: course.id, dayNumber: 2, title: "Praktična tehnika", description: "Vođena demonstracija i samostalni rad uz povratnu informaciju instruktora.", durationMinutes: 240, sortOrder: 2 },
      { courseId: course.id, dayNumber: 3, title: "Završna praksa", description: "Primena kompletnog protokola i plan narednih koraka.", durationMinutes: 180, sortOrder: 3 },
    ]);
  }
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
        passwordSetAt: new Date(),
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

async function seedEducationMonetization(): Promise<void> {
  const [settings] = await db.select().from(educationPlatformSettingsTable).limit(1);
  const activeSettings = settings ?? (await db.insert(educationPlatformSettingsTable).values({}).returning())[0]!;
  const [plan] = await db.select().from(subscriptionPlansTable).where(eq(subscriptionPlansTable.active, true)).limit(1);
  const demoCenterNames = ["Akademija Ritual", "Studio Forma Edu", "Wellbeing Institut"];
  const centers = await db.select().from(educationCentersTable).where(inArray(educationCentersTable.name, demoCenterNames));
  for (const center of centers) {
    if (center.verificationStatus !== "verified") {
      await db.update(educationCentersTable).set({ verificationStatus: "verified", verifiedAt: new Date(), updatedAt: new Date() }).where(eq(educationCentersTable.id, center.id));
    }
    if (plan) {
      const [subscription] = await db.select().from(educationCenterSubscriptionsTable).where(eq(educationCenterSubscriptionsTable.centerId, center.id)).limit(1);
      if (!subscription) {
        await db.insert(educationCenterSubscriptionsTable).values({
          centerId: center.id, planId: plan.id, status: "active", dueAmount: plan.price,
          currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        });
      }
    }
  }
  const [enrollment] = await db.select().from(courseEnrollmentsTable)
    .innerJoin(coursesTable, eq(courseEnrollmentsTable.courseId, coursesTable.id))
    .where(inArray(coursesTable.centerId, centers.map((center) => center.id)))
    .limit(1);
  if (!enrollment || !enrollment.courses.centerId) return;
  const [existingEscrow] = await db.select().from(educationEscrowsTable).where(eq(educationEscrowsTable.enrollmentId, enrollment.course_enrollments.id)).limit(1);
  if (existingEscrow) return;
  const price = enrollment.courses.price;
  const platformFee = Math.floor(price * activeSettings.commissionPercent / 100);
  const reserveAmount = Math.floor(price * activeSettings.reservePercent / 100);
  const [escrow] = await db.insert(educationEscrowsTable).values({
    enrollmentId: enrollment.course_enrollments.id,
    centerId: enrollment.courses.centerId,
    grossAmount: price,
    platformFee,
    reserveAmount,
    netAmount: price - platformFee - reserveAmount,
    releaseAt: new Date(Date.now() + activeSettings.onlineRefundDays * 24 * 60 * 60 * 1000),
    paymentReference: `seed:${enrollment.course_enrollments.id}`,
  }).returning();
  await db.insert(educationLedgerEntriesTable).values([
    { escrowId: escrow!.id, enrollmentId: enrollment.course_enrollments.id, centerId: enrollment.courses.centerId, type: "charge", amount: price, note: "Demo potvrđena kupovina." },
    { escrowId: escrow!.id, enrollmentId: enrollment.course_enrollments.id, centerId: enrollment.courses.centerId, type: "platform_fee", amount: -platformFee, note: "Demo platformská provizija." },
    { escrowId: escrow!.id, enrollmentId: enrollment.course_enrollments.id, centerId: enrollment.courses.centerId, type: "reserve_hold", amount: -reserveAmount, note: "Demo zadržana rezerva." },
  ]);
  await db.insert(educationFinancialEventsTable).values({
    escrowId: escrow!.id, enrollmentId: enrollment.course_enrollments.id,
    eventType: "purchase_confirmed", nextStatus: "held", amount: price, note: "Demo monetizaciona evidencija.",
  });
  await db.insert(educationThreadsTable).values({
    enrollmentId: enrollment.course_enrollments.id,
    purchaserId: enrollment.course_enrollments.purchaserId,
    centerId: enrollment.courses.centerId,
  }).onConflictDoNothing();
}