import { Link, useLocation, useRoute } from "wouter";
import { 
  LayoutDashboard, Briefcase, GraduationCap, 
  UserCircle, Settings, LogOut, Loader2, Bell, Gift
} from "lucide-react";
import { useGetCurrentUser, useGetJobseekerDashboard, useLogout } from "@workspace/api-client-react";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

// Embed the components for the tabs
import CustomerBeautyJobsPage from "./customer-beauty-jobs";
import BusinessEducation from "./business-education";
import JobseekerProfile from "@/components/jobseeker/jobseeker-profile";
import JobseekerSettings from "@/components/jobseeker/jobseeker-settings";

export default function JobseekerDashboard() {
  const [, params] = useRoute("/poslovi/nalog/:tab?");
  const activeTab = params?.tab || "pregled";
  const [, setLocation] = useLocation();
  const { data: userResp, isLoading: userLoading } = useGetCurrentUser();
  const logout = useLogout();
  
  if (userLoading) {
    return (
      <Layout>
        <div className="flex h-screen items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </Layout>
    );
  }

  const user = userResp?.user;
  if (!user || user.role !== "JOBSEEKER") return null;

  const handleLogout = () => {
    logout.mutate(undefined, {
      onSuccess: () => setLocation("/")
    });
  };

  const navItems = [
    { id: "pregled", label: "Pregled", icon: LayoutDashboard },
    { id: "oglasi", label: "Moji oglasi", icon: Briefcase },
    { id: "edukacije", label: "Edukacije", icon: GraduationCap },
    { id: "profil", label: "Profil", icon: UserCircle },
    { id: "podesavanja", label: "Podešavanja", icon: Settings },
  ];

  return (
    <Layout>
      <div className="flex flex-col md:flex-row min-h-[calc(100vh-4rem)]">
        {/* Sidebar */}
        <aside className="w-full md:w-64 shrink-0 border-r bg-card md:sticky md:top-16 md:h-[calc(100vh-4rem)] p-4 flex flex-col gap-2 overflow-y-auto">
          <div className="mb-6 px-2">
            <h2 className="font-serif text-lg font-bold text-primary">Moj Nalog</h2>
            <p className="text-sm text-muted-foreground">{user.firstName} {user.lastName}</p>
          </div>
          
          <nav className="flex-1 space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id || (activeTab === "edukacije" && item.id === "edukacije");
              return (
                <Link key={item.id} href={`/poslovi/nalog/${item.id === "pregled" ? "" : item.id}`}>
                  <span className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors hover:bg-muted ${
                    isActive ? "bg-primary/10 text-primary hover:bg-primary/15" : "text-muted-foreground"
                  }`}>
                    <Icon className="h-4 w-4" />
                    {item.label}
                  </span>
                </Link>
              );
            })}
            <Link href="/preporuke">
              <span className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors hover:bg-muted text-primary bg-primary/5 border border-primary/10 mt-4">
                <Gift className="h-4 w-4" />
                Preporuke
              </span>
            </Link>
          </nav>

          <div className="pt-4 border-t mt-auto">
            <button onClick={handleLogout} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10">
              <LogOut className="h-4 w-4" />
              Odjavi se
            </button>
          </div>
        </aside>

        {/* Content */}
        <main className="flex-1">
          {activeTab === "pregled" && <DashboardOverview />}
          {activeTab === "oglasi" && <CustomerBeautyJobsPage hideLayout />}
          {activeTab === "edukacije" && <BusinessEducation hideLayout />}
          {activeTab === "profil" && <JobseekerProfile />}
          {activeTab === "podesavanja" && <JobseekerSettings />}
        </main>
      </div>
    </Layout>
  );
}

function DashboardOverview() {
  const { data: dashboard, isLoading } = useGetJobseekerDashboard();
  
  if (isLoading) {
    return (
      <div className="p-6 md:p-8 space-y-6">
        <Skeleton className="h-10 w-48" />
        <div className="grid gap-6 md:grid-cols-3">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-32 rounded-xl" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 md:p-8 space-y-6">
      <div>
        <h1 className="text-3xl font-serif font-bold text-foreground">Pregled</h1>
        <p className="text-muted-foreground mt-1">Dobrodošli u vaš radni prostor.</p>
      </div>
      
      <div className="grid gap-6 sm:grid-cols-2 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Aktivni oglasi</CardTitle>
            <Briefcase className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{dashboard?.activeListings || 0}</div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Primljene prijave/poruke</CardTitle>
            <Bell className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{dashboard?.receivedContacts || 0}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Upisane edukacije</CardTitle>
            <GraduationCap className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{dashboard?.enrollments || 0}</div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
