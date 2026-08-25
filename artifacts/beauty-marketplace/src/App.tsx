import { lazy, type ReactNode, Suspense, useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useGetCurrentUser, type UserRole } from '@workspace/api-client-react';
import { Loader2 } from 'lucide-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ClientSeoMetadata } from '@/components/client-seo-metadata';
import { RetailCartStatus } from '@/components/retail-cart-status';
import {
  Link,
  Route,
  Switch,
  useLocation,
  useSearch,
  Router as WouterRouter,
} from 'wouter';

import { homeForRole } from './lib/role-routing';
import { loginPathWithReturnTo } from './lib/auth-return';

// Every page boundary stays out of the initial bundle. Shared application
// providers, guards and the small route fallback are intentionally eager.
const Home = lazy(() => import('./pages/home'));
const Layout = lazy(() => import('./components/layout').then((module) => ({ default: module.Layout })));
const Auth = lazy(() => import('./pages/auth'));
const BusinessAuth = lazy(() => import('./pages/business-auth'));
const BusinessLanding = lazy(() => import('./pages/business-landing'));
const BusinessHub = lazy(() => import('./pages/business-hub'));
const BusinessEducation = lazy(() => import('./pages/business-education'));
const InstructorPublicProfilePage = lazy(() => import('./pages/business-education').then((module) => ({ default: module.InstructorPublicProfilePage })));
const EducationMarketplace = lazy(() => import('./pages/education-marketplace'));
const EducationPublicCenterPage = lazy(() => import('./pages/education-marketplace').then((module) => ({ default: module.EducationPublicCenterPage })));
const EducationPublicCourseDetail = lazy(() => import('./pages/education-marketplace').then((module) => ({ default: module.EducationPublicCourseDetail })));
const MarketplaceGuides = lazy(() => import('./pages/marketplace-guides'));
const LegalPage = lazy(() => import('./pages/legal'));

const BeautyJobs = lazy(() => import('./pages/beauty-jobs'));
const BeautyJobDetail = lazy(() => import('./pages/beauty-jobs-detail'));
const CustomerBeautyJobs = lazy(() => import('./pages/customer-beauty-jobs'));
const BusinessBeautyJobs = lazy(() => import('./pages/business-beauty-jobs'));
const AdminBeautyJobs = lazy(() => import('./pages/admin/beauty-jobs'));
const AdminRejectedBeautyJobs = lazy(() => import('./pages/admin/rejected-beauty-jobs'));

