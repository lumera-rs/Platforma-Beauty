import { useState, useEffect, useRef } from "react";
import { AdminLayout } from "./layout";
import { useAdminCreateAccountSetup, useAdminReissueAccountSetup, useAdminListUsers, useAdminUpdateUser, getAdminListUsersQueryKey, useGetCurrentUser, useAdminListSalons, getAdminListSalonsQueryKey, useListAdminEducationCenters, getListAdminEducationCentersQueryKey, useAdminConvertUserToBusinessAccount, useAdminGetBusinessRoleTransition, useAdminTransitionBusinessRole, getAdminGetBusinessRoleTransitionQueryKey } from "@workspace/api-client-react";
import type { AdminCreateAccountSetupInput, AdminUserUpdateRole, AdminListUsersRole, AdminUser, AdminBusinessAccountConversionInput, AdminBusinessRoleTransitionInput, AdminBusinessRoleTransitionState, AdminBusinessRelation, AdminBusinessRelationAllowedActionsItem } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Loader2, Search, Users as UsersIcon, Mail, FilterX, UserPlus, Copy, Check, Briefcase, LogOut, ShieldAlert } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useDebouncedSearch } from "@/hooks/use-debounce";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type AccountForm = {
  firstName: string;
  lastName: string;
  email: string;
  role: AdminCreateAccountSetupInput["role"];
  salon: {
    name: string;
    slug: string;
    city: string;
    municipality: string;
    address: string;
    postalCode: string;
    phone: string;
    email: string;
    companyName: string;
    companyTaxId: string;
    companyRegistrationNumber: string;
    companyAddress: string;
    companyCity: string;
    companyPostalCode: string;
    shortDescription: string;
    description: string;
  };
  employee: { salonId: string; jobTitle: string; bio: string };
  educationCenter: {
    name: string;
    city: string;
    description: string;
    contactEmail: string;
    contactPhone: string;
    contactAddress: string;
    pib: string;
  };
  instructor: {
    centerId: string;
    biography: string;
    industryYears: string;
    experienceYears: string;
    specializations: string;
    qualifications: string;
  };
};

const emptyAccountForm = (): AccountForm => ({
  firstName: "",
  lastName: "",
  email: "",
  role: "CUSTOMER",
  salon: {
    name: "", slug: "", city: "", municipality: "", address: "", postalCode: "",
    phone: "", email: "", companyName: "", companyTaxId: "",
    companyRegistrationNumber: "", companyAddress: "", companyCity: "",
    companyPostalCode: "", shortDescription: "", description: "",
  },
  employee: { salonId: "", jobTitle: "", bio: "" },
  educationCenter: {
    name: "", city: "", description: "", contactEmail: "", contactPhone: "",
    contactAddress: "", pib: "",
  },
  instructor: {
    centerId: "", biography: "", industryYears: "", experienceYears: "",
    specializations: "", qualifications: "",
  },
});

const roleNames: Record<string, string> = {
  CUSTOMER: "klijenta",
  JOBSEEKER: "tražioca posla",
  STUDENT: "studenta",
  ADMIN: "administratora",
  SALON_OWNER: "vlasnika salona",
  SALON_EMPLOYEE: "zaposlenog u salonu",
  EDUKATIVNI_CENTAR: "edukativnog centra",
  INSTRUCTOR: "instruktora",
};

type BusinessExitDecisionOption = {
  value: string;
  label: string;
  description?: string;
};

type BusinessExitRelation = {
  id: string;
  type: keyof Pick<AdminBusinessRoleTransitionInput, "salonOwnerships" | "employments" | "educationCenterOwnerships" | "instructorRelations">;
  label: string;
  active: boolean;
  description?: string;
  decisions: BusinessExitDecisionOption[];
};

const businessExitTargetRoles = ["CUSTOMER", "JOBSEEKER", "STUDENT", "ADMIN"] as const satisfies readonly AdminBusinessRoleTransitionInput["role"][];
type BusinessExitTargetRole = typeof businessExitTargetRoles[number];

const businessExitRelationGroups: Array<{
  type: BusinessExitRelation["type"];
  label: string;
}> = [
  { type: "salonOwnerships", label: "Salon u vlasništvu" },
  { type: "employments", label: "Radni odnos u salonu" },
  { type: "educationCenterOwnerships", label: "Edukativni centar u vlasništvu" },
  { type: "instructorRelations", label: "Angažman instruktora" },
];

const decisionLabels: Record<AdminBusinessRelationAllowedActionsItem, string> = {
  transfer: "Prenesi na drugog korisnika",
  deactivate: "Deaktiviraj za buduću upotrebu",
  retain: "Zadrži postojeću vezu",
  unlink: "Prekini aktivnu povezanost",
};

function toBusinessExitRelations(state: AdminBusinessRoleTransitionState): BusinessExitRelation[] {
  return businessExitRelationGroups.flatMap(({ type, label }) =>
    state[type].map((relation: AdminBusinessRelation) => ({
      id: relation.id,
      type,
      label: relation.name,
      active: relation.active,
      description: label,
      decisions: relation.allowedActions.map((action) => ({ value: action, label: decisionLabels[action] })),
    })),
  );
}

function buildBusinessExitInput(
  role: AdminBusinessRoleTransitionInput["role"],
  active: boolean,
  relations: BusinessExitRelation[],
  decisions: Record<string, string>,
  transferTargets: Record<string, string>,
): AdminBusinessRoleTransitionInput {
  const input: AdminBusinessRoleTransitionInput = {
    role,
    active,
    activeSalonId: null,
    salonOwnerships: [],
    employments: [],
    educationCenterOwnerships: [],
    instructorRelations: [],
  };

  relations.forEach((relation) => {
    const action = decisions[relation.id]!;
    if (relation.type === "salonOwnerships" || relation.type === "educationCenterOwnerships") {
      input[relation.type].push({
        relationId: relation.id,
        action: action as AdminBusinessRoleTransitionInput["salonOwnerships"][number]["action"],
        ...(action === "transfer" ? { targetUserId: transferTargets[relation.id]!.trim() } : {}),
      });
    } else if (relation.type === "employments") {
      input.employments.push({
        relationId: relation.id,
        action: action as AdminBusinessRoleTransitionInput["employments"][number]["action"],
      });
    } else {
      input.instructorRelations.push({
        relationId: relation.id,
        action: action as AdminBusinessRoleTransitionInput["instructorRelations"][number]["action"],
      });
    }
  });

  return input;
}

function getApiError(error: unknown) {
  const apiError = typeof error === "object" && error !== null
    ? error as { status?: number; message?: string; response?: { status?: number; data?: { message?: string } }; data?: { message?: string } }
    : {};
  const status = apiError.status ?? apiError.response?.status;
  const message = apiError.response?.data?.message ?? apiError.data?.message ?? apiError.message;
  if (status === 409) {
    return "Podaci su u međuvremenu promenjeni. Ponovo učitajte pregled i donesite odluke za aktuelne veze.";
  }
  return message || "Izlazak iz poslovne uloge nije uspeo. Pokušajte ponovo.";
}

