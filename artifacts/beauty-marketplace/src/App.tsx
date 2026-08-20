import { type ReactNode, useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useGetCurrentUser, type UserRole } from '@workspace/api-client-react';
import { Loader2 } from 'lucide-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import {
  Route,
  Switch,
  useLocation,
  Router as WouterRouter,
} from 'wouter';

// Pages
import Home from './pages/home';
import Auth from './pages/auth';
import BusinessAuth from './pages/business-auth';
import BusinessLanding from './pages/business-landing';
import BusinessHub from './pages/business-hub';
import BusinessEducation from './pages/business-education';
import MarketplaceGuides from './pages/marketplace-guides';
import Salons from './pages/salons';
import SalonProfile from './pages/salon-profile';
import CustomerDashboard from './pages/customer-dashboard';
import OwnerDashboard from './pages/owner/dashboard';
import OwnerServices from './pages/owner/services';
import OwnerShop from './pages/owner/shop';
import OwnerCalendar from './pages/owner/calendar';
import OwnerLoyalty from './pages/owner/loyalty';
import OwnerOrders from './pages/owner/orders';
import OwnerProductDetail from './pages/owner/product-detail';
import AdminDashboard from './pages/admin/dashboard';
import AdminSalons from './pages/admin/salons';
import AdminUsers from './pages/admin/users';
import AdminLoyalty from './pages/admin/loyalty';
import AdminSubscriptions from './pages/admin/subscriptions';
import AdminReviews from './pages/admin/reviews';
import AdminProducts from './pages/admin/products';
import AdminCategories from './pages/admin/categories';
import AdminBrands from './pages/admin/brands';
import AdminShipping from './pages/admin/shipping';
import AdminOrders from './pages/admin/orders';
import { Layout } from './components/layout';
import { homeForRole } from './lib/role-routing';

const queryClient = new QueryClient();

function NotFound() {
  return (
    <Layout>
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-muted/20">
        <h1 className="text-6xl font-serif font-bold text-primary mb-4">404</h1>
        <h2 className="text-2xl font-bold mb-2">Stranica nije pronađena</h2>
        <p className="text-muted-foreground mb-8">Tražena stranica ne postoji ili je premeštena.</p>
        <a href="/" className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-8 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90">
          Nazad na početnu
        </a>
      </div>
    </Layout>
  );
}