const PublicProducts = lazy(() => import('./pages/public-products'));
const RetailCartPage = lazy(() => import('./pages/retail-checkout').then((module) => ({ default: module.RetailCartPage })));
const RetailCheckoutPage = lazy(() => import('./pages/retail-checkout').then((module) => ({ default: module.RetailCheckoutPage })));
const RetailSuccessPage = lazy(() => import('./pages/retail-checkout').then((module) => ({ default: module.RetailSuccessPage })));
const RetailTrackingPage = lazy(() => import('./pages/retail-checkout').then((module) => ({ default: module.RetailTrackingPage })));
const Salons = lazy(() => import('./pages/salons'));
const SalonProfile = lazy(() => import('./pages/salon-profile'));
const CustomerDashboard = lazy(() => import('./pages/customer-dashboard'));
const OwnerDashboard = lazy(() => import('./pages/owner/dashboard'));
const OwnerResources = lazy(() => import('./pages/owner/resources'));
const OwnerSalonProfile = lazy(() => import('./pages/owner/profile'));
const OwnerServices = lazy(() => import('./pages/owner/services'));
const OwnerShop = lazy(() => import('./pages/owner/shop'));
const OwnerCalendar = lazy(() => import('./pages/owner/calendar'));
const OwnerLoyalty = lazy(() => import('./pages/owner/loyalty'));
const OwnerOrders = lazy(() => import('./pages/owner/orders'));
const OwnerProductDetail = lazy(() => import('./pages/owner/product-detail'));
const OwnerNotifications = lazy(() => import('./pages/owner/notifications'));
const OwnerEmployees = lazy(() => import('./pages/owner/employees'));
const OwnerRetention = lazy(() => import('./pages/owner/retention'));
const OwnerAutomations = lazy(() => import('./pages/owner/automations'));
const OwnerPackages = lazy(() => import('./pages/owner/packages'));
const OwnerPerformance = lazy(() => import('./pages/owner/performance'));
const OwnerAiAssistant = lazy(() => import('./pages/owner/ai-assistant'));
const OwnerCartPage = lazy(() => import('./pages/owner/checkout').then((module) => ({ default: module.OwnerCartPage })));
const OwnerCheckoutDeliveryPage = lazy(() => import('./pages/owner/checkout').then((module) => ({ default: module.OwnerCheckoutDeliveryPage })));
const OwnerCheckoutReviewPage = lazy(() => import('./pages/owner/checkout').then((module) => ({ default: module.OwnerCheckoutReviewPage })));
const OwnerOrderConfirmationPage = lazy(() => import('./pages/owner/checkout').then((module) => ({ default: module.OwnerOrderConfirmationPage })));
const OwnerInventory = lazy(() => import('./pages/owner/inventory'));
const OwnerStaffOps = lazy(() => import('./pages/owner/staff-ops'));
const WidgetBooking = lazy(() => import('./pages/widget-booking'));
const EmployeePortal = lazy(() => import('./pages/employee/portal'));
const BusinessGuidePage = lazy(() => import('./pages/business-guide'));
const EmployeePasswordChange = lazy(() => import('./pages/employee/portal').then((module) => ({ default: module.EmployeePasswordChange })));
const AdminDashboard = lazy(() => import('./pages/admin/dashboard'));
const AdminSalons = lazy(() => import('./pages/admin/salons'));
const AdminSalonDetail = lazy(() => import('./pages/admin/salon-detail'));
const AdminServiceTemplates = lazy(() => import('./pages/admin/service-templates'));
const AdminUsers = lazy(() => import('./pages/admin/users'));

const AdminProfile = lazy(() => import('./pages/admin/profile'));
const AdminLoyalty = lazy(() => import('./pages/admin/loyalty'));
const AdminRetentionSettings = lazy(() => import('./pages/admin/retention-settings'));
const AdminSubscriptions = lazy(() => import('./pages/admin/subscriptions'));
const AdminReviews = lazy(() => import('./pages/admin/reviews'));
const AdminProducts = lazy(() => import('./pages/admin/products'));
const AdminCategories = lazy(() => import('./pages/admin/categories'));
const AdminBrands = lazy(() => import('./pages/admin/brands'));
const AdminShipping = lazy(() => import('./pages/admin/shipping'));
const AdminOrders = lazy(() => import('./pages/admin/orders'));
const AdminEmailMarketing = lazy(() => import('./pages/admin/email-marketing'));
const AdminSmsDeliveries = lazy(() => import('./pages/admin/sms-deliveries'));
const AdminIntegrations = lazy(() => import('./pages/admin/integrations'));
const AdminEducationMarketplace = lazy(() => import('./pages/admin/education-marketplace'));

const queryClient = new QueryClient();

function NotFound() {
  return (
    <Layout>
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-muted/20">
        <h1 className="text-6xl font-serif font-bold text-primary mb-4">404</h1>
        <h2 className="text-2xl font-bold mb-2">Stranica nije pronađena</h2>
        <p className="text-muted-foreground mb-8">Tražena stranica ne postoji ili je premeštena.</p>
        <Link href="/" className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-8 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90">
          Nazad na početnu
        </Link>
      </div>
    </Layout>
  );
}

function InstructorPublicPage(props: any) {
  return <InstructorPublicProfilePage instructorId={props.params?.instructorId ?? ""} />;
}

