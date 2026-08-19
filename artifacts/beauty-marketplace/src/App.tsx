import { type ReactNode, useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useGetCurrentUser } from '@workspace/api-client-react';
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
import Salons from './pages/salons';
import SalonProfile from './pages/salon-profile';
import CustomerDashboard from './pages/customer-dashboard';
import OwnerDashboard from './pages/owner/dashboard';
import OwnerServices from './pages/owner/services';
import OwnerShop from './pages/owner/shop';
import OwnerCalendar from './pages/owner/calendar';
import OwnerLoyalty from './pages/owner/loyalty';
import AdminDashboard from './pages/admin/dashboard';
import AdminSalons from './pages/admin/salons';
import AdminUsers from './pages/admin/users';
import AdminLoyalty from './pages/admin/loyalty';
import AdminSubscriptions from './pages/admin/subscriptions';
import AdminReviews from './pages/admin/reviews';
import { Layout } from './components/layout';

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

function AdminGuard({ children }: { children: ReactNode }) {
  const [, setLocation] = useLocation();
  const { data, isLoading } = useGetCurrentUser();
  const user = data?.user;
  const isAdmin = user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN';

  useEffect(() => {
    if (isLoading) return;
    if (!user) setLocation('/prijava');
    else if (user.role === 'CUSTOMER') setLocation('/moj-nalog');
    else if (!isAdmin) setLocation('/');
  }, [isAdmin, isLoading, setLocation, user]);

  if (isLoading || !isAdmin) {
    return (
      <Layout>
        <div className="flex min-h-[50vh] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" data-testid="admin-route-loading" />
        </div>
      </Layout>
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
        <Route path="/saloni" component={Salons} />
        <Route path="/saloni/:slug" component={SalonProfile} />
        <Route path="/moj-nalog" component={CustomerDashboard} />
        
        <Route path="/vlasnik" component={OwnerDashboard} />
        <Route path="/vlasnik/kalendar" component={OwnerCalendar} />
        <Route path="/vlasnik/usluge" component={OwnerServices} />
        <Route path="/vlasnik/shop" component={OwnerShop} />
        <Route path="/vlasnik/loyalty" component={OwnerLoyalty} />
        
        <Route path="/edukacije"><PlaceholderPage title="Edukacije" /></Route>

        <Route path="/admin"><AdminGuard><AdminDashboard /></AdminGuard></Route>
        <Route path="/admin/saloni"><AdminGuard><AdminSalons /></AdminGuard></Route>
        <Route path="/admin/korisnici"><AdminGuard><AdminUsers /></AdminGuard></Route>
        <Route path="/admin/loyalty"><AdminGuard><AdminLoyalty /></AdminGuard></Route>
        <Route path="/admin/pretplate"><AdminGuard><AdminSubscriptions /></AdminGuard></Route>
        <Route path="/admin/recenzije"><AdminGuard><AdminReviews /></AdminGuard></Route>
        
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