function PlaceholderPage({ title }: { title: string }) {
  return (
    <Layout>
      <div className="container mx-auto px-4 py-20 text-center">
        <h1 className="text-4xl font-serif font-bold mb-4">{title}</h1>
        <p className="text-muted-foreground max-w-lg mx-auto">Sadržaj ove stranice je u pripremi i biće dostupan uskoro.</p>
      </div>
    </Layout>
  )
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

function RoleGuard({
  children,
  allowedRoles,
  loginPath,
}: {
  children: ReactNode;
  allowedRoles: UserRole[];
  loginPath: string;
}) {
  const [, setLocation] = useLocation();
  const { data, isLoading } = useGetCurrentUser();
  const user = data?.user;
  const allowed = user ? allowedRoles.includes(user.role) : false;

  useEffect(() => {
    if (isLoading) return;
    if (!user) setLocation(loginPath);
    else if (!allowed) setLocation(homeForRole(user.role));
  }, [allowed, isLoading, loginPath, setLocation, user]);

  if (isLoading || !allowed) {
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
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/prijava" component={Auth} />
        <Route path="/za-biznise" component={BusinessLanding} />
        <Route path="/poslovna-prijava"><BusinessAuth initialTab="login" /></Route>
        <Route path="/poslovna-registracija"><BusinessAuth initialTab="register" /></Route>
        <Route path="/saloni" component={Salons} />
        <Route path="/saloni/:slug" component={SalonProfile} />
        <Route path="/inspiracija"><MarketplaceGuides kind="inspiration" /></Route>
        <Route path="/recnik"><MarketplaceGuides kind="glossary" /></Route>
        <Route path="/brendovi"><MarketplaceGuides kind="brands" /></Route>
        <Route path="/moj-nalog">
          <RoleGuard allowedRoles={['CUSTOMER']} loginPath="/prijava">
            <CustomerDashboard />
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
        
        <Route path="/vlasnik"><RoleGuard allowedRoles={['SALON_OWNER']} loginPath="/poslovna-prijava"><OwnerDashboard /></RoleGuard></Route>
        <Route path="/vlasnik/kalendar"><RoleGuard allowedRoles={['SALON_OWNER']} loginPath="/poslovna-prijava"><OwnerCalendar /></RoleGuard></Route>
        <Route path="/vlasnik/usluge"><RoleGuard allowedRoles={['SALON_OWNER']} loginPath="/poslovna-prijava"><OwnerServices /></RoleGuard></Route>
        <Route path="/vlasnik/shop"><RoleGuard allowedRoles={['SALON_OWNER']} loginPath="/poslovna-prijava"><OwnerShop /></RoleGuard></Route>
        <Route path="/vlasnik/shop/proizvodi/:productId"><RoleGuard allowedRoles={['SALON_OWNER']} loginPath="/poslovna-prijava"><OwnerProductDetail /></RoleGuard></Route>
        <Route path="/vlasnik/porudzbine/:orderId"><RoleGuard allowedRoles={['SALON_OWNER']} loginPath="/poslovna-prijava"><OwnerOrders /></RoleGuard></Route>
        <Route path="/vlasnik/porudzbine"><RoleGuard allowedRoles={['SALON_OWNER']} loginPath="/poslovna-prijava"><OwnerOrders /></RoleGuard></Route>
        <Route path="/vlasnik/loyalty"><RoleGuard allowedRoles={['SALON_OWNER']} loginPath="/poslovna-prijava"><OwnerLoyalty /></RoleGuard></Route>
        
        <Route path="/edukacije"><LegacyEducationRedirect /></Route>

        <Route path="/admin"><RoleGuard allowedRoles={['ADMIN', 'SUPER_ADMIN']} loginPath="/poslovna-prijava"><AdminDashboard /></RoleGuard></Route>
        <Route path="/admin/saloni"><RoleGuard allowedRoles={['ADMIN', 'SUPER_ADMIN']} loginPath="/poslovna-prijava"><AdminSalons /></RoleGuard></Route>
        <Route path="/admin/korisnici"><RoleGuard allowedRoles={['ADMIN', 'SUPER_ADMIN']} loginPath="/poslovna-prijava"><AdminUsers /></RoleGuard></Route>
        <Route path="/admin/loyalty"><RoleGuard allowedRoles={['ADMIN', 'SUPER_ADMIN']} loginPath="/poslovna-prijava"><AdminLoyalty /></RoleGuard></Route>
        <Route path="/admin/proizvodi"><RoleGuard allowedRoles={['ADMIN', 'SUPER_ADMIN']} loginPath="/poslovna-prijava"><AdminProducts /></RoleGuard></Route>
        <Route path="/admin/kategorije"><RoleGuard allowedRoles={['ADMIN', 'SUPER_ADMIN']} loginPath="/poslovna-prijava"><AdminCategories /></RoleGuard></Route>
        <Route path="/admin/brendovi"><RoleGuard allowedRoles={['ADMIN', 'SUPER_ADMIN']} loginPath="/poslovna-prijava"><AdminBrands /></RoleGuard></Route>
        <Route path="/admin/dostava"><RoleGuard allowedRoles={['ADMIN', 'SUPER_ADMIN']} loginPath="/poslovna-prijava"><AdminShipping /></RoleGuard></Route>
        <Route path="/admin/porudzbine/:orderId"><RoleGuard allowedRoles={['ADMIN', 'SUPER_ADMIN']} loginPath="/poslovna-prijava"><AdminOrders /></RoleGuard></Route>
        <Route path="/admin/porudzbine"><RoleGuard allowedRoles={['ADMIN', 'SUPER_ADMIN']} loginPath="/poslovna-prijava"><AdminOrders /></RoleGuard></Route>
        <Route path="/admin/pretplate"><RoleGuard allowedRoles={['ADMIN', 'SUPER_ADMIN']} loginPath="/poslovna-prijava"><AdminSubscriptions /></RoleGuard></Route>
        <Route path="/admin/recenzije"><RoleGuard allowedRoles={['ADMIN', 'SUPER_ADMIN']} loginPath="/poslovna-prijava"><AdminReviews /></RoleGuard></Route>
        
        <Route path="/uslovi-koriscenja"><PlaceholderPage title="Uslovi korišćenja" /></Route>
        <Route path="/politika-privatnosti"><PlaceholderPage title="Politika privatnosti" /></Route>
        <Route path="/politika-kolacica"><PlaceholderPage title="Politika kolačića" /></Route>
        <Route path="/uslovi-kupovine"><PlaceholderPage title="Uslovi kupovine" /></Route>
        <Route path="/otkazivanje-termina"><PlaceholderPage title="Otkazivanje termina" /></Route>
        <Route path="/povracaj-sredstava"><PlaceholderPage title="Povraćaj sredstava" /></Route>
        
        <Route component={NotFound} />
      </Switch>
    </RoutedErrorBoundary>
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
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