function LegacyEducationRedirect() {
  const [, setLocation] = useLocation();
  const { data, isLoading } = useGetCurrentUser();

  useEffect(() => {
    if (isLoading) return;
    const role = data?.user?.role;
    if (role === "SALON_OWNER" || role === "EDUCATION_CENTER_OWNER" || role === "ADMIN" || role === "SUPER_ADMIN") {
      setLocation("/biznis/edukacije");
    } else if (role === "CUSTOMER") {
      setLocation("/moj-nalog");
    } else {
      setLocation("/saloni");
    }
  }, [data?.user?.role, isLoading, setLocation]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <Loader2 className="h-8 w-8 animate-spin text-primary" aria-label="Preusmeravanje" />
    </div>
  );
}

function RouteRedirect({ to }: { to: string }) {
  const [, setLocation] = useLocation();
  const searchString = useSearch();

  useEffect(() => {
    setLocation(`${to}${searchString}`);
  }, [searchString, setLocation, to]);

  return <RouteLoadingFallback />;
}

function LegacyBeautyJobsDashboardRedirect({
  tab = "my-jobs",
  newListing = false,
}: {
  tab?: "my-jobs" | "inbox";
  newListing?: boolean;
}) {
  const [, setLocation] = useLocation();
  const searchString = useSearch();
  const { data, isLoading } = useGetCurrentUser();
  const user = data?.user;

  useEffect(() => {
    if (isLoading) return;

    const currentPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (!user) {
      setLocation(loginPathWithReturnTo("/prijava", currentPath));
      return;
    }
    if (user.role === "SALON_EMPLOYEE") {
      setLocation("/zaposleni");
      return;
    }
    if (user.role === "ADMIN" || user.role === "SUPER_ADMIN") {
      setLocation("/admin/poslovi");
      return;
    }

    const destination = user.role === "SALON_OWNER" || user.role === "EDUCATION_CENTER_OWNER" || user.role === "INSTRUCTOR"
      ? "/biznis/poslovi"
      : "/moji-oglasi";
    const params = new URLSearchParams(searchString);
    params.set("tab", tab);
    if (newListing) params.set("new", "1");
    setLocation(`${destination}?${params.toString()}`);
  }, [isLoading, newListing, searchString, setLocation, tab, user]);

  return <RouteLoadingFallback />;
}

function RoleGuard({
  children,
  allowedRoles,
  loginPath,
  allowEmployeePasswordChange = false,
}: {
  children: ReactNode;
  allowedRoles: UserRole[];
  loginPath: string;
  allowEmployeePasswordChange?: boolean;
}) {
  const [, setLocation] = useLocation();
  const searchString = useSearch();
  const { data, isLoading } = useGetCurrentUser();
  const user = data?.user;
  const allowed = user ? allowedRoles.includes(user.role) : false;
  const passwordChangeRequired = user?.role === "SALON_EMPLOYEE" && user.mustChangePassword && !allowEmployeePasswordChange;

  useEffect(() => {
    if (isLoading) return;
    if (!user) {
      const currentPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      setLocation(loginPathWithReturnTo(loginPath, currentPath));
    }
    else if (passwordChangeRequired) setLocation("/zaposleni/promeni-lozinku");
    else if (!allowed) setLocation(homeForRole(user.role));
  }, [allowed, isLoading, loginPath, passwordChangeRequired, searchString, setLocation, user]);

  if (isLoading || !allowed || passwordChangeRequired) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" data-testid="protected-route-loading" />
      </div>
    );
  }

  return children;
}