function BusinessFields({
  form,
  setForm,
  salonSearch,
  setSalonSearch,
  salonsLoading,
  salonsError,
  availableSalons,
  centersLoading,
  centersError,
  availableCenters,
}: {
  form: AccountForm;
  setForm: React.Dispatch<React.SetStateAction<AccountForm>>;
  salonSearch: string;
  setSalonSearch: React.Dispatch<React.SetStateAction<string>>;
  salonsLoading: boolean;
  salonsError: unknown;
  availableSalons: any[] | undefined;
  centersLoading: boolean;
  centersError: unknown;
  availableCenters: any[] | undefined;
}) {
  return (
    <>
      {form.role === "SALON_OWNER" && (
        <fieldset className="grid gap-4 border-t pt-4 sm:grid-cols-2">
          <legend className="px-1 text-sm font-semibold">Salon i poslovni podaci</legend>
          {([
            ["name", "Naziv salona"], ["slug", "URL oznaka (slug)"], ["city", "Grad"],
            ["municipality", "Opština"], ["address", "Adresa"], ["postalCode", "Poštanski broj (opciono)"],
            ["phone", "Telefon salona"], ["email", "E-mail salona"], ["companyName", "Naziv pravnog lica"],
            ["companyTaxId", "PIB"], ["companyRegistrationNumber", "Matični broj"],
            ["companyAddress", "Adresa pravnog lica"], ["companyCity", "Grad pravnog lica"],
            ["companyPostalCode", "Poštanski broj pravnog lica (opciono)"], ["shortDescription", "Kratak opis"],
          ] as const).map(([key, label]) => (
            <div className="space-y-2" key={key}>
              <Label htmlFor={`salon-${key}`}>{label}</Label>
              <Input id={`salon-${key}`} required={!["postalCode", "companyPostalCode"].includes(key)} value={form.salon[key as keyof typeof form.salon]} onChange={(event) => setForm((value) => ({ ...value, salon: { ...value.salon, [key]: event.target.value } }))} data-testid={`input-salon-${key}`} />
            </div>
          ))}
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="salon-description">Opis salona</Label>
            <Textarea id="salon-description" required value={form.salon.description} onChange={(event) => setForm((value) => ({ ...value, salon: { ...value.salon, description: event.target.value } }))} data-testid="textarea-salon-description" />
          </div>
        </fieldset>
      )}

      {form.role === "SALON_EMPLOYEE" && (
        <fieldset className="space-y-4 border-t pt-4">
          <legend className="px-1 text-sm font-semibold">Radni profil</legend>
          <div className="space-y-2">
            <Label htmlFor="employee-salon">Salon</Label>
            <Input value={salonSearch} onChange={(event) => setSalonSearch(event.target.value)} placeholder="Pretraži aktivne salone" aria-label="Pretraži aktivne salone" data-testid="input-employee-salon-search" />
            <Select value={form.employee.salonId} onValueChange={(salonId) => setForm((value) => ({ ...value, employee: { ...value.employee, salonId } }))}>
              <SelectTrigger id="employee-salon" data-testid="select-employee-salon"><SelectValue placeholder={salonsLoading ? "Učitavanje salona..." : "Izaberite salon"} /></SelectTrigger>
              <SelectContent>{availableSalons?.map((salon) => <SelectItem key={salon.id} value={salon.id}>{salon.name} — {salon.city}</SelectItem>)}</SelectContent>
            </Select>
            {!!salonsError && <p className="text-sm text-destructive" role="alert" data-testid="error-salon-list">Saloni nisu mogli biti učitani.</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="employee-job-title">Pozicija</Label>
            <Input id="employee-job-title" required value={form.employee.jobTitle} onChange={(event) => setForm((value) => ({ ...value, employee: { ...value.employee, jobTitle: event.target.value } }))} data-testid="input-employee-job-title" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="employee-bio">Biografija (opciono)</Label>
            <Textarea id="employee-bio" value={form.employee.bio} onChange={(event) => setForm((value) => ({ ...value, employee: { ...value.employee, bio: event.target.value } }))} data-testid="textarea-employee-bio" />
          </div>
        </fieldset>
      )}

      {form.role === "EDUKATIVNI_CENTAR" && (
        <fieldset className="grid gap-4 border-t pt-4 sm:grid-cols-2">
          <legend className="px-1 text-sm font-semibold">Profil edukativnog centra</legend>
          {([
            ["name", "Naziv centra", "text"], ["city", "Grad", "text"],
            ["contactEmail", "Kontakt e-mail", "email"], ["contactPhone", "Kontakt telefon", "tel"],
            ["contactAddress", "Kontakt adresa", "text"], ["pib", "PIB", "text"],
          ] as const).map(([key, label, type]) => (
            <div className="space-y-2" key={key}>
              <Label htmlFor={`center-${key}`}>{label}</Label>
              <Input id={`center-${key}`} type={type} required value={form.educationCenter[key as keyof typeof form.educationCenter]} onChange={(event) => setForm((value) => ({ ...value, educationCenter: { ...value.educationCenter, [key]: event.target.value } }))} data-testid={`input-center-${key}`} />
            </div>
          ))}
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="center-description">Opis centra</Label>
            <Textarea id="center-description" required value={form.educationCenter.description} onChange={(event) => setForm((value) => ({ ...value, educationCenter: { ...value.educationCenter, description: event.target.value } }))} data-testid="textarea-center-description" />
          </div>
        </fieldset>
      )}

      {form.role === "INSTRUCTOR" && (
        <fieldset className="grid gap-4 border-t pt-4 sm:grid-cols-2">
          <legend className="px-1 text-sm font-semibold">Profil instruktora</legend>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="instructor-center">Edukativni centar</Label>
            <Select value={form.instructor.centerId} onValueChange={(centerId) => setForm((value) => ({ ...value, instructor: { ...value.instructor, centerId } }))}>
              <SelectTrigger id="instructor-center" data-testid="select-instructor-center"><SelectValue placeholder={centersLoading ? "Učitavanje centara..." : "Izaberite centar"} /></SelectTrigger>
              <SelectContent>{availableCenters?.filter((center: any) => !["rejected", "suspended"].includes(center.verificationStatus)).map((center: any) => <SelectItem key={center.id} value={center.id}>{center.name} — {center.city}</SelectItem>)}</SelectContent>
            </Select>
            {!!centersError && <p className="text-sm text-destructive" role="alert" data-testid="error-center-list">Centri nisu mogli biti učitani.</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="instructor-industry-years">Godine u industriji (opciono)</Label>
            <Input id="instructor-industry-years" type="number" min="0" step="1" value={form.instructor.industryYears} onChange={(event) => setForm((value) => ({ ...value, instructor: { ...value.instructor, industryYears: event.target.value } }))} data-testid="input-instructor-industry-years" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="instructor-experience-years">Godine predavačkog iskustva (opciono)</Label>
            <Input id="instructor-experience-years" type="number" min="0" step="1" value={form.instructor.experienceYears} onChange={(event) => setForm((value) => ({ ...value, instructor: { ...value.instructor, experienceYears: event.target.value } }))} data-testid="input-instructor-experience-years" />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="instructor-biography">Biografija (opciono)</Label>
            <Textarea id="instructor-biography" value={form.instructor.biography} onChange={(event) => setForm((value) => ({ ...value, instructor: { ...value.instructor, biography: event.target.value } }))} data-testid="textarea-instructor-biography" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="instructor-specializations">Specijalizacije (odvojene zarezom)</Label>
            <Input id="instructor-specializations" value={form.instructor.specializations} onChange={(event) => setForm((value) => ({ ...value, instructor: { ...value.instructor, specializations: event.target.value } }))} data-testid="input-instructor-specializations" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="instructor-qualifications">Kvalifikacije (odvojene zarezom)</Label>
            <Input id="instructor-qualifications" value={form.instructor.qualifications} onChange={(event) => setForm((value) => ({ ...value, instructor: { ...value.instructor, qualifications: event.target.value } }))} data-testid="input-instructor-qualifications" />
          </div>
        </fieldset>
      )}
    </>
  );
}

export default function AdminUsers() {
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedSearch(search);
  
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [activeFilter, setActiveFilter] = useState<string>("all");

  const [page, setPage] = useState(1);
  const pageSize = 50;
  // Reset to the first page whenever any filter changes so results stay reachable.
  useEffect(() => { setPage(1); }, [debouncedSearch, roleFilter, activeFilter]);

  const queryParams = {
    search: debouncedSearch || undefined,
    role: roleFilter === "all" ? undefined : (roleFilter as AdminListUsersRole),
    active: activeFilter === "all" ? undefined : activeFilter === "true",
    page,
    pageSize,
  };

  const { data: users, isLoading, error } = useAdminListUsers(queryParams);
  // customFetch returns only the body; infer next-page availability from length.
  const hasNextPage = (users?.length ?? 0) === pageSize;
  const { data: currentUserResponse } = useGetCurrentUser();
  const updateUser = useAdminUpdateUser();
  const createCustomer = useAdminCreateAccountSetup();
  const reissueCustomerSetup = useAdminReissueAccountSetup();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const canManageUsers = currentUserResponse?.user?.role === "SUPER_ADMIN";
  const convertUser = useAdminConvertUserToBusinessAccount();
  const [createOpen, setCreateOpen] = useState(false);
  const [convertOpen, setConvertOpen] = useState(false);
  const [userToConvert, setUserToConvert] = useState<AdminUser | null>(null);
  const [exitOpen, setExitOpen] = useState(false);
  const [userToExit, setUserToExit] = useState<AdminUser | null>(null);
  const [exitTargetRole, setExitTargetRole] = useState("");
  const [exitDecisions, setExitDecisions] = useState<Record<string, string>>({});
  const [exitTransferTargets, setExitTransferTargets] = useState<Record<string, string>>({});
  const [exitValidationError, setExitValidationError] = useState("");
  const [customerForm, setCustomerForm] = useState<AccountForm>(emptyAccountForm());
  const [convertForm, setConvertForm] = useState<AccountForm>(emptyAccountForm());
  const [salonSearch, setSalonSearch] = useState("");
  const debouncedSalonSearch = useDebouncedSearch(salonSearch);
  const [setupResult, setSetupResult] = useState<{ setupUrl: string; expiresAt: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const needsSalonList = (createOpen && !setupResult && customerForm.role === "SALON_EMPLOYEE") || (convertOpen && convertForm.role === "SALON_EMPLOYEE");
  const needsCenterList = (createOpen && !setupResult && customerForm.role === "INSTRUCTOR") || (convertOpen && convertForm.role === "INSTRUCTOR");
  const salonListParams = { page: 1, pageSize: 100, active: true, search: debouncedSalonSearch || undefined };
  const { data: availableSalons, isLoading: salonsLoading, error: salonsError } = useAdminListSalons(salonListParams, {
    query: { enabled: needsSalonList, queryKey: getAdminListSalonsQueryKey(salonListParams) },
  });
  const { data: availableCenters, isLoading: centersLoading, error: centersError } = useListAdminEducationCenters({
    query: { enabled: needsCenterList, queryKey: getListAdminEducationCentersQueryKey() },
  });
  const exitTransition = useAdminGetBusinessRoleTransition(userToExit?.id ?? "", {
    query: {
      enabled: exitOpen && Boolean(userToExit),
      queryKey: getAdminGetBusinessRoleTransitionQueryKey(userToExit?.id ?? ""),
      retry: false,
    },
  });
  const exitBusinessRole = useAdminTransitionBusinessRole();
  const exitRelations = exitTransition.data ? toBusinessExitRelations(exitTransition.data) : [];
  
  const mutateFnRef = useRef(updateUser.mutate);
  mutateFnRef.current = updateUser.mutate;

  const handleToggleActive = (id: string, currentValue: boolean) => {
    mutateFnRef.current({
      userId: id,
      data: { active: !currentValue }
    }, {
      onSuccess: () => {
        toast.success("Korisnik ažuriran", { description: "Status naloga je promenjen." });
        queryClient.invalidateQueries({ queryKey: getAdminListUsersQueryKey() });
      },
      onError: () => {
        toast.error("Greška", { description: "Nije moguće ažurirati korisnika." });
      }
    });
  };

  const handleChangeRole = (id: string, newRole: AdminUserUpdateRole) => {
    if (!window.confirm("Da li ste sigurni da želite promeniti ulogu ovog korisnika?")) return;
    
    mutateFnRef.current({
      userId: id,
      data: { role: newRole }
    }, {
      onSuccess: () => {
        toast.success("Uloga promenjena", { description: "Uloga korisnika je uspešno ažurirana." });
        queryClient.invalidateQueries({ queryKey: getAdminListUsersQueryKey() });
      },
      onError: () => {
        toast.error("Greška", { description: "Nije moguće promeniti ulogu." });
      }
    });
  };

  const openBusinessExitDialog = (user: AdminUser) => {
    setUserToExit(user);
    setExitTargetRole("");
    setExitDecisions({});
    setExitTransferTargets({});
    setExitValidationError("");
    exitBusinessRole.reset();
    setExitOpen(true);
  };

  const closeBusinessExitDialog = (force = false) => {
    if (exitBusinessRole.isPending && !force) return;
    setExitOpen(false);
    setUserToExit(null);
    setExitTargetRole("");
    setExitDecisions({});
    setExitTransferTargets({});
    setExitValidationError("");
    exitBusinessRole.reset();
  };

  const handleBusinessExit = () => {
    if (!userToExit || !exitTransition.data) return;
    if (!businessExitTargetRoles.includes(exitTargetRole as BusinessExitTargetRole)) {
      setExitValidationError("Izaberite jednu od dozvoljenih ciljnih uloga.");
      return;
    }
    const undecided = exitRelations.filter((relation) => {
      const decision = exitDecisions[relation.id];
      return !decision || !relation.decisions.some((option) => option.value === decision);
    });
    if (undecided.length) {
      setExitValidationError(`Donesite odluku za svaku poslovnu vezu (${undecided.length} preostalo).`);
      return;
    }
    const invalidTransfers = exitRelations.filter((relation) =>
      exitDecisions[relation.id] === "transfer"
      && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(exitTransferTargets[relation.id]?.trim() ?? ""),
    );
    if (invalidTransfers.length) {
      setExitValidationError("Za svaki prenos unesite ispravan ID korisnika koji preuzima poslovnu vezu.");
      return;
    }

    setExitValidationError("");
    exitBusinessRole.mutate({
      userId: userToExit.id,
      data: buildBusinessExitInput(
        exitTargetRole as AdminBusinessRoleTransitionInput["role"],
        exitTransition.data.user.active,
        exitRelations,
        exitDecisions,
        exitTransferTargets,
      ),
    }, {
      onSuccess: () => {
        toast.success("Poslovna uloga je završena", {
          description: "Nova uloga je aktivna, a istorijski podaci su sačuvani.",
        });
        queryClient.invalidateQueries({ queryKey: getAdminListUsersQueryKey() });
        queryClient.invalidateQueries({ queryKey: getAdminGetBusinessRoleTransitionQueryKey(userToExit.id) });
        closeBusinessExitDialog(true);
      },
      onError: (businessExitError) => {
        setExitValidationError(getApiError(businessExitError));
      },
    });
  };

  const reloadBusinessExitPlan = () => {
    setExitDecisions({});
    setExitTransferTargets({});
    setExitValidationError("");
    exitBusinessRole.reset();
    queryClient.invalidateQueries({ queryKey: getAdminListUsersQueryKey() });
    queryClient.invalidateQueries({ queryKey: getAdminGetBusinessRoleTransitionQueryKey(userToExit?.id ?? "") });
    exitTransition.refetch();
  };

  const handleResetFilters = () => {
    setSearch("");
    setRoleFilter("all");
    setActiveFilter("all");
  };

  const openConvertDialog = (user: AdminUser) => {
    setUserToConvert(user);
    setConvertForm({
      ...emptyAccountForm(),
      role: "SALON_OWNER",
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
    });
    setConvertOpen(true);
  };

  const closeConvertDialog = () => {
    setConvertOpen(false);
    setUserToConvert(null);
    setConvertForm(emptyAccountForm());
    setSalonSearch("");
    convertUser.reset();
  };

  const handleConvertUser = () => {
    if (!userToConvert) return;

    if (convertForm.role === "SALON_EMPLOYEE" && !convertForm.employee.salonId) {
      toast.error("Izaberite salon", { description: "Zaposleni mora biti povezan sa postojećim salonom." });
      return;
    }
    if (convertForm.role === "INSTRUCTOR" && !convertForm.instructor.centerId) {
      toast.error("Izaberite edukativni centar", { description: "Instruktor mora biti povezan sa postojećim centrom." });
      return;
    }

    const roleName = roleNames[convertForm.role] ?? convertForm.role;
    if (!window.confirm(`Konvertovati nalog korisnika ${userToConvert.firstName} ${userToConvert.lastName} u poslovni nalog: ${roleName}? Ova akcija se ne može poništiti.`)) return;

    let data: AdminBusinessAccountConversionInput;
    if (convertForm.role === "SALON_OWNER") {
      data = {
        role: "SALON_OWNER",
        salon: {
          name: convertForm.salon.name.trim(),
          slug: convertForm.salon.slug.trim(),
          city: convertForm.salon.city.trim(),
          municipality: convertForm.salon.municipality.trim(),
          address: convertForm.salon.address.trim(),
          postalCode: convertForm.salon.postalCode.trim() || undefined,
          phone: convertForm.salon.phone.trim(),
          email: convertForm.salon.email.trim(),
          companyName: convertForm.salon.companyName.trim(),
          companyTaxId: convertForm.salon.companyTaxId.trim(),
          companyRegistrationNumber: convertForm.salon.companyRegistrationNumber.trim(),
          companyAddress: convertForm.salon.companyAddress.trim(),
          companyCity: convertForm.salon.companyCity.trim(),
          companyPostalCode: convertForm.salon.companyPostalCode.trim() || undefined,
          shortDescription: convertForm.salon.shortDescription.trim(),
          description: convertForm.salon.description.trim(),
        },
      };
    } else if (convertForm.role === "SALON_EMPLOYEE") {
      data = {
        role: "SALON_EMPLOYEE",
        employee: {
          salonId: convertForm.employee.salonId,
          jobTitle: convertForm.employee.jobTitle.trim(),
          bio: convertForm.employee.bio.trim() || undefined,
        },
      };
    } else if (convertForm.role === "EDUKATIVNI_CENTAR") {
      data = {
        role: "EDUKATIVNI_CENTAR",
        educationCenter: {
          name: convertForm.educationCenter.name.trim(),
          city: convertForm.educationCenter.city.trim(),
          description: convertForm.educationCenter.description.trim(),
          contactEmail: convertForm.educationCenter.contactEmail.trim(),
          contactPhone: convertForm.educationCenter.contactPhone.trim(),
          contactAddress: convertForm.educationCenter.contactAddress.trim(),
          pib: convertForm.educationCenter.pib.trim(),
        },
      };
    } else if (convertForm.role === "INSTRUCTOR") {
      const specializations = convertForm.instructor.specializations.split(",").map((value) => value.trim()).filter(Boolean);
      const qualifications = convertForm.instructor.qualifications.split(",").map((value) => value.trim()).filter(Boolean);
      data = {
        role: "INSTRUCTOR",
        instructor: {
          centerId: convertForm.instructor.centerId,
          biography: convertForm.instructor.biography.trim() || undefined,
          industryYears: convertForm.instructor.industryYears === "" ? undefined : Number(convertForm.instructor.industryYears),
          experienceYears: convertForm.instructor.experienceYears === "" ? undefined : Number(convertForm.instructor.experienceYears),
          ...(specializations.length ? { specializations } : {}),
          ...(qualifications.length ? { qualifications } : {}),
        },
      };
    } else {
      toast.error("Nepoznata uloga za konverziju");
      return;
    }

    convertUser.mutate({ userId: userToConvert.id, data }, {
      onSuccess: () => {
        toast.success("Nalog uspešno konvertovan", { description: `Korisnik je sada ${roleName}.` });
        queryClient.invalidateQueries({ queryKey: getAdminListUsersQueryKey() });
        closeConvertDialog();
      },
      onError: (err: any) => {
        toast.error("Greška pri konverziji", { description: err?.message || "Došlo je do neočekivane greške." });
      }
    });
  };

  const closeCreateDialog = () => {
    setCreateOpen(false);
    setSetupResult(null);
    setCopied(false);
    setSalonSearch("");
    setCustomerForm(emptyAccountForm());
    createCustomer.reset();
    reissueCustomerSetup.reset();
  };

  const handleCreateCustomer = () => {
    const roleName = roleNames[customerForm.role] ?? "korisnika";
    if (customerForm.role === "SALON_EMPLOYEE" && !customerForm.employee.salonId) {
      toast.error("Izaberite salon", { description: "Zaposleni mora biti povezan sa postojećim salonom." });
      return;
    }
    if (customerForm.role === "INSTRUCTOR" && !customerForm.instructor.centerId) {
      toast.error("Izaberite edukativni centar", { description: "Instruktor mora biti povezan sa postojećim centrom." });
      return;
    }
    if (!window.confirm(`Kreirati nalog ${roleName} i izdati jednokratni link koji važi 15 minuta?`)) return;

    const common = {
      firstName: customerForm.firstName.trim(),
      lastName: customerForm.lastName.trim(),
      email: customerForm.email.trim(),
    };
    let data: AdminCreateAccountSetupInput;
    if (customerForm.role === "SALON_OWNER") {
      data = {
        ...common,
        role: "SALON_OWNER",
        salon: {
          name: customerForm.salon.name.trim(),
          slug: customerForm.salon.slug.trim(),
          city: customerForm.salon.city.trim(),
          municipality: customerForm.salon.municipality.trim(),
          address: customerForm.salon.address.trim(),
          postalCode: customerForm.salon.postalCode.trim() || undefined,
          phone: customerForm.salon.phone.trim(),
          email: customerForm.salon.email.trim(),
          companyName: customerForm.salon.companyName.trim(),
          companyTaxId: customerForm.salon.companyTaxId.trim(),
          companyRegistrationNumber: customerForm.salon.companyRegistrationNumber.trim(),
          companyAddress: customerForm.salon.companyAddress.trim(),
          companyCity: customerForm.salon.companyCity.trim(),
          companyPostalCode: customerForm.salon.companyPostalCode.trim() || undefined,
          shortDescription: customerForm.salon.shortDescription.trim(),
          description: customerForm.salon.description.trim(),
        },
      };
    } else if (customerForm.role === "SALON_EMPLOYEE") {
      data = {
        ...common,
        role: "SALON_EMPLOYEE",
        employee: {
          salonId: customerForm.employee.salonId,
          jobTitle: customerForm.employee.jobTitle.trim(),
          bio: customerForm.employee.bio.trim() || undefined,
        },
      };
    } else if (customerForm.role === "EDUKATIVNI_CENTAR") {
      data = {
        ...common,
        role: "EDUKATIVNI_CENTAR",
        educationCenter: {
          name: customerForm.educationCenter.name.trim(),
          city: customerForm.educationCenter.city.trim(),
          description: customerForm.educationCenter.description.trim(),
          contactEmail: customerForm.educationCenter.contactEmail.trim(),
          contactPhone: customerForm.educationCenter.contactPhone.trim(),
          contactAddress: customerForm.educationCenter.contactAddress.trim(),
          pib: customerForm.educationCenter.pib.trim(),
        },
      };
    } else if (customerForm.role === "INSTRUCTOR") {
      const specializations = customerForm.instructor.specializations.split(",").map((value) => value.trim()).filter(Boolean);
      const qualifications = customerForm.instructor.qualifications.split(",").map((value) => value.trim()).filter(Boolean);
      data = {
        ...common,
        role: "INSTRUCTOR",
        instructor: {
          centerId: customerForm.instructor.centerId,
          biography: customerForm.instructor.biography.trim() || undefined,
          industryYears: customerForm.instructor.industryYears === "" ? undefined : Number(customerForm.instructor.industryYears),
          experienceYears: customerForm.instructor.experienceYears === "" ? undefined : Number(customerForm.instructor.experienceYears),
          ...(specializations.length ? { specializations } : {}),
          ...(qualifications.length ? { qualifications } : {}),
        },
      };
    } else {
      data = { ...common, role: customerForm.role };
    }

    createCustomer.mutate({ data }, {
      onSuccess: (result) => {
        setSetupResult({ setupUrl: result.setupUrl, expiresAt: result.expiresAt });
        queryClient.invalidateQueries({ queryKey: getAdminListUsersQueryKey() });
        toast.success(`Nalog ${roleName} je kreiran`, { description: "Kopirajte setup link pre zatvaranja prozora." });
      },
      onError: () => {
        toast.error("Kreiranje nije uspelo", { description: "Proverite podatke ili da li e-mail već postoji." });
      },
    });
  };

  const copySetupUrl = async () => {
    if (!setupResult) return;
    try {
      await navigator.clipboard.writeText(setupResult.setupUrl);
      setCopied(true);
      toast.success("Setup link je kopiran.");
    } catch {
      toast.error("Kopiranje nije uspelo", { description: "Označite link i kopirajte ga ručno." });
    }
  };

  const handleReissueSetup = (userId: string) => {
    if (!window.confirm("Izdati novi jednokratni link? Prethodni link će odmah biti poništen.")) return;
    reissueCustomerSetup.mutate({ userId }, {
      onSuccess: (result) => {
        setSetupResult({ setupUrl: result.setupUrl, expiresAt: result.expiresAt });
        setCreateOpen(true);
        toast.success("Novi setup link je izdat", { description: "Kopirajte ga pre zatvaranja prozora." });
      },
      onError: () => toast.error("Nije moguće izdati novi link", { description: "Link je dostupan samo za aktivan nalog bez postavljene lozinke." }),
    });
  };

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-serif font-bold text-foreground">Upravljanje Korisnicima</h1>
              <p className="text-muted-foreground text-sm">
                {canManageUsers
                  ? "Pregled i modifikacija svih korisničkih naloga."
                  : "Pregled korisničkih naloga. Promene uloga i statusa dostupne su samo super administratorima."}
              </p>
            </div>
            {canManageUsers && (
              <Button onClick={() => setCreateOpen(true)} data-testid="btn-create-account">
                <UserPlus className="mr-2 h-4 w-4" />
                Kreiraj nalog
              </Button>
            )}
          </div>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 p-4 bg-card rounded-xl border shadow-sm">
            <div className="relative md:col-span-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input 
                placeholder="Pretraži..." 
                className="pl-9 h-9"
                value={search}
                onChange={e => setSearch(e.target.value)}
                data-testid="input-search-users"
              />
            </div>
            
            <Select value={roleFilter} onValueChange={setRoleFilter}>
              <SelectTrigger className="h-9" data-testid="select-role-filter">
                <SelectValue placeholder="Sve uloge" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Sve uloge</SelectItem>
                <SelectItem value="CUSTOMER">Klijent</SelectItem>
                <SelectItem value="SALON_OWNER">Vlasnik Salona</SelectItem>
                <SelectItem value="SALON_EMPLOYEE">Zaposleni (Salon)</SelectItem>
                <SelectItem value="EDUKATIVNI_CENTAR">Edukativni centar</SelectItem>
                <SelectItem value="INSTRUCTOR">Instruktor</SelectItem>
                <SelectItem value="ADMIN">Admin</SelectItem>
                <SelectItem value="SUPER_ADMIN">Super Admin</SelectItem>
              </SelectContent>
            </Select>

            <Select value={activeFilter} onValueChange={setActiveFilter}>
              <SelectTrigger className="h-9" data-testid="select-active-filter">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Svi statusi</SelectItem>
                <SelectItem value="true">Aktivni</SelectItem>
                <SelectItem value="false">Neaktivni</SelectItem>
              </SelectContent>
            </Select>
            
            <Button variant="outline" className="h-9 w-full" onClick={handleResetFilters} data-testid="btn-reset-filters">
              <FilterX className="w-4 h-4 mr-2" /> Očisti filtere
            </Button>
          </div>
        </div>

        <div className="bg-card rounded-xl border shadow-sm overflow-hidden">
          {isLoading ? (
            <div className="flex justify-center p-12"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
          ) : error ? (
            <div className="p-8 text-center text-destructive">Došlo je do greške pri učitavanju korisnika.</div>
          ) : !users || users.length === 0 ? (
            <div className="p-12 flex flex-col items-center justify-center text-muted-foreground">
              <UsersIcon className="w-12 h-12 mb-4 opacity-20" />
              <p>Nema pronađenih korisnika za odabrane filtere.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="bg-muted/50 text-muted-foreground font-medium border-b">
                  <tr>
                    <th className="px-6 py-4">Korisnik</th>
                    <th className="px-6 py-4">Kontakt</th>
                    <th className="px-6 py-4">Uloga</th>
                    <th className="px-6 py-4 text-center">Aktivno</th>
                     <th className="px-6 py-4 text-right">Akcije</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {users.map(user => (
                    <tr key={user.id} className="hover:bg-muted/20 transition-colors" data-testid={`row-user-${user.id}`}>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-serif font-bold shrink-0">
                            {user.firstName[0]}{user.lastName[0]}
                          </div>
                          <div className="flex flex-col">
                            <span className="font-semibold text-foreground">{user.firstName} {user.lastName}</span>
                            <span className="text-xs text-muted-foreground">Pridružio/la se {new Date(user.createdAt).toLocaleDateString('sr-RS')}</span>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-col gap-1 text-muted-foreground">
                          <span className="flex items-center gap-1.5"><Mail className="w-3.5 h-3.5" /> {user.email}</span>
                          {user.phone && <span className="flex items-center gap-1.5 text-xs">{user.phone}</span>}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <select 
                          className="bg-transparent border border-border rounded-md px-2 py-1 text-xs font-medium focus:ring-1 focus:ring-primary outline-none cursor-pointer"
                          value={user.role}
                          onChange={(e) => handleChangeRole(user.id, e.target.value as AdminUserUpdateRole)}
                           disabled={!canManageUsers || updateUser.isPending || ["SALON_OWNER", "SALON_EMPLOYEE", "EDUKATIVNI_CENTAR", "INSTRUCTOR"].includes(user.role)}
                           aria-label={canManageUsers ? "Promeni ulogu korisnika" : "Samo super administrator može promeniti ulogu"}
                          data-testid={`select-role-${user.id}`}
                        >
                          <option value="CUSTOMER">Klijent</option>
                          <option value="SALON_OWNER" disabled={user.role !== "SALON_OWNER"}>Vlasnik Salona</option>
                          <option value="SALON_EMPLOYEE" disabled={user.role !== "SALON_EMPLOYEE"}>Zaposleni (Salon)</option>
                          <option value="EDUKATIVNI_CENTAR" disabled={user.role !== "EDUKATIVNI_CENTAR"}>Edukativni centar</option>
                          <option value="INSTRUCTOR" disabled={user.role !== "INSTRUCTOR"}>Instruktor</option>
                          <option value="JOBSEEKER" disabled={user.role !== "JOBSEEKER"}>Tražilac posla</option>
                          <option value="STUDENT" disabled={user.role !== "STUDENT"}>Student</option>
                          <option value="ADMIN">Admin</option>
                          <option value="SUPER_ADMIN">Super Admin</option>
                        </select>
                      </td>
                      <td className="px-6 py-4 text-center align-middle">
                        <div className="flex justify-center">
                          <Switch 
                            checked={user.active} 
                            onCheckedChange={() => handleToggleActive(user.id, user.active)}
                            disabled={!canManageUsers || updateUser.isPending}
                            aria-label={canManageUsers ? "Promeni status korisnika" : "Samo super administrator može promeniti status"}
                            data-testid={`toggle-active-${user.id}`}
                          />
                        </div>
                      </td>
                       <td className="px-6 py-4 text-right">
                         <div className="flex justify-end items-center gap-2">
                           {canManageUsers && ["SALON_OWNER", "SALON_EMPLOYEE", "EDUKATIVNI_CENTAR", "INSTRUCTOR"].includes(user.role) && (
                             <Button variant="outline" size="sm" onClick={() => openBusinessExitDialog(user)} aria-label="Završi poslovnu ulogu" data-testid={`button-business-exit-${user.id}`}>
                               <LogOut className="mr-1.5 h-4 w-4" /> Izlazak
                             </Button>
                           )}
                           {canManageUsers && user.active && ["CUSTOMER", "JOBSEEKER", "STUDENT", "ADMIN"].includes(user.role) && (
                             <Button variant="outline" size="sm" onClick={() => openConvertDialog(user)} aria-label="Konvertuj u poslovni nalog" data-testid={`btn-convert-${user.id}`}>
                               <Briefcase className="w-4 h-4 mr-1.5" /> Konverzija
                             </Button>
                           )}
                           {canManageUsers && user.role !== "SUPER_ADMIN" && user.active && !user.passwordSetAt && (
                             <Button variant="outline" size="sm" disabled={reissueCustomerSetup.isPending} onClick={() => handleReissueSetup(user.id)}>
                               Novi link
                             </Button>
                           )}
                         </div>
                       </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {!isLoading && !error && users && users.length > 0 && (
          <div className="flex items-center justify-between gap-3">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))} data-testid="btn-prev-page">Prethodna</Button>
            <span className="text-sm text-muted-foreground">Strana {page}</span>
            <Button variant="outline" size="sm" disabled={!hasNextPage} onClick={() => setPage(p => p + 1)} data-testid="btn-next-page">Sledeća</Button>
          </div>
        )}

        <Dialog open={createOpen} onOpenChange={(open) => { if (!open) closeCreateDialog(); }}>
          <DialogContent className="flex max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-3xl flex-col overflow-hidden rounded-xl">
            <DialogHeader>
              <DialogTitle>{setupResult ? "Jednokratni setup link" : "Kreiraj nalog"}</DialogTitle>
              <DialogDescription>
                {setupResult
                  ? "Ovaj link se prikazuje samo sada. Bezbedno ga prosledite korisniku i zatim zatvorite prozor."
                  : "Korisnik neće dobiti SMS ili e-mail. Lozinku će sam postaviti preko jednokratnog linka."}
              </DialogDescription>
            </DialogHeader>
            {setupResult ? (
              <div className="space-y-4">
                <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900" role="status">
                  Link važi do {new Date(setupResult.expiresAt).toLocaleTimeString("sr-RS", { hour: "2-digit", minute: "2-digit" })}.
                  Posle zatvaranja ga nije moguće ponovo prikazati.
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input readOnly value={setupResult.setupUrl} onFocus={(event) => event.currentTarget.select()} aria-label="Jednokratni setup link" />
                  <Button type="button" variant="outline" onClick={copySetupUrl} className="shrink-0">
                    {copied ? <Check className="mr-2 h-4 w-4" /> : <Copy className="mr-2 h-4 w-4" />}
                    {copied ? "Kopirano" : "Kopiraj"}
                  </Button>
                </div>
              </div>
            ) : (
              <form className="flex min-h-0 flex-1 flex-col" onSubmit={(event) => { event.preventDefault(); handleCreateCustomer(); }}>
                <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-1 pb-4">
                  <fieldset className="space-y-4">
                    <legend className="mb-3 text-sm font-semibold">Podaci naloga</legend>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="create-first-name">Ime</Label>
                        <Input id="create-first-name" required maxLength={100} value={customerForm.firstName} onChange={(event) => setCustomerForm((value) => ({ ...value, firstName: event.target.value }))} data-testid="input-create-first-name" />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="create-last-name">Prezime</Label>
                        <Input id="create-last-name" required maxLength={100} value={customerForm.lastName} onChange={(event) => setCustomerForm((value) => ({ ...value, lastName: event.target.value }))} data-testid="input-create-last-name" />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="create-email">E-mail adresa</Label>
                      <Input id="create-email" required type="email" maxLength={320} value={customerForm.email} onChange={(event) => setCustomerForm((value) => ({ ...value, email: event.target.value }))} data-testid="input-create-email" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="create-role">Uloga</Label>
                      <Select value={customerForm.role} onValueChange={(role) => setCustomerForm((value) => ({ ...value, role: role as AdminCreateAccountSetupInput["role"] }))}>
                        <SelectTrigger id="create-role" data-testid="select-create-role"><SelectValue placeholder="Uloga" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="CUSTOMER">Klijent</SelectItem>
                          <SelectItem value="JOBSEEKER">Tražilac posla</SelectItem>
                          <SelectItem value="STUDENT">Student</SelectItem>
                          <SelectItem value="ADMIN">Administrator</SelectItem>
                          <SelectItem value="SALON_OWNER">Vlasnik salona</SelectItem>
                          <SelectItem value="SALON_EMPLOYEE">Zaposleni u salonu</SelectItem>
                          <SelectItem value="EDUKATIVNI_CENTAR">Edukativni centar</SelectItem>
                          <SelectItem value="INSTRUCTOR">Instruktor</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </fieldset>

                  <BusinessFields
                    form={customerForm}
                    setForm={setCustomerForm}
                    salonSearch={salonSearch}
                    setSalonSearch={setSalonSearch}
                    salonsLoading={salonsLoading}
                    salonsError={salonsError}
                    availableSalons={availableSalons}
                    centersLoading={centersLoading}
                    centersError={centersError}
                    availableCenters={availableCenters}
                  />
                </div>
                <DialogFooter className="border-t pt-4">
                  <Button type="button" variant="outline" onClick={closeCreateDialog}>Otkaži</Button>
                  <Button type="submit" disabled={createCustomer.isPending || salonsLoading || centersLoading || Boolean(salonsError) || Boolean(centersError)} data-testid="button-create-account">
                    {createCustomer.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Kreiraj i izdaj link
                  </Button>
                </DialogFooter>
              </form>
            )}
            {setupResult && <DialogFooter><Button onClick={closeCreateDialog}>Završi</Button></DialogFooter>}
          </DialogContent>
        </Dialog>

        <Dialog open={exitOpen} onOpenChange={(open) => { if (!open) closeBusinessExitDialog(); }}>
          <DialogContent className="flex max-h-[92dvh] w-[calc(100%_-_1.5rem)] max-w-3xl flex-col overflow-hidden rounded-xl p-4 sm:p-6">
            <DialogHeader>
              <DialogTitle>Bezbedan izlazak iz poslovne uloge</DialogTitle>
              <DialogDescription>
                {userToExit?.firstName} {userToExit?.lastName} ({userToExit?.email})
              </DialogDescription>
            </DialogHeader>

            <div className="min-h-0 flex-1 overflow-y-auto pr-1">
              {exitTransition.isLoading ? (
                <div className="flex min-h-48 flex-col items-center justify-center gap-3 text-sm text-muted-foreground" data-testid="status-business-exit-loading">
                  <Loader2 className="h-6 w-6 animate-spin text-primary" />
                  Učitavanje svih postojećih poslovnih veza…
                </div>
              ) : exitTransition.error ? (
                <div className="space-y-4 rounded-lg border border-destructive/30 bg-destructive/5 p-4" role="alert" data-testid="error-business-exit-plan">
                  <div className="flex items-start gap-3">
                    <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
                    <div>
                      <p className="font-medium text-destructive">Pregled nije moguće učitati</p>
                      <p className="mt-1 text-sm text-muted-foreground">{getApiError(exitTransition.error)}</p>
                    </div>
                  </div>
                  <Button type="button" variant="outline" size="sm" onClick={reloadBusinessExitPlan} data-testid="button-retry-business-exit-plan">
                    Pokušaj ponovo
                  </Button>
                </div>
              ) : exitTransition.data ? (
                <form id="business-exit-form" className="space-y-5" onSubmit={(event) => { event.preventDefault(); handleBusinessExit(); }}>
                  <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100" data-testid="notice-business-exit-history">
                    <p className="font-semibold">Istorijski podaci se ne brišu</p>
                    <p className="mt-1">
                      Završene rezervacije, transakcije, evidencije i izveštaji ostaju sačuvani.
                      Odluke ispod određuju samo budući status svake aktivne poslovne veze.
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="business-exit-target-role">Nova uloga</Label>
                    <Select value={exitTargetRole} onValueChange={(role) => {
                      setExitTargetRole(role);
                      setExitValidationError("");
                    }}>
                      <SelectTrigger id="business-exit-target-role" data-testid="select-business-exit-target-role">
                        <SelectValue placeholder="Izaberite dozvoljenu ciljnu ulogu" />
                      </SelectTrigger>
                      <SelectContent>
                        {businessExitTargetRoles.map((role) => (
                          <SelectItem key={role} value={role}>{roleNames[role] ?? role}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <fieldset className="space-y-3">
                    <legend className="text-sm font-semibold">
                      Poslovne veze ({exitRelations.length})
                    </legend>
                    {exitRelations.length === 0 ? (
                      <p className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground" data-testid="status-business-exit-no-relations">
                        Nema aktivnih poslovnih veza koje zahtevaju odluku.
                      </p>
                    ) : (
                      <div className="grid gap-3 md:grid-cols-2">
                        {exitRelations.map((relation) => (
                          <div key={relation.id} className="space-y-3 rounded-lg border p-4" data-testid={`card-business-relation-${relation.id}`}>
                            <div>
                              <p className="font-medium" data-testid={`text-business-relation-${relation.id}`}>{relation.label}</p>
                              <p className="text-xs text-muted-foreground">
                                {relation.description ?? relation.type} · {relation.active ? "aktivna" : "neaktivna"}
                              </p>
                            </div>
                            <div className="space-y-2">
                              <Label htmlFor={`business-relation-${relation.id}`}>Obavezna odluka</Label>
                              <Select value={exitDecisions[relation.id] ?? ""} onValueChange={(decision) => {
                                setExitDecisions((current) => ({ ...current, [relation.id]: decision }));
                                setExitValidationError("");
                              }}>
                                <SelectTrigger id={`business-relation-${relation.id}`} data-testid={`select-business-relation-decision-${relation.id}`}>
                                  <SelectValue placeholder="Izaberite odluku" />
                                </SelectTrigger>
                                <SelectContent>
                                  {relation.decisions.map((decision) => (
                                    <SelectItem key={decision.value} value={decision.value}>
                                      {decision.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              {exitDecisions[relation.id] && (
                                <p className="text-xs text-muted-foreground">
                                  {relation.decisions.find((option) => option.value === exitDecisions[relation.id])?.description}
                                </p>
                              )}
                              {exitDecisions[relation.id] === "transfer" && (
                                <div className="space-y-2 pt-1">
                                  <Label htmlFor={`business-relation-target-${relation.id}`}>ID korisnika koji preuzima vezu</Label>
                                  <Input
                                    id={`business-relation-target-${relation.id}`}
                                    required
                                    value={exitTransferTargets[relation.id] ?? ""}
                                    onChange={(event) => {
                                      setExitTransferTargets((current) => ({ ...current, [relation.id]: event.target.value }));
                                      setExitValidationError("");
                                    }}
                                    placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                                    data-testid={`input-business-relation-target-${relation.id}`}
                                  />
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </fieldset>

                  {exitValidationError && (
                    <div className="space-y-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive" role="alert" data-testid="error-business-exit-submit">
                      <p>{exitValidationError}</p>
                      {exitBusinessRole.isError && (
                        <Button type="button" variant="outline" size="sm" onClick={reloadBusinessExitPlan} data-testid="button-reload-business-exit-conflict">
                          Ponovo učitaj veze
                        </Button>
                      )}
                    </div>
                  )}
                </form>
              ) : null}
            </div>

            <DialogFooter className="gap-2 border-t pt-4 sm:gap-0">
              <Button type="button" variant="outline" onClick={() => closeBusinessExitDialog()} disabled={exitBusinessRole.isPending} data-testid="button-cancel-business-exit">
                Otkaži
              </Button>
              <Button
                type="submit"
                form="business-exit-form"
                disabled={!exitTransition.data || exitBusinessRole.isPending || exitTransition.isFetching}
                data-testid="button-submit-business-exit"
              >
                {exitBusinessRole.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Potvrdi izlazak
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={convertOpen} onOpenChange={(open) => { if (!open) closeConvertDialog(); }}>
          <DialogContent className="flex max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-3xl flex-col overflow-hidden rounded-xl">
            <DialogHeader>
              <DialogTitle>Konverzija Naloga</DialogTitle>
              <DialogDescription>
                Konvertovanje postojećeg naloga ({userToConvert?.email}) u poslovni profil.
                Ova akcija automatski kreira neophodne poslovne entitete i trajno menja ulogu korisnika.
              </DialogDescription>
            </DialogHeader>
            <form className="flex min-h-0 flex-1 flex-col" onSubmit={(event) => { event.preventDefault(); handleConvertUser(); }}>
              <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-1 pb-4">
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="convert-role">Ciljna uloga</Label>
                    <Select value={convertForm.role} onValueChange={(role) => setConvertForm((value) => ({ ...value, role: role as AccountForm["role"] }))}>
                      <SelectTrigger id="convert-role" data-testid="select-convert-role"><SelectValue placeholder="Izaberite ulogu" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="SALON_OWNER">Vlasnik salona</SelectItem>
                        <SelectItem value="SALON_EMPLOYEE">Zaposleni u salonu</SelectItem>
                        <SelectItem value="EDUKATIVNI_CENTAR">Edukativni centar</SelectItem>
                        <SelectItem value="INSTRUCTOR">Instruktor</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <BusinessFields
                  form={convertForm}
                  setForm={setConvertForm}
                  salonSearch={salonSearch}
                  setSalonSearch={setSalonSearch}
                  salonsLoading={salonsLoading}
                  salonsError={salonsError}
                  availableSalons={availableSalons}
                  centersLoading={centersLoading}
                  centersError={centersError}
                  availableCenters={availableCenters}
                />
              </div>
              <DialogFooter className="border-t pt-4">
                <Button type="button" variant="outline" onClick={closeConvertDialog}>Otkaži</Button>
                <Button type="submit" disabled={convertUser.isPending || salonsLoading || centersLoading || Boolean(salonsError) || Boolean(centersError)} data-testid="button-convert-account">
                  {convertUser.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Potvrdi Konverziju
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>
    </AdminLayout>
  );
}