function Router() {
  return (
    <RoutedErrorBoundary>
      <Suspense fallback={<RouteLoadingFallback />}>
        <Switch>
        <Route path="/" component={Home} />
        <Route path="/prijava" component={Auth} />
        <Route path="/student/prijava" component={Auth} />
        <Route path="/za-biznise" component={BusinessLanding} />
        <Route path="/poslovna-prijava"><BusinessAuth initialTab="login" /></Route>
        <Route path="/poslovna-registracija"><BusinessAuth initialTab="register" /></Route>
        <Route path="/saloni" component={Salons} />
        <Route path="/saloni/kategorija/:categorySlug" component={Salons} />
        <Route path="/saloni/:slug" component={SalonProfile} />
        <Route path="/beauty-poslovi/novi"><LegacyBeautyJobsDashboardRedirect newListing /></Route>
        <Route path="/beauty-poslovi/moji-oglasi"><LegacyBeautyJobsDashboardRedirect /></Route>
        <Route path="/beauty-poslovi/prijave"><LegacyBeautyJobsDashboardRedirect tab="inbox" /></Route>
        <Route path="/beauty-poslovi/:listingId" component={BeautyJobDetail} />
        <Route path="/beauty-poslovi"><RouteRedirect to="/poslovi" /></Route>
        <Route path="/poslovi" component={BeautyJobs} />
        <Route path="/poslovi/:slug/:listingId" component={BeautyJobDetail} />
        <Route path="/proizvodi" component={PublicProducts} />
        <Route path="/proizvodi/:productId" component={PublicProductDetail} />
        <Route path="/korpa" component={RetailCartPage} />
        <Route path="/korpa/placanje" component={RetailCheckoutPage} />
        <Route path="/korpa/uspeh" component={RetailSuccessPage} />
        <Route path="/porudzbina/pracenje" component={RetailTrackingPage} />
        <Route path="/inspiracija"><MarketplaceGuides kind="inspiration" /></Route>
        <Route path="/recnik"><MarketplaceGuides kind="glossary" /></Route>
        <Route path="/brendovi"><MarketplaceGuides kind="brands" /></Route>
        <Route path="/moj-nalog">
          <RoleGuard allowedRoles={['CUSTOMER']} loginPath="/prijava">
            <CustomerDashboard />
          </RoleGuard>
        </Route>
        <Route path="/moji-oglasi">
          <RoleGuard allowedRoles={['CUSTOMER', 'STUDENT']} loginPath="/prijava">
            <CustomerBeautyJobs />
          </RoleGuard>
        </Route>
        <Route path="/biznis/vodic">
          <RoleGuard allowedRoles={['SALON_OWNER', 'SALON_EMPLOYEE']} loginPath="/poslovna-prijava">
            <BusinessGuidePage />
          </RoleGuard>
        </Route>
        <Route path="/biznis/edukacije">
          <RoleGuard allowedRoles={['SALON_OWNER', 'SALON_EMPLOYEE', 'EDUCATION_CENTER_OWNER', 'ADMIN', 'SUPER_ADMIN']} loginPath="/poslovna-prijava">
            <BusinessEducation />
          </RoleGuard>
        </Route>
        <Route path="/biznis/edukacije/lms/:enrollmentId">
          <RoleGuard allowedRoles={['SALON_OWNER', 'SALON_EMPLOYEE', 'EDUCATION_CENTER_OWNER', 'ADMIN', 'SUPER_ADMIN']} loginPath="/poslovna-prijava">
            <BusinessEducation />
          </RoleGuard>
        </Route>
        <Route path="/moj-nalog/edukacije/lms/:enrollmentId">
          <RoleGuard allowedRoles={['CUSTOMER']} loginPath="/prijava">
            <BusinessEducation />
          </RoleGuard>
        </Route>
        <Route path="/student/edukacije">
          <RoleGuard allowedRoles={['STUDENT']} loginPath="/student/prijava">
            <BusinessEducation />
          </RoleGuard>
        </Route>
        <Route path="/student/edukacije/lms/:enrollmentId">
          <RoleGuard allowedRoles={['STUDENT']} loginPath="/student/prijava">
            <BusinessEducation />
          </RoleGuard>
        </Route>
        <Route path="/biznis/edukacije/:courseId">
          <RoleGuard allowedRoles={['SALON_OWNER', 'EDUCATION_CENTER_OWNER', 'ADMIN', 'SUPER_ADMIN']} loginPath="/poslovna-prijava">
            <BusinessEducation />
          </RoleGuard>
        </Route>
        <Route path="/biznis">
          <RoleGuard allowedRoles={['EDUCATION_CENTER_OWNER']} loginPath="/poslovna-prijava">
            <BusinessHub />
          </RoleGuard>
        </Route>
        <Route path="/zaposleni/promeni-lozinku"><RoleGuard allowedRoles={['SALON_EMPLOYEE']} loginPath="/poslovna-prijava" allowEmployeePasswordChange><EmployeePasswordChange /></RoleGuard></Route>
        <Route path="/zaposleni"><RoleGuard allowedRoles={['SALON_EMPLOYEE']} loginPath="/poslovna-prijava"><EmployeePortal /></RoleGuard></Route>

        <Route path="/vlasnik/kontrolna-tabla"><RoleGuard allowedRoles={['SALON_OWNER']} loginPath="/poslovna-prijava"><OwnerDashboard /></RoleGuard></Route>
        <Route path="/vlasnik"><RoleGuard allowedRoles={['SALON_OWNER']} loginPath="/poslovna-prijava"><OwnerDashboard /></RoleGuard></Route>
        <Route path="/vlasnik/kalendar"><RoleGuard allowedRoles={['SALON_OWNER']} loginPath="/poslovna-prijava"><OwnerCalendar /></RoleGuard></Route>
        <Route path="/vlasnik/resursi"><RoleGuard allowedRoles={['SALON_OWNER']} loginPath="/poslovna-prijava"><OwnerResources /></RoleGuard></Route>
        <Route path="/vlasnik/usluge"><RoleGuard allowedRoles={['SALON_OWNER']} loginPath="/poslovna-prijava"><OwnerServices /></RoleGuard></Route>
        <Route path="/vlasnik/profil"><RoleGuard allowedRoles={['SALON_OWNER']} loginPath="/poslovna-prijava"><OwnerSalonProfile /></RoleGuard></Route>
        <Route path="/vlasnik/zaposleni"><RoleGuard allowedRoles={['SALON_OWNER']} loginPath="/poslovna-prijava"><OwnerEmployees /></RoleGuard></Route>
        <Route path="/vlasnik/klijenti"><RoleGuard allowedRoles={['SALON_OWNER']} loginPath="/poslovna-prijava"><OwnerRetention /></RoleGuard></Route>
        <Route path="/vlasnik/inventar"><RoleGuard allowedRoles={['SALON_OWNER']} loginPath="/poslovna-prijava"><OwnerInventory /></RoleGuard></Route>
        <Route path="/vlasnik/radno-vreme"><RoleGuard allowedRoles={['SALON_OWNER']} loginPath="/poslovna-prijava"><OwnerStaffOps /></RoleGuard></Route>
        <Route path="/widget/:slug"><WidgetBooking /></Route>
        <Route path="/vlasnik/automatizacije"><RoleGuard allowedRoles={['SALON_OWNER']} loginPath="/poslovna-prijava"><OwnerAutomations /></RoleGuard></Route>
        <Route path="/vlasnik/paketi"><RoleGuard allowedRoles={['SALON_OWNER']} loginPath="/poslovna-prijava"><OwnerPackages /></RoleGuard></Route>
        <Route path="/vlasnik/performanse"><RoleGuard allowedRoles={['SALON_OWNER']} loginPath="/poslovna-prijava"><OwnerPerformance /></RoleGuard></Route>
        <Route path="/vlasnik/ai-asistent"><RoleGuard allowedRoles={['SALON_OWNER']} loginPath="/poslovna-prijava"><OwnerAiAssistant /></RoleGuard></Route>
        <Route path="/vlasnik/shop"><RoleGuard allowedRoles={['SALON_OWNER']} loginPath="/poslovna-prijava"><OwnerShop /></RoleGuard></Route>
        <Route path="/vlasnik/prodavnica/korpa"><RoleGuard allowedRoles={['SALON_OWNER']} loginPath="/poslovna-prijava"><OwnerCartPage /></RoleGuard></Route>
        <Route path="/vlasnik/prodavnica/dostava"><RoleGuard allowedRoles={['SALON_OWNER']} loginPath="/poslovna-prijava"><OwnerCheckoutDeliveryPage /></RoleGuard></Route>
        <Route path="/vlasnik/prodavnica/pregled"><RoleGuard allowedRoles={['SALON_OWNER']} loginPath="/poslovna-prijava"><OwnerCheckoutReviewPage /></RoleGuard></Route>
        <Route path="/vlasnik/prodavnica/porudzbina/:id/potvrda"><RoleGuard allowedRoles={['SALON_OWNER']} loginPath="/poslovna-prijava"><OwnerOrderConfirmationPage /></RoleGuard></Route>
        <Route path="/vlasnik/shop/proizvodi/:productId"><RoleGuard allowedRoles={['SALON_OWNER']} loginPath="/poslovna-prijava"><OwnerProductDetail /></RoleGuard></Route>
        <Route path="/biznis/poslovi"><RoleGuard allowedRoles={['SALON_OWNER', 'SALON_EMPLOYEE', 'EDUCATION_CENTER_OWNER', 'INSTRUCTOR']} loginPath="/poslovna-prijava"><BusinessBeautyJobs /></RoleGuard></Route>
        <Route path="/vlasnik/porudzbine/:orderId"><RoleGuard allowedRoles={['SALON_OWNER']} loginPath="/poslovna-prijava"><OwnerOrders /></RoleGuard></Route>
        <Route path="/vlasnik/porudzbine"><RoleGuard allowedRoles={['SALON_OWNER']} loginPath="/poslovna-prijava"><OwnerOrders /></RoleGuard></Route>
        <Route path="/vlasnik/obavestenja"><RoleGuard allowedRoles={['SALON_OWNER']} loginPath="/poslovna-prijava"><OwnerNotifications /></RoleGuard></Route>
        <Route path="/vlasnik/loyalty"><RoleGuard allowedRoles={['SALON_OWNER']} loginPath="/poslovna-prijava"><OwnerLoyalty /></RoleGuard></Route>

        <Route path="/edukacije/instruktori/:instructorId" component={InstructorPublicPage} />
        <Route path="/edukacije/centri/:centerId" component={EducationPublicCenterPage} />
        <Route path="/edukacije/:courseId" component={EducationPublicCourseDetail} />
        <Route path="/edukacije"><EducationMarketplace /></Route>

        <Route path="/admin"><RoleGuard allowedRoles={['ADMIN', 'SUPER_ADMIN']} loginPath="/poslovna-prijava"><AdminDashboard /></RoleGuard></Route>
        <Route path="/admin/saloni/:salonId"><RoleGuard allowedRoles={['ADMIN', 'SUPER_ADMIN']} loginPath="/poslovna-prijava"><AdminSalonDetail /></RoleGuard></Route>
        <Route path="/admin/saloni"><RoleGuard allowedRoles={['ADMIN', 'SUPER_ADMIN']} loginPath="/poslovna-prijava"><AdminSalons /></RoleGuard></Route>
        <Route path="/admin/predlosci-usluga"><RoleGuard allowedRoles={['ADMIN', 'SUPER_ADMIN']} loginPath="/poslovna-prijava"><AdminServiceTemplates /></RoleGuard></Route>
        <Route path="/admin/korisnici"><RoleGuard allowedRoles={['ADMIN', 'SUPER_ADMIN']} loginPath="/poslovna-prijava"><AdminUsers /></RoleGuard></Route>
        <Route path="/admin/poslovi/pregled/:listingId"><RoleGuard allowedRoles={['ADMIN', 'SUPER_ADMIN']} loginPath="/poslovna-prijava"><BeautyJobDetail /></RoleGuard></Route>
        <Route path="/admin/odbijeni-oglasi"><RoleGuard allowedRoles={['ADMIN', 'SUPER_ADMIN']} loginPath="/poslovna-prijava"><AdminRejectedBeautyJobs /></RoleGuard></Route>
        <Route path="/admin/poslovi"><RoleGuard allowedRoles={['ADMIN', 'SUPER_ADMIN']} loginPath="/poslovna-prijava"><AdminBeautyJobs /></RoleGuard></Route>
        <Route path="/admin/profil"><RoleGuard allowedRoles={['ADMIN', 'SUPER_ADMIN']} loginPath="/poslovna-prijava"><AdminProfile /></RoleGuard></Route>
        <Route path="/admin/loyalty"><RoleGuard allowedRoles={['ADMIN', 'SUPER_ADMIN']} loginPath="/poslovna-prijava"><AdminLoyalty /></RoleGuard></Route>
        <Route path="/admin/retencija"><RoleGuard allowedRoles={['ADMIN', 'SUPER_ADMIN']} loginPath="/poslovna-prijava"><AdminRetentionSettings /></RoleGuard></Route>
        <Route path="/admin/proizvodi"><RoleGuard allowedRoles={['ADMIN', 'SUPER_ADMIN']} loginPath="/poslovna-prijava"><AdminProducts /></RoleGuard></Route>
        <Route path="/admin/kategorije"><RoleGuard allowedRoles={['ADMIN', 'SUPER_ADMIN']} loginPath="/poslovna-prijava"><AdminCategories /></RoleGuard></Route>
        <Route path="/admin/brendovi"><RoleGuard allowedRoles={['ADMIN', 'SUPER_ADMIN']} loginPath="/poslovna-prijava"><AdminBrands /></RoleGuard></Route>
        <Route path="/admin/dostava"><RoleGuard allowedRoles={['ADMIN', 'SUPER_ADMIN']} loginPath="/poslovna-prijava"><AdminShipping /></RoleGuard></Route>
        <Route path="/admin/email-marketing"><RoleGuard allowedRoles={['ADMIN', 'SUPER_ADMIN']} loginPath="/poslovna-prijava"><AdminEmailMarketing /></RoleGuard></Route>
        <Route path="/admin/sms-evidencija"><RoleGuard allowedRoles={['ADMIN', 'SUPER_ADMIN']} loginPath="/poslovna-prijava"><AdminSmsDeliveries /></RoleGuard></Route>
        <Route path="/admin/integracije"><RoleGuard allowedRoles={['ADMIN', 'SUPER_ADMIN']} loginPath="/poslovna-prijava"><AdminIntegrations /></RoleGuard></Route>
        <Route path="/admin/porudzbine/:orderId"><RoleGuard allowedRoles={['ADMIN', 'SUPER_ADMIN']} loginPath="/poslovna-prijava"><AdminOrders /></RoleGuard></Route>
        <Route path="/admin/porudzbine"><RoleGuard allowedRoles={['ADMIN', 'SUPER_ADMIN']} loginPath="/poslovna-prijava"><AdminOrders /></RoleGuard></Route>
        <Route path="/admin/pretplate"><RoleGuard allowedRoles={['ADMIN', 'SUPER_ADMIN']} loginPath="/poslovna-prijava"><AdminSubscriptions /></RoleGuard></Route>
        <Route path="/admin/edukacije"><RoleGuard allowedRoles={['ADMIN', 'SUPER_ADMIN']} loginPath="/poslovna-prijava"><AdminEducationMarketplace /></RoleGuard></Route>
        <Route path="/admin/recenzije"><RoleGuard allowedRoles={['ADMIN', 'SUPER_ADMIN']} loginPath="/poslovna-prijava"><AdminReviews /></RoleGuard></Route>

        <Route path="/uslovi-koriscenja"><LegalPage pagePath="/uslovi-koriscenja" /></Route>
        <Route path="/politika-privatnosti"><LegalPage pagePath="/politika-privatnosti" /></Route>
        <Route path="/politika-kolacica"><LegalPage pagePath="/politika-kolacica" /></Route>
        <Route path="/uslovi-kupovine"><LegalPage pagePath="/uslovi-kupovine" /></Route>
        <Route path="/otkazivanje-termina"><LegalPage pagePath="/otkazivanje-termina" /></Route>
        <Route path="/povracaj-sredstava"><LegalPage pagePath="/povracaj-sredstava" /></Route>

          <Route component={NotFound} />
        </Switch>
      </Suspense>
    </RoutedErrorBoundary>
  );
}

function RouteLoadingFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background" data-testid="route-loading">
      <Loader2 className="h-8 w-8 animate-spin text-primary" aria-label="Učitavanje stranice" />
    </div>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <ClientSeoMetadata />
          <RetailCartStatus />
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;

const PublicProductDetail = lazy(() => import('./pages/public-products').then((module) => ({ default: module.PublicProductDetailPage })));
